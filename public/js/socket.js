/**
 * SocketManager - Manejador de eventos Socket.io para DuoPlayX
 */

class SocketManager {
  constructor() {
    this.socket = null;
    this.currentRoomId = null;
    this.currentUser = null;
    this.isHost = false;
    this.init();
  }

  init() {
    let serverUrl = window.location.origin;

    // Detectar si estamos en APK Android (Capacitor), archivo local file:// o app nativa
    const isLocalFileOrCapacitor = !serverUrl ||
                                   serverUrl === 'null' ||
                                   serverUrl.startsWith('file:') ||
                                   serverUrl.startsWith('capacitor:') ||
                                   serverUrl === 'https://localhost' ||
                                   serverUrl === 'http://localhost' ||
                                   (typeof navigator !== 'undefined' && navigator.userAgent && (navigator.userAgent.includes('Android') || navigator.userAgent.includes('Mobile') || navigator.userAgent.includes('Capacitor')));

    if (isLocalFileOrCapacitor) {
      serverUrl = 'https://duoplayx.onrender.com';
    }

    if (typeof io === 'undefined') {
      console.warn('⚠️ Librería socket.io client no detectada todavía.');
      return;
    }

    if (this.socket) {
      if (this.socket.connected) return;
      try { this.socket.connect(); } catch (e) {}
      return;
    }

    console.log(`🔌 Conectando Socket.io a: ${serverUrl}`);
    try {
      this.socket = io(serverUrl, {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 50,
        reconnectionDelay: 800,
        timeout: 20000
      });

      this.socket.on('connect', () => {
        console.log('⚡ Conectado al servidor WebSocket:', this.socket.id);
        if (window.appUI) window.appUI.showToast('✅ Conectado al servidor DuoPlayX', 'success');
      });

      this.socket.on('connect_error', (err) => {
        console.warn('⚠️ Error de conexión WebSocket:', err ? err.message : err);
      });

      this.socket.on('disconnect', () => {
        console.warn('⚠️ Desconectado del servidor WebSocket');
        if (window.appUI) window.appUI.showToast('Conexión perdida. Intentando reconectar...', 'warning');
      });

      this.socket.on('sync_media_action', (data) => {
        console.log('[Sync Action]:', data);
        window.playerManager.syncRemoteAction(data.action, data.currentTime, data.isPlaying);
        window.appUI.updateSyncBadge(true, `Sync con ${data.triggeredBy}`);
      });

      this.socket.on('media_source_changed', (data) => {
        console.log('[Media Changed]:', data);
        window.playerManager.setMediaSource(data.media);
        if (data.sysMessage) window.appUI.appendChatMessage(data.sysMessage);
        window.appUI.showToast(`El Host (${data.changedBy}) cambió la película 🎬`, 'info');
      });

      this.socket.on('user_joined', (data) => {
        window.appUI.updateUsersList(data.users);
        if (data.sysMessage) window.appUI.appendChatMessage(data.sysMessage);
        window.appUI.showToast(`${data.user.username} se unió a la sala 🎉`, 'success');
        window.webrtcVoiceManager.joinVoiceRoom();
      });

      this.socket.on('user_left', (data) => {
        window.appUI.updateUsersList(data.users);
        if (data.sysMessage) window.appUI.appendChatMessage(data.sysMessage);

        if (data.newHostId === this.socket.id) {
          this.isHost = true;
          window.appUI.updateHostControlsView(true);
          window.appUI.showToast('👑 Ahora eres el Host de la sala.', 'info');
        }
      });

      this.socket.on('user_kicked', (data) => {
        if (data.kickedSocketId === this.socket.id) {
          alert('Has sido expulsado de la sala por el Host.');
          window.location.reload();
        } else {
          window.appUI.updateUsersList(data.users);
          if (data.sysMessage) window.appUI.appendChatMessage(data.sysMessage);
        }
      });

      const handleVoiceUpdate = (data) => {
        if (data && data.voiceMembers) {
          window.appUI.updateVoiceRoomState(data.voiceMembers, data.users || []);
          window.webrtcVoiceManager.syncVoicePeers(data.voiceMembers);
        }
      };
      this.socket.on('voice_room_updated', handleVoiceUpdate);
      this.socket.on('voice_members_updated', handleVoiceUpdate);

      const handleSpeaking = (data) => {
        window.appUI.setUserSpeakingIndicator(data.socketId, data.isSpeaking);
      };
      this.socket.on('speaking_state_changed', handleSpeaking);

      this.socket.on('webrtc_signal', (data) => {
        window.webrtcVoiceManager.handleIncomingSignal(data.senderSocketId, data.signal);
      });

      this.socket.on('new_chat_message', (msg) => {
        window.appUI.appendChatMessage(msg);
      });

      this.socket.on('new_reaction', (data) => {
        window.appUI.showFloatingReaction(data.emoji, data.user?.username);
      });

      this.socket.on('chat_message_reaction_updated', (data) => {
        window.appUI.updateChatMessageReactions(data.msgId, data.reactions);
      });
    } catch (e) {
      console.error('Error al instanciar io():', e);
    }
  }

  leaveCurrentRoom() {
    try {
      if (window.webrtcVoiceManager) {
        window.webrtcVoiceManager.leaveVoiceRoom();
      }
      if (this.socket && this.currentRoomId) {
        this.socket.emit('leave_room', { roomId: this.currentRoomId });
      }
    } catch (e) {
      console.warn('Error al salir de sala previa:', e);
    }
    this.currentRoomId = null;
    this.currentUser = null;
    this.isHost = false;
  }

  createRoom(username, avatar) {
    this.leaveCurrentRoom();
    this.init();

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        return reject('Error: No se pudo conectar al servidor WebSocket.');
      }

      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject('El servidor está tardando en responder. Intenta de nuevo en unos segundos.');
        }
      }, 15000);

      const doEmit = () => {
        if (done) return;
        this.socket.emit('create_room', { username, avatar }, (response) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (response && response.success) {
            this.currentRoomId = response.room.roomId;
            this.currentUser = response.room.user;
            this.isHost = true;
            this.joinVoiceRoom();
            resolve(response.room);
          } else {
            reject(response ? response.error : 'Error al crear la sala.');
          }
        });
      };

      if (this.socket.connected) {
        doEmit();
      } else {
        if (window.appUI) window.appUI.showToast('Conectando al servidor...', 'info');
        this.socket.once('connect', () => {
          doEmit();
        });
        try { this.socket.connect(); } catch (e) {}
      }
    });
  }

  joinRoom(roomId, username, avatar) {
    this.leaveCurrentRoom();
    this.init();

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        return reject('Error: No se pudo conectar al servidor WebSocket.');
      }

      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject('El servidor está tardando en responder. Intenta de nuevo en unos segundos.');
        }
      }, 15000);

      const doEmit = () => {
        if (done) return;
        this.socket.emit('join_room', { roomId, username, avatar }, (response) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (response && response.success) {
            this.currentRoomId = response.room.roomId;
            this.currentUser = response.room.user;
            this.isHost = response.room.user.isHost;
            this.joinVoiceRoom();
            resolve(response.room);
          } else {
            reject(response ? response.error : 'No se pudo unirse a la sala.');
          }
        });
      };

      if (this.socket.connected) {
        doEmit();
      } else {
        if (window.appUI) window.appUI.showToast('Conectando al servidor...', 'info');
        this.socket.once('connect', () => {
          doEmit();
        });
        try { this.socket.connect(); } catch (e) {}
      }
    });
  }

  kickUser(targetSocketId) {
    if (!this.currentRoomId || !this.isHost) return;
    this.socket.emit('kick_user', {
      roomId: this.currentRoomId,
      targetSocketId
    });
  }

  requestHostSync() {
    if (!this.currentRoomId) return;
    this.socket.emit('request_host_sync', { roomId: this.currentRoomId });
  }

  emitMediaAction(action, currentTime) {
    if (!this.currentRoomId) return;
    this.socket.emit('media_action', {
      roomId: this.currentRoomId,
      action,
      currentTime
    });
  }

  emitChangeMedia(mediaUrl) {
    return new Promise((resolve, reject) => {
      if (!this.currentRoomId) return reject('No estás en ninguna sala.');
      this.socket.emit('change_media_source', {
        roomId: this.currentRoomId,
        mediaUrl
      }, (response) => {
        if (response && response.success) resolve(response.media);
        else reject(response ? response.error : 'URL no válida.');
      });
    });
  }

  sendChatMessage(text, gifUrl = null) {
    if (!this.currentRoomId) return;
    this.socket.emit('send_chat_message', {
      roomId: this.currentRoomId,
      text,
      gifUrl
    });
  }

  sendReaction(emoji) {
    if (!this.currentRoomId) return;
    this.socket.emit('send_reaction', {
      roomId: this.currentRoomId,
      emoji
    });
  }

  sendChatMessageReaction(msgId, emoji) {
    if (!this.currentRoomId || !msgId) return;
    this.socket.emit('react_to_chat_message', {
      roomId: this.currentRoomId,
      msgId,
      emoji
    });
  }

  joinVoiceRoom() {
    if (!this.currentRoomId) return;
    this.socket.emit('join_voice_room', { roomId: this.currentRoomId });
  }

  leaveVoiceRoom() {
    if (!this.currentRoomId) return;
    this.socket.emit('leave_voice_room', { roomId: this.currentRoomId });
  }

  sendWebRTCSignal(targetSocketId, signal) {
    this.socket.emit('webrtc_signal', { targetSocketId, signal });
  }

  sendSpeakingState(isSpeaking, isMuted) {
    if (!this.currentRoomId) return;
    this.socket.emit('voice_speaking_state', {
      roomId: this.currentRoomId,
      isSpeaking,
      isMuted
    });
  }
}

window.socketManager = new SocketManager();
