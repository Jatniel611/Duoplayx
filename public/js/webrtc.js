/**
 * WebRTCVoiceManager - Sistema de Sala de Voz en Vivo DuoPlayX
 * 
 * 1. Todos los usuarios que entran a la sala escuchan automáticamente el canal de voz.
 * 2. Transceiver único en m-line #0 para evitar m-lines vacíos fantasma.
 * 3. Botón único de "Encender / Apagar Micrófono" e indicador neón de volumen.
 * 4. Servidores STUN y TURN de relevo integrados para 4G/5G y redes hogareñas.
 * 5. Salida directa por elementos <audio> nativos desbloqueados.
 */

class WebRTCVoiceManager {
  constructor() {
    this.localStream = null;
    this.peerConnections = new Map(); // socketId -> RTCPeerConnection
    this.iceCandidateQueues = new Map();
    this.inVoiceRoom = true;
    this.isMuted = true;
    this.audioContext = null;
    this.analyser = null;
    this._analyserTimerId = null;
    this.selectedMicId = null;
    this.mutedPeers = new Set(); // Conjunto de socketIds silenciados manualmente por el usuario

    // Configuración de servidores ICE (STUN + TURN Relay público para 4G/5G)
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      sdpSemantics: 'unified-plan'
    };

    this._bindAutoplayUnlocker();
  }

  _bindAutoplayUnlocker() {
    const unlock = () => { this.unlockAudio(); };
    ['click', 'touchstart', 'keydown', 'pointerdown', 'touchend'].forEach(evt => {
      window.addEventListener(evt, unlock, { once: false, passive: true });
    });
  }

  // ─── Desbloqueo unificado de audio local y elementos remotos ─────────────────
  unlockAudio() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    document.querySelectorAll('audio[id^="audio_peer_"]').forEach(el => {
      try {
        el.muted = false;
        el.volume = 1.0;
        const p = el.play();
        if (p && typeof p.then === 'function') {
          p.catch(() => {});
        }
      } catch (e) {}
    });
  }

  async populateMicrophones(selectElement) {
    if (!selectElement) return;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        selectElement.innerHTML = '<option value="">Micrófono por defecto</option>';
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');

      selectElement.innerHTML = '';
      if (audioInputs.length === 0) {
        selectElement.innerHTML = '<option value="">Micrófono por defecto</option>';
        return;
      }

      audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Micrófono ${index + 1}`;
        if (this.selectedMicId && device.deviceId === this.selectedMicId) {
          option.selected = true;
        }
        selectElement.appendChild(option);
      });
    } catch (err) {
      console.warn('Error enumerando micrófonos:', err);
      selectElement.innerHTML = '<option value="">Micrófono por defecto</option>';
    }
  }

  async joinVoiceRoom() {
    this.inVoiceRoom = true;
    if (window.socketManager) window.socketManager.joinVoiceRoom();
    this.unlockAudio();
    return true;
  }

  leaveVoiceRoom() {
    this.inVoiceRoom = false;
    this.isMuted = true;
    this._stopAnalyser();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.peerConnections.forEach((pc, id) => {
      pc.close();
      this._removePeerAudio(id);
    });
    this.peerConnections.clear();
    this.iceCandidateQueues.clear();

    if (window.socketManager) window.socketManager.leaveVoiceRoom();
  }

  async changeMicDevice(deviceId) {
    this.selectedMicId = deviceId;
    if (!this.isMuted && this.localStream) {
      await this.turnOnMic(deviceId);
    }
  }

  async toggleMic(deviceId = null) {
    if (deviceId) this.selectedMicId = deviceId;

    if (this.isMuted) {
      return await this.turnOnMic(this.selectedMicId);
    } else {
      return this.turnOffMic();
    }
  }

  async turnOnMic(deviceId = null) {
    this.inVoiceRoom = true;
    if (window.socketManager) window.socketManager.joinVoiceRoom();

    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
      }

      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      if (deviceId && typeof deviceId === 'string' && deviceId.trim() !== '' && deviceId !== 'null' && deviceId !== 'undefined') {
        audioConstraints.deviceId = { exact: deviceId.trim() };
      }

      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        });
      } catch (errDevice) {
        console.warn('Falló captura con dispositivo exacto, intentando captura por defecto:', errDevice);
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
      }

      this.isMuted = false;
      this._startAnalyser();

      // Vincular la pista de audio al Transceiver único m-line #0 de cada peer
      const audioTrack = this.localStream.getAudioTracks()[0];
      
      this.peerConnections.forEach(async (pc, targetId) => {
        try {
          const transceivers = pc.getTransceivers();
          let audioTransceiver = transceivers.find(t => t.receiver.track.kind === 'audio' || t.sender.track?.kind === 'audio');
          
          if (audioTransceiver) {
            audioTransceiver.direction = 'sendrecv';
            await audioTransceiver.sender.replaceTrack(audioTrack);
          } else {
            pc.addTrack(audioTrack, this.localStream);
          }

          // Crear oferta de renegociación SDP
          if (pc.signalingState === 'stable') {
            const offer = await pc.createOffer({ offerToReceiveAudio: true });
            await pc.setLocalDescription(offer);
            window.socketManager.sendWebRTCSignal(targetId, { offer });
          }
        } catch (errReneg) {
          console.warn(`Error renegociando con peer ${targetId}:`, errReneg);
        }
      });

      window.socketManager.sendSpeakingState(false, false);
      if (window.appUI) {
        window.appUI.showToast('🎙️ Micrófono activado. ¡La sala te escucha!', 'success');
      }
      return false;
    } catch (e) {
      console.error('Error al acceder al micrófono:', e);
      this.isMuted = true;
      if (window.appUI) {
        window.appUI.showToast('No se pudo acceder al micrófono. Por favor permite los permisos.', 'warning');
      }
      return true;
    }
  }

  turnOffMic() {
    this.isMuted = true;
    this._stopAnalyser();

    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = false;
        track.stop();
      });
      this.localStream = null;
    }

    this.peerConnections.forEach(async (pc) => {
      const transceivers = pc.getTransceivers();
      const audioTransceiver = transceivers.find(t => t.receiver.track.kind === 'audio' || t.sender.track?.kind === 'audio');
      if (audioTransceiver && audioTransceiver.sender) {
        try { await audioTransceiver.sender.replaceTrack(null); } catch (e) {}
      }
    });

    window.socketManager.sendSpeakingState(false, true);
    if (window.appUI) {
      window.appUI.setUserSpeakingIndicator(window.socketManager.socket.id, false);
      window.appUI.showToast('🔇 Micrófono apagado', 'info');
    }
    return true;
  }

  syncVoicePeers(voiceMembers) {
    this.inVoiceRoom = true;

    const currentSocketId = window.socketManager.socket?.id;
    if (!currentSocketId) return;

    const voiceSocketIds = voiceMembers.map(m => m.socketId);

    voiceSocketIds.forEach(targetId => {
      if (targetId !== currentSocketId && !this.peerConnections.has(targetId)) {
        const isInitiator = currentSocketId < targetId;
        this._createPeerConnection(targetId, isInitiator);
      }
    });

    this.peerConnections.forEach((pc, targetId) => {
      if (!voiceSocketIds.includes(targetId)) {
        pc.close();
        this.peerConnections.delete(targetId);
        this._removePeerAudio(targetId);
      }
    });
  }

  // ─── Analizador de volumen local ──────────────────────────────────────────
  _startAnalyser() {
    this._stopAnalyser();

    if (!this.localStream) return;
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let lastSpeaking = false;

      const checkVolume = () => {
        if (this.isMuted || !this.analyser) {
          if (lastSpeaking) {
            lastSpeaking = false;
            window.socketManager.sendSpeakingState(false, true);
            if (window.appUI) window.appUI.setUserSpeakingIndicator(window.socketManager.socket.id, false);
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const average = sum / bufferLength;
        const isSpeaking = average > 14;

        if (isSpeaking !== lastSpeaking) {
          lastSpeaking = isSpeaking;
          window.socketManager.sendSpeakingState(isSpeaking, false);
          if (window.appUI) {
            window.appUI.setUserSpeakingIndicator(window.socketManager.socket.id, isSpeaking);
          }
        }

        this._analyserTimerId = setTimeout(checkVolume, 100);
      };

      checkVolume();
    } catch (e) {
      console.warn('AudioAnalyser error:', e);
    }
  }

  _stopAnalyser() {
    if (this._analyserTimerId) {
      clearTimeout(this._analyserTimerId);
      this._analyserTimerId = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
  }

  // ─── Crear conexión WebRTC con peer ─────────────────────────────────────────
  async _createPeerConnection(targetSocketId, isInitiator) {
    if (this.peerConnections.has(targetSocketId)) {
      return this.peerConnections.get(targetSocketId);
    }

    console.log(`🎙️ Creando conexión WebRTC P2P con peer: ${targetSocketId} (Iniciador: ${isInitiator})`);
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(targetSocketId, pc);
    this.iceCandidateQueues.set(targetSocketId, []);

    // Crear exactamente UN Transceiver de audio en m-line #0
    const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });

    if (this.localStream && this.localStream.getAudioTracks().length > 0) {
      const track = this.localStream.getAudioTracks()[0];
      audioTransceiver.sender.replaceTrack(track);
    }

    pc.ontrack = (event) => {
      console.log(`📡 [WebRTC ontrack] Pista remota recibida de ${targetSocketId}:`, event.track?.id, 'Kind:', event.track?.kind);
      if (event.track && event.track.kind === 'audio') {
        event.track.enabled = true;
        let stream = event.streams && event.streams[0];
        if (!stream) {
          stream = new MediaStream();
          stream.addTrack(event.track);
        }
        this._attachRemoteAudio(targetSocketId, stream);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.socketManager.sendWebRTCSignal(targetSocketId, { candidate: event.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`📡 [WebRTC ICE State] ${targetSocketId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this._checkAndAttachReceivers(targetSocketId, pc);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        window.socketManager.sendWebRTCSignal(targetSocketId, { offer });
      } catch (err) {
        console.error('Error creando oferta WebRTC:', err);
      }
    }

    return pc;
  }

  _checkAndAttachReceivers(senderSocketId, pc) {
    if (!pc) return;
    try {
      const receivers = pc.getReceivers();
      receivers.forEach(r => {
        if (r.track && r.track.kind === 'audio') {
          r.track.enabled = true;
          let stream = new MediaStream();
          stream.addTrack(r.track);
          this._attachRemoteAudio(senderSocketId, stream);
        }
      });
    } catch (e) {
      console.warn('Error verificando receivers:', e);
    }
  }

  // ─── Vincular elemento <audio> nativo desbloqueado ────────────────────────
  _attachRemoteAudio(targetSocketId, stream) {
    if (!targetSocketId || !stream) return;

    let audioEl = document.getElementById(`audio_peer_${targetSocketId}`);
    if (!audioEl) {
      console.log(`🔊 Creando elemento <audio> nativo para peer ${targetSocketId}`);
      audioEl = document.createElement('audio');
      audioEl.id = `audio_peer_${targetSocketId}`;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.cssText = 'position:fixed;bottom:2px;right:2px;width:4px;height:4px;opacity:0.01;pointer-events:none;z-index:99999;';
      document.body.appendChild(audioEl);
    }

    audioEl.srcObject = stream;

    if (this.mutedPeers.has(targetSocketId)) {
      audioEl.muted = true;
      audioEl.pause();
    } else {
      audioEl.muted = false;
      audioEl.volume = 1.0;

      const playAudio = () => {
        audioEl.muted = false;
        audioEl.volume = 1.0;
        const p = audioEl.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            console.log(`🔊 [Audio Out] Reproduciendo voz de ${targetSocketId} a través de altavoces`);
          }).catch(e => {
            console.warn(`[Audio Peer ${targetSocketId}] Play error:`, e.message);
          });
        }
      };

      const audioTracks = stream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = true;
        track.onunmute = () => {
          console.log(`🔊 [Track Unmuted] Pista de audio activa para peer ${targetSocketId}`);
          playAudio();
        };
      });

      playAudio();
    }
  }

  _removePeerAudio(socketId) {
    this.mutedPeers.delete(socketId);
    const audioEl = document.getElementById(`audio_peer_${socketId}`);
    if (audioEl && audioEl.parentNode) {
      audioEl.srcObject = null;
      audioEl.parentNode.removeChild(audioEl);
    }
  }

  togglePeerAudio(socketId) {
    if (this.mutedPeers.has(socketId)) {
      return this.unmutePeerAudio(socketId);
    } else {
      return this.mutePeerAudio(socketId);
    }
  }

  unmutePeerAudio(socketId) {
    this.mutedPeers.delete(socketId);
    const audioEl = document.getElementById(`audio_peer_${socketId}`);
    if (audioEl) {
      audioEl.muted = false;
      if (!audioEl.volume || audioEl.volume === 0) audioEl.volume = 1.0;
      const p = audioEl.play();
      if (p && typeof p.then === 'function') {
        p.catch(e => console.warn(`Error reproduciendo audio de ${socketId}:`, e));
      }
    }
    return false; // Retorna false = NO está silenciado (Escuchando)
  }

  mutePeerAudio(socketId) {
    this.mutedPeers.add(socketId);
    const audioEl = document.getElementById(`audio_peer_${socketId}`);
    if (audioEl) {
      audioEl.muted = true;
      audioEl.pause();
    }
    return true; // Retorna true = SÍ está silenciado
  }

  setPeerVolume(socketId, volumePercent) {
    const audioEl = document.getElementById(`audio_peer_${socketId}`);
    if (!audioEl) return;

    const vol = Math.max(0, Math.min(1, volumePercent / 100));
    audioEl.volume = vol;
    if (vol > 0 && !this.mutedPeers.has(socketId)) {
      audioEl.muted = false;
      audioEl.play().catch(() => {});
    }
  }

  isPeerMuted(socketId) {
    return this.mutedPeers.has(socketId);
  }

  async handleIncomingSignal(senderSocketId, signal) {
    this.inVoiceRoom = true;

    let pc = this.peerConnections.get(senderSocketId);
    if (!pc) {
      pc = await this._createPeerConnection(senderSocketId, false);
    }

    try {
      if (signal.offer) {
        if (pc.signalingState !== 'stable') {
          console.warn(`[SDP Glare] Conflicto de oferta detectado con ${senderSocketId}, ejecutando rollback...`);
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch (errRoll) {
            console.warn('Rollback info:', errRoll);
          }
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
        this._processPendingCandidates(senderSocketId, pc);
        const answer = await pc.createAnswer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(answer);
        window.socketManager.sendWebRTCSignal(senderSocketId, { answer });
        this._checkAndAttachReceivers(senderSocketId, pc);

      } else if (signal.answer) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
          this._processPendingCandidates(senderSocketId, pc);
          this._checkAndAttachReceivers(senderSocketId, pc);
        }

      } else if (signal.candidate) {
        const candidate = new RTCIceCandidate(signal.candidate);
        if (pc.remoteDescription && pc.remoteDescription.type) {
          pc.addIceCandidate(candidate).catch(e => console.warn('ICE Candidate error:', e));
        } else {
          const queue = this.iceCandidateQueues.get(senderSocketId) || [];
          queue.push(candidate);
          this.iceCandidateQueues.set(senderSocketId, queue);
        }
      }
    } catch (e) {
      console.warn('[WebRTC Signal Error]', e);
    }
  }

  async _processPendingCandidates(socketId, pc) {
    const queue = this.iceCandidateQueues.get(socketId) || [];
    while (queue.length > 0) {
      const cand = queue.shift();
      try {
        await pc.addIceCandidate(cand);
      } catch (e) {
        console.warn('Pending candidate error:', e);
      }
    }
  }
}

window.webrtcVoiceManager = new WebRTCVoiceManager();
