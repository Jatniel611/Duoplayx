/**
 * AppUI - Controlador de Interfaz DuoPlayX
 * Sincronización Automática Sin Restricciones de Autoplay (DuoPlayX)
 */

class AppUI {
  constructor() {
    this.selectedAvatar = '⚡';
    this.currentRoom = null;
    this.currentRoomUsers = [];
    this.currentVoiceMembers = [];

    // Categorías de Emojis
    this.emojiCategories = {
      faces: ['😊', '😂', '🤣', '😍', '😎', '🥳', '😡', '😱', '🥺', '😴', '😜', '😈', '😇', '🤔', '🙄'],
      hands: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '✌️', '🤟', '👊', '👋', '💪', '🖕', '🤙'],
      party: ['🎉', '🎊', '🥳', '🍾', '🍺', '🍿', '🎈', '🎁', '🎂', '💥', '✨', '🎶', '🎵'],
      animals: ['🐶', '🐱', '🦊', '🦁', '🐵', '🐼', '🦄', '🐰', '🐯', '🐸', '🐙', '🦖'],
      movies: ['🍿', '🎬', '📽️', '🎥', '📺', '⭐', '🔥', '💎', '🚀', '⚡', '🏆', '🎟️']
    };

    // Diccionario de Traducción Español -> Inglés
    this.esTranslationMap = {
      'perrito': 'puppy',
      'perro': 'dog',
      'gato': 'cat',
      'gatito': 'kitten',
      'salto': 'jump',
      'saltando': 'jumping',
      'enojado': 'angry',
      'furia': 'angry',
      'risa': 'laughing',
      'reir': 'laugh',
      'jaja': 'lol',
      'baile': 'dance',
      'bailando': 'dancing',
      'fiesta': 'party',
      'triste': 'sad',
      'llorando': 'crying',
      'amor': 'love',
      'abrazo': 'hug',
      'sorpresa': 'surprised',
      'película': 'popcorn',
      'peli': 'movie',
      'aplausos': 'applause',
      'hola': 'wave'
    };

    this.popularKeywords = [
      'perrito', 'salto', 'enojado', 'risa', 'baile', 'fiesta', 'amor', 'gato',
      'llorando', 'sorpresa', 'película', 'aplausos', 'memes', 'anime', 'correr'
    ];

    this.gifCategories = {
      trending: [
        'https://media.giphy.com/media/l0HlHFRbmaZtBRhXG/giphy.gif',
        'https://media.giphy.com/media/3o7abKhOpu0NwenH3y/giphy.gif',
        'https://media.giphy.com/media/26n6WywJyh39n1pBu/giphy.gif',
        'https://media.giphy.com/media/d31w24psGYeekCXY/giphy.gif',
        'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif'
      ],
      perrito: [
        'https://media.giphy.com/media/4Zo41lhzKt6iZ8xff9/giphy.gif',
        'https://media.giphy.com/media/mCRJDo24UvJMA/giphy.gif',
        'https://media.giphy.com/media/bbshzL3Ao6KIVeeXt9/giphy.gif',
        'https://media.giphy.com/media/1d3AKQGS6vPE9uGjJG/giphy.gif'
      ],
      salto: [
        'https://media.giphy.com/media/l2JdZOv5l2j2n6xNu/giphy.gif',
        'https://media.giphy.com/media/3o7TKr3nzbh5yWubgQ/giphy.gif',
        'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif'
      ],
      enojado: [
        'https://media.giphy.com/media/11tTNkKOscnNGM/giphy.gif',
        'https://media.giphy.com/media/l1J3x37y5C6k6v4eI/giphy.gif',
        'https://media.giphy.com/media/3o9bQX4mC5G6ZP2qVq/giphy.gif'
      ],
      risa: [
        'https://media.giphy.com/media/l41YkxvU8c7J7BbaE/giphy.gif',
        'https://media.giphy.com/media/3oKIPnAiaMCws8nOsE/giphy.gif',
        'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif'
      ],
      baile: [
        'https://media.giphy.com/media/nUxC6MRNmw32E/giphy.gif',
        'https://media.giphy.com/media/l0HlUxcWRsqROfJw4/giphy.gif'
      ]
    };

    this.initDOM();
    this.bindEvents();
    this.checkUrlRoomCode();

    window.kickUserFromRoom = (socketId) => {
      if (confirm('¿Estás seguro de expulsar a este usuario de la sala?')) {
        window.socketManager.kickUser(socketId);
      }
    };
  }

  initDOM() {
    this.modalLobby = document.getElementById('modalLobby');
    this.mainRoom = document.getElementById('mainRoom');
    this.headerRoomInfo = document.getElementById('headerRoomInfo');
    this.displayRoomCode = document.getElementById('displayRoomCode');

    this.inputUsername = document.getElementById('inputUsername');
    this.inputRoomCode = document.getElementById('inputRoomCode');
    this.inputMediaUrl = document.getElementById('inputMediaUrl');
    this.inputChatMessage = document.getElementById('inputChatMessage');

    this.btnCreateRoom = document.getElementById('btnCreateRoom');
    this.btnJoinRoom = document.getElementById('btnJoinRoom');
    this.btnChangeMedia = document.getElementById('btnChangeMedia');
    this.btnCopyInvite = document.getElementById('btnCopyInvite');
    this.btnResync = document.getElementById('btnResync');

    // DESBLOQUEO DE AUTOPLAY DuoPlayX
    this.videoAutoplayOverlay = document.getElementById('videoAutoplayOverlay');
    this.btnUnlockVideoAutoplay = document.getElementById('btnUnlockVideoAutoplay');

    // CONTROL DE VOLUMEN LOCAL DE VIDEO
    this.btnToggleVideoMute = document.getElementById('btnToggleVideoMute');
    this.inputVideoVolume = document.getElementById('inputVideoVolume');
    
    // SELECTOR DE CALIDAD DE VIDEO
    this.selectVideoQuality = document.getElementById('selectVideoQuality');

    this.btnToggleFullscreen = document.getElementById('btnToggleFullscreen');
    this.playerStage = document.getElementById('playerStage');

    // SALA DE VOZ DEDICADA DuoPlayX
    this.voiceMembersGrid = document.getElementById('voiceMembersGrid');
    this.btnToggleMic = document.getElementById('btnToggleMic');
    this.voiceMicStateIcon = document.getElementById('voiceMicStateIcon');
    this.voiceMicStateLabel = document.getElementById('voiceMicStateLabel');
    this.selectMicDevice = document.getElementById('selectMicDevice');

    // CONTROLES ESTILO NETFLIX DE HOST Y BARRA DE TIEMPO
    this.hostMediaBar = document.getElementById('hostMediaBar');
    this.guestHostNotice = document.getElementById('guestHostNotice');
    this.guestPlayerLockOverlay = document.getElementById('guestPlayerLockOverlay');
    this.hostBtnsGroup = document.getElementById('hostBtnsGroup');
    this.btnHostPlayPause = document.getElementById('btnHostPlayPause');
    this.svgPlayIcon = document.getElementById('svgPlayIcon');
    this.svgPauseIcon = document.getElementById('svgPauseIcon');
    this.btnHostRewind = document.getElementById('btnHostRewind');
    this.btnHostForward = document.getElementById('btnHostForward');
    this.timeProgressSlider = document.getElementById('timeProgressSlider');
    this.timeCurrent = document.getElementById('timeCurrent');
    this.timeDuration = document.getElementById('timeDuration');

    // BUSCADOR DE GIFS Y SUGERENCIAS
    this.btnOpenGifPicker = document.getElementById('btnOpenGifPicker');
    this.btnCloseGifPicker = document.getElementById('btnCloseGifPicker');
    this.gifPickerPopover = document.getElementById('gifPickerPopover');
    this.inputGifSearch = document.getElementById('inputGifSearch');
    this.gifSuggestionsBox = document.getElementById('gifSuggestionsBox');
    this.inputDirectGifUrl = document.getElementById('inputDirectGifUrl');
    this.btnSendDirectGif = document.getElementById('btnSendDirectGif');
    this.gifGrid = document.getElementById('gifGrid');

    // SELECTOR DE EMOJIS
    this.btnOpenEmojiPicker = document.getElementById('btnOpenEmojiPicker');
    this.btnCloseEmojiPicker = document.getElementById('btnCloseEmojiPicker');
    this.emojiPickerPopover = document.getElementById('emojiPickerPopover');
    this.emojiGrid = document.getElementById('emojiGrid');

    this.headerUserAvatar = document.getElementById('headerUserAvatar');
    this.headerUserName = document.getElementById('headerUserName');
    this.avatarOptions = document.querySelectorAll('.avatar-option');

    this.chatMessages = document.getElementById('chatMessages');
    this.chatForm = document.getElementById('chatForm');
    this.inputChatMessage = document.getElementById('inputChatMessage');
    this.btnResync = document.getElementById('btnResync');
    this.btnCopyInvite = document.getElementById('btnCopyInvite');
    this.usersList = document.getElementById('usersList');
    this.userCount = document.getElementById('userCount');

    this.reactionOverlay = document.getElementById('reactionOverlay');
    this.toastContainer = document.getElementById('toastContainer');

    // MÓVIL & CHAT FLOTANTE (DuoPlayX)
    this.mobileNavBar = document.getElementById('mobileNavBar');
    this.sectionPlayer = document.getElementById('sectionPlayer');
    this.sectionSidebar = document.getElementById('sectionSidebar');
    this.btnNavPlayer = document.getElementById('btnNavPlayer');
    this.btnNavChat = document.getElementById('btnNavChat');
    this.btnNavUsers = document.getElementById('btnNavUsers');

    this.btnFloatingChatBubble = document.getElementById('btnFloatingChatBubble');
    this.floatingChatOverlay = document.getElementById('floatingChatOverlay');
    this.btnCloseFloatingChat = document.getElementById('btnCloseFloatingChat');
    this.floatingChatMessages = document.getElementById('floatingChatMessages');
    this.floatingChatForm = document.getElementById('floatingChatForm');
    this.inputFloatingChatMessage = document.getElementById('inputFloatingChatMessage');
    this.chatUnreadBadge = document.getElementById('chatUnreadBadge');
    this.unreadChatCount = 0;

    // BARRA COMPACTA DE VOZ MÓVIL DuoPlayX
    this.mobileVoiceStrip = document.getElementById('mobileVoiceStrip');
    this.mobileVoiceCount = document.getElementById('mobileVoiceCount');
    this.mobileVoiceAvatars = document.getElementById('mobileVoiceAvatars');
    this.btnMobileToggleMic = document.getElementById('btnMobileToggleMic');
    this.mobileMicIcon = document.getElementById('mobileMicIcon');
    this.mobileMicLabel = document.getElementById('mobileMicLabel');

    // MODAL DE CREAR / CAMBIAR DE SALA
    this.btnOpenSwitchRoomModal = document.getElementById('btnOpenSwitchRoomModal');
    this.modalSwitchRoom = document.getElementById('modalSwitchRoom');
    this.btnCloseSwitchRoomModal = document.getElementById('btnCloseSwitchRoomModal');
    this.btnModalCreateRoom = document.getElementById('btnModalCreateRoom');
    this.inputModalRoomCode = document.getElementById('inputModalRoomCode');
    this.btnModalJoinRoom = document.getElementById('btnModalJoinRoom');

    // CONTROL DE INACTIVIDAD & PANTALLA COMPLETA
    this.syncStatusBadge = document.getElementById('syncStatusBadge');
    this.stageFullscreenBtn = document.getElementById('btnToggleFullscreen');
    this.playerStageContainer = document.getElementById('playerStage');
    this.inactivityTimer = null;
    this.messageHighlightTimer = null;
    this.isUserActiveInStage = true;
  }

  bindEvents() {
    try {
      if (window.socketManager) window.socketManager.init();
    } catch (err) {
      console.warn('Socket.io init diferido:', err);
    }

    // Selección de Avatar
    this.avatarOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        this.avatarOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        this.selectedAvatar = opt.dataset.avatar;
      });
    });

    // CAPA DE DESBLOQUEO DE AUTOPLAY DuoPlayX
    if (this.videoAutoplayOverlay) {
      this.videoAutoplayOverlay.addEventListener('click', () => {
        this.unlockVideoExperience();
      });
    }

    // Vincular botones de la barra de reacciones flotante superpuesta sobre el video
    const stageReactionsBar = document.getElementById('stageFloatingReactionsBar');
    if (stageReactionsBar) {
      stageReactionsBar.querySelectorAll('.stage-reaction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const emoji = btn.dataset.emoji;
          if (emoji && window.socketManager) {
            window.socketManager.sendReaction(emoji);
          }
        });
      });
    }

    if (this.btnUnlockVideoAutoplay) {
      this.btnUnlockVideoAutoplay.addEventListener('click', (e) => {
        e.stopPropagation();
        this.unlockVideoExperience();
      });
    }

    // Garantizar que la pulsación táctil en inputs active el foco nativo y se desplace hacia la vista en Android
    document.addEventListener('pointerdown', (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        target.focus();
        setTimeout(() => {
          try {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } catch (err) {}
        }, 300);
      }
    }, { passive: true });

    // Crear Sala DuoPlayX
    if (this.btnCreateRoom) {
      this.btnCreateRoom.addEventListener('click', async () => {
        const username = (this.inputUsername && this.inputUsername.value.trim()) || 'Invitado';
        this.btnCreateRoom.disabled = true;
        this.btnCreateRoom.innerHTML = '<span>⚡ Creando sala...</span>';
        try {
          const roomData = await window.socketManager.createRoom(username, this.selectedAvatar);
          this.enterRoom(roomData);
          this.showToast('¡Bienvenido a DuoPlayX! Eres el Host (👑) y tienes el control exclusivo.', 'success');
        } catch (err) {
          console.error('Error al crear sala:', err);
          this.showToast(typeof err === 'string' ? err : 'Error al conectar con el servidor. Reintenta.', 'danger');
        } finally {
          this.btnCreateRoom.disabled = false;
          this.btnCreateRoom.innerHTML = '<span>✨ Crear Sala (Como Host 👑)</span>';
        }
      });
    }

    // Unirse a Sala
    if (this.btnJoinRoom) {
      this.btnJoinRoom.addEventListener('click', async () => {
        const username = (this.inputUsername && this.inputUsername.value.trim()) || 'Invitado';
        const code = this.inputRoomCode ? this.inputRoomCode.value.trim() : '';
        if (!code) return this.showToast('Introduce un código de sala.', 'warning');

        this.btnJoinRoom.disabled = true;
        this.btnJoinRoom.innerText = 'Uniendo...';
        try {
          const roomData = await window.socketManager.joinRoom(code, username, this.selectedAvatar);
          this.enterRoom(roomData);
          this.showToast(`Unido a la sala ${roomData.roomId}`, 'success');
        } catch (err) {
          console.error('Error al unirse a sala:', err);
          this.showToast(typeof err === 'string' ? err : 'No se pudo unirse a la sala.', 'danger');
        } finally {
          this.btnJoinRoom.disabled = false;
          this.btnJoinRoom.innerText = 'Unirme';
        }
      });
    }

    // MODAL DE CREAR / CAMBIAR DE SALA EN CUALQUIER MOMENTO
    if (this.btnOpenSwitchRoomModal) {
      this.btnOpenSwitchRoomModal.addEventListener('click', () => {
        if (this.modalSwitchRoom) this.modalSwitchRoom.style.display = 'flex';
      });
    }

    if (this.btnCloseSwitchRoomModal) {
      this.btnCloseSwitchRoomModal.addEventListener('click', () => {
        if (this.modalSwitchRoom) this.modalSwitchRoom.style.display = 'none';
      });
    }

    if (this.btnModalCreateRoom) {
      this.btnModalCreateRoom.addEventListener('click', async () => {
        const username = this.inputUsername ? (this.inputUsername.value.trim() || 'Invitado') : 'Invitado';
        this.btnModalCreateRoom.disabled = true;
        this.btnModalCreateRoom.innerHTML = '<span>⚡ Creando sala...</span>';
        try {
          const roomData = await window.socketManager.createRoom(username, this.selectedAvatar);
          this.enterRoom(roomData);
          if (this.modalSwitchRoom) this.modalSwitchRoom.style.display = 'none';
          this.showToast('¡Nueva sala creada con éxito! Eres el Host (👑).', 'success');
        } catch (err) {
          console.error('Error al crear sala desde modal:', err);
          this.showToast(typeof err === 'string' ? err : 'Error al crear la sala.', 'danger');
        } finally {
          this.btnModalCreateRoom.disabled = false;
          this.btnModalCreateRoom.innerHTML = '<span>✨ Crear Nueva Sala (Host 👑)</span>';
        }
      });
    }

    if (this.btnModalJoinRoom) {
      this.btnModalJoinRoom.addEventListener('click', async () => {
        const username = this.inputUsername ? (this.inputUsername.value.trim() || 'Invitado') : 'Invitado';
        const code = this.inputModalRoomCode ? this.inputModalRoomCode.value.trim() : '';
        if (!code) return this.showToast('Introduce un código de sala.', 'warning');

        this.btnModalJoinRoom.disabled = true;
        this.btnModalJoinRoom.innerText = 'Uniendo...';
        try {
          const roomData = await window.socketManager.joinRoom(code, username, this.selectedAvatar);
          this.enterRoom(roomData);
          if (this.modalSwitchRoom) this.modalSwitchRoom.style.display = 'none';
          this.showToast(`¡Unido con éxito a la sala ${roomData.roomId}!`, 'success');
        } catch (err) {
          console.error('Error al unirse a sala desde modal:', err);
          this.showToast(typeof err === 'string' ? err : 'No se pudo unirse a la sala.', 'danger');
        } finally {
          this.btnModalJoinRoom.disabled = false;
          this.btnModalJoinRoom.innerText = 'Unirme';
        }
      });
    }

    // Cambiar Video (Solo Host)
    if (this.btnChangeMedia) {
      this.btnChangeMedia.addEventListener('click', async () => {
        if (!window.socketManager.isHost) {
          return this.showToast('⛔ Solo el Host (👑) puede cambiar la película.', 'warning');
        }

        const rawUrl = this.inputMediaUrl ? this.inputMediaUrl.value.trim() : '';
        if (!rawUrl) return this.showToast('Ingresa una URL válida de YouTube, Google Drive, Pixeldrain o Servidor Embed.', 'warning');

        // 1. Detección instantánea sin delay ni peticiones de red para YouTube, Drive, Pixeldrain y MP4 directos
        const fastMedia = this.quickParseMedia(rawUrl);
        if (fastMedia) {
          console.log('[FastParse] Medio detectado de forma instantánea:', fastMedia);
          await window.socketManager.emitChangeMedia(fastMedia);
          if (this.inputMediaUrl) this.inputMediaUrl.value = '';
          return;
        }

        // 2. Extracción de servidores Embed (vimeus.com, vimeos.net, etc.) vía backend
        this.showToast('🔍 Extrayendo fuente de película del servidor...', 'info');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const res = await fetch('/api/resolve-media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: rawUrl }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`HTTP Error ${res.status}`);
          }

          const mediaData = await res.json();

          if (mediaData && mediaData.error) {
            return this.showToast(mediaData.error, 'danger');
          }

          await window.socketManager.emitChangeMedia(mediaData || { type: 'mp4', url: rawUrl });
          if (this.inputMediaUrl) this.inputMediaUrl.value = '';
        } catch (err) {
          clearTimeout(timeoutId);
          console.warn('Extracción de servidor diferida, cargando como fuente directa:', err.message);
          await window.socketManager.emitChangeMedia({ type: 'mp4', url: rawUrl });
          if (this.inputMediaUrl) this.inputMediaUrl.value = '';
        }
      });
    }

    // SELECTOR DE CALIDAD DE VIDEO (Si existe)
    if (this.selectVideoQuality) {
      this.selectVideoQuality.addEventListener('change', (e) => {
        const quality = e.target.value;
        if (window.playerManager.setVideoQuality) {
          window.playerManager.setVideoQuality(quality);
        }
      });
    }

    // CONTROL DE VOLUMEN LOCAL DE VIDEO
    if (this.inputVideoVolume) {
      this.inputVideoVolume.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        window.playerManager.setLocalVolume(val);
      });
    }

    if (this.btnToggleVideoMute) {
      this.btnToggleVideoMute.addEventListener('click', () => {
        const isMuted = window.playerManager.toggleLocalMute();
        if (this.inputVideoVolume) {
          this.inputVideoVolume.value = isMuted ? 0 : 100;
        }
      });
    }

    // PANTALLA COMPLETA 100% ESTABLE (ANDROID, WINDOWS & BROWSER)
    if (this.btnToggleFullscreen) {
      this.btnToggleFullscreen.addEventListener('click', () => {
        const stage = this.playerStage || document.getElementById('playerStage');
        if (!stage) return;

        const isAndroidOrMobile = !!window.Capacitor || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const isNativeFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement);
        const isCssFS = document.body.classList.contains('fullscreen-active') || stage.classList.contains('fullscreen-active');

        if (isNativeFS || isCssFS) {
          this.exitFullscreen();
        } else {
          // ENTRAR A PANTALLA COMPLETA
          this._isExitingFullscreen = false;
          document.body.classList.add('fullscreen-active');
          stage.classList.add('fullscreen-active');

          if (!isAndroidOrMobile) {
            const docEl = document.documentElement;
            let promise = null;
            if (docEl.requestFullscreen) promise = docEl.requestFullscreen();
            else if (docEl.webkitRequestFullscreen) promise = docEl.webkitRequestFullscreen();
            else if (stage.requestFullscreen) promise = stage.requestFullscreen();

            if (promise && promise.catch) {
              promise.catch(e => console.warn('Native FS fallback to CSS:', e.message));
            }
          }
          this.handleFullscreenChange(true);
        }
      });
    }

    // Interceptar Botón Físico / Gesto de Ir Atrás en Android
    let backPressCount = 0;
    let backPressTimer = null;

    const handleAndroidBack = (e) => {
      const stage = this.playerStage || document.getElementById('playerStage');
      const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement) || (stage && stage.classList.contains('fullscreen-active')) || document.body.classList.contains('fullscreen-active');
      if (isFS) {
        if (e && e.preventDefault) e.preventDefault();
        this.exitFullscreen();
        return true;
      }

      if (this.emojiPickerPopover && this.emojiPickerPopover.style.display !== 'none' && this.emojiPickerPopover.style.display !== '') {
        if (e && e.preventDefault) e.preventDefault();
        this.emojiPickerPopover.style.display = 'none';
        return true;
      }
      if (this.gifPickerPopover && this.gifPickerPopover.style.display !== 'none' && this.gifPickerPopover.style.display !== '') {
        if (e && e.preventDefault) e.preventDefault();
        this.gifPickerPopover.style.display = 'none';
        return true;
      }
      if (this.floatingChatOverlay && this.floatingChatOverlay.style.display !== 'none' && this.floatingChatOverlay.style.display !== '') {
        if (e && e.preventDefault) e.preventDefault();
        this.floatingChatOverlay.style.display = 'none';
        return true;
      }
      if (this.modalSwitchRoom && this.modalSwitchRoom.style.display !== 'none' && this.modalSwitchRoom.style.display !== '') {
        if (e && e.preventDefault) e.preventDefault();
        this.modalSwitchRoom.style.display = 'none';
        return true;
      }

      if (document.body.classList.contains('in-room')) {
        if (e && e.preventDefault) e.preventDefault();
        backPressCount++;
        if (backPressCount === 1) {
          this.showToast('👈 Presiona Atrás de nuevo si deseas salir de la sala', 'info');
          backPressTimer = setTimeout(() => { backPressCount = 0; }, 2500);
        } else if (backPressCount >= 2) {
          clearTimeout(backPressTimer);
          backPressCount = 0;
          this.leaveRoom();
        }
        return true;
      }
      return false;
    };

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        handleAndroidBack(null);
      });
    }

    // Controles Personalizados del Host
    if (this.btnHostPlayPause) {
      this.btnHostPlayPause.addEventListener('click', () => {
        window.playerManager.hostTogglePlayPause();
      });
    }

    if (this.btnHostRewind) {
      this.btnHostRewind.addEventListener('click', () => {
        window.playerManager.hostSkip(-10);
      });
    }

    if (this.btnHostForward) {
      this.btnHostForward.addEventListener('click', () => {
        window.playerManager.hostSkip(10);
      });
    }

    if (this.timeProgressSlider) {
      this.timeProgressSlider.addEventListener('change', (e) => {
        if (!window.socketManager.isHost) return;
        const targetTime = parseFloat(e.target.value);
        window.playerManager.hostSeekTo(targetTime);
      });
    }

    // Copiar Código de Sala
    if (this.btnCopyInvite) {
      this.btnCopyInvite.addEventListener('click', () => {
        if (!this.currentRoom) return;
        navigator.clipboard.writeText(this.currentRoom.roomId);
        this.showToast(`¡Código de sala (${this.currentRoom.roomId}) copiado! 📋`, 'success');
      });
    }

    // Enviar Chat de texto
    if (this.chatForm) {
      this.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!this.inputChatMessage) return;
        const text = this.inputChatMessage.value.trim();
        if (text) {
          window.socketManager.sendChatMessage(text, null);
          this.inputChatMessage.value = '';
        }
      });
    }

    // CHAT FLOTANTE SOBRE EL VIDEO (DuoPlayX)
    if (this.btnFloatingChatBubble) {
      this.btnFloatingChatBubble.addEventListener('click', () => this.toggleFloatingChatOverlay());
    }

    if (this.btnCloseFloatingChat) {
      this.btnCloseFloatingChat.addEventListener('click', () => this.toggleFloatingChatOverlay(false));
    }

    if (this.floatingChatForm) {
      this.floatingChatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = this.inputFloatingChatMessage.value.trim();
        if (text) {
          window.socketManager.sendChatMessage(text, null);
          this.inputFloatingChatMessage.value = '';
        }
      });
    }

    // SELECTOR DE EMOJIS
    if (this.btnOpenEmojiPicker) {
      this.btnOpenEmojiPicker.addEventListener('click', () => {
        const isVisible = this.emojiPickerPopover && this.emojiPickerPopover.style.display === 'flex';
        if (this.gifPickerPopover) this.gifPickerPopover.style.display = 'none';
        if (this.emojiPickerPopover) {
          if (!isVisible) {
            this.emojiPickerPopover.style.display = 'flex';
            this.renderEmojis(this.emojiCategories.faces);
          } else {
            this.emojiPickerPopover.style.display = 'none';
          }
        }
      });
    }

    if (this.btnCloseEmojiPicker) {
      this.btnCloseEmojiPicker.addEventListener('click', () => {
        if (this.emojiPickerPopover) this.emojiPickerPopover.style.display = 'none';
      });
    }

    document.querySelectorAll('.emoji-cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.emoji-cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const cat = chip.dataset.cat;
        if (this.emojiCategories && this.emojiCategories[cat]) {
          this.renderEmojis(this.emojiCategories[cat]);
        }
      });
    });

    // BUSCADOR DE GIFS MULTI-MOTOR
    if (this.btnOpenGifPicker) {
      this.btnOpenGifPicker.addEventListener('click', () => {
        const isVisible = this.gifPickerPopover && this.gifPickerPopover.style.display === 'flex';
        if (this.emojiPickerPopover) this.emojiPickerPopover.style.display = 'none';
        if (this.gifPickerPopover) {
          if (!isVisible) {
            this.gifPickerPopover.style.display = 'flex';
            this.renderGifs(this.gifCategories.trending);
          } else {
            this.gifPickerPopover.style.display = 'none';
          }
        }
      });
    }

    if (this.btnCloseGifPicker) {
      this.btnCloseGifPicker.addEventListener('click', () => {
        if (this.gifPickerPopover) this.gifPickerPopover.style.display = 'none';
      });
    }

    if (this.btnSendDirectGif) {
      this.btnSendDirectGif.addEventListener('click', () => {
        if (!this.inputDirectGifUrl) return;
        const url = this.inputDirectGifUrl.value.trim();
        if (url) {
          window.socketManager.sendChatMessage('', url);
          this.inputDirectGifUrl.value = '';
          if (this.gifPickerPopover) this.gifPickerPopover.style.display = 'none';
          this.showToast('¡GIF enviado al chat! 🖼️', 'success');
        } else {
          this.showToast('Ingresa una URL válida de GIF.', 'warning');
        }
      });
    }

    // SUGERENCIAS DE GIFS EN TIEMPO REAL
    if (this.inputGifSearch) {
      let searchTimeout = null;
      this.inputGifSearch.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim().toLowerCase();
        this.updateGifSuggestions(query);
        searchTimeout = setTimeout(() => {
          this.fetchGifsMultiEngine(query);
        }, 300);
      });
    }

    // Reacciones Flotantes
    document.querySelectorAll('.btn-reaction').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji || btn.innerText.trim();
        if (emoji) {
          this.triggerFloatingReaction(emoji);
          window.socketManager.sendReaction(emoji);
        }
      });
    });

    // Forzar Resync
    if (this.btnResync) {
      this.btnResync.addEventListener('click', () => {
        if (this.currentRoom && window.socketManager.isHost) {
          const time = window.playerManager.getCurrentTime();
          window.socketManager.emitMediaAction('seek', time);
          this.showToast('Sincronización forzada enviada 🔄', 'info');
        } else {
          window.socketManager.requestHostSync();
          this.showToast('Sincronizando con el tiempo actual del Host... 🔄', 'info');
        }
      });
    }

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const targetId = tab.dataset.tab;
        document.getElementById(targetId).classList.add('active');
      });
    });

    // Navegación Móvil
    if (this.btnNavPlayer) this.btnNavPlayer.addEventListener('click', () => this.setActiveMobileTab('player'));
    if (this.btnNavChat) this.btnNavChat.addEventListener('click', () => this.setActiveMobileTab('chat'));
    if (this.btnNavUsers) this.btnNavUsers.addEventListener('click', () => this.setActiveMobileTab('users'));

    // Resize listener para alternar flex / grid dinámicamente
    window.addEventListener('resize', () => {
      if (this.currentRoom && this.mainRoom && this.mainRoom.style.display !== 'none') {
        if (window.innerWidth <= 768) {
          this.mainRoom.style.display = 'flex';
          this.mobileNavBar.style.display = 'flex';
        } else {
          this.mainRoom.style.display = 'grid';
          this.mobileNavBar.style.display = 'none';
          this.sectionPlayer.style.display = 'flex';
          this.sectionSidebar.style.display = 'flex';
        }
      }
    });

    window.playerManager.onLocalActionCallback = (action, currentTime) => {
      window.socketManager.emitMediaAction(action, currentTime);
      this.togglePlayPauseSVG(action === 'play');
    };

    // Control de micrófono unificado DuoPlayX
    if (this.btnToggleMic) {
      this.btnToggleMic.addEventListener('click', async () => {
        const micId = this.selectMicDevice ? this.selectMicDevice.value : null;
        const isMuted = await window.webrtcVoiceManager.toggleMic(micId);
        this.updateMicUIState(isMuted);
      });
    }

    if (this.btnMobileToggleMic) {
      this.btnMobileToggleMic.addEventListener('click', async () => {
        const micId = this.selectMicDevice ? this.selectMicDevice.value : null;
        const isMuted = await window.webrtcVoiceManager.toggleMic(micId);
        this.updateMicUIState(isMuted);
      });
    }

    const btnNavMainMic = document.getElementById('btnNavMainMic');
    if (btnNavMainMic) {
      btnNavMainMic.addEventListener('click', async () => {
        const micId = this.selectMicDevice ? this.selectMicDevice.value : null;
        const isMuted = await window.webrtcVoiceManager.toggleMic(micId);
        this.updateMicUIState(isMuted);
      });
    }

    const btnNavProfile = document.getElementById('btnNavProfile');
    if (btnNavProfile) {
      btnNavProfile.addEventListener('click', () => {
        if (this.modalSwitchRoom) this.modalSwitchRoom.style.display = 'flex';
      });
    }

    if (this.selectMicDevice) {
      this.selectMicDevice.addEventListener('focus', () => {
        window.webrtcVoiceManager.populateMicrophones(this.selectMicDevice);
      });
      this.selectMicDevice.addEventListener('change', async (e) => {
        await window.webrtcVoiceManager.changeMicDevice(e.target.value);
      });
    }

    // Control de inactividad sobre el reproductor y Pantalla Completa
    this.setupStageInactivityControls();
  }

  updateMicUIState(isMuted) {
    const micGlowCircle = document.getElementById('micGlowCircle');
    const mainMicDockLabel = document.getElementById('mainMicDockLabel');
    const mainMicDockIcon = document.getElementById('mainMicDockIcon');

    if (isMuted) {
      if (this.voiceMicStateIcon) this.voiceMicStateIcon.innerText = '🎙️';
      if (this.voiceMicStateLabel) this.voiceMicStateLabel.innerText = 'Encender Micrófono';
      if (this.btnToggleMic) this.btnToggleMic.className = 'btn btn-sm btn-secondary';
      if (this.mobileMicIcon) this.mobileMicIcon.innerText = '🎙️';
      if (this.mobileMicLabel) this.mobileMicLabel.innerText = 'Encender Mic';
      if (this.btnMobileToggleMic) this.btnMobileToggleMic.className = 'btn btn-xs btn-secondary';
      if (micGlowCircle) micGlowCircle.classList.remove('mic-active');
      if (mainMicDockLabel) mainMicDockLabel.innerText = 'Hablar';
      if (mainMicDockIcon) mainMicDockIcon.innerText = '🎙️';
    } else {
      if (this.voiceMicStateIcon) this.voiceMicStateIcon.innerText = '🔇';
      if (this.voiceMicStateLabel) this.voiceMicStateLabel.innerText = 'Apagar Micrófono';
      if (this.btnToggleMic) this.btnToggleMic.className = 'btn btn-sm btn-danger-soft';
      if (this.mobileMicIcon) this.mobileMicIcon.innerText = '🔇';
      if (this.mobileMicLabel) this.mobileMicLabel.innerText = 'Apagar Mic';
      if (this.btnMobileToggleMic) this.btnMobileToggleMic.className = 'btn btn-xs btn-danger-soft';
      if (micGlowCircle) micGlowCircle.classList.add('mic-active');
      if (mainMicDockLabel) mainMicDockLabel.innerText = 'Hablando';
      if (mainMicDockIcon) mainMicDockIcon.innerText = '🎙️';
    }
  }

  setupStageInactivityControls() {
    const resetActivity = () => {
      this.isUserActiveInStage = true;
      this.showStageFloatingUI(true);

      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = setTimeout(() => {
        this.isUserActiveInStage = false;
        this.showStageFloatingUI(false);
      }, 3500);
    };

    // Registrar eventos usando la fase de captura solo en document (no duplicar en window)
    const events = ['mousemove', 'mousedown', 'click', 'touchstart', 'pointermove', 'keydown'];
    events.forEach(evt => {
      document.addEventListener(evt, resetActivity, { capture: true, passive: true });
    });

    // Clic / Tap sobre el reproductor de video (stageActivityTracker)
    const tracker = document.getElementById('stageActivityTracker');
    if (tracker) {
      tracker.addEventListener('click', (e) => {
        resetActivity();

        // Si la capa de activar video/autoplay sigue visible, ocultarla inmediatamente
        if (this.videoAutoplayOverlay && this.videoAutoplayOverlay.style.display !== 'none') {
          this.unlockVideoExperience();
          return;
        }

        // Si es Host y los controles ya estaban visibles, alterna reproducción
        if (window.socketManager?.isHost) {
          window.playerManager.hostTogglePlayPause();
        }
      });
    }

    document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
    document.addEventListener('mozfullscreenchange', () => this.handleFullscreenChange());
  }

  quickParseMedia(url) {
    if (!url || typeof url !== 'string') return null;
    url = url.trim();

    // 1. YouTube
    const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
    if (ytMatch && ytMatch[1]) {
      return { type: 'youtube', url: url, videoId: ytMatch[1] };
    }

    // 2. Google Drive
    const gdriveMatch = url.match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/file\/d\/)([a-zA-Z0-9_-]+)/);
    if (gdriveMatch && gdriveMatch[1]) {
      const fileId = gdriveMatch[1];
      return { type: 'gdrive', url: `/api/gdrive-stream/${fileId}`, fileId: fileId, isGDrive: true };
    }

    // 3. Pixeldrain
    if (url.includes('pixeldrain.com')) {
      let fileId = null;
      if (url.includes('/u/')) {
        fileId = url.split('/u/')[1].split('/')[0].split('?')[0];
        url = `https://pixeldrain.com/api/file/${fileId}`;
      }
      return { type: 'mp4', url: url };
    }

    // 4. Enlaces .m3u8 directos
    if (url.includes('.m3u8')) {
      return { type: 'hls', url: url };
    }

    // 5. Archivos de video directo (.mp4, .mkv, .webm, .mov, etc.)
    if (url.match(/\.(mp4|mkv|webm|ogv|mov|m4v|avi)(\?.*)?$/i)) {
      return { type: 'mp4', url: url };
    }

    return null;
  }

  exitFullscreen() {
    const stage = this.playerStage || document.getElementById('playerStage');
    this._isExitingFullscreen = true;
    document.body.classList.remove('fullscreen-active');
    if (stage) stage.classList.remove('fullscreen-active');

    const isNativeFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement);
    if (isNativeFS) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }

    setTimeout(() => { this._isExitingFullscreen = false; }, 800);
    this.handleFullscreenChange(false);
  }

  handleFullscreenChange(forceState = null) {
    if (this._isExitingFullscreen && forceState === null) return;

    const stage = this.playerStage || document.getElementById('playerStage');
    let isFS = forceState;
    if (isFS === null) {
      isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement) || (stage && stage.classList.contains('fullscreen-active')) || document.body.classList.contains('fullscreen-active');
    }

    if (!isFS) {
      document.body.classList.remove('fullscreen-active');
      if (stage) stage.classList.remove('fullscreen-active');
      clearTimeout(this.inactivityTimer);
      this.showStageFloatingUI(true);
    } else {
      document.body.classList.add('fullscreen-active');
      if (stage) stage.classList.add('fullscreen-active');
      this.showToast('📺 Modo Pantalla Completa activado', 'info');
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = setTimeout(() => {
        this.showStageFloatingUI(false);
      }, 3500);
    }
  }

  showStageFloatingUI(visible) {
    const stageFloatingReactionsBar = document.getElementById('stageFloatingReactionsBar');
    const controlsBar = document.getElementById('timelineControlsBar');
    const stageElements = [
      this.stageFullscreenBtn,
      this.btnFloatingChatBubble,
      this.syncStatusBadge,
      stageFloatingReactionsBar,
      controlsBar
    ];

    stageElements.forEach(el => {
      if (el) {
        if (visible) {
          el.classList.remove('idle-hidden');
        } else {
          // No ocultar la burbuja si el chat flotante está abierto
          if (el === this.btnFloatingChatBubble && this.floatingChatOverlay && this.floatingChatOverlay.style.display === 'flex') {
            return;
          }
          el.classList.add('idle-hidden');
        }
      }
    });
  }

  highlightFloatingBubbleOnNewMessage() {
    if (!this.btnFloatingChatBubble) return;

    // Hacer visible suavemente la burbuja de chat al recibir mensaje
    this.btnFloatingChatBubble.classList.remove('idle-hidden');

    clearTimeout(this.messageHighlightTimer);
    this.messageHighlightTimer = setTimeout(() => {
      const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement);
      const isOverlayOpen = this.floatingChatOverlay && this.floatingChatOverlay.style.display === 'flex';

      if (isFS && !this.isUserActiveInStage && !isOverlayOpen) {
        this.btnFloatingChatBubble.classList.add('idle-hidden');
      }
    }, 4500);
  }

  unlockVideoExperience() {
    if (this.videoAutoplayOverlay) {
      this.videoAutoplayOverlay.style.display = 'none';
    }
    if (window.playerManager) {
      window.playerManager.unlockVideoAutoplay();
    }
    this.showToast('¡Video y Sincronización Activados! 🎬', 'success');
  }

  togglePlayPauseSVG(isPlaying) {
    if (isPlaying) {
      this.svgPlayIcon.style.display = 'none';
      this.svgPauseIcon.style.display = 'block';
    } else {
      this.svgPlayIcon.style.display = 'block';
      this.svgPauseIcon.style.display = 'none';
    }
  }

  // SUGERENCIAS DE GIFS EN TIEMPO REAL AL ESCRIBIR
  updateGifSuggestions(query) {
    this.gifSuggestionsBox.innerHTML = '';
    if (!query) {
      this.gifSuggestionsBox.innerHTML = `
        <span class="suggestion-chip" data-query="perrito">🐶 perrito</span>
        <span class="suggestion-chip" data-query="salto">🦘 salto</span>
        <span class="suggestion-chip" data-query="enojado">😡 enojado</span>
        <span class="suggestion-chip" data-query="risa">😂 risa</span>
        <span class="suggestion-chip" data-query="baile">💃 baile</span>
      `;
    } else {
      const matches = this.popularKeywords.filter(k => k.includes(query) || query.includes(k));
      const suggestions = matches.length > 0 ? matches : [query, `${query} meme`, `${query} divertido`].slice(0, 5);
      
      suggestions.forEach(s => {
        const chip = document.createElement('span');
        chip.className = 'suggestion-chip';
        chip.dataset.query = s;
        chip.innerText = `🔍 ${s}`;
        this.gifSuggestionsBox.appendChild(chip);
      });
    }

    this.gifSuggestionsBox.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.dataset.query;
        this.inputGifSearch.value = q;
        this.fetchGifsMultiEngine(q);
      });
    });
  }

  async fetchGifsMultiEngine(rawQuery) {
    if (!rawQuery) return this.renderGifs(this.gifCategories.trending);

    const query = rawQuery.toLowerCase().trim();
    const translatedQuery = this.esTranslationMap[query] || query;

    if (this.gifCategories[query]) {
      return this.renderGifs(this.gifCategories[query]);
    }

    this.gifGrid.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8; grid-column:span 2;">Buscando GIFs...</div>';

    try {
      const tenorRes = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(translatedQuery)}&key=LIVDSRZULELA&limit=16`);
      const tenorData = await tenorRes.json();
      if (tenorData && tenorData.results && tenorData.results.length > 0) {
        const urls = tenorData.results.map(g => g.media_formats.gif.url);
        this.renderGifs(urls);
        return;
      }
    } catch (e) {
      console.warn('Tenor V2 fetch failed:', e);
    }

    try {
      const giphyRes = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=pL01FjDikR256ch98g588sB89RIwN4nW&limit=16&q=${encodeURIComponent(translatedQuery)}`);
      const giphyData = await giphyRes.json();
      if (giphyData && giphyData.data && giphyData.data.length > 0) {
        const urls = giphyData.data.map(g => g.images.fixed_height.url);
        this.renderGifs(urls);
        return;
      }
    } catch (e) {
      console.warn('Giphy fetch failed:', e);
    }

    this.renderGifs(this.gifCategories.trending);
  }

  renderGifs(gifUrls) {
    this.gifGrid.innerHTML = '';
    gifUrls.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'gif-item';
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        window.socketManager.sendChatMessage('', url);
        this.gifPickerPopover.style.display = 'none';
        this.showToast('¡GIF enviado al chat! 🖼️', 'success');
      });
      this.gifGrid.appendChild(img);
    });
  }

  renderEmojis(emojiList) {
    this.emojiGrid.innerHTML = '';
    emojiList.forEach(emoji => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-item-btn';
      btn.innerText = emoji;
      btn.addEventListener('click', () => {
        this.inputChatMessage.value += emoji;
        this.inputChatMessage.focus();
      });
      this.emojiGrid.appendChild(btn);
    });
  }

  isMobileOrCompactView() {
    return window.innerWidth <= 1024 || window.innerHeight <= 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  setActiveMobileTab(mode) {
    if (this.btnNavChat) this.btnNavChat.classList.remove('active');
    if (this.btnNavUsers) this.btnNavUsers.classList.remove('active');

    if (mode === 'chat') {
      if (this.btnNavChat) this.btnNavChat.classList.add('active');
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const tabChatBtn = document.querySelector('[data-tab="tabChat"]');
      const tabChatContent = document.getElementById('tabChat');
      if (tabChatBtn) tabChatBtn.classList.add('active');
      if (tabChatContent) tabChatContent.classList.add('active');
    } else if (mode === 'users') {
      if (this.btnNavUsers) this.btnNavUsers.classList.add('active');
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const tabUsersBtn = document.querySelector('[data-tab="tabUsers"]');
      const tabUsersContent = document.getElementById('tabUsers');
      if (tabUsersBtn) tabUsersBtn.classList.add('active');
      if (tabUsersContent) tabUsersContent.classList.add('active');
    }
  }

  checkUrlRoomCode() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      this.inputRoomCode.value = roomParam.toUpperCase();
      this.showToast(`Código de sala ${roomParam.toUpperCase()} detectado. Elige tu apodo y haz clic en Unirme.`, 'info');
    }
  }

  enterRoom(roomData) {
    if (!roomData || (!roomData.roomId && !roomData.id)) {
      return this.showToast('Error al recibir información de la sala.', 'danger');
    }

    const roomId = roomData.roomId || roomData.id;

    // Si ya estábamos en una sala previa, limpiar reproductor
    if (this.currentRoom && (this.currentRoom.roomId || this.currentRoom.id) !== roomId) {
      if (window.playerManager) window.playerManager.destroyPlayer();
    }

    this.currentRoom = roomData;
    document.body.classList.add('in-room');

    // Cerrar TODOS los modales y ventanas flotantes activas
    if (this.modalLobby) this.modalLobby.style.display = 'none';
    if (this.modalSwitchRoom) this.modalSwitchRoom.style.display = 'none';
    if (this.emojiPickerPopover) this.emojiPickerPopover.style.display = 'none';
    if (this.gifPickerPopover) this.gifPickerPopover.style.display = 'none';
    if (this.floatingChatOverlay) this.floatingChatOverlay.style.display = 'none';

    if (this.mainRoom) {
      const isPortrait = window.matchMedia('(orientation: portrait)').matches || window.innerWidth <= 768;
      if (isPortrait) {
        this.mainRoom.style.display = 'flex';
        if (this.mobileNavBar) this.mobileNavBar.style.display = 'flex';
        this.sectionPlayer.style.display = 'flex';
        if (this.sectionSidebar) this.sectionSidebar.style.display = 'flex';
      } else {
        this.mainRoom.style.display = 'grid';
        if (this.mobileNavBar) this.mobileNavBar.style.display = 'none';
        this.sectionPlayer.style.display = 'flex';
        if (this.sectionSidebar) this.sectionSidebar.style.display = 'flex';
      }
    }

    if (this.headerRoomInfo) this.headerRoomInfo.style.display = 'flex';
    if (this.displayRoomCode) this.displayRoomCode.innerText = roomId;
    if (this.headerUserAvatar && roomData.user) this.headerUserAvatar.innerText = roomData.user.avatar || '⚡';
    if (this.headerUserName && roomData.user) this.headerUserName.innerText = roomData.user.username || 'Invitado';

    if (roomData.media) {
      const isPlaying = roomData.mediaState ? !!roomData.mediaState.isPlaying : false;
      const initialTime = roomData.mediaState ? (roomData.mediaState.calculatedTime || roomData.mediaState.currentTime || 0) : 0;
      window.playerManager.setMediaSource(roomData.media, isPlaying).then(() => {
        window.playerManager.syncRemoteAction(isPlaying ? 'play' : 'pause', initialTime, isPlaying);
      }).catch(err => {
        console.warn('Error al configurar media inicial:', err);
      });
    }

    if (this.chatMessages) {
      this.chatMessages.innerHTML = '<div class="chat-welcome-notice"><span>✨ ¡Bienvenidos a DuoPlayX! Chatea, busca GIFs, envía Emojis y entra a la Sala de Voz en Vivo.</span></div>';
    }
    if (this.floatingChatMessages) this.floatingChatMessages.innerHTML = '';
    if (roomData.chatHistory) {
      roomData.chatHistory.forEach(msg => this.appendChatMessage(msg));
    }

    this.updateUsersList(roomData.users || []);
    this.updateVoiceRoomState(roomData.voiceMembers || [], roomData.users || []);
    
    const isUserHost = roomData.user ? !!roomData.user.isHost : window.socketManager.isHost;
    this.updateHostControlsView(isUserHost);

    // Unirse automáticamente al canal de voz DuoPlayX & cargar lista de micrófonos
    window.webrtcVoiceManager.joinVoiceRoom();
    if (this.selectMicDevice) {
      window.webrtcVoiceManager.populateMicrophones(this.selectMicDevice);
    }

    // Auto-Sincronización inicial garantizada 1.2s después de ingresar a la sala como invitado
    if (roomData.user && !roomData.user.isHost) {
      setTimeout(() => {
        if (this.currentRoom && window.socketManager) {
          console.log('🔄 Ejecutando sincronización automática inicial de invitado...');
          window.socketManager.requestHostSync();
        }
      }, 1200);
    }

    // Mantener pantalla del navegador siempre encendida (Web WakeLock API)
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').catch(() => {});
    }

    // Ajustar vista
    window.dispatchEvent(new Event('resize'));
  }

  toggleFloatingChatOverlay(forceState) {
    if (!this.floatingChatOverlay) return;
    const isVisible = forceState !== undefined
      ? forceState
      : (this.floatingChatOverlay.style.display === 'none' || !this.floatingChatOverlay.style.display);

    this.floatingChatOverlay.style.display = isVisible ? 'flex' : 'none';

    if (isVisible) {
      this.unreadChatCount = 0;
      if (this.chatUnreadBadge) this.chatUnreadBadge.style.display = 'none';
      if (this.inputFloatingChatMessage) this.inputFloatingChatMessage.focus();
    }
  }

  appendChatMessage(msg) {
    if (!msg) return;
    const msgId = msg.id || ('msg_' + Date.now() + Math.random().toString(36).substr(2, 4));

    const createBubbleElement = (isFloating = false) => {
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${msg.type === 'system' ? 'system' : ''}`;
      bubble.dataset.msgId = msgId;

      if (msg.type === 'system') {
        bubble.innerHTML = `<span class="chat-text">${msg.text}</span>`;
      } else {
        let content = '';
        if (msg.text) {
          content += `<div class="chat-text">${this.escapeHTML(msg.text)}</div>`;
        }
        if (msg.gifUrl) {
          content += `<img src="${msg.gifUrl}" class="chat-gif-img" alt="GIF" loading="lazy">`;
        }

        const reactionsContainerHTML = `<div class="msg-reactions-list" id="reactions_${isFloating ? 'float_' : ''}${msgId}"></div>`;

        const quickReactionsHTML = `
          <div class="msg-reaction-bar">
            <span class="react-btn" data-emoji="❤️">❤️</span>
            <span class="react-btn" data-emoji="👍">👍</span>
            <span class="react-btn" data-emoji="🔥">🔥</span>
            <span class="react-btn" data-emoji="😂">😂</span>
            <span class="react-btn" data-emoji="🎉">🎉</span>
          </div>
        `;

        bubble.innerHTML = `
          <div class="chat-user">
            <span>${msg.user.avatar || '⚡'}</span>
            <span>${this.escapeHTML(msg.user.username)}</span>
            ${msg.user.isHost ? '<span class="host-tag">HOST 👑</span>' : ''}
          </div>
          ${content}
          ${reactionsContainerHTML}
          ${quickReactionsHTML}
        `;

        bubble.querySelectorAll('.react-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const emoji = btn.dataset.emoji;
            if (window.socketManager) {
              window.socketManager.sendChatMessageReaction(msgId, emoji);
            }
          });
        });
      }
      return bubble;
    };

    const mainBubble = createBubbleElement(false);
    this.chatMessages.appendChild(mainBubble);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    if (this.floatingChatMessages) {
      const floatBubble = createBubbleElement(true);
      this.floatingChatMessages.appendChild(floatBubble);
      this.floatingChatMessages.scrollTop = this.floatingChatMessages.scrollHeight;
    }

    if (msg.reactions) {
      this.updateChatMessageReactions(msgId, msg.reactions);
    }

    if (msg.type !== 'system' && this.floatingChatOverlay && (this.floatingChatOverlay.style.display === 'none' || !this.floatingChatOverlay.style.display)) {
      this.unreadChatCount++;
      if (this.chatUnreadBadge) {
        this.chatUnreadBadge.innerText = this.unreadChatCount;
        this.chatUnreadBadge.style.display = 'block';
      }
      this.highlightFloatingBubbleOnNewMessage();
    }

    // Carrusel ticker de mensajes estilo Rave para Pantalla Completa
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement || document.body.classList.contains('fullscreen-active'));
    const tickerContainer = document.getElementById('fullscreenChatTickerContainer');
    if (isFS && tickerContainer && msg.type !== 'system') {
      const tickerItem = document.createElement('div');
      tickerItem.className = 'chat-ticker-item';
      let textContent = msg.text ? this.escapeHTML(msg.text) : (msg.gifUrl ? '🖼️ GIF' : '');
      tickerItem.innerHTML = `
        <span class="ticker-avatar">${msg.user?.avatar || '⚡'}</span>
        <span class="ticker-username">${this.escapeHTML(msg.user?.username || 'Usuario')}:</span>
        <span class="ticker-text">${textContent}</span>
      `;
      tickerContainer.appendChild(tickerItem);
      setTimeout(() => {
        if (tickerItem && tickerItem.parentNode) {
          tickerItem.parentNode.removeChild(tickerItem);
        }
      }, 8600);
    }
  }

  updateChatMessageReactions(msgId, reactions) {
    if (!msgId) return;

    ['reactions_' + msgId, 'reactions_float_' + msgId].forEach(containerId => {
      const container = document.getElementById(containerId);
      if (!container) return;

      container.innerHTML = '';
      if (!reactions) return;

      Object.entries(reactions).forEach(([emoji, users]) => {
        if (users && users.length > 0) {
          const badge = document.createElement('span');
          badge.className = 'msg-reaction-badge';
          badge.title = `Reaccionado por: ${users.join(', ')}`;
          badge.innerHTML = `${emoji} <small>${users.length}</small>`;
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.socketManager) window.socketManager.sendChatMessageReaction(msgId, emoji);
          });
          container.appendChild(badge);
        }
      });
    });
  }

  updateUsersList(users) {
    if (!users) return;
    this.currentRoomUsers = users;
    this.userCount.innerText = users.length;
    this.usersList.innerHTML = '';

    const isCurrentHost = window.socketManager.isHost;

    users.forEach(u => {
      const item = document.createElement('div');
      item.id = `user_item_${u.socketId}`;
      item.className = 'user-item';
      
      let voiceBadge = '';
      if (u.inVoiceRoom) {
        if (!u.isMuted) voiceBadge = `<span class="voice-speaking-wave">🎙️</span>`;
        else voiceBadge = `<span style="font-size:0.9rem; opacity:0.6;">🎧</span>`;
      }

      let kickButtonHTML = '';
      if (isCurrentHost && !u.isHost) {
        kickButtonHTML = `<button class="btn btn-xs btn-danger-soft" onclick="window.kickUserFromRoom('${u.socketId}')" title="Expulsar de la sala">❌ Expulsar</button>`;
      }

      item.innerHTML = `
        <div class="user-item-info">
          <span style="font-size: 1.3rem;">${u.avatar || '⚡'}</span>
          <strong style="font-size: 0.9rem;">${this.escapeHTML(u.username)}</strong>
          ${voiceBadge}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${u.isHost ? '<span class="host-tag">HOST 👑</span>' : ''}
          ${kickButtonHTML}
        </div>
      `;
      this.usersList.appendChild(item);
    });
  }

  updateVoiceRoomState(voiceMembers, users) {
    if (users) this.updateUsersList(users);
    this.currentVoiceMembers = voiceMembers || [];

    if (this.mobileVoiceCount) {
      this.mobileVoiceCount.innerText = this.currentVoiceMembers.length;
    }

    if (this.mobileVoiceAvatars) {
      this.mobileVoiceAvatars.innerHTML = '';
      this.currentVoiceMembers.forEach(m => {
        const span = document.createElement('span');
        span.id = `mobile_voice_avatar_${m.socketId}`;
        span.title = m.username;
        span.style.fontSize = '1.1rem';
        span.innerText = m.avatar || '⚡';
        this.mobileVoiceAvatars.appendChild(span);
      });
    }

    this.voiceMembersGrid.innerHTML = '';
    if (this.currentVoiceMembers.length === 0) {
      this.voiceMembersGrid.innerHTML = '<div class="voice-empty-state">Canal de voz activo. Presiona Encender Micrófono para hablar.</div>';
      return;
    }

    const mySocketId = window.socketManager.socket?.id;

    this.currentVoiceMembers.forEach(m => {
      const card = document.createElement('div');
      card.id = `voice_card_${m.socketId}`;
      card.className = `voice-member-card ${m.isSpeaking ? 'user-speaking' : ''}`;

      let listenBtnHTML = '';
      if (m.socketId !== mySocketId) {
        const isMuted = window.webrtcVoiceManager.isPeerMuted(m.socketId);
        listenBtnHTML = `
          <div class="voice-peer-controls">
            <button class="btn btn-xs ${isMuted ? 'btn-secondary' : 'btn-primary'}" id="btn_listen_${m.socketId}" title="Haz clic para escuchar o silenciar la voz de ${this.escapeHTML(m.username)}">
              ${isMuted ? '🔇 Activar Voz' : '🔊 Escuchando'}
            </button>
            <input type="range" class="voice-peer-slider" id="slider_vol_${m.socketId}" min="0" max="100" value="100" title="Volumen de ${this.escapeHTML(m.username)}">
          </div>
        `;
      }

      card.innerHTML = `
        <div class="voice-avatar-box">
          <span>${m.avatar || '⚡'}</span>
          ${m.isMuted ? '<span class="mute-badge">🎧</span>' : '<span class="live-mic-badge">🎙️</span>'}
        </div>
        <span class="voice-member-name">${this.escapeHTML(m.username)}</span>
        ${listenBtnHTML}
      `;

      this.voiceMembersGrid.appendChild(card);

      if (m.socketId !== mySocketId) {
        const btnListen = card.querySelector(`#btn_listen_${m.socketId}`);
        const sliderVol = card.querySelector(`#slider_vol_${m.socketId}`);

        if (btnListen) {
          btnListen.addEventListener('click', (e) => {
            e.stopPropagation();
            const isMutedNow = window.webrtcVoiceManager.togglePeerAudio(m.socketId);
            if (isMutedNow) {
              btnListen.className = 'btn btn-xs btn-secondary';
              btnListen.innerText = '🔇 Activar Voz';
              this.showToast(`🔇 Silenciaste a ${m.username}`, 'info');
            } else {
              btnListen.className = 'btn btn-xs btn-primary';
              btnListen.innerText = '🔊 Escuchando';
              this.showToast(`🔊 Escuchando la voz de ${m.username}`, 'success');
            }
          });
        }

        if (sliderVol) {
          sliderVol.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            window.webrtcVoiceManager.setPeerVolume(m.socketId, val);
          });
        }
      }
    });
  }

  setUserSpeakingIndicator(socketId, isSpeaking) {
    const item = document.getElementById(`user_item_${socketId}`);
    const card = document.getElementById(`voice_card_${socketId}`);
    const mobileAvatar = document.getElementById(`mobile_voice_avatar_${socketId}`);

    if (item) {
      if (isSpeaking) item.classList.add('user-speaking');
      else item.classList.remove('user-speaking');
    }

    if (card) {
      if (isSpeaking) card.classList.add('user-speaking');
      else card.classList.remove('user-speaking');
    }

    if (mobileAvatar) {
      if (isSpeaking) mobileAvatar.classList.add('user-speaking');
      else mobileAvatar.classList.remove('user-speaking');
    }
  }

  updateHostControlsView(isHost) {
    if (this.hostMediaBar) this.hostMediaBar.style.display = isHost ? 'flex' : 'none';
    if (this.hostBtnsGroup) this.hostBtnsGroup.style.display = isHost ? 'flex' : 'none';
    if (this.guestHostNotice) this.guestHostNotice.style.display = isHost ? 'none' : 'block';
    if (this.guestPlayerLockOverlay) {
      if (isHost) this.guestPlayerLockOverlay.classList.remove('active');
      else this.guestPlayerLockOverlay.classList.add('active');
    }
    if (this.timeProgressSlider) {
      this.timeProgressSlider.disabled = !isHost;
      this.timeProgressSlider.style.pointerEvents = isHost ? 'auto' : 'none';
    }
  }

  updateSliderProgress(currentTime, duration) {
    if (duration > 0) {
      this.timeProgressSlider.max = duration;
      this.timeProgressSlider.value = currentTime;
      this.timeCurrent.innerText = this.formatTime(currentTime);
      this.timeDuration.innerText = this.formatTime(duration);
    }
  }

  toggleFloatingChatOverlay(forceShow = null) {
    if (!this.floatingChatOverlay) return;
    const isVisible = forceShow !== null ? forceShow : (this.floatingChatOverlay.style.display === 'none' || !this.floatingChatOverlay.style.display);
    if (isVisible) {
      this.floatingChatOverlay.style.display = 'flex';
      document.body.classList.add('floating-chat-open');
      this.unreadChatCount = 0;
      if (this.chatUnreadBadge) this.chatUnreadBadge.style.display = 'none';
      // No enfocamos el input automáticamente para no desplegar el teclado Android
    } else {
      this.floatingChatOverlay.style.display = 'none';
      document.body.classList.remove('floating-chat-open');
    }
  }

  handleBackAction() {
    const stage = this.playerStage || document.getElementById('playerStage');
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement) || (stage && stage.classList.contains('fullscreen-active')) || document.body.classList.contains('fullscreen-active');
    if (isFS) {
      this.exitFullscreen();
      return true;
    }

    if (this.emojiPickerPopover && this.emojiPickerPopover.style.display !== 'none' && this.emojiPickerPopover.style.display !== '') {
      this.emojiPickerPopover.style.display = 'none';
      return true;
    }
    if (this.gifPickerPopover && this.gifPickerPopover.style.display !== 'none' && this.gifPickerPopover.style.display !== '') {
      this.gifPickerPopover.style.display = 'none';
      return true;
    }
    if (this.floatingChatOverlay && this.floatingChatOverlay.style.display !== 'none' && this.floatingChatOverlay.style.display !== '') {
      this.toggleFloatingChatOverlay(false);
      return true;
    }
    if (this.modalSwitchRoom && this.modalSwitchRoom.style.display !== 'none' && this.modalSwitchRoom.style.display !== '') {
      this.modalSwitchRoom.style.display = 'none';
      return true;
    }

    if (document.body.classList.contains('in-room')) {
      if (!this._backPressCount) this._backPressCount = 0;
      this._backPressCount++;
      if (this._backPressCount === 1) {
        this.showToast('👈 Presiona Atrás de nuevo si deseas salir de la sala', 'info');
        clearTimeout(this._backPressTimer);
        this._backPressTimer = setTimeout(() => { this._backPressCount = 0; }, 2500);
      } else if (this._backPressCount >= 2) {
        clearTimeout(this._backPressTimer);
        this._backPressCount = 0;
        this.leaveRoom();
      }
      return true;
    }
    return false;
  }

  leaveRoom() {
    if (window.socketManager) {
      window.socketManager.leaveCurrentRoom();
    }
    if (window.webrtcVoiceManager) {
      window.webrtcVoiceManager.leaveVoiceRoom();
    }
    if (window.playerManager) {
      window.playerManager.destroyPlayer();
    }
    this.currentRoom = null;
    document.body.classList.remove('in-room');
    if (this.mainRoom) this.mainRoom.style.display = 'none';
    if (this.headerRoomInfo) this.headerRoomInfo.style.display = 'none';
    if (this.modalSwitchRoom) this.modalSwitchRoom.style.display = 'none';
    if (this.modalLobby) this.modalLobby.style.display = 'flex';
    this.showToast('Has salido de la sala 👋', 'info');
  }

  formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || isNaN(seconds) || seconds < 0 || seconds > 86400 * 2) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const padSecs = secs < 10 ? `0${secs}` : `${secs}`;
    const padMins = mins < 10 ? `0${mins}` : `${mins}`;

    if (hrs > 0) {
      const padHrs = hrs < 10 ? `0${hrs}` : `${hrs}`;
      return `${padHrs}:${padMins}:${padSecs}`;
    } else {
      return `${padMins}:${padSecs}`;
    }
  }

  triggerFloatingReaction(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.innerText = emoji;

    const randomX = Math.floor(Math.random() * 75) + 10;
    el.style.left = `${randomX}%`;

    this.reactionOverlay.appendChild(el);

    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3600);
  }

  showFloatingReaction(emoji, username) {
    this.triggerFloatingReaction(emoji);
  }

  updateSyncBadge(synced, text) {
    const badgeText = document.getElementById('syncStatusText');
    const indicator = document.querySelector('.status-indicator');

    if (synced) {
      indicator.className = 'status-indicator synced';
      badgeText.innerText = text || 'Sincronizado';
    } else {
      indicator.className = 'status-indicator lagging';
      badgeText.innerText = text || 'Ajustando...';
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s ease';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, 3500);
  }

  escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.appUI = new AppUI();
  window.handleAndroidNativeBack = () => {
    if (window.appUI && typeof window.appUI.handleBackAction === 'function') {
      window.appUI.handleBackAction();
    }
  };
});
