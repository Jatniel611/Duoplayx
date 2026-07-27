/**
 * PlayerManager - DuoPlayX
 * Motor híbrido: YouTube IFrame API + HTML5 video nativo
 *
 * Google Drive (MP4):
 *   → /api/gdrive-stream/:fileId  (proxy con Range headers)
 *   → El navegador hace play/pause/seek nativo con <video>
 *   → Socket.io sincroniza posición con invitados
 *   → Sin ffmpeg, sin conversión, cero procesamiento extra
 */

class PlayerManager {
  constructor() {
    this.currentType  = null;   // 'youtube' | 'mp4' | 'gdrive'
    this.currentMedia = null;

    this.ytPlayer  = null;
    this.isYTReady = false;

    this.mp4Video    = document.getElementById('html5VideoPlayer');
    this.gdriveVideo = document.getElementById('gdriveVideoPlayer');
    this.loadingOverlay = document.getElementById('videoLoadingOverlay');
    this.loadingText    = document.getElementById('videoLoadingText');

    this.isProgrammaticAction = false;
    this.localVolume  = 100;
    this.isMuted      = false;
    this.selectedQuality = 'auto';

    this.onLocalActionCallback = null;

    this._bindHTML5Events(this.mp4Video);
    this._bindHTML5Events(this.gdriveVideo);
    this._startProgressTracker();
  }

  // ─── Control del Spinner de Carga ─────────────────────────────────────────
  showLoadingOverlay(show, text = 'Cargando película...') {
    if (!this.loadingOverlay) return;
    if (text && this.loadingText) this.loadingText.textContent = text;
    this.loadingOverlay.style.display = show ? 'flex' : 'none';
  }

  // ─── Bind eventos HTML5 ──────────────────────────────────────────────────
  _bindHTML5Events(videoEl) {
    if (!videoEl) return;

    videoEl.addEventListener('loadstart', () => this.showLoadingOverlay(true, 'Cargando película...'));
    videoEl.addEventListener('waiting',   () => this.showLoadingOverlay(true, 'Almacenando en búfer...'));
    videoEl.addEventListener('seeking',   () => this.showLoadingOverlay(true, 'Sincronizando tiempo...'));
    videoEl.addEventListener('canplay',   () => this.showLoadingOverlay(false));
    videoEl.addEventListener('playing',   () => this.showLoadingOverlay(false));
    videoEl.addEventListener('seeked',    () => this.showLoadingOverlay(false));

    videoEl.addEventListener('play', () => {
      this.showLoadingOverlay(false);
      if (this.isProgrammaticAction || !window.socketManager?.isHost) return;
      if (this.onLocalActionCallback) this.onLocalActionCallback('play', videoEl.currentTime);
    });

    videoEl.addEventListener('pause', () => {
      if (this.isProgrammaticAction || !window.socketManager?.isHost) return;
      if (this.onLocalActionCallback) this.onLocalActionCallback('pause', videoEl.currentTime);
    });

    videoEl.addEventListener('error', () => {
      this.showLoadingOverlay(false);
      const err = videoEl.error;
      console.error('[Video Error]', err ? `code=${err.code}` : 'desconocido');
      if (window.appUI) window.appUI.showToast('⚠️ Error cargando el video. Comprueba que el archivo es MP4 y está compartido públicamente.', 'danger');
    });

    videoEl.addEventListener('canplay', () => {
      console.log(`[Video] ✅ Listo — duracion=${Math.round(videoEl.duration)}s`);
    });
  }

  // ─── Video activo ─────────────────────────────────────────────────────────
  _activeVideo() {
    if (this.currentType === 'gdrive') return this.gdriveVideo;
    if (this.currentType === 'mp4')    return this.mp4Video;
    return null;
  }

  // ─── Mostrar/ocultar contenedores ─────────────────────────────────────────
  _showContainer(which) {
    ['youtubePlayerContainer', 'mp4PlayerContainer', 'gdrivePlayerContainer', 'emptyMediaOverlay']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    const map = {
      youtube: 'youtubePlayerContainer',
      mp4    : 'mp4PlayerContainer',
      gdrive : 'gdrivePlayerContainer',
      empty  : 'emptyMediaOverlay'
    };
    const t = document.getElementById(map[which]);
    if (t) t.style.display = 'block';
  }

  // ─── YouTube IFrame Player ────────────────────────────────────────────────
  _initYouTubePlayer(videoId) {
    return new Promise((resolve) => {
      if (this.ytPlayer) {
        this.ytPlayer.loadVideoById({
          videoId,
          suggestedQuality: this._ytQuality(this.selectedQuality)
        });
        return resolve(this.ytPlayer);
      }
      const doCreate = () => {
        this.ytPlayer = new YT.Player('ytPlayer', {
          height: '100%', width: '100%', videoId,
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, fs: 0 },
          events: {
            onReady: () => {
              this.isYTReady = true;
              this.setLocalVolume(this.localVolume);
              this.showLoadingOverlay(false);
              resolve(this.ytPlayer);
            },
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.BUFFERING) {
                this.showLoadingOverlay(true, 'Cargando YouTube...');
              } else if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED) {
                this.showLoadingOverlay(false);
              }

              if (this.isProgrammaticAction || !window.socketManager?.isHost || !this.onLocalActionCallback) return;
              const t = this.ytPlayer.getCurrentTime();
              if (e.data === YT.PlayerState.PLAYING) this.onLocalActionCallback('play', t);
              else if (e.data === YT.PlayerState.PAUSED) this.onLocalActionCallback('pause', t);
            }
          }
        });
      };
      if (typeof YT !== 'undefined' && YT.Player) doCreate();
      else window.onYouTubeIframeAPIReady = doCreate;
    });
  }

  _ytQuality(q) {
    return { '1080': 'hd1080', '720': 'hd720', '480': 'large', '360': 'medium', 'auto': 'default' }[q] || 'default';
  }

  // ─── Cargar fuente de media ───────────────────────────────────────────────
  async setMediaSource(media) {
    this.currentMedia = media;

    // Detener reproductores previos
    if (this.mp4Video)    { this.mp4Video.pause();    this.mp4Video.src = ''; }
    if (this.gdriveVideo) { this.gdriveVideo.pause(); this.gdriveVideo.src = ''; }
    if (this.ytPlayer && this.isYTReady && typeof this.ytPlayer.pauseVideo === 'function') {
      this.ytPlayer.pauseVideo();
    }

    if (media.type === 'youtube') {
      this.currentType = 'youtube';
      this._showContainer('youtube');
      await this._initYouTubePlayer(media.videoId);

    } else if (media.isGDrive) {
      // Google Drive MP4: proxy sin conversión, seeking nativo via Range headers
      this.currentType = 'gdrive';
      this._showContainer('gdrive');

      const proxyUrl = `/api/gdrive-stream/${media.fileId}`;
      console.log(`[GDrive] Cargando MP4 via proxy: ${proxyUrl}`);

      if (window.appUI) window.appUI.showToast('🔄 Cargando MP4 de Google Drive...', 'info');

      // Pre-verificación rápida para detectar cuota excedida (429) de Google Drive
      try {
        const checkRes = await fetch(proxyUrl, { method: 'HEAD' });
        if (checkRes.status === 429) {
          console.warn('[GDrive] 🛑 Cuota excedida detectada');
          if (window.appUI) {
            window.appUI.showToast('🛑 Google Drive: Se superó la cuota diaria de descarga de este archivo. Google ha bloqueado este enlace temporalmente. Solución: Copia el archivo a tu propio Google Drive o sube otro archivo.', 'danger');
          }
          return;
        }
      } catch (err) {
        console.warn('[GDrive Check Error]:', err.message);
      }

      this.gdriveVideo.src = proxyUrl;
      this.gdriveVideo.load();

      this.gdriveVideo.addEventListener('canplay', () => {
        if (window.appUI) window.appUI.showToast('✅ MP4 de Drive listo para reproducir 🎬', 'success');
      }, { once: true });

      this.gdriveVideo.play().catch(err => {
        console.log('[GDrive] Autoplay bloqueado (esperando clic del usuario):', err.message);
      });

    } else {
      // MP4 / URL directa
      this.currentType = 'mp4';
      this._showContainer('mp4');
      this.mp4Video.src = media.url;
      this.mp4Video.load();
      this.mp4Video.play().catch(e => console.log('[MP4] Autoplay bloqueado:', e.message));
    }

    this.setLocalVolume(this.localVolume);
  }

  // ─── Sincronizar acción remota del Host (para invitados) ─────────────────
  syncRemoteAction(action, targetTime, isPlaying) {
    this.isProgrammaticAction = true;
    try {
      if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
        if (typeof targetTime === 'number' && Math.abs(this.ytPlayer.getCurrentTime() - targetTime) > 0.8) {
          this.ytPlayer.seekTo(targetTime, true);
        }
        if (action === 'play'  || isPlaying === true)  this.ytPlayer.playVideo();
        if (action === 'pause' || isPlaying === false) this.ytPlayer.pauseVideo();

      } else {
        const vid = this._activeVideo();
        if (!vid) return;

        if (typeof targetTime === 'number' && Math.abs(vid.currentTime - targetTime) > 0.8) {
          vid.currentTime = targetTime;
        }
        if (action === 'play'  || isPlaying === true)  vid.play().catch(() => {});
        if (action === 'pause' || isPlaying === false) vid.pause();
      }
    } finally {
      setTimeout(() => { this.isProgrammaticAction = false; }, 600);
    }
  }

  // ─── Desbloqueo de autoplay ────────────────────────────────────────────────
  unlockVideoAutoplay() {
    if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
      this.ytPlayer.playVideo();
    } else {
      const vid = this._activeVideo();
      if (vid) vid.play().catch(e => console.log('[Unlock]', e));
    }
  }

  // ─── Cambio de calidad (YouTube) ──────────────────────────────────────────
  setVideoQuality(qualityVal) {
    this.selectedQuality = qualityVal;

    if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
      const curTime = this.getCurrentTime();
      this.ytPlayer.loadVideoById({
        videoId: this.currentMedia.videoId,
        startSeconds: curTime,
        suggestedQuality: this._ytQuality(qualityVal)
      });
      if (window.appUI) window.appUI.showToast(`✨ YouTube: ${qualityVal === 'auto' ? 'Calidad Auto' : qualityVal + 'p'}`, 'success');

    } else if (this.currentType === 'gdrive') {
      if (window.appUI) window.appUI.showToast('ℹ️ Drive MP4: calidad según el archivo original subido.', 'info');
    }
  }

  // ─── Controles del Host ───────────────────────────────────────────────────
  hostTogglePlayPause() {
    if (!window.socketManager?.isHost) return;

    if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
      const state = this.ytPlayer.getPlayerState();
      if (state === YT.PlayerState.PLAYING) {
        this.ytPlayer.pauseVideo();
        if (this.onLocalActionCallback) this.onLocalActionCallback('pause', this.ytPlayer.getCurrentTime());
      } else {
        this.ytPlayer.playVideo();
        if (this.onLocalActionCallback) this.onLocalActionCallback('play', this.ytPlayer.getCurrentTime());
      }
    } else {
      const vid = this._activeVideo();
      if (!vid) return;
      if (!vid.paused) {
        vid.pause();
        if (this.onLocalActionCallback) this.onLocalActionCallback('pause', vid.currentTime);
      } else {
        vid.play().catch(() => {});
        if (this.onLocalActionCallback) this.onLocalActionCallback('play', vid.currentTime);
      }
    }
  }

  hostSeekTo(seconds) {
    if (!window.socketManager?.isHost) return;

    if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
      this.ytPlayer.seekTo(seconds, true);
    } else {
      const vid = this._activeVideo();
      if (vid) vid.currentTime = seconds;
    }
    if (this.onLocalActionCallback) this.onLocalActionCallback('seek', seconds);
  }

  hostSkip(offset) {
    if (!window.socketManager?.isHost) return;
    this.hostSeekTo(Math.max(0, this.getCurrentTime() + offset));
  }

  // ─── Volumen ──────────────────────────────────────────────────────────────
  setLocalVolume(vol) {
    this.localVolume = Math.max(0, Math.min(100, vol));
    this.isMuted = this.localVolume === 0;

    if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
      if (typeof this.ytPlayer.setVolume === 'function') {
        this.ytPlayer.setVolume(this.localVolume);
        this.isMuted ? this.ytPlayer.mute() : this.ytPlayer.unMute();
      }
    }
    if (this.mp4Video)    { this.mp4Video.volume    = this.localVolume / 100; this.mp4Video.muted    = this.isMuted; }
    if (this.gdriveVideo) { this.gdriveVideo.volume = this.localVolume / 100; this.gdriveVideo.muted = this.isMuted; }
  }

  toggleLocalMute() {
    if (this.isMuted) { this.setLocalVolume(100); return false; }
    else              { this.setLocalVolume(0);   return true;  }
  }

  // ─── Tiempo / Duración ────────────────────────────────────────────────────
  getCurrentTime() {
    if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
      try { return this.ytPlayer.getCurrentTime() || 0; } catch(e) { return 0; }
    }
    const vid = this._activeVideo();
    return vid ? (vid.currentTime || 0) : 0;
  }

  getDuration() {
    if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
      try { return this.ytPlayer.getDuration() || 0; } catch(e) { return 0; }
    }
    const vid = this._activeVideo();
    return vid ? (isNaN(vid.duration) ? 0 : (vid.duration || 0)) : 0;
  }

  // ─── Tracker de progreso 500ms ─────────────────────────────────────────────
  _startProgressTracker() {
    setInterval(() => {
      if (!window.appUI) return;
      window.appUI.updateSliderProgress(this.getCurrentTime(), this.getDuration());

      let isPlaying = false;
      if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
        try { isPlaying = this.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING; } catch(e) {}
      } else {
        const vid = this._activeVideo();
        if (vid) isPlaying = !vid.paused && !vid.ended && vid.readyState >= 2;
      }
      window.appUI.togglePlayPauseSVG(isPlaying);
    }, 500);
  }
}

window.playerManager = new PlayerManager();
