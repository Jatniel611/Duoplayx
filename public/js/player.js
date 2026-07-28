/**
 * PlayerManager - DuoPlayX
 * Motor híbrido ultranfluido: YouTube IFrame API + HTML5 Video Nativo / HLS.js / GDrive
 *
 * Sincronización Ultra-Estable (Estilo Rave / Teleparty):
 *   → Cero bucles recursivos de pause/seek/waiting.
 *   → Tolerancia de desvío suave de hasta 3.0s (sin flushes innecesarios de decodificador).
 *   → Cero carteles de búfer al azar en micro-pausas de red.
 */

class PlayerManager {
  constructor() {
    this.currentType  = null;   // 'youtube' | 'mp4' | 'gdrive' | 'hls'
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

    let bufferTimer = null;

    videoEl.addEventListener('loadstart', () => this.showLoadingOverlay(true, 'Cargando película...'));

    // Solo mostrar aviso de búfer si la carga se detiene por más de 2.0 segundos reales
    videoEl.addEventListener('waiting', () => {
      clearTimeout(bufferTimer);
      bufferTimer = setTimeout(() => {
        if (!videoEl.paused && videoEl.readyState < 3) {
          this.showLoadingOverlay(true, 'Almacenando en búfer...');
        }
      }, 2000);
    });

    videoEl.addEventListener('seeking', () => {
      clearTimeout(bufferTimer);
      if (!this.isProgrammaticAction) {
        this.showLoadingOverlay(true, 'Sincronizando tiempo...');
      }
    });

    const hideOverlay = () => {
      clearTimeout(bufferTimer);
      this.showLoadingOverlay(false);
    };

    videoEl.addEventListener('canplay', hideOverlay);
    videoEl.addEventListener('playing', hideOverlay);
    videoEl.addEventListener('seeked', hideOverlay);

    videoEl.addEventListener('play', () => {
      hideOverlay();
      if (this.isProgrammaticAction || !window.socketManager?.isHost) return;
      if (this.onLocalActionCallback) this.onLocalActionCallback('play', videoEl.currentTime);
    });

    videoEl.addEventListener('pause', () => {
      hideOverlay();
      if (this.isProgrammaticAction || !window.socketManager?.isHost) return;
      if (this.onLocalActionCallback) this.onLocalActionCallback('pause', videoEl.currentTime);
    });

    videoEl.addEventListener('error', () => {
      hideOverlay();
      const err = videoEl.error;
      console.error('[Video Error]', err ? `code=${err.code}` : 'desconocido');
      if (window.appUI) window.appUI.showToast('⚠️ Error cargando el video. Comprueba que el enlace está activo.', 'danger');
    });

    videoEl.addEventListener('canplay', () => {
      console.log(`[Video] ✅ Listo — duracion=${Math.round(videoEl.duration)}s`);
    });
  }

  // ─── Video activo ─────────────────────────────────────────────────────────
  _activeVideo() {
    if (this.currentType === 'gdrive') return this.gdriveVideo;
    if (this.currentType === 'mp4' || this.currentType === 'hls') return this.mp4Video;
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
      let isResolved = false;
      const safeResolve = () => {
        if (!isResolved) {
          isResolved = true;
          resolve(this.ytPlayer);
        }
      };

      const timer = setTimeout(() => {
        console.warn('⚠️ YouTube Iframe API tardó demasiado. Continuando...');
        safeResolve();
      }, 4000);

      if (this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {
        try {
          this.ytPlayer.loadVideoById({
            videoId,
            suggestedQuality: this._ytQuality(this.selectedQuality)
          });
        } catch (e) {
          console.warn('Error al cargar video de YouTube:', e);
        }
        clearTimeout(timer);
        return safeResolve();
      }

      const doCreate = () => {
        try {
          this.ytPlayer = new YT.Player('ytPlayer', {
            height: '100%', width: '100%', videoId,
            playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, fs: 0 },
            events: {
              onReady: () => {
                this.isYTReady = true;
                this.setLocalVolume(this.localVolume);
                this.showLoadingOverlay(false);
                clearTimeout(timer);
                safeResolve();
              },
              onStateChange: (e) => {
                if (e.data === YT.PlayerState.BUFFERING) {
                  this.showLoadingOverlay(true, 'Cargando YouTube...');
                } else if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED) {
                  this.showLoadingOverlay(false);
                }

                if (this.isProgrammaticAction || !window.socketManager?.isHost || !this.onLocalActionCallback) return;
                const t = (this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') ? this.ytPlayer.getCurrentTime() : 0;
                if (e.data === YT.PlayerState.PLAYING) this.onLocalActionCallback('play', t);
                else if (e.data === YT.PlayerState.PAUSED) this.onLocalActionCallback('pause', t);
              },
              onError: (err) => {
                console.warn('YouTube Error:', err);
                clearTimeout(timer);
                safeResolve();
              }
            }
          });
        } catch (err) {
          console.error('Error al instanciar YT.Player:', err);
          clearTimeout(timer);
          safeResolve();
        }
      };

      if (typeof YT !== 'undefined' && YT.Player) {
        doCreate();
      } else {
        const prevHandler = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (prevHandler) prevHandler();
          doCreate();
        };
      }
    });
  }

  _ytQuality(q) {
    return { '1080': 'hd1080', '720': 'hd720', '480': 'large', '360': 'medium', 'auto': 'default' }[q] || 'default';
  }

  // ─── Cargar fuente de media ───────────────────────────────────────────────
  async setMediaSource(media, autoPlay = true) {
    if (!media) return;
    console.log('🎬 Configurando nueva fuente multimedia:', media, 'autoPlay:', autoPlay);
    this.currentMedia = media;
    this.showLoadingOverlay(true);

    // Detener reproductores previos y destruir HLS anterior
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
    if (this.mp4Video)    { this.mp4Video.pause();    this.mp4Video.src = ''; }
    if (this.gdriveVideo) { this.gdriveVideo.pause(); this.gdriveVideo.src = ''; }
    if (this.ytPlayer && this.isYTReady && typeof this.ytPlayer.pauseVideo === 'function') {
      this.ytPlayer.pauseVideo();
    }

    if (media.type === 'hls' || (media.url && media.url.includes('.m3u8'))) {
      this.currentType = 'hls';
      this._showContainer('mp4');
      this._playHLSStream(media.url, media.referer, autoPlay);

    } else if (media.type === 'youtube') {
      this.currentType = 'youtube';
      this._showContainer('youtube');
      await this._initYouTubePlayer(media.videoId);
      if (!autoPlay && this.ytPlayer && this.isYTReady) {
        this.ytPlayer.pauseVideo();
      }

    } else if (media.isGDrive || media.type === 'gdrive') {
      this.currentType = 'gdrive';
      this._showContainer('gdrive');

      const proxyUrl = media.url || `/api/gdrive-stream/${media.fileId}`;
      console.log(`[GDrive] Cargando MP4 via proxy: ${proxyUrl}`);

      if (window.appUI) window.appUI.showToast('🔄 Cargando MP4 de Google Drive...', 'info');

      try {
        const checkRes = await fetch(proxyUrl, { method: 'HEAD' });
        if (checkRes.status === 429) {
          console.warn('[GDrive] 🛑 Cuota excedida detectada');
          if (window.appUI) {
            window.appUI.showToast('🛑 Google Drive: Se superó la cuota diaria de descarga de este archivo. Copia el archivo a tu propio Google Drive o sube otro enlace.', 'danger');
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

      if (autoPlay) {
        this.gdriveVideo.play().catch(err => console.log('[GDrive] Autoplay bloqueado:', err.message));
      } else {
        this.gdriveVideo.pause();
      }

    } else {
      // MP4 / Pixeldrain / Enlace directo
      this.currentType = 'mp4';
      this._showContainer('mp4');
      this.mp4Video.removeAttribute('crossorigin');
      this.mp4Video.setAttribute('referrerpolicy', 'no-referrer');
      this.mp4Video.src = media.url;
      this.mp4Video.load();
      if (autoPlay) {
        this.mp4Video.play().catch(e => console.log('[MP4] Autoplay bloqueado:', e.message));
      } else {
        this.mp4Video.pause();
      }
    }

    this.setLocalVolume(this.localVolume);
  }

  _playHLSStream(hlsUrl, referer, autoPlay = true) {
    const proxyUrl = `/api/hls-proxy?url=${encodeURIComponent(hlsUrl)}${referer ? '&referer=' + encodeURIComponent(referer) : ''}`;
    console.log(`[HLS Player] Cargando stream via proxy: ${proxyUrl}`);

    if (window.appUI) window.appUI.showToast('🎬 Cargando película HLS / Stream en vivo...', 'info');

    if (window.Hls && Hls.isSupported()) {
      if (this.hlsInstance) {
        this.hlsInstance.destroy();
      }
      this.hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 30 * 1024 * 1024,
        backBufferLength: 15,
        liveSyncDurationCount: 3,
        nudgeMaxRetries: 10,
        maxBufferHole: 0.5,
        capLevelToPlayerSize: false,
        startLevel: -1,
        abrEwmaDefaultEstimate: 5000000
      });
      this.hlsInstance.loadSource(proxyUrl);
      this.hlsInstance.attachMedia(this.mp4Video);

      this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log('✅ Manifiesto HLS cargado con éxito. Niveles de calidad:', data.levels);
        
        if (this.hlsInstance.levels && this.hlsInstance.levels.length > 0) {
          const maxLevel = this.hlsInstance.levels.length - 1;
          this.hlsInstance.currentLevel = maxLevel;
          const selectedQual = data.levels[maxLevel];
          if (window.appUI && selectedQual) {
            const qualText = selectedQual.height ? `${selectedQual.height}p` : (selectedQual.bitrate ? `${Math.round(selectedQual.bitrate / 1000)}k` : 'Máxima HD');
            window.appUI.showToast(`🎬 Calidad Inicial: ${qualText} ⭐ (ABR adaptativo activo)`, 'success');
          }
        }

        if (autoPlay) {
          this.mp4Video.play().catch(err => console.log('[HLS Autoplay bloqueado]:', err.message));
        } else {
          this.mp4Video.pause();
        }
      });

      this.hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[HLS Network Error] Intentando recuperar red...');
              this.hlsInstance.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[HLS Media Error] Intentando recuperar media...');
              this.hlsInstance.recoverMediaError();
              break;
            default:
              console.error('[HLS Fatal Error]', data);
              this.hlsInstance.destroy();
              break;
          }
        }
      });
    } else if (this.mp4Video.canPlayType('application/vnd.apple.mpegurl')) {
      this.mp4Video.src = proxyUrl;
      if (autoPlay) {
        this.mp4Video.play().catch(err => console.log('[HLS Native Autoplay bloqueado]:', err.message));
      } else {
        this.mp4Video.pause();
      }
    }
  }

  // ─── Sincronizar acción remota del Host (para invitados) ─────────────────
  syncRemoteAction(action, targetTime, isPlaying) {
    this.isProgrammaticAction = true;
    try {
      if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
        const ytCurTime = this.ytPlayer.getCurrentTime ? (this.ytPlayer.getCurrentTime() || 0) : 0;
        if (action === 'seek' || (typeof targetTime === 'number' && Math.abs(ytCurTime - targetTime) > 3.0)) {
          this.ytPlayer.seekTo(targetTime, true);
        }
        if (action === 'play'  || isPlaying === true)  this.ytPlayer.playVideo();
        if (action === 'pause' || isPlaying === false) this.ytPlayer.pauseVideo();

      } else {
        const vid = this._activeVideo();
        if (!vid) return;

        if (action === 'pause' || isPlaying === false) {
          vid.pause();
          if (typeof targetTime === 'number' && Math.abs(vid.currentTime - targetTime) > 2.5) {
            vid.currentTime = targetTime;
          }
          return;
        }

        if (typeof targetTime === 'number') {
          const diff = Math.abs(targetTime - vid.currentTime);
          // Buscar/Ajustar tiempo SOLO si fue un Seek explícito o si la diferencia supera los 3.0s
          if (action === 'seek' || diff > 3.0) {
            console.log(`[Sync Seek] Ajustando tiempo por diferencia de ${diff.toFixed(2)}s`);
            vid.currentTime = targetTime;
          }
        }

        if (vid.playbackRate !== 1.0) vid.playbackRate = 1.0;

        if (action === 'play' || isPlaying === true) {
          if (vid.paused) vid.play().catch(() => {});
        }
      }
    } finally {
      setTimeout(() => { this.isProgrammaticAction = false; }, 600);
    }
  }

  // ─── Desbloqueo de autoplay ────────────────────────────────────────────────
  unlockVideoAutoplay() {
    if (window.socketManager?.isHost) {
      if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
        this.ytPlayer.playVideo();
      } else {
        const vid = this._activeVideo();
        if (vid) vid.play().catch(e => console.log('[Unlock]', e));
      }
    } else {
      if (window.socketManager) {
        window.socketManager.requestHostSync();
      }
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
      const curTime = this.getCurrentTime();
      const dur = this.getDuration();
      window.appUI.updateSliderProgress(curTime, dur);

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
