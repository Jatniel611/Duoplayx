/**
 * WebRTCVoiceManager - Sistema de Sala de Voz en Vivo DuoPlayX
 * 
 * 1. Todos los usuarios que entran a la sala escuchan automáticamente el canal de voz.
 * 2. Cero botones de "Unirse a la sala de voz".
 * 3. Botón único de "Encender / Apagar Micrófono".
 * 4. Selector de Micrófonos disponibles (MediaDevices.enumerateDevices).
 * 5. Indicador neón verde que ilumina el nombre/avatar del usuario cada vez que habla.
 * 6. Renegociación SDP transparente y puente WebAudio directo a los altavoces.
 */

class WebRTCVoiceManager {
  constructor() {
    this.localStream = null;
    this.peerConnections = new Map(); // socketId -> RTCPeerConnection
    this.iceCandidateQueues = new Map();
    this.inVoiceRoom = true; // Por defecto TODOS los participantes entran a la sala de voz como oyentes
    this.isMuted = true;
    this.audioContext = null;
    this.remoteAudioContext = null;
    this.analyser = null;
    this._analyserTimerId = null;
    this.selectedMicId = null;

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ]
    };

    this._bindAutoplayUnlocker();
  }

  _bindAutoplayUnlocker() {
    const unlock = () => { this.unlockAudio(); };
    ['click', 'touchstart', 'keydown', 'pointerdown'].forEach(evt => {
      window.addEventListener(evt, unlock, { once: false, passive: true });
    });
  }

  // ─── Desbloqueo unificado de audio local y remoto ───────────────────────────
  unlockAudio() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    if (this.remoteAudioContext && this.remoteAudioContext.state === 'suspended') {
      this.remoteAudioContext.resume().catch(() => {});
    }
    document.querySelectorAll('audio[id^="audio_peer_"]').forEach(el => {
      el.muted = false;
      el.volume = 1.0;
      el.play().catch(() => {});
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
        console.warn('Falló captura con dispositivo exacto, intentando por defecto:', errDevice);
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
      }

      this.isMuted = false;
      this._startAnalyser();

      // Transmitir la pista de audio local a todas las conexiones activas
      const audioTrack = this.localStream.getAudioTracks()[0];
      this.peerConnections.forEach(async (pc, targetId) => {
        const transceivers = pc.getTransceivers();
        const audioTransceiver = transceivers.find(t => t.receiver.track.kind === 'audio' || t.sender.track?.kind === 'audio');
        if (audioTransceiver) {
          audioTransceiver.direction = 'sendrecv';
        }

        const senders = pc.getSenders();
        const audioSender = senders.find(s => s.track?.kind === 'audio' || !s.track);
        if (audioSender) {
          await audioSender.replaceTrack(audioTrack);
        } else {
          pc.addTrack(audioTrack, this.localStream);
        }

        // Renegociación SDP para asegurar la transmisión de paquetes UDP
        if (pc.signalingState === 'stable') {
          try {
            const offer = await pc.createOffer({ offerToReceiveAudio: true });
            await pc.setLocalDescription(offer);
            window.socketManager.sendWebRTCSignal(targetId, { offer });
          } catch (e) {
            console.warn('Renegotiation offer error:', e);
          }
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
      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track?.kind === 'audio');
      if (audioSender) {
        try { await audioSender.replaceTrack(null); } catch (e) {}
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
        const isInitiator = currentSocketId < targetSocketId;
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

  // ─── Analizador de volumen ────────────────────────────────────────────────
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
        const isSpeaking = average > 16;

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

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(targetSocketId, pc);
    this.iceCandidateQueues.set(targetSocketId, []);

    pc.addTransceiver('audio', { direction: 'sendrecv' });

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        const senders = pc.getSenders();
        const audioSender = senders.find(s => s.track?.kind === 'audio' || !s.track);
        if (audioSender) {
          audioSender.replaceTrack(track);
        } else {
          pc.addTrack(track, this.localStream);
        }
      });
    }

    pc.ontrack = (event) => {
      console.log(`📡 [ontrack] Recibida pista remota de ${targetSocketId}`);
      const stream = event.streams?.[0] || (event.track ? new MediaStream([event.track]) : null);
      if (stream) {
        this._attachRemoteAudio(targetSocketId, stream);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.socketManager.sendWebRTCSignal(targetSocketId, { candidate: event.candidate });
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
          const stream = new MediaStream([r.track]);
          this._attachRemoteAudio(senderSocketId, stream);
        }
      });
    } catch (e) {
      console.warn('Error verificando receivers:', e);
    }
  }

  // ─── Vincular elemento <audio> + Puente WebAudio directo ────────────────────
  _attachRemoteAudio(targetSocketId, stream) {
    if (!targetSocketId || !stream) return;

    let audioEl = document.getElementById(`audio_peer_${targetSocketId}`);
    if (!audioEl) {
      console.log(`🔊 Creando elemento <audio> para peer ${targetSocketId}`);
      audioEl = document.createElement('audio');
      audioEl.id = `audio_peer_${targetSocketId}`;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.cssText = 'position:fixed;bottom:0;right:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:1;';
      document.body.appendChild(audioEl);
    }

    audioEl.srcObject = stream;
    audioEl.muted = false;
    audioEl.volume = 1.0;

    const playAudio = () => {
      audioEl.muted = false;
      audioEl.volume = 1.0;
      audioEl.play().catch(e => console.warn(`[Audio Peer ${targetSocketId}] Play error:`, e.message));

      try {
        if (!this.remoteAudioContext) {
          this.remoteAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.remoteAudioContext.state === 'suspended') {
          this.remoteAudioContext.resume().catch(() => {});
        }
        if (!audioEl._webAudioSource && stream.getAudioTracks().length > 0) {
          const source = this.remoteAudioContext.createMediaStreamSource(stream);
          source.connect(this.remoteAudioContext.destination);
          audioEl._webAudioSource = source;
          console.log(`🔊 [WebAudio Bridge] Audio conectado con éxito para ${targetSocketId}`);
        }
      } catch (eWa) {
        console.warn('WebAudio bridge error:', eWa);
      }
    };

    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach(track => {
      track.enabled = true;
      track.onunmute = () => {
        console.log(`🔊 [Track Unmuted] Conectando salida de voz de ${targetSocketId}`);
        playAudio();
      };
    });

    playAudio();
  }

  _removePeerAudio(socketId) {
    const audioEl = document.getElementById(`audio_peer_${socketId}`);
    if (audioEl && audioEl.parentNode) {
      if (audioEl._webAudioSource) {
        try { audioEl._webAudioSource.disconnect(); } catch (e) {}
        audioEl._webAudioSource = null;
      }
      audioEl.srcObject = null;
      audioEl.parentNode.removeChild(audioEl);
    }
  }

  async handleIncomingSignal(senderSocketId, signal) {
    this.inVoiceRoom = true;

    let pc = this.peerConnections.get(senderSocketId);
    if (!pc) {
      pc = await this._createPeerConnection(senderSocketId, false);
    }

    try {
      if (signal.offer) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setLocalDescription({ type: 'rollback' });
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
