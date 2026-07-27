/**
 * WebRTCVoiceManager - Sistema de Sala de Voz en Vivo para DuoPlayX
 * Entra en modo solo oyente por defecto (0 permisos requeridos).
 * Activa micrófono únicamente al presionar el botón de micrófono.
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

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ]
    };

    this.bindAutoplayUnlocker();
  }

  bindAutoplayUnlocker() {
    const unlock = () => {
      this.unlockAudio();
    };
    window.addEventListener('click', unlock, { once: false });
    window.addEventListener('touchstart', unlock, { once: false });
  }

  unlockAudio() {
    document.querySelectorAll('audio[id^="audio_peer_"]').forEach(el => {
      el.muted = false;
      el.volume = 1.0;
      el.play().catch(e => console.warn('Audio play attempt:', e));
    });
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  async joinVoiceRoom() {
    if (this.inVoiceRoom) return true;

    this.inVoiceRoom = true;
    this.isMuted = true;
    this.localStream = null; // Entrar como OYENTE por defecto sin solicitar micrófono

    window.socketManager.joinVoiceRoom();
    this.unlockAudio();

    if (window.appUI) {
      window.appUI.showToast('¡Te has unido a la Sala de Voz en modo Oyente! 🎧 (Presiona 🎙️ para hablar)', 'info');
    }

    return true;
  }

  leaveVoiceRoom() {
    if (!this.inVoiceRoom) return;

    this.inVoiceRoom = false;
    this.isMuted = true;

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.peerConnections.forEach((pc, id) => {
      pc.close();
      this.removePeerAudioElement(id);
    });
    this.peerConnections.clear();
    this.iceCandidateQueues.clear();

    window.socketManager.leaveVoiceRoom();
  }

  async toggleMicMute() {
    if (!this.inVoiceRoom) return true;

    // Si aún no se ha capturado el micrófono, capturarlo ahora (se solicitará permiso)
    if (!this.localStream) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
        this.isMuted = false;
        this.initAudioAnalyser();

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

          // Iniciar renegociación si es necesario
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            window.socketManager.sendWebRTCSignal(targetId, { offer });
          } catch (e) {
            console.warn('Renegotiation error:', e);
          }
        });

        window.socketManager.sendSpeakingState(false, false);
        if (window.appUI) {
          window.appUI.showToast('¡Micrófono activado! 🎙️ Ya te escuchan.', 'success');
        }
        return false; // Retorna false (no silenciado)
      } catch (e) {
        console.error('Error al acceder al micrófono:', e);
        if (window.appUI) {
          window.appUI.showToast('No se pudo acceder al micrófono. Verifica los permisos de tu dispositivo.', 'warning');
        }
        return true;
      }
    }

    // Si ya existe el stream, alternar silenciamiento (Mute / Unmute)
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    window.socketManager.sendSpeakingState(false, this.isMuted);
    if (window.appUI) {
      window.appUI.showToast(this.isMuted ? 'Micrófono silenciado 🔇' : 'Micrófono activo 🎙️', 'info');
    }
    return this.isMuted;
  }

  syncVoicePeers(voiceMembers) {
    if (!this.inVoiceRoom) return;

    const currentSocketId = window.socketManager.socket.id;
    const voiceSocketIds = voiceMembers.map(m => m.socketId);

    voiceSocketIds.forEach(targetId => {
      if (targetId !== currentSocketId && !this.peerConnections.has(targetId)) {
        this.createPeerConnection(targetId, true);
      }
    });

    this.peerConnections.forEach((pc, targetId) => {
      if (!voiceSocketIds.includes(targetId)) {
        pc.close();
        this.peerConnections.delete(targetId);
        this.removePeerAudioElement(targetId);
      }
    });
  }

  initAudioAnalyser() {
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
        if (!this.inVoiceRoom || !this.analyser) return;
        this.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const average = sum / bufferLength;
        const isSpeaking = average > 18 && !this.isMuted;

        if (isSpeaking !== lastSpeaking) {
          lastSpeaking = isSpeaking;
          window.socketManager.sendSpeakingState(isSpeaking, this.isMuted);
        }

        window.appUI.setUserSpeakingIndicator(window.socketManager.socket.id, isSpeaking);
        requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (e) {
      console.warn('AudioAnalyser error:', e);
    }
  }

  async createPeerConnection(targetSocketId, isInitiator) {
    if (this.peerConnections.has(targetSocketId)) {
      return this.peerConnections.get(targetSocketId);
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(targetSocketId, pc);
    this.iceCandidateQueues.set(targetSocketId, []);

    // Añadir Transceiver de audio bidireccional por defecto
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
      console.log(`🔊 Pista de voz recibida de ${targetSocketId}`);
      let audioEl = document.getElementById(`audio_peer_${targetSocketId}`);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio_peer_${targetSocketId}`;
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
      }

      if (event.streams && event.streams[0]) {
        audioEl.srcObject = event.streams[0];
      } else if (event.track) {
        audioEl.srcObject = new MediaStream([event.track]);
      }

      audioEl.muted = false;
      audioEl.volume = 1.0;
      audioEl.play().catch(e => console.warn('Autoplay audio blocked:', e));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.socketManager.sendWebRTCSignal(targetSocketId, { candidate: event.candidate });
      }
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

  async handleIncomingSignal(senderSocketId, signal) {
    if (!this.inVoiceRoom) return;

    let pc = this.peerConnections.get(senderSocketId);
    if (!pc) {
      pc = await this.createPeerConnection(senderSocketId, false);
    }

    if (signal.offer) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
      this.processPendingCandidates(senderSocketId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      window.socketManager.sendWebRTCSignal(senderSocketId, { answer });
    } else if (signal.answer) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
      this.processPendingCandidates(senderSocketId, pc);
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
  }

  async processPendingCandidates(socketId, pc) {
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

  removePeerAudioElement(socketId) {
    const audioEl = document.getElementById(`audio_peer_${socketId}`);
    if (audioEl && audioEl.parentNode) {
      audioEl.parentNode.removeChild(audioEl);
    }
  }
}

window.webrtcVoiceManager = new WebRTCVoiceManager();
