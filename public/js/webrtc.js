/**
 * WebRTCVoiceManager - Sistema de Sala de Voz en Vivo DuoPlayX
 * 
 * 1. Todos los usuarios que entran a la sala escuchan automáticamente el canal de voz.
 * 2. Cero botones de "Unirse a la sala de voz".
 * 3. Botón único de "Encender / Apagar Micrófono".
 * 4. Selector de Micrófonos disponibles (MediaDevices.enumerateDevices).
 * 5. Indicador neón verde que ilumina el nombre/avatar del usuario cada vez que habla.
 */

class WebRTCVoiceManager {
  constructor() {
    this.localStream = null;
    this.peerConnections = new Map(); // socketId -> RTCPeerConnection
    this.iceCandidateQueues = new Map();
    this.inVoiceRoom = false;
    this.isMuted = true;
    this.audioContext = null;
    this.analyser = null;
    this._analyserTimerId = null; // Controlar loop de volumen
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
    window.addEventListener('click', unlock, { once: false });
    window.addEventListener('touchstart', unlock, { once: false });
  }

  // ─── Desbloqueo unificado de audio (local analyser + remote audio elements) ───
  unlockAudio() {
    // Reanudar AudioContext del analizador de micrófono local
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    // Reanudar y reproducir todos los elementos <audio> de peers remotos
    document.querySelectorAll('audio[id^="audio_peer_"]').forEach(el => {
      el.muted = false;
      el.volume = 1.0;
      el.play().catch(() => {});
    });
  }

  // Lista todos los micrófonos disponibles en el sistema/dispositivo
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

  // Conexión automática al canal de voz al ingresar a la sala (Sin pedir micrófono)
  async joinVoiceRoom() {
    if (this.inVoiceRoom) return true;

    this.inVoiceRoom = true;
    this.isMuted = true;
    this.localStream = null; // Entrar como OYENTE por defecto (0 permisos requeridos)

    window.socketManager.joinVoiceRoom();
    this.unlockAudio();
    return true;
  }

  leaveVoiceRoom() {
    if (!this.inVoiceRoom) return;

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

    window.socketManager.leaveVoiceRoom();
  }

  // Cambiar dispositivo de micrófono seleccionado
  async changeMicDevice(deviceId) {
    this.selectedMicId = deviceId;
    if (!this.isMuted && this.localStream) {
      await this.turnOnMic(deviceId);
    }
  }

  // Encender / Apagar Micrófono
  async toggleMic(deviceId = null) {
    if (deviceId) this.selectedMicId = deviceId;

    if (this.isMuted) {
      return await this.turnOnMic(this.selectedMicId);
    } else {
      return this.turnOffMic();
    }
  }

  // Encender micrófono (Solicita permiso al usuario en Web/Android)
  async turnOnMic(deviceId = null) {
    if (!this.inVoiceRoom) await this.joinVoiceRoom();

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

      // Enviar la pista de audio a todas las conexiones peer activas
      const audioTrack = this.localStream.getAudioTracks()[0];
      this.peerConnections.forEach(async (pc, targetId) => {
        const senders = pc.getSenders();
        const audioSender = senders.find(s => s.track?.kind === 'audio' || !s.track);
        if (audioSender) {
          await audioSender.replaceTrack(audioTrack);
        } else {
          pc.addTrack(audioTrack, this.localStream);
        }

        // Solo renegociar si estamos en estado estable
        if (pc.signalingState === 'stable') {
          try {
            const offer = await pc.createOffer();
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
      return false; // Retorna false (isMuted = false)
    } catch (e) {
      console.error('Error al acceder al micrófono:', e);
      this.isMuted = true;
      if (window.appUI) {
        window.appUI.showToast('No se pudo acceder al micrófono. Por favor permite los permisos.', 'warning');
      }
      return true; // Retorna true (isMuted = true)
    }
  }

  // Apagar micrófono
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

    window.socketManager.sendSpeakingState(false, true);
    if (window.appUI) {
      window.appUI.setUserSpeakingIndicator(window.socketManager.socket.id, false);
      window.appUI.showToast('🔇 Micrófono apagado', 'info');
    }
    return true; // Retorna true (isMuted = true)
  }

  syncVoicePeers(voiceMembers) {
    if (!this.inVoiceRoom) return;

    const currentSocketId = window.socketManager.socket?.id;
    if (!currentSocketId) return;

    const voiceSocketIds = voiceMembers.map(m => m.socketId);

    voiceSocketIds.forEach(targetId => {
      if (targetId !== currentSocketId && !this.peerConnections.has(targetId)) {
        this._createPeerConnection(targetId, true);
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

  // ─── Analizador de nivel de voz ─────────────────────────────────────────────
  _startAnalyser() {
    this._stopAnalyser(); // Limpiar loop anterior si existe

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

  // ─── Crear conexión WebRTC con un peer ──────────────────────────────────────
  async _createPeerConnection(targetSocketId, isInitiator) {
    if (this.peerConnections.has(targetSocketId)) {
      return this.peerConnections.get(targetSocketId);
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(targetSocketId, pc);
    this.iceCandidateQueues.set(targetSocketId, []);

    // Transceiver de audio bidireccional por defecto
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

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state con ${targetSocketId}: ${pc.iceConnectionState}`);
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        window.socketManager.sendWebRTCSignal(targetSocketId, { offer });
      } catch (err) {
        console.error('Error creando oferta WebRTC:', err);
      }
    }

    return pc;
  }

  // ─── Vincular audio remoto (SOLO via <audio> HTML5, sin doble WebAudio) ────
  _attachRemoteAudio(targetSocketId, stream) {
    if (!targetSocketId || !stream) return;
    console.log(`🔊 Vinculando audio remoto de ${targetSocketId}`);

    let audioEl = document.getElementById(`audio_peer_${targetSocketId}`);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = `audio_peer_${targetSocketId}`;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0.01;pointer-events:none;top:-9999px;left:-9999px;';
      document.body.appendChild(audioEl);
    }

    // Asegurar que todos los tracks de audio están habilitados
    stream.getAudioTracks().forEach(t => { t.enabled = true; });

    audioEl.srcObject = stream;
    audioEl.muted = false;
    audioEl.volume = 1.0;
    audioEl.play().catch(e => console.warn(`[Audio Peer ${targetSocketId}] Autoplay diferido:`, e.message));
  }

  _removePeerAudio(socketId) {
    const audioEl = document.getElementById(`audio_peer_${socketId}`);
    if (audioEl && audioEl.parentNode) {
      audioEl.srcObject = null;
      audioEl.parentNode.removeChild(audioEl);
    }
  }

  // ─── Manejo de señalización WebRTC entrante ─────────────────────────────────
  async handleIncomingSignal(senderSocketId, signal) {
    if (!this.inVoiceRoom) return;

    let pc = this.peerConnections.get(senderSocketId);
    if (!pc) {
      pc = await this._createPeerConnection(senderSocketId, false);
    }

    try {
      if (signal.offer) {
        // Protección contra glare: si ya tenemos una oferta local, hacer rollback
        if (pc.signalingState === 'have-local-offer') {
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
        this._processPendingCandidates(senderSocketId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        window.socketManager.sendWebRTCSignal(senderSocketId, { answer });

      } else if (signal.answer) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
          this._processPendingCandidates(senderSocketId, pc);
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
