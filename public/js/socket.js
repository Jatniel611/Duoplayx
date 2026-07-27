/**
 * SocketManager - Manejador de eventos Socket.io para DuoPlayX
 */

class SocketManager {
  constructor() {
    this.socket = null;
    this.currentRoomId = null;
    this.currentUser = null;
    this.isHost = false;
  }

  init() {
    let serverUrl = window.location.origin;
    if (!serverUrl || serverUrl.startsWith('file:') || serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1') || serverUrl.startsWith('capacitor:')) {
      serverUrl = 'https://duoplayx.onrender.com';
    }

    console.log(`🔌 Conectando Socket.io a: ${serverUrl}`);
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      timeout: 10000
    });

    this.socket.on('connect', () => {
      console.log('⚡ Conectado al servidor WebSocket:', this.socket.id);
    });

    this.socket.on('disconnect', () => {
      console.warn('⚠️ Desconectado del servidor WebSocket');
      window.appUI.showToast('Conexión perdida. Intentando reconectar...', 'warning');
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

    this.socket.on('voice_members_updated', (data) => {
      window.appUI.updateVoiceMembersUI(data.voiceMembers);
      window.webrtcVoiceManager.syncVoicePeers(data.voiceMembers);
    });

    this.socket.on('speaking_state_changed', (data) => {
      window.appUI.setUserSpeakingIndicator(data.socketId, data.isSpeaking);
    });

    this.socket.on('webrtc_signal', (data) => {
      window.webrtcVoiceManager.handleIncomingSignal(data.senderSocketId, data.signal);
    });

    this.socket.on('receive_chat_message', (message) => {
      window.appUI.appendChatMessage(message);
    });

    this.socket.on('receive_reaction', (data) => {
      window.appUI.showFloatingReaction(data.emoji, data.username);
    });

    this.socket.on('error_message', (data) => {
      window.appUI.showToast(data.message, 'danger');
    });
  }

  createRoom(username, avatar) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        if (window.appUI) window.appUI.showToast('Conectando al servidor... Reintentando en un momento.', 'info');

        const timer = setTimeout(() => {
          reject('No se pudo conectar al servidor. Verifica tu conexión a internet.');
        }, 10000);

        this.socket.once('connect', () => {
          clearTimeout(timer);
          this.createRoom(username, avatar).then(resolve).catch(reject);
        });
        return;
      }

      this.socket.emit('create_room', { username, avatar }, (response) => {
        if (response && response.success) {
          this.currentRoomId = response.room.roomId;
          this.currentUser = response.room.user;
          this.isHost = true;
          resolve(response.room);
        } else {
          reject(response ? response.error : 'Error al crear sala.');
        }
      });
    });
  }

  joinRoom(roomId, username, avatar) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        if (window.appUI) window.appUI.showToast('Conectando al servidor... Reintentando en un momento.', 'info');

        const timer = setTimeout(() => {
          reject('No se pudo conectar al servidor. Verifica tu conexión a internet.');
        }, 10000);

        this.socket.once('connect', () => {
          clearTimeout(timer);
          this.joinRoom(roomId, username, avatar).then(resolve).catch(reject);
        });
        return;
      }

      this.socket.emit('join_room', { roomId, username, avatar }, (response) => {
        if (response && response.success) {
          this.currentRoomId = response.room.roomId;
          this.currentUser = response.room.user;
          this.isHost = response.room.user.isHost;
          resolve(response.room);
        } else {
          reject(response ? response.error : 'No se pudo unirse a la sala.');
        }
      });
    });
  }

  kickUser(targetSocketId) {
    if (!this.currentRoomId || !this.isHost) return;
    this.socket.emit('kick_user', {
      roomId: this.currentRoomId,
      targetSocketId
    });
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
