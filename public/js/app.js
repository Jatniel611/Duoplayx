/**
 * AppUI - Controlador de Interfaz DuoPlayX
 * Sincronización Automática Sin Restricciones de Autoplay (Estilo Rave)
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

    // DESBLOQUEO DE AUTOPLAY ESTILO RAVE
    this.videoAutoplayOverlay = document.getElementById('videoAutoplayOverlay');
    this.btnUnlockVideoAutoplay = document.getElementById('btnUnlockVideoAutoplay');

    // CONTROL DE VOLUMEN LOCAL DE VIDEO
    this.btnToggleVideoMute = document.getElementById('btnToggleVideoMute');
    this.inputVideoVolume = document.getElementById('inputVideoVolume');
    
    // SELECTOR DE CALIDAD DE VIDEO
    this.selectVideoQuality = document.getElementById('selectVideoQuality');

    this.btnToggleFullscreen = document.getElementById('btnToggleFullscreen');
    this.playerStage = document.getElementById('playerStage');

    // SALA DE VOZ DEDICADA
    this.btnJoinVoiceRoom = document.getElementById('btnJoinVoiceRoom');
    this.btnLeaveVoiceRoom = document.getElementById('btnLeaveVoiceRoom');
    this.voiceMembersGrid = document.getElementById('voiceMembersGrid');
    this.voiceControlsRow = document.getElementById('voiceControlsRow');
    this.btnToggleMic = document.getElementById('btnToggleMic');
    this.voiceMicStateIcon = document.getElementById('voiceMicStateIcon');
    this.voiceMicStateLabel = document.getElementById('voiceMicStateLabel');
    this.btnUnlockAudio = document.getElementById('btnUnlockAudio');

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
    this.usersList = document.getElementById('usersList');
    this.userCount = document.getElementById('userCount');

    this.reactionOverlay = document.getElementById('reactionOverlay');
    this.toastContainer = document.getElementById('toastContainer');

    // MÓVIL & CHAT FLOTANTE (Estilo Rave)
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

    // BARRA COMPACTA DE VOZ MÓVIL
    this.mobileVoiceStrip = document.getElementById('mobileVoiceStrip');
    this.mobileVoiceCount = document.getElementById('mobileVoiceCount');
    this.mobileVoiceAvatars = document.getElementById('mobileVoiceAvatars');
    this.btnMobileJoinVoice = document.getElementById('btnMobileJoinVoice');
    this.btnMobileLeaveVoice = document.getElementById('btnMobileLeaveVoice');
    this.btnMobileToggleMic = document.getElementById('btnMobileToggleMic');
    this.mobileMicIcon = document.getElementById('mobileMicIcon');

    // CONTROL DE INACTIVIDAD & PANTALLA COMPLETA
    this.syncStatusBadge = document.getElementById('syncStatusBadge');
    this.stageFullscreenBtn = document.getElementById('btnToggleFullscreen');
    this.playerStageContainer = document.getElementById('playerStage');
    this.inactivityTimer = null;
    this.messageHighlightTimer = null;
    this.isUserActiveInStage = true;
  }

  bindEvents() {
    window.socketManager.init();

    // Selección de Avatar
    this.avatarOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        this.avatarOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        this.selectedAvatar = opt.dataset.avatar;
      });
    });

    // CAPA DE DESBLOQUEO DE AUTOPLAY ESTILO RAVE
    if (this.videoAutoplayOverlay) {
      this.videoAutoplayOverlay.addEventListener('click', () => {
        this.unlockVideoExperience();
      });
    }

    if (this.btnUnlockVideoAutoplay) {
      this.btnUnlockVideoAutoplay.addEventListener('click', (e) => {
        e.stopPropagation();
        this.unlockVideoExperience();
      });
    }

    // Crear Sala DuoPlayX
    this.btnCreateRoom.addEventListener('click', async () => {
      const username = this.inputUsername.value.trim() || 'Invitado';
      try {
        const roomData = await window.socketManager.createRoom(username, this.selectedAvatar);
        this.enterRoom(roomData);
        this.showToast('¡Bienvenido a DuoPlayX! Eres el Host (👑) y tienes el control exclusivo.', 'success');
      } catch (err) {
        this.showToast(err, 'danger');
      }
    });

    // Unirse a Sala
    this.btnJoinRoom.addEventListener('click', async () => {
      const username = this.inputUsername.value.trim() || 'Invitado';
      const code = this.inputRoomCode.value.trim();
      if (!code) return this.showToast('Introduce un código de sala.', 'warning');

      try {
        const roomData = await window.socketManager.joinRoom(code, username, this.selectedAvatar);
        this.enterRoom(roomData);
        this.showToast(`Unido a la sala ${roomData.roomId}`, 'success');
      } catch (err) {
        this.showToast(err, 'danger');
      }
    });

    // Cambiar Video (Solo Host)
    this.btnChangeMedia.addEventListener('click', async () => {
      if (!window.socketManager.isHost) {
        return this.showToast('⛔ Solo el Host (👑) puede cambiar la película.', 'warning');
      }

      const url = this.inputMediaUrl.value.trim();
      if (!url) return this.showToast('Ingresa una URL válida de YouTube, Google Drive o MP4.', 'warning');

      try {
        await window.socketManager.emitChangeMedia(url);
        this.inputMediaUrl.value = '';
      } catch (err) {
        this.showToast(err, 'danger');
      }
    });

    // SELECTOR DE CALIDAD DE VIDEO
    this.selectVideoQuality.addEventListener('change', (e) => {
      const quality = e.target.value;
      if (window.playerManager.setVideoQuality) {
        window.playerManager.setVideoQuality(quality);
      }
    });

    // CONTROL DE VOLUMEN LOCAL DE VIDEO
    this.inputVideoVolume.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      window.playerManager.setLocalVolume(val);
    });

    this.btnToggleVideoMute.addEventListener('click', () => {
      const isMuted = window.playerManager.toggleLocalMute();
      if (isMuted) {
        this.inputVideoVolume.value = 0;
      } else {
        this.inputVideoVolume.value = 100;
      }
    });

    // PANTALLA COMPLETA
    this.btnToggleFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        if (this.playerStage.requestFullscreen) {
          this.playerStage.requestFullscreen();
        } else if (this.playerStage.webkitRequestFullscreen) {
          this.playerStage.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
    });

    // Controles Personalizados del Host (Estilo Netflix)
    this.btnHostPlayPause.addEventListener('click', () => {
      window.playerManager.hostTogglePlayPause();
    });

    this.btnHostRewind.addEventListener('click', () => {
      window.playerManager.hostSkip(-10);
    });

    this.btnHostForward.addEventListener('click', () => {
      window.playerManager.hostSkip(10);
    });

    this.timeProgressSlider.addEventListener('change', (e) => {
      if (!window.socketManager.isHost) return;
      const targetTime = parseFloat(e.target.value);
      window.playerManager.hostSeekTo(targetTime);
    });

    // Copiar Código de Sala
    this.btnCopyInvite.addEventListener('click', () => {
      if (!this.currentRoom) return;
      navigator.clipboard.writeText(this.currentRoom.roomId);
      this.showToast(`¡Código de sala (${this.currentRoom.roomId}) copiado! 📋`, 'success');
    });

    // CONTROLES DE LA SALA DE VOZ DEDICADA
    this.btnJoinVoiceRoom.addEventListener('click', async () => {
      const ok = await window.webrtcVoiceManager.joinVoiceRoom();
      if (ok) {
        this.showToast('¡Te has unido a la Sala de Voz! 🎙️', 'success');
      }
    });

    this.btnLeaveVoiceRoom.addEventListener('click', () => {
      window.webrtcVoiceManager.leaveVoiceRoom();
      this.showToast('Has salido de la Sala de Voz 🚪', 'info');
    });

    this.btnToggleMic.addEventListener('click', async () => {
      const muted = await window.webrtcVoiceManager.toggleMicMute();
      if (muted) {
        this.voiceMicStateIcon.innerText = '🔇';
        if (this.mobileMicIcon) this.mobileMicIcon.innerText = '🔇';
        this.voiceMicStateLabel.innerText = 'Micrófono OFF';
        this.showToast('Micrófono silenciado 🔇', 'info');
      } else {
        this.voiceMicStateIcon.innerText = '🎙️';
        if (this.mobileMicIcon) this.mobileMicIcon.innerText = '🎙️';
        this.voiceMicStateLabel.innerText = 'Micrófono ON';
        this.showToast('Micrófono activado 🎙️', 'success');
      }
    });

    // BARRA COMPACTA DE VOZ PARA MÓVIL
    if (this.btnMobileJoinVoice) {
      this.btnMobileJoinVoice.addEventListener('click', () => this.btnJoinVoiceRoom.click());
    }
    if (this.btnMobileLeaveVoice) {
      this.btnMobileLeaveVoice.addEventListener('click', () => this.btnLeaveVoiceRoom.click());
    }
    if (this.btnMobileToggleMic) {
      this.btnMobileToggleMic.addEventListener('click', () => this.btnToggleMic.click());
    }

    this.btnUnlockAudio.addEventListener('click', () => {
      window.webrtcVoiceManager.unlockAudio();
      this.showToast('Parlantes activados y audio listo 🔊', 'info');
    });

    // Enviar Chat de texto
    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.inputChatMessage.value.trim();
      if (text) {
        window.socketManager.sendChatMessage(text, null);
        this.inputChatMessage.value = '';
      }
    });

    // CHAT FLOTANTE SOBRE EL VIDEO (Estilo Rave)
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
    this.btnOpenEmojiPicker.addEventListener('click', () => {
      const isVisible = this.emojiPickerPopover.style.display === 'flex';
      this.gifPickerPopover.style.display = 'none';
      if (!isVisible) {
        this.emojiPickerPopover.style.display = 'flex';
        this.renderEmojis(this.emojiCategories.faces);
      } else {
        this.emojiPickerPopover.style.display = 'none';
      }
    });

    this.btnCloseEmojiPicker.addEventListener('click', () => {
      this.emojiPickerPopover.style.display = 'none';
    });

    document.querySelectorAll('.emoji-cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.emoji-cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const cat = chip.dataset.cat;
        if (this.emojiCategories[cat]) {
          this.renderEmojis(this.emojiCategories[cat]);
        }
      });
    });

    // BUSCADOR DE GIFS MULTI-MOTOR
    this.btnOpenGifPicker.addEventListener('click', () => {
      const isVisible = this.gifPickerPopover.style.display === 'flex';
      this.emojiPickerPopover.style.display = 'none';
      if (!isVisible) {
        this.gifPickerPopover.style.display = 'flex';
        this.renderGifs(this.gifCategories.trending);
      } else {
        this.gifPickerPopover.style.display = 'none';
      }
    });

    this.btnCloseGifPicker.addEventListener('click', () => {
      this.gifPickerPopover.style.display = 'none';
    });

    this.btnSendDirectGif.addEventListener('click', () => {
      const url = this.inputDirectGifUrl.value.trim();
      if (url) {
        window.socketManager.sendChatMessage('', url);
        this.inputDirectGifUrl.value = '';
        this.gifPickerPopover.style.display = 'none';
        this.showToast('¡GIF enviado al chat! 🖼️', 'success');
      } else {
        this.showToast('Ingresa una URL válida de GIF.', 'warning');
      }
    });

    // SUGERENCIAS DE GIFS EN TIEMPO REAL
    let searchTimeout = null;
    this.inputGifSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim().toLowerCase();
      this.updateGifSuggestions(query);
      searchTimeout = setTimeout(() => {
        this.fetchGifsMultiEngine(query);
      }, 300);
    });

    // Reacciones Flotantes
    document.querySelectorAll('.btn-reaction').forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        window.socketManager.sendReaction(emoji);
      });
    });

    // Forzar Resync
    this.btnResync.addEventListener('click', () => {
      if (this.currentRoom && window.socketManager.isHost) {
        const time = window.playerManager.getCurrentTime();
        window.socketManager.emitMediaAction('seek', time);
        this.showToast('Sincronización forzada enviada 🔄', 'info');
      } else {
        this.showToast('Sincronizando reproductor 🔄', 'info');
      }
    });

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

    // Control de inactividad sobre el reproductor y Pantalla Completa
    this.setupStageInactivityControls();
  }

  setupStageInactivityControls() {
    const resetActivity = () => {
      this.isUserActiveInStage = true;
      this.showStageFloatingUI(true);

      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = setTimeout(() => {
        const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement);
        if (isFS) {
          this.isUserActiveInStage = false;
          this.showStageFloatingUI(false);
        }
      }, 3500);
    };

    // Registrar eventos usando la fase de captura (capture: true) en window y document
    const events = ['mousemove', 'mousedown', 'click', 'touchstart', 'touchmove', 'pointermove', 'keydown'];
    events.forEach(evt => {
      window.addEventListener(evt, resetActivity, { capture: true, passive: true });
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

  handleFullscreenChange() {
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement);
    if (isFS) {
      this.showToast('📺 Modo Pantalla Completa activado', 'info');
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = setTimeout(() => {
        this.showStageFloatingUI(false);
      }, 3500);
    } else {
      clearTimeout(this.inactivityTimer);
      this.showStageFloatingUI(true);
    }
  }

  showStageFloatingUI(visible) {
    const stageElements = [
      this.stageFullscreenBtn,
      this.btnFloatingChatBubble,
      this.syncStatusBadge
    ];

    // En pantalla completa, incluir también las barras de controles inferiores
    const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement);
    if (isFS) {
      const controlsBar = document.getElementById('timelineControlsBar');
      const bottomBar = document.querySelector('.player-bottom-bar');
      if (controlsBar) stageElements.push(controlsBar);
      if (bottomBar) stageElements.push(bottomBar);
    }

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

  setActiveMobileTab(mode) {
    if (window.innerWidth > 768) return;

    this.btnNavPlayer.classList.remove('active');
    this.btnNavChat.classList.remove('active');
    this.btnNavUsers.classList.remove('active');

    if (mode === 'player') {
      this.sectionPlayer.style.display = 'flex';
      this.sectionSidebar.style.display = 'none';
      this.btnNavPlayer.classList.add('active');
    } else if (mode === 'chat') {
      this.sectionPlayer.style.display = 'none';
      this.sectionSidebar.style.display = 'flex';
      this.btnNavChat.classList.add('active');

      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector('[data-tab="tabChat"]').classList.add('active');
      document.getElementById('tabChat').classList.add('active');
    } else if (mode === 'users') {
      this.sectionPlayer.style.display = 'none';
      this.sectionSidebar.style.display = 'flex';
      this.btnNavUsers.classList.add('active');

      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector('[data-tab="tabUsers"]').classList.add('active');
      document.getElementById('tabUsers').classList.add('active');
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
    this.currentRoom = roomData;
    this.modalLobby.style.display = 'none';

    if (window.innerWidth <= 768) {
      this.mainRoom.style.display = 'flex';
      this.mobileNavBar.style.display = 'flex';
      this.setActiveMobileTab('player');
    } else {
      this.mainRoom.style.display = 'grid';
    }

    this.headerRoomInfo.style.display = 'flex';

    this.displayRoomCode.innerText = roomData.roomId;
    this.headerUserAvatar.innerText = roomData.user.avatar;
    this.headerUserName.innerText = roomData.user.username;

    const serverOrigin = window.location.origin;
    document.getElementById('codeShortcode').innerText = `[duoplayx_watch_party room="${roomData.roomId}" server="${serverOrigin}"]`;
    document.getElementById('codeIframe').innerText = `<iframe src="${serverOrigin}?room=${roomData.roomId}" width="100%" height="650" allow="autoplay; fullscreen; microphone; camera"></iframe>`;

    if (roomData.media) {
      window.playerManager.setMediaSource(roomData.media).then(() => {
        const initialTime = roomData.mediaState.calculatedTime || roomData.mediaState.currentTime || 0;
        window.playerManager.syncRemoteAction('sync', initialTime, roomData.mediaState.isPlaying);
      });
    }

    this.chatMessages.innerHTML = '<div class="chat-welcome-notice"><span>✨ ¡Bienvenidos a DuoPlayX! Chatea, busca GIFs, envía Emojis y entra a la Sala de Voz en Vivo.</span></div>';
    if (this.floatingChatMessages) this.floatingChatMessages.innerHTML = '';
    if (roomData.chatHistory) {
      roomData.chatHistory.forEach(msg => this.appendChatMessage(msg));
    }

    this.updateUsersList(roomData.users);
    this.updateVoiceRoomState(roomData.voiceMembers || [], roomData.users);
    this.updateHostControlsView(roomData.user.isHost);
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
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.type === 'system' ? 'system' : ''}`;

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

      bubble.innerHTML = `
        <div class="chat-user">
          <span>${msg.user.avatar || '⚡'}</span>
          <span>${this.escapeHTML(msg.user.username)}</span>
          ${msg.user.isHost ? '<span class="host-tag">HOST 👑</span>' : ''}
        </div>
        ${content}
      `;
    }

    this.chatMessages.appendChild(bubble);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // Agregar también al chat flotante sobre el video
    if (this.floatingChatMessages) {
      const floatBubble = bubble.cloneNode(true);
      this.floatingChatMessages.appendChild(floatBubble);
      this.floatingChatMessages.scrollTop = this.floatingChatMessages.scrollHeight;
    }

    // Contador de no leídos en la burbuja si el chat flotante está cerrado
    if (msg.type !== 'system' && this.floatingChatOverlay && (this.floatingChatOverlay.style.display === 'none' || !this.floatingChatOverlay.style.display)) {
      this.unreadChatCount++;
      if (this.chatUnreadBadge) {
        this.chatUnreadBadge.innerText = this.unreadChatCount;
        this.chatUnreadBadge.style.display = 'block';
      }
      this.highlightFloatingBubbleOnNewMessage();
    }
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

    const isSelfInVoice = window.webrtcVoiceManager.inVoiceRoom;

    if (isSelfInVoice) {
      this.btnJoinVoiceRoom.style.display = 'none';
      this.btnLeaveVoiceRoom.style.display = 'inline-flex';
      this.voiceControlsRow.style.display = 'flex';

      if (this.btnMobileJoinVoice) this.btnMobileJoinVoice.style.display = 'none';
      if (this.btnMobileLeaveVoice) this.btnMobileLeaveVoice.style.display = 'inline-flex';
      if (this.btnMobileToggleMic) this.btnMobileToggleMic.style.display = 'inline-flex';
    } else {
      this.btnJoinVoiceRoom.style.display = 'inline-flex';
      this.btnLeaveVoiceRoom.style.display = 'none';
      this.voiceControlsRow.style.display = 'none';

      if (this.btnMobileJoinVoice) this.btnMobileJoinVoice.style.display = 'inline-flex';
      if (this.btnMobileLeaveVoice) this.btnMobileLeaveVoice.style.display = 'none';
      if (this.btnMobileToggleMic) this.btnMobileToggleMic.style.display = 'none';
    }

    if (this.mobileVoiceCount) {
      this.mobileVoiceCount.innerText = this.currentVoiceMembers.length;
    }

    if (this.mobileVoiceAvatars) {
      this.mobileVoiceAvatars.innerHTML = '';
      this.currentVoiceMembers.forEach(m => {
        const span = document.createElement('span');
        span.title = m.username;
        span.style.fontSize = '1.1rem';
        span.innerText = m.avatar || '⚡';
        this.mobileVoiceAvatars.appendChild(span);
      });
    }

    this.voiceMembersGrid.innerHTML = '';
    if (this.currentVoiceMembers.length === 0) {
      this.voiceMembersGrid.innerHTML = '<div class="voice-empty-state">No hay nadie en la Sala de Voz. ¡Haz clic en Unirme para hablar o escuchar!</div>';
      return;
    }

    this.currentVoiceMembers.forEach(m => {
      const card = document.createElement('div');
      card.id = `voice_card_${m.socketId}`;
      card.className = `voice-member-card ${m.isSpeaking ? 'speaking-active' : ''}`;
      card.innerHTML = `
        <div class="voice-avatar-box">
          <span>${m.avatar || '⚡'}</span>
          ${m.isMuted ? '<span class="mute-badge">🎧</span>' : '<span class="live-mic-badge">🎙️</span>'}
        </div>
        <span class="voice-member-name ${m.isSpeaking ? 'speaking-text' : ''}">${this.escapeHTML(m.username)}</span>
      `;
      this.voiceMembersGrid.appendChild(card);
    });
  }

  setUserSpeakingIndicator(socketId, isSpeaking) {
    const item = document.getElementById(`user_item_${socketId}`);
    const card = document.getElementById(`voice_card_${socketId}`);

    if (item) {
      if (isSpeaking) item.classList.add('speaking-active');
      else item.classList.remove('speaking-active');
    }

    if (card) {
      const nameEl = card.querySelector('.voice-member-name');
      if (isSpeaking) {
        card.classList.add('speaking-active');
        if (nameEl) nameEl.classList.add('speaking-text');
      } else {
        card.classList.remove('speaking-active');
        if (nameEl) nameEl.classList.remove('speaking-text');
      }
    }
  }

  updateHostControlsView(isHost) {
    if (isHost) {
      this.hostMediaBar.style.display = 'flex';
      this.hostBtnsGroup.style.display = 'flex';
      this.guestHostNotice.style.display = 'none';
      this.guestPlayerLockOverlay.classList.remove('active');
      this.timeProgressSlider.disabled = false;
      this.timeProgressSlider.style.pointerEvents = 'auto';
    } else {
      this.hostMediaBar.style.display = 'none';
      this.hostBtnsGroup.style.display = 'none';
      this.guestHostNotice.style.display = 'block';
      this.guestPlayerLockOverlay.classList.add('active');
      this.timeProgressSlider.disabled = true;
      this.timeProgressSlider.style.pointerEvents = 'none';
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

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
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
});
