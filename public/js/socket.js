/**
 * SocketManager - DuoPlayX
 * Conexión robusta a servidor Render con detección automática de plataforma
 */
class SocketManager {
  constructor() {
    this.socket = null;
    this.currentRoomId = null;
    this.currentUser = null;
    this.isHost = false;
    this._initDone = false;
    this._initSocket();
  }

  _getServerUrl() {
    const origin = window.location.origin || '';
    // Android APK (Capacitor), file://, o localhost sin servidor web
    const isNativeApp = (
      !!window.Capacitor ||
      origin === '' ||
      origin === 'null' ||
      origin.startsWith('file:') ||
      origin.startsWith('capacitor:') ||
      origin === 'https://localhost' ||
      origin === 'http://localhost' ||
      (origin.includes('localhost') && /Android|Mobile|Capacitor/i.test(navigator.userAgent || ''))
    );
    return isNativeApp ? 'https://duoplayx-39qn.onrender.com' : origin;
  }

  _initSocket() {
    if (this._initDone) return;
    if (typeof io === 'undefined') {
      console.error('[DuoPlayX] socket.io no está disponible. Verificar que js/socket.io.min.js cargó correctamente.');
      return;
    }

    const serverUrl = this._getServerUrl();
    console.log('[DuoPlayX] Conectando a:', serverUrl);

    try {
      this.socket = io(serverUrl, {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 100,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        forceNew: false
      });

      this._initDone = true;
      this._bindSocketEvents();
    } catch (e) {
      console.error('[DuoPlayX] Error al crear socket:', e);
    }
  }

  _bindSocketEvents() {
    const s = this.socket;

    s.on('connect', () => {
      console.log('[DuoPlayX] Conectado al servidor. ID:', s.id);
      const el = document.getElementById('connectionStatusLobby');
      if (el) { el.textContent = '✅ Conectado a DuoPlayX'; el.style.color = '#10b981'; }
      if (window.appUI) window.appUI.showToast('✅ Conectado al servidor DuoPlayX', 'success');
    });

    s.on('connect_error', (err) => {
      console.warn('[DuoPlayX] Error de conexión:', err && err.message);
      const el = document.getElementById('connectionStatusLobby');
      if (el) { el.textContent = '🔄 Reconectando...'; el.style.color = '#f59e0b'; }
    });

    s.on('disconnect', (reason) => {
      console.warn('[DuoPlayX] Desconectado. Razón:', reason);
      if (window.appUI) window.appUI.showToast('⚠️ Conexión perdida. Reconectando...', 'warning');
    });

    s.on('reconnect', () => {
      console.log('[DuoPlayX] Reconectado al servidor.');
      if (window.appUI) window.appUI.showToast('✅ Reconexión exitosa', 'success');
    });

    // Sincronización de reproductor
    s.on('sync_media_action', (data) => {
      if (window.playerManager) window.playerManager.syncRemoteAction(data.action, data.currentTime, data.isPlaying);
      if (window.appUI) window.appUI.updateSyncBadge(true, `Sync con ${data.triggeredBy}`);
    });

    s.on('media_source_changed', (data) => {
      if (window.playerManager) window.playerManager.setMediaSource(data.media);
      if (data.sysMessage && window.appUI) window.appUI.appendChatMessage(data.sysMessage);
      if (window.appUI) window.appUI.showToast(`El Host cambió la película 🎬`, 'info');
    });

    // Usuarios
    s.on('user_joined', (data) => {
      if (window.appUI) {
        window.appUI.updateUsersList(data.users);
        if (data.sysMessage) window.appUI.appendChatMessage(data.sysMessage);
        window.appUI.showToast(`${data.user.username} se unió 🎉`, 'success');
      }
    });

    s.on('user_left', (data) => {
      if (window.appUI) {
        window.appUI.updateUsersList(data.users);
        if (data.sysMessage) window.appUI.appendChatMessage(data.sysMessage);
        if (data.newHostId === s.id) {
          this.isHost = true;
          window.appUI.updateHostControlsView(true);
          window.appUI.showToast('👑 Ahora eres el Host', 'info');
        }
      }
    });

    s.on('user_kicked', (data) => {
      if (data.kickedSocketId === s.id) {
        alert('Has sido expulsado de la sala por el Host.');
        window.location.reload();
      } else if (window.appUI) {
        window.appUI.updateUsersList(data.users);
        if (data.sysMessage) window.appUI.appendChatMessage(data.sysMessage);
      }
    });

    // Voz
    const handleVoiceUpdate = (data) => {
      if (!data || !data.voiceMembers) return;
      if (window.appUI) window.appUI.updateVoiceRoomState(data.voiceMembers, data.users || []);
      if (window.webrtcVoiceManager) window.webrtcVoiceManager.syncVoicePeers(data.voiceMembers);
    };
    s.on('voice_room_updated', handleVoiceUpdate);
    s.on('voice_members_updated', handleVoiceUpdate);

    s.on('speaking_state_changed', (data) => {
      if (window.appUI) window.appUI.setUserSpeakingIndicator(data.socketId, data.isSpeaking);
    });

    s.on('webrtc_signal', (data) => {
      if (window.webrtcVoiceManager) window.webrtcVoiceManager.handleIncomingSignal(data.senderSocketId, data.signal);
    });

    // Chat
    s.on('new_chat_message', (msg) => {
      if (window.appUI) window.appUI.appendChatMessage(msg);
    });

    s.on('new_reaction', (data) => {
      if (window.appUI) window.appUI.showFloatingReaction(data.emoji, data.user && data.user.username);
    });

    s.on('chat_message_reaction_updated', (data) => {
      if (window.appUI) window.appUI.updateChatMessageReactions(data.msgId, data.reactions);
    });
  }

  init() {
    if (!this._initDone) this._initSocket();
    else if (this.socket && !this.socket.connected) {
      try { this.socket.connect(); } catch(e) {}
    }
  }

  _ensureConnected() {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        this._initSocket();
        if (!this.socket) return reject('No se pudo inicializar la conexión al servidor.');
      }

      if (this.socket.connected) return resolve();

      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; reject('No se pudo conectar al servidor. ¿El servidor está activo?'); }
      }, 18000);

      this.socket.once('connect', () => {
        if (!resolved) { resolved = true; clearTimeout(timer); resolve(); }
      });

      try { this.socket.connect(); } catch(e) {}
    });
  }

  _leaveCurrentRoomSilent() {
    try {
      if (window.webrtcVoiceManager) window.webrtcVoiceManager.leaveVoiceRoom();
      if (this.socket && this.currentRoomId) {
        this.socket.emit('leave_room', { roomId: this.currentRoomId });
      }
    } catch(e) {}
    this.currentRoomId = null;
    this.currentUser = null;
    this.isHost = false;
  }

  createRoom(username, avatar) {
    this._leaveCurrentRoomSilent();
    return new Promise(async (resolve, reject) => {
      try {
        await this._ensureConnected();
      } catch(e) {
        return reject(e);
      }

      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; reject('El servidor tardó en responder. Intenta de nuevo.'); }
      }, 15000);

      this.socket.emit('create_room', { username, avatar }, (response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (response && response.success) {
          this.currentRoomId = response.room.roomId;
          this.currentUser = response.room.user;
          this.isHost = true;
          this._emitJoinVoice();
          resolve(response.room);
        } else {
          reject(response ? response.error : 'Error al crear la sala.');
        }
      });
    });
  }

  joinRoom(roomId, username, avatar) {
    this._leaveCurrentRoomSilent();
    return new Promise(async (resolve, reject) => {
      try {
        await this._ensureConnected();
      } catch(e) {
        return reject(e);
      }

      const cleanId = String(roomId || '').trim().toUpperCase();
      if (!cleanId) return reject('Introduce un código de sala.');

      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; reject('El servidor tardó en responder. Intenta de nuevo.'); }
      }, 15000);

      this.socket.emit('join_room', { roomId: cleanId, username, avatar }, (response) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (response && response.success) {
          this.currentRoomId = response.room.roomId;
          this.currentUser = response.room.user;
          this.isHost = !!response.room.user.isHost;
          this._emitJoinVoice();
          resolve(response.room);
        } else {
          reject(response ? response.error : 'No se pudo unirse a la sala. Verifica el código.');
        }
      });
    });
  }

  _emitJoinVoice() {
    if (this.currentRoomId && this.socket && this.socket.connected) {
      this.socket.emit('join_voice_room', { roomId: this.currentRoomId });
    }
  }

  joinVoiceRoom() { this._emitJoinVoice(); }

  leaveVoiceRoom() {
    if (this.currentRoomId && this.socket) {
      this.socket.emit('leave_voice_room', { roomId: this.currentRoomId });
    }
  }

  kickUser(targetSocketId) {
    if (!this.currentRoomId || !this.isHost || !this.socket) return;
    this.socket.emit('kick_user', { roomId: this.currentRoomId, targetSocketId });
  }

  requestHostSync() {
    if (!this.currentRoomId || !this.socket) return;
    this.socket.emit('request_host_sync', { roomId: this.currentRoomId });
  }

  emitMediaAction(action, currentTime) {
    if (!this.currentRoomId || !this.socket) return;
    this.socket.emit('media_action', { roomId: this.currentRoomId, action, currentTime });
  }

  emitChangeMedia(mediaUrl) {
    return new Promise((resolve, reject) => {
      if (!this.currentRoomId || !this.socket) return reject('No estás en ninguna sala.');
      this.socket.emit('change_media_source', { roomId: this.currentRoomId, mediaUrl }, (response) => {
        if (response && response.success) resolve(response.media);
        else reject(response ? response.error : 'URL no válida.');
      });
    });
  }

  sendChatMessage(text, gifUrl = null) {
    if (!this.currentRoomId || !this.socket) return;
    this.socket.emit('send_chat_message', { roomId: this.currentRoomId, text, gifUrl });
  }

  sendReaction(emoji) {
    if (!this.currentRoomId || !this.socket) return;
    this.socket.emit('send_reaction', { roomId: this.currentRoomId, emoji });
  }

  sendChatMessageReaction(msgId, emoji) {
    if (!this.currentRoomId || !msgId || !this.socket) return;
    this.socket.emit('react_to_chat_message', { roomId: this.currentRoomId, msgId, emoji });
  }

  sendWebRTCSignal(targetSocketId, signal) {
    if (!this.socket) return;
    this.socket.emit('webrtc_signal', { targetSocketId, signal });
  }

  sendSpeakingState(isSpeaking, isMuted) {
    if (!this.currentRoomId || !this.socket) return;
    this.socket.emit('voice_speaking_state', { roomId: this.currentRoomId, isSpeaking, isMuted });
  }
}

window.socketManager = new SocketManager();
