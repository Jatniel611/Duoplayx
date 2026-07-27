/**
 * WebRTCVoiceManager - Sistema de Sala de Voz en Vivo para DuoPlayX
 * Soporta modo con micrófono y modo solo oyente (escuchar sin micro)
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
    console.log('🔊 Desbloqueando altavoces de audio WebRTC...');
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

    // Intentar capturar micrófono si está disponible
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
      window.appUI.showToast('¡Te has unido a la Sala de Voz con micrófono! 🎙️', 'success');
    } catch (err) {
      console.warn('Microphone not available, joining as listener only:', err);
      this.localStream = null;
      this.isMuted = true;
      window.appUI.showToast('¡Te has unido a la Sala de Voz en modo Oyente (escuchar)! 🎧', 'info');
    }

    window.socketManager.joinVoiceRoom();
    this.unlockAudio();

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

    if (!this.localStream) {
      // Intentar activar micrófono si antes era solo oyente
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false
        });
        this.isMuted = false;
        this.initAudioAnalyser();

        // Añadir pista a las conexiones peer existentes
        this.peerConnections.forEach(pc => {
          this.localStream.getTracks().forEach(track => {
            pc.addTrack(track, this.localStream);
          });
        });

        window.socketManager.sendSpeakingState(false, false);
        return false;
      } catch (e) {
        window.appUI.showToast('No se pudo acceder al micrófono.', 'warning');
        return true;
      }
    }

    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    window.socketManager.sendSpeakingState(false, this.isMuted);
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

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
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
      audioEl.srcObject = event.streams[0];
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
