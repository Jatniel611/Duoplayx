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
    this.iframeVideo  = document.getElementById('iframeVideoPlayer');
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
    ['youtubePlayerContainer', 'mp4PlayerContainer', 'gdrivePlayerContainer', 'iframePlayerContainer', 'emptyMediaOverlay']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    const map = {
      youtube: 'youtubePlayerContainer',
      mp4    : 'mp4PlayerContainer',
      gdrive : 'gdrivePlayerContainer',
      iframe : 'iframePlayerContainer',
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
    if (this.iframeVideo) { this.iframeVideo.src = ''; }
    if (this.ytPlayer && this.isYTReady && typeof this.ytPlayer.pauseVideo === 'function') {
      this.ytPlayer.pauseVideo();
    }

    if (media.type === 'hls' || (media.url && media.url.includes('.m3u8'))) {
      this.currentType = 'hls';
      this._showContainer('mp4');
      this._playHLSStream(media.url, media.referer, autoPlay);

    } else if (media.type === 'vimeo') {
      // Vimeus/Vimeos: extraer el HLS EN ESTE navegador (el token del CDN se
      // firma con el User-Agent de quien pide el embed; así reproduce directo
      // CDN → navegador: 0% banda del server, video limpio y sincronizable).
      this.currentType = 'vimeo';
      this._showContainer('mp4');
      this._playVimeoEmbed(media.embedUrl || media.url || media.referer, autoPlay);

    } else if (media.type === 'iframe') {
      // Último recurso: reproducir embed original en iframe (sin sync).
      this._playIframe(media.url || media.referer);

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

      // Intentar transmisión directa desde Google Drive (0% ancho de banda del servidor)
      const directUrl = (media.url && !media.url.startsWith('/api/')) 
        ? media.url 
        : `https://drive.usercontent.google.com/download?id=${media.fileId}&export=download&confirm=t`;

      const proxyUrl = (media.fileId && window.socketManager && window.socketManager.resolveMediaUrl)
        ? window.socketManager.resolveMediaUrl(`/api/gdrive-stream/${media.fileId}?force=1`)
        : null;

      const self = this;
      let driveFallbackUsed = false;
      const fallbackToProxy = () => {
        if (!proxyUrl || driveFallbackUsed) return;
        driveFallbackUsed = true;
        console.warn('[GDrive] Directo rechazado (cookies/confirm); fallback al proxy del server:', proxyUrl);
        if (window.appUI) window.appUI.showToast('⚙️ Google Drive requiere proxy temporal (ancho de banda del server).', 'warning');
        self.gdriveVideo.src = proxyUrl;
        self.gdriveVideo.load();
        if (autoPlay) self.gdriveVideo.play().catch(err => console.log('[GDrive] Autoplay proxy diferido:', err.message));
      };
      const removeHandlers = () => {
        self.gdriveVideo.removeEventListener('error', fallbackToProxy);
        window.clearTimeout(fallbackToProxy._timer);
      };

      // Si el directo no carga en ~8s o da error → proxy del servidor (resuelve redirects/cookies)
      fallbackToProxy._timer = window.setTimeout(() => {
        if (self.gdriveVideo.readyState <= 1) fallbackToProxy();
      }, 8000);

      console.log(`[GDrive] Cargando película de Drive directo: ${directUrl}`);

      if (window.appUI) window.appUI.showToast('🔄 Cargando película de Google Drive...', 'info');

      this.gdriveVideo.addEventListener('error', fallbackToProxy);

      this.gdriveVideo.addEventListener('canplay', () => {
        if (window.appUI) window.appUI.showToast('✅ Película de Drive lista para reproducir 🎬', 'success');
      }, { once: true });
      this.gdriveVideo.addEventListener('playing', removeHandlers, { once: true });

      this.gdriveVideo.src = directUrl;
      this.gdriveVideo.load();

      if (autoPlay) {
        this.gdriveVideo.play().catch(err => console.log('[GDrive] Autoplay diferido:', err.message));
      } else {
        this.gdriveVideo.pause();
      }

    } else {
      // MP4 / Pixeldrain / Enlace directo (0% ancho de banda del servidor)
      this.currentType = 'mp4';
      this._showContainer('mp4');
      this.mp4Video.removeAttribute('crossorigin');
      this.mp4Video.removeAttribute('referrerpolicy');
      // Si el server lo reescribió al proxy (http:// en página https → mixed
      // content obliga a proxear), avisar del consumo de banda.
      if (typeof media.url === 'string' && media.url.indexOf('/api/stream-proxy') !== -1) {
        if (window.appUI) window.appUI.showToast('⚠️ Fuente http: se proxeará por el server (gasta ancho de banda).', 'warning');
      }
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

  // ─── Extraer y reproducir HLS de embeds vimeus/vimeos ─────────────────────
  // Cada navegador extrae su propio master (token firmado para su UA) vía
  // /api/embed-html + VimeoExtractor, y reproduce DIRECTO del CDN. Si la
  // extracción o el CDN fallan → iframe del embed (último recurso).
  async _playVimeoEmbed(embedUrl, autoPlay = true) {
    this._vimeoEmbedRequest = embedUrl;
    try {
      if (window.appUI) window.appUI.showToast('🔍 Extrayendo HLS limpio del servidor de video...', 'info');
      const master = await window.VimeoExtractor.extractVimeos(embedUrl);
      if (this._vimeoEmbedRequest !== embedUrl) return; // cambiaron de media mientras tanto
      console.log(`[Vimeo] Master extraído en navegador (token para este UA): ${master.substring(0, 100)}`);

      // Pre-flight determinista: si el CDN rechaza esta sesión (en la nube el
      // token se firma para IP datacenter → honeypot 403), ir a iframe YA en
      // lugar de esperar 2 fallos de red de hls.js. En local/EXE el token es
      // válido → hls.js directo con sync y 0% banda del server.
      const ok = await window.VimeoExtractor.checkMaster(master);
      if (this._vimeoEmbedRequest !== embedUrl) return;
      if (!ok) {
        console.warn('[Vimeo] El CDN rechaza esta sesión; iframe del embed (0% banda del server).');
        if (window.appUI) window.appUI.showToast('🎬 Modo compatible: reproductor original del sitio (sin sync).', 'warning');
        this._playIframe(embedUrl);
        return;
      }

      this._playHLSStream(master, embedUrl, autoPlay);
    } catch (err) {
      console.warn('[Vimeo] Extracción HLS falló; fallback a iframe del embed:', err.message);
      this._playIframe(embedUrl);
    }
  }

  // ─── Reproducir embed original en iframe (fallback vimeus/vimeos) ────────
  // Los CDN de estos embeds (s13.vimeos.net, p4.vimeos.zip, etc.) bloquean las
  // peticiones que no vienen del navegador real con su sesión, así que si el
  // stream HLS directo falla, se carga la página embed original (que sí crea
  // su propia sesión y reproduce). Sin consumo de banda del servidor.
  _playIframe(embedUrl) {
    console.warn('[Player] Reproduciendo embed original en iframe:', embedUrl);
    this.currentType = 'iframe';
    this._showContainer('iframe');
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
    if (this.iframeVideo) {
      this.iframeVideo.src = embedUrl;
    }
    if (window.appUI) window.appUI.showToast('🎬 Reproduciendo reproductor original del sitio...', 'info');
    this.showLoadingOverlay(false);
  }

  _playHLSStream(hlsUrl, referer, autoPlay = true) {
    // Usar la fuente HLS directa del cliente por defecto (0% ancho de banda del servidor)
    const targetSource = hlsUrl;
    console.log(`[HLS Player] Cargando stream directo: ${targetSource}`);

    if (window.appUI) window.appUI.showToast('🎬 Cargando película HLS / Stream en vivo...', 'info');

    if (window.Hls && Hls.isSupported()) {
      if (this.hlsInstance) {
        this.hlsInstance.destroy();
      }
      let networkFails = 0;
      this.hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1024 * 1024,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        nudgeMaxRetries: 5,
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        capLevelToPlayerSize: false,
        startLevel: -1
      });
      this.hlsInstance.loadSource(targetSource);
      this.hlsInstance.attachMedia(this.mp4Video);

      // Playlist sin #EXT-X-ENDLIST → hls.js la trata como LIVE (duración Infinity,
      // sin seek). Los CDN de embeds sirven películas así: forzar VOD si el nivel
      // tiene duración total conocida para que el slider muestre el tiempo y el
      // Host pueda adelantar/retroceder.
      this.hlsInstance.on(Hls.Events.LEVEL_LOADED, (event, data) => {
        try {
          if (data && data.details && data.details.live) {
            const total = data.details.totalduration;
            if (isFinite(total) && total > 0) {
              console.log(`[HLS] Playlist sin ENDLIST → VOD forzado (duración ${Math.round(total)}s)`);
              data.details.live = false;
              data.details.ended = true;
              if (this.hlsInstance) this.hlsInstance.liveSyncPosition = null;
            }
          }
        } catch (e) {}
      });

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
              networkFails++;
              // Si el CDN bloquea el stream (403/sesión) y tenemos el embed original,
              // fallback automático a iframe (el embed crea su propia sesión).
              if (networkFails >= 2 && referer && /^https?:\/\//i.test(referer) && !referer.includes('.m3u8')) {
                console.warn('[HLS] CDN bloqueó el stream; fallback a iframe del embed:', referer);
                this._playIframe(referer);
                return;
              }
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
      this.mp4Video.src = targetSource;
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
  _initAudioGainNode(videoElement) {
    if (!videoElement || videoElement._gainNode) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaElementSource(videoElement);
      const gainNode = audioCtx.createGain();
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      videoElement._gainNode = gainNode;
      videoElement._audioCtx = audioCtx;
    } catch(e) {
      console.warn('[AudioGain] Error creando gain node:', e.message);
    }
  }

  setLocalVolume(vol) {
    const clampedVol = Math.max(0, Math.min(150, parseInt(vol) || 0));
    this.localVolume = clampedVol;

    if (this.currentType === 'youtube' && this.ytPlayer && this.isYTReady) {
      if (typeof this.ytPlayer.setVolume === 'function') {
        this.ytPlayer.setVolume(Math.min(100, this.localVolume));
        this.isMuted ? this.ytPlayer.mute() : this.ytPlayer.unMute();
      }
    }

    const setVidVol = (vid) => {
      if (!vid) return;
      vid.muted = this.isMuted;
      if (this.localVolume <= 100) {
        vid.volume = this.localVolume / 100;
        if (vid._gainNode) vid._gainNode.gain.value = 1.0;
      } else {
        vid.volume = 1.0;
        this._initAudioGainNode(vid);
        if (vid._gainNode) vid._gainNode.gain.value = this.localVolume / 100;
        if (vid._audioCtx && vid._audioCtx.state === 'suspended') {
          vid._audioCtx.resume().catch(() => {});
        }
      }
    };

    setVidVol(this.mp4Video);
    setVidVol(this.gdriveVideo);
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
    if (!vid) return 0;
    let dur = vid.duration;
    // Playlists HLS sin #EXT-X-ENDLIST se tratan como LIVE → duration = Infinity/NaN
    // y el slider/seek quedan rotos. hls.js conoce la duración real del contenido
    // en level.details.totalduration (suma de #EXTINF) — la usamos como fallback.
    if (!isFinite(dur) || isNaN(dur) || dur <= 0) {
      try {
        if (this.hlsInstance && this.hlsInstance.levels && this.hlsInstance.levels.length) {
          const lvl = this.hlsInstance.levels[this.hlsInstance.currentLevel] || this.hlsInstance.levels[this.hlsInstance.levels.length - 1];
          if (lvl && lvl.details && isFinite(lvl.details.totalduration) && lvl.details.totalduration > 0) {
            dur = lvl.details.totalduration;
          }
        }
      } catch (e) {}
    }
    return (isNaN(dur) || dur < 0) ? 0 : dur;
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
  destroyPlayer() {
    if (this.hlsInstance) {
      try { this.hlsInstance.destroy(); } catch(e) {}
      this.hlsInstance = null;
    }
    if (this.mp4Video) {
      try { this.mp4Video.pause(); this.mp4Video.src = ''; } catch(e) {}
    }
    if (this.gdriveVideo) {
      try { this.gdriveVideo.pause(); this.gdriveVideo.src = ''; } catch(e) {}
    }
    if (this.ytPlayer && this.isYTReady) {
      try { this.ytPlayer.pauseVideo(); } catch(e) {}
    }
    this.currentType = null;
    this.currentMedia = null;
    this._showContainer('empty');
    this.showLoadingOverlay(false);
  }
}

window.playerManager = new PlayerManager();
