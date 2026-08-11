const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const roomManager = require('./roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Caché de URL final resuelta por fileId
const driveUrlCache = new Map();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 100 });

function makeHttpsRequest(url, headers = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Demasiados redireccionamientos HTTP'));
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      agent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate',
        ...headers
      },
      timeout: 15000
    };
    const r = client.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const redirectUrl = new URL(res.headers.location, url).href;
          return makeHttpsRequest(redirectUrl, headers, maxRedirects - 1).then(resolve).catch(reject);
        } catch (eRed) {
          return resolve(res);
        }
      }
      resolve(res);
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('HTTP Request Timeout')); });
    r.on('error', reject);
    r.end();
  });
}

function readBody(res) {
  return new Promise((resolve) => {
    const encoding = res.headers['content-encoding'];
    let stream = res;
    if (encoding === 'gzip') {
      stream = res.pipe(zlib.createGunzip());
    } else if (encoding === 'deflate') {
      stream = res.pipe(zlib.createDeflate());
    }
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

// Resuelve la URL final de streaming de Google Drive siguiendo todos los redirects,
// cookies y tokens de confirmación (para archivos grandes > 100MB)
async function resolveDriveUrl(fileId) {
  // Devolver desde caché si está vigente
  const cached = driveUrlCache.get(fileId);
  if (cached && Date.now() < cached.expiresAt) {
    return { url: cached.url, cookies: cached.cookies };
  }

  let cookies = '';
  let currentUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  for (let attempt = 0; attempt < 8; attempt++) {
    const hdrs = {};
    if (cookies) hdrs['Cookie'] = cookies;

    const driveRes = await makeHttpsRequest(currentUrl, hdrs);

    // Acumular cookies
    const setCookie = driveRes.headers['set-cookie'] || [];
    const newC = setCookie.map(c => c.split(';')[0]).join('; ');
    if (newC) cookies = cookies ? `${cookies}; ${newC}` : newC;

    const ct     = driveRes.headers['content-type'] || '';
    const loc    = driveRes.headers['location'];
    const status = driveRes.statusCode;

    console.log(`[GDrive Resolve] attempt=${attempt + 1} status=${status} ct=${ct.split(';')[0]}`);

    // Redireccionamiento
    if ([301, 302, 303, 307, 308].includes(status) && loc) {
      driveRes.resume();
      currentUrl = loc.startsWith('http') ? loc : `https://drive.google.com${loc}`;
      continue;
    }

    // Página HTML de confirmación (archivo grande, virus-scan, o límite de cuota)
    if (ct.includes('text/html')) {
      const body = await readBody(driveRes);

      // Detección de Cuota Excedida de Google Drive
      if (body.includes('Quota exceeded') || body.includes('cuota de descarga') || body.includes('User rate limit exceeded')) {
        console.warn(`[GDrive Resolve] ⚠️ Límite de cuota alcanzado para fileId: ${fileId}`);
        return { error: 'QuotaExceeded', isQuotaError: true };
      }

      // Token UUID (archivos > 100MB desde 2023)
      const uuidM = body.match(/name=["']uuid["']\s+value=["']([^"']+)["']/) ||
                    body.match(/"uuid":"([^"]+)"/);
      if (uuidM) {
        currentUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t&uuid=${uuidM[1]}`;
        continue;
      }

      // Token confirm clásico
      const confM = body.match(/confirm=([a-zA-Z0-9_-]+)/);
      if (confM) {
        currentUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confM[1]}`;
        continue;
      }

      // Fallback usercontent
      driveRes.resume();
      currentUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
      continue;
    }

    // ✅ Es video/binario — esta es la URL final
    driveRes.resume();

    // Guardar en caché
    driveUrlCache.set(fileId, { url: currentUrl, cookies, expiresAt: Date.now() + CACHE_TTL_MS });
    console.log(`[GDrive Resolve] ✅ URL resuelta y cacheada para ${fileId}`);

    return { url: currentUrl, cookies };
  }

  // Último fallback
  const url = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  driveUrlCache.set(fileId, { url, cookies, expiresAt: Date.now() + CACHE_TTL_MS });
  return { url, cookies };
}

// Helper para verificar si la petición es local (PC/Desktop del usuario) o nube (Render)
function isLocalhostRequest(req) {
  const host = req.headers.host || '';
  return host.includes('localhost') || host.includes('127.0.0.1') || host.includes('192.168.') || host.includes('10.');
}

// Endpoint proxy inteligente para Google Drive
app.get('/api/gdrive-stream/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId) return res.status(400).json({ error: 'File ID required' });

  // En la nube (Render), redirigir directo para 0% consumo de banda,
  // SALVO que el cliente pida ?force=1 (cuando el directo falló: el proxy
  // completo resuelve redirects/cookies/token confirm y SÍ reproduce).
  const forceProxy = req.query.force === '1';
  if (!isLocalhostRequest(req) && !forceProxy) {
    const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    return res.redirect(302, directUrl);
  }

  // En la App de Windows / Ejecutable local, actuar como Proxy local completo
  try {
    const driveResult = await resolveDriveUrl(fileId);
    if (driveResult.error === 'QuotaExceeded') {
      return res.status(429).json({ error: 'Google Drive quota exceeded', isQuotaError: true });
    }

    const { url: driveUrl, cookies } = driveResult;
    const reqHeaders = {};
    if (cookies) reqHeaders['Cookie'] = cookies;
    if (req.headers.range) reqHeaders['Range'] = req.headers.range;

    const driveRes = await makeHttpsRequest(driveUrl, reqHeaders);
    const status = driveRes.statusCode;

    const resHeaders = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    };

    if (driveRes.headers['content-length']) resHeaders['Content-Length'] = driveRes.headers['content-length'];
    if (driveRes.headers['content-range']) resHeaders['Content-Range'] = driveRes.headers['content-range'];

    res.writeHead(status === 206 ? 206 : 200, resHeaders);
    driveRes.pipe(res);
    req.on('close', () => driveRes.destroy());
  } catch (err) {
    console.error('[Local GDrive Stream Error]:', err.message);
    res.redirect(302, `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`);
  }
});

// Endpoint proxy inteligente para Pixeldrain
app.get('/api/pixeldrain-stream/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId) return res.status(400).json({ error: 'File ID required' });

  const targetUrl = `https://pixeldrain.com/api/file/${fileId}`;

  // En el servidor remoto en la nube (Render), redirigir directamente para 0% consumo de ancho de banda
  if (!isLocalhostRequest(req)) {
    return res.redirect(302, targetUrl);
  }

  // En la App de Windows / Ejecutable local, actuar como Proxy local completo
  try {
    const reqHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
    if (req.headers.range) reqHeaders['Range'] = req.headers.range;

    const pxRes = await makeHttpsRequest(targetUrl, reqHeaders);
    const status = pxRes.statusCode;

    const resHeaders = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    };

    if (pxRes.headers['content-length']) resHeaders['Content-Length'] = pxRes.headers['content-length'];
    if (pxRes.headers['content-range']) resHeaders['Content-Range'] = pxRes.headers['content-range'];

    res.writeHead(status === 206 ? 206 : (status === 200 ? 200 : status), resHeaders);
    pxRes.pipe(res);
    req.on('close', () => pxRes.destroy());
  } catch (err) {
    console.error('[Local Pixeldrain Stream Error]:', err.message);
    res.redirect(302, targetUrl);
  }
});

// Proxy de stream directo (MP4/etc.) para URLs http:// (mixed content en HTTPS).
// Consumo de banda del servidor = 0% SIEMPRE que se pueda:
//  - Target https → 302 directo (el navegador carga solo, en nube y en local).
//  - Target http + página servida por http (localhost/Electron) → 302 directo.
//  - Target http + página https (Render) → proxy OBLIGATORIO (mixed content).
app.get('/api/stream-proxy', async (req, res) => {
  const targetUrl = (req.query.url || '').trim();
  if (!targetUrl) return res.status(400).json({ error: 'URL required' });
  if (!/^https?:\/\//i.test(targetUrl)) return res.status(400).json({ error: 'Solo se permiten URLs http/https' });

  const isHttpsTarget = targetUrl.startsWith('https://');
  const pageIsHttps = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
    || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
    || (req.connection && req.connection.encrypted);

  // 302 directo: el navegador carga sin pasar por el servidor (0% ancho de banda).
  // Solo se fuerza proxy cuando un destino http se carga desde una página https.
  if (isHttpsTarget || !pageIsHttps) {
    return res.redirect(302, targetUrl);
  }

  try {
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Encoding': 'identity'
    };
    if (req.headers.range) reqHeaders['Range'] = req.headers.range;

    const upRes = await makeHttpsRequest(targetUrl, reqHeaders);
    const status = upRes.statusCode;

    const resHeaders = {
      'Content-Type': upRes.headers['content-type'] || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    };
    if (upRes.headers['content-length']) resHeaders['Content-Length'] = upRes.headers['content-length'];
    if (upRes.headers['content-range']) resHeaders['Content-Range'] = upRes.headers['content-range'];

    res.writeHead(status === 206 ? 206 : (status === 200 ? 200 : status), resHeaders);
    upRes.pipe(res);
    req.on('close', () => upRes.destroy());
  } catch (err) {
    console.error('[Stream Proxy Error]:', err.message);
    res.redirect(302, targetUrl);
  }
});

// CDNs que bloquean con 403 a peticiones no-navegador (sin Referer/sesión).
// Su HLS SOLO se puede reproducir si el server hace de proxy (aunque gaste banda en Render).
function isTokenProtectedCdn(url) {
  const u = (url || '').toLowerCase();
  return u.includes('vimeo') || u.includes('vimeus') ||
         u.includes('vibuxer') || u.includes('vibux') ||
         u.includes('morencius') || u.includes('minochinos') || u.includes('vidhide') ||
         u.includes('player4me') || u.includes('cargahd') ||
         u.includes('luluvdoo') || u.includes('lulucdn');
}

// Proxy HLS inteligente (Localhost = Proxy completo local / Render = 302 Directo en 0%)
app.get('/api/hls-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const referer = req.query.referer || targetUrl;

  if (!targetUrl) return res.status(400).send('URL required');

  const isLocal = isLocalhostRequest(req);
  const isTokenCdn = isTokenProtectedCdn(targetUrl);

  // Si no es local, es un segmento binario (.ts/.m4s/.mp4) y NO es una CDN token-protegida, redirigir directo (0% en Render)
  if (!isLocal && !isTokenCdn && (targetUrl.includes('.ts') || targetUrl.includes('.m4s') || targetUrl.includes('.mp4'))) {
    return res.redirect(302, targetUrl);
  }

  try {
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': referer
    };
    if (req.headers.range) reqHeaders['Range'] = req.headers.range;

    const proxyRes = await makeHttpsRequest(targetUrl, reqHeaders);
    const status = proxyRes.statusCode;
    let contentType = proxyRes.headers['content-type'] || '';

    if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/x-mpegurl')) {
      let m3u8Body = await readBody(proxyRes);
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

      const rewritten = m3u8Body.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
              let abs = uri.startsWith('http') ? uri : new URL(uri, baseUrl).href;
              return `URI="/api/hls-proxy?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}"`;
            });
          }
          return line;
        }

        let absoluteSegmentUrl = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          absoluteSegmentUrl = new URL(trimmed, baseUrl).href;
        }

        // Local o CDN token-protegida: canalizar segmentos por el proxy (referer/sesión).
        // Render + CDN abierta: usar URL directa (0% banda).
        return (isLocal || isTokenCdn)
          ? `/api/hls-proxy?url=${encodeURIComponent(absoluteSegmentUrl)}&referer=${encodeURIComponent(referer)}`
          : absoluteSegmentUrl;
      }).join('\n');

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.status(status === 206 ? 206 : 200).send(rewritten);
    }

    if (!contentType || contentType.includes('mpegurl')) {
      contentType = targetUrl.includes('.m4s') ? 'video/iso.segment' : 'video/mp2t';
    }

    req.on('close', () => {
      try {
        if (proxyRes && typeof proxyRes.destroy === 'function' && !proxyRes.destroyed) {
          proxyRes.destroy();
        }
      } catch (eClose) {}
    });

    const proxyHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    };
    if (proxyRes.headers['content-length']) proxyHeaders['Content-Length'] = proxyRes.headers['content-length'];
    if (proxyRes.headers['content-range']) proxyHeaders['Content-Range'] = proxyRes.headers['content-range'];
    if (proxyRes.headers['content-encoding']) proxyHeaders['Content-Encoding'] = proxyRes.headers['content-encoding'];
    res.writeHead(status === 206 ? 206 : 200, proxyHeaders);
    proxyRes.pipe(res);

  } catch (err) {
    console.error('[HLS Proxy Error]:', err.message);
    res.redirect(302, targetUrl);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTOR SEGURIZADO DE HLS / M3U8 Y PROXY DE STREAMING
// ─────────────────────────────────────────────────────────────────────────────

async function safeFetchHtml(targetUrl, referer, customUA) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const domain = new URL(targetUrl).origin;
    const reqHeaders = {
      'User-Agent': customUA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': referer || domain,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    };

    const res = await fetch(targetUrl, { headers: reqHeaders, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return '';
    return await res.text();
  } catch (err) {
    console.warn(`[SafeFetch Warning] ${targetUrl}:`, err.message);
    return '';
  }
}

const vm = require('vm');

function unpackDeanEdwardsJs(code) {
  if (!code || typeof code !== 'string') return code;
  try {
    const evalRegex = /eval\(function\(p,a,c,k,e,d\)[\s\S]+?\.split\('\|'\)\s*\)\s*\)/g;
    const matches = code.match(evalRegex);
    if (!matches) return code;

    let unpackedAll = code;
    for (const packedSnippet of matches) {
      const inner = packedSnippet.replace(/^eval\s*\(/, '').replace(/\)\s*$/, '');
      try {
        const unpackedJS = vm.runInNewContext('(' + inner + ')');
        if (unpackedJS && typeof unpackedJS === 'string') {
          unpackedAll += '\n' + unpackedJS;
        }
      } catch (eVm) {
        const parts = packedSnippet.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
        if (parts) {
          let [_, p, a, c, k] = parts;
          a = parseInt(a, 10);
          c = parseInt(c, 10);
          k = k.split('|');
          const eFunc = (c) => (c < a ? '' : eFunc(Math.floor(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
          while (c--) {
            if (k[c]) {
              p = p.replace(new RegExp('\\b' + eFunc(c) + '\\b', 'g'), k[c]);
            }
          }
          unpackedAll += '\n' + p;
        }
      }
    }
    return unpackedAll;
  } catch (err) {
    return code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE EXTRACCIÓN (portados de Peliscarga app)
// ─────────────────────────────────────────────────────────────────────────────

// Encuentra una URL .m3u8 / .urlset/master en un texto (HTML o JS desempaquetado)
function findM3u8Url(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/(https?:[\\\/][\\\/][^"'`\s>]+\.(?:m3u8|urlset)[^"'`\s>]*)/i) ||
           text.match(/file:\s*["']([^"']+\.(?:m3u8|urlset)[^"']*)["']/i) ||
           text.match(/source:\s*["']([^"']+\.(?:m3u8|urlset)[^"']*)["']/i) ||
           text.match(/src:\s*["']([^"']+\.(?:m3u8|urlset)[^"']*)["']/i);
  if (!m) return null;
  let url = (m[1] || m[0]).replace(/\\/g, '');
  if (url.startsWith('//')) url = 'https:' + url;
  return url;
}

// URL del proxy HLS (misma-origen para el navegador + referer del CDN)
function hlsProxyUrl(url, referer) {
  return `/api/hls-proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer || '')}`;
}

// El referer que necesitan los CDN token-protegidos es su PROPIA misma-origen
function cdnSameOriginReferer(url) {
  try {
    return new URL(url).origin + '/';
  } catch (e) {
    return '';
  }
}

// Extractores de la familia Vibuxer (vibuxer.com/.net, morencius, minochinos, vidhide)
// Patrón: JS Dean Edwards desempaquetado con objeto links = {hls2,hls3,hls4,...}
async function extractVibuxerFamily(embedUrl) {
  try {
    let targetUrl = embedUrl.trim();
    const origin = new URL(targetUrl).origin;

    const candidates = [targetUrl];
    if (!targetUrl.includes('/e/') && !targetUrl.includes('/d/')) {
      const u = new URL(targetUrl);
      u.pathname = '/e' + u.pathname;
      candidates.push(u.href);
    }

    for (const cand of candidates) {
      let html = await safeFetchHtml(cand, origin + '/');
      if (!html) continue;
      const unpacked = unpackDeanEdwardsJs(html);
      if (!unpacked || unpacked === html) continue;

      // Soportar claves con comillas ("hls2") o sin comillas (hls2)
      const linksMatch = unpacked.match(/(\{[^{}]*["']?hls[234]["']?\s*:[^{}]*\})/);
      if (!linksMatch) continue;

      let videoUrl = null;
      try {
        const links = JSON.parse(linksMatch[1]);
        const v = links.hls4 || links.hls3 || links.hls2;
        if (v) {
          let url = String(v);
          if (url.startsWith('/')) url = origin + url;
          if (/^https?:\/\//i.test(url)) videoUrl = url;
        }
      } catch (eParse) {
        const hlsM = linksMatch[1].match(/["']?hls[234]["']?\s*:\s*["']([^"']+)["']/);
        if (hlsM && hlsM[1]) {
          let v = hlsM[1].replace(/\\/g, '');
          if (v.startsWith('/')) v = origin + v;
          if (/^https?:\/\//i.test(v)) videoUrl = v;
        }
      }

      if (videoUrl) {
        console.log(`[Vibuxer Extractor] ✅ Stream extraído: ${videoUrl.substring(0, 90)}`);
        return {
          type: 'hls',
          url: hlsProxyUrl(videoUrl, cdnSameOriginReferer(videoUrl)),
          referer: cand,
          originalUrl: videoUrl
        };
      }
    }
    return null;
  } catch (err) {
    console.warn('[Vibuxer Extractor Error]:', err.message);
    return null;
  }
}

// Extractor Player4me / Cargahd (API cifrada AES-128-CBC)
async function extractPlayer4me(embedUrl) {
  try {
    const parsed = new URL(embedUrl.trim());
    const origin = parsed.origin;
    let hash = (parsed.hash || '').replace(/^#/, '').split('&')[0];
    if (!hash) return null;

    // Inicializa sesión/cookies del dominio
    await safeFetchHtml(embedUrl, origin + '/');

    const apiUrl = `${origin}/api/v1/video?id=${encodeURIComponent(hash)}&w=1920&h=1080&r=`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    let res;
    try {
      res = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': origin + '/',
          'Origin': origin,
          'Accept': '*/*'
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res || !res.ok) return null;
    const hexCipher = (await res.text()).trim();
    if (!hexCipher || hexCipher.length < 32) return null;

    let decrypted;
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from('kiemtienmua911ca', 'utf8'), Buffer.from('1234567890oiuytr', 'utf8'));
      decrypted = Buffer.concat([decipher.update(Buffer.from(hexCipher, 'hex')), decipher.final()]).toString('utf8');
    } catch (eDec) {
      console.warn('[Player4me] Error al descifrar:', eDec.message);
      return null;
    }

    let data;
    try {
      data = JSON.parse(decrypted);
    } catch (eJson) {
      return null;
    }

    let videoUrl = data.cfNative || data.source || data.cf;
    if (!videoUrl) return null;
    if (videoUrl.startsWith('/')) videoUrl = origin + videoUrl;
    if (!/^https?:\/\//i.test(videoUrl)) return null;

    const isHls = videoUrl.includes('.m3u8') || videoUrl.includes('playlist') || videoUrl.includes('master') || !videoUrl.includes('.mp4');
    console.log(`[Player4me Extractor] ✅ Stream extraído: ${videoUrl.substring(0, 90)}`);
    return {
      type: isHls ? 'hls' : 'mp4',
      url: isHls ? hlsProxyUrl(videoUrl, cdnSameOriginReferer(videoUrl)) : videoUrl,
      referer: embedUrl,
      originalUrl: videoUrl
    };
  } catch (err) {
    console.warn('[Player4me Extractor Error]:', err.message);
    return null;
  }
}

// Extractor Luluvdoo / Lulucdn (JS desempaquetado con file:"...")
async function extractLuluvdoo(embedUrl) {
  try {
    let targetUrl = embedUrl.trim();
    const origin = new URL(targetUrl).origin;

    const candidates = [targetUrl];
    if (!targetUrl.includes('/e/')) {
      const u = new URL(targetUrl);
      u.pathname = '/e' + u.pathname;
      candidates.push(u.href);
    }

    for (const cand of candidates) {
      let html = await safeFetchHtml(cand, origin + '/');
      if (!html) continue;
      const unpacked = unpackDeanEdwardsJs(html);
      const m3u8Url = findM3u8Url(unpacked);
      if (m3u8Url) {
        console.log(`[Luluvdoo Extractor] ✅ HLS extraído: ${m3u8Url.substring(0, 90)}`);
        return {
          type: 'hls',
          url: hlsProxyUrl(m3u8Url, cdnSameOriginReferer(m3u8Url)),
          referer: cand,
          originalUrl: m3u8Url
        };
      }
    }
    return null;
  } catch (err) {
    console.warn('[Luluvdoo Extractor Error]:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VIMEUS / VIMEOS → reproducción directa en IFRAME
// ─────────────────────────────────────────────────────────────────────────────
// Los CDN token-protegidos de vimeos (s13.vimeos.net, p2.vimeos.zip, etc.)
// responden 403 Forbidden a TODO request que no venga de la sesión real del
// navegador que cargó el embed (probado empíricamente: 403 incluso con token
// fresco, Referer same-origin y UA Chrome). Por eso el HLS extraído por el
// server JAMÁS reproduce en el cliente (ni directo ni por proxy). La única vía
// es cargar el embed original en un <iframe>: el embed crea su propia sesión
// y reproduce. Consume 0% de banda del servidor.

function isVimeoFamily(url) {
  const u = (url || '').toLowerCase();
  return u.includes('vimeus') || u.includes('vimeos');
}

// Encuentra la URL del embed vimeos real (el que reproduce en el navegador)
async function resolveVimeoEmbed(embedUrl) {
  try {
    const targetUrl = embedUrl.trim();
    const lower = targetUrl.toLowerCase();

    // Ya es un embed vimeos directo
    if (/vimeos\.(net|com|zip)\/embed-/i.test(targetUrl)) {
      return targetUrl;
    }

    const u = new URL(targetUrl);
    const domain = `${u.protocol}//${u.hostname}`;
    const referer = lower.includes('vimeus.com') ? 'https://vimeus.com/' : domain + '/';
    const html = await safeFetchHtml(targetUrl, referer);
    if (!html) return null;

    // 1. iframe src que apunte a vimeos
    let m = html.match(/(?:iframe[^>]+src|src)\s*=\s*["'](https?:\/\/(?:vimeos\.net|vimeos\.com|vimeos\.zip)\/embed-[^"'\s>]+)/i);
    if (m && m[1]) return m[1];

    // 2. URL genérica de vimeos en el HTML
    m = html.match(/(https?:\/\/(?:vimeos\.net|vimeos\.com|vimeos\.zip)\/[^\s"'<>]+)/i);
    if (m && m[1]) return m[1].replace(/\\/g, '');

    // 3. JSON <script id="data"> / text/json (embeds)
    const jm = html.match(/<script[^>]*id=["']data["'][^>]*>([\s\S]*?)<\/script>/i) ||
               html.match(/<script[^>]*type=["']text\/json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jm && jm[1]) {
      try {
        const d = JSON.parse(jm[1].trim());
        const embeds = (d && Array.isArray(d.embeds)) ? d.embeds : [];
        for (const e of embeds) {
          if (e && e.url && /vimeos\.(net|com|zip)/i.test(e.url)) return e.url;
        }
        for (const e of embeds) {
          if (e && e.url && !/goodstream\.one/i.test(e.url) && !/vimeus\.com/i.test(e.url)) return e.url;
        }
      } catch (eJson) {}
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Vimeus/Vimeos → descriptor para extracción EN EL NAVEGADOR.
// El token t=/s= del HLS de vimeos se firma con el **User-Agent** del que pide
// el HTML del embed (probado: token firmado con UA Chrome/124 → 403 con UA
// Chrome/126 y viceversa). Por eso el server NO puede extraer un HLS que luego
// reproduzca el navegador (UA distinto). La única vía limpia y sin banda de
// servidor es que CADA navegador pida su propio HTML (vía /api/embed-html, que
// reenvía el UA del cliente), desempaquete el JS y extraiga su master con su
// token válido. El video fluye directo CDN → navegador (0% del server).
async function extractHlsFromEmbed(embedUrl) {
  try {
    let targetUrl = embedUrl.trim();
    if (targetUrl.includes('vimeus.com/v/')) {
      targetUrl = targetUrl.replace('vimeus.com/v/', 'vimeus.com/e/');
    }
    if (targetUrl.includes('vimeos.net/v/')) {
      targetUrl = targetUrl.replace('vimeos.net/v/', 'vimeos.net/e/');
    }

    // Vimeus/Vimeos: descriptor para que el NAVEGADOR extraiga el HLS con su
    // propio User-Agent (el token del CDN se firma por UA, así que solo así
    // reproduce y sin gastar banda del server). Fallback: iframe del embed.
    if (isVimeoFamily(targetUrl)) {
      const vimeoEmbed = await resolveVimeoEmbed(targetUrl);
      if (vimeoEmbed) {
        console.log(`[Vimeos] Descriptor para extracción en navegador: ${vimeoEmbed.substring(0, 90)}`);
        return { type: 'vimeo', url: vimeoEmbed, embedUrl: vimeoEmbed, referer: vimeoEmbed, originalUrl: targetUrl };
      }
      console.warn('[Vimeos] No se pudo resolver el embed vimeos; intentando extracción HLS genérica:', targetUrl);
    }

    // Pixeldrain
    if (targetUrl.includes('pixeldrain.com')) {
      const fileIdMatch = targetUrl.match(/pixeldrain\.com\/(?:u|l|api\/file)\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch && fileIdMatch[1]) {
        return { type: 'mp4', url: `https://pixeldrain.com/api/file/${fileIdMatch[1]}` };
      }
    }

    if (targetUrl.includes('.m3u8')) {
      return { type: 'hls', url: targetUrl };
    }

    // Extractores específicos por proveedor (portados de Peliscarga)
    const lowUrl = targetUrl.toLowerCase();
    if (lowUrl.includes('vibux') || lowUrl.includes('morencius') || lowUrl.includes('minochinos') || lowUrl.includes('vidhide')) {
      const vibuxer = await extractVibuxerFamily(targetUrl);
      if (vibuxer) return vibuxer;
    }
    if (lowUrl.includes('player4me') || lowUrl.includes('cargahd')) {
      const player4me = await extractPlayer4me(targetUrl);
      if (player4me) return player4me;
    }
    if (lowUrl.includes('luluvdoo') || lowUrl.includes('lulucdn')) {
      const luluvdoo = await extractLuluvdoo(targetUrl);
      if (luluvdoo) return luluvdoo;
    }

    const u = new URL(targetUrl);
    const domain = `${u.protocol}//${u.hostname}`;

    let html = await safeFetchHtml(targetUrl, domain);
    if (!html) {
      return { type: 'mp4', url: targetUrl };
    }

    // 0. Parsear <script type="text/json" id="data"> de Vimeus / Vimeos
    const jsonScriptMatch = html.match(/<script[^>]*id=["']data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonScriptMatch && jsonScriptMatch[1]) {
      try {
        const jsonData = JSON.parse(jsonScriptMatch[1].trim());
        if (jsonData && Array.isArray(jsonData.embeds)) {
          // Priorizar Vimeos / Vimeus / HLSWish en el orden de prueba
          const sortedEmbeds = jsonData.embeds.sort((a, b) => {
            const aUrl = (a && a.url) ? a.url.toLowerCase() : '';
            const bUrl = (b && b.url) ? b.url.toLowerCase() : '';
            const score = (u) => (u.includes('vimeos') || u.includes('vimeus')) ? 3 : (u.includes('hlswish') || u.includes('goodstream') ? 2 : 1);
            return score(bUrl) - score(aUrl);
          });

          for (const embedObj of sortedEmbeds) {
            if (embedObj && embedObj.url) {
              console.log(`[Vimeus Extractor] Probando sub-embed prioritario: ${embedObj.url}`);
              const subResult = await extractHlsFromEmbed(embedObj.url);
              if (subResult && subResult.url && subResult.url !== embedObj.url) {
                return subResult;
              }
            }
          }
        }
      } catch (eJson) {
        console.warn('Error al parsear #data JSON de Vimeus:', eJson.message);
      }
    }

    // Desempaquetar JS de Vimeus / Vimeos / JWPlayer obfuscados
    html = unpackDeanEdwardsJs(html);

    // 1. Buscar .m3u8 / .urlset/master (vimeos/vimeus con HLS por el proxy del server)
    const hlsUrl = findM3u8Url(html);
    if (hlsUrl) {
      console.log(`[HLS Extractor] ✅ HLS extraído: ${hlsUrl.substring(0, 90)}`);
      return {
        type: 'hls',
        url: hlsProxyUrl(hlsUrl, cdnSameOriginReferer(hlsUrl)),
        referer: targetUrl,
        originalUrl: hlsUrl
      };
    }

    // 2. Buscar .mp4 directo
    const mp4Match = html.match(/(https?:[\\\/][\\\/][^"'`\s>]+\.(?:mp4|mkv|webm)[^"'`\s>]*)/i) ||
                     html.match(/file:\s*["']([^"']+\.(?:mp4|mkv|webm)[^"']*)["']/i) ||
                     html.match(/src:\s*["']([^"']+\.(?:mp4|mkv|webm)[^"']*)["']/i);
    if (mp4Match) {
      let mp4Url = (mp4Match[1] || mp4Match[0]).replace(/\\/g, '');
      if (mp4Url.startsWith('//')) mp4Url = 'https:' + mp4Url;
      return { type: 'mp4', url: mp4Url, referer: targetUrl };
    }

    // 3. Búsqueda de iframe interno (para reproductores con anuncios de video)
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) {
      let iframeSrc = iframeMatch[1];
      if (iframeSrc.startsWith('//')) iframeSrc = 'https:' + iframeSrc;
      else if (iframeSrc.startsWith('/')) iframeSrc = domain + iframeSrc;

      if (iframeSrc !== targetUrl) {
        let innerHtml = await safeFetchHtml(iframeSrc, targetUrl);
        innerHtml = unpackDeanEdwardsJs(innerHtml);

        const innerHlsUrl = findM3u8Url(innerHtml);
        if (innerHlsUrl) {
          console.log(`[HLS Extractor] ✅ HLS de iframe interno: ${innerHlsUrl.substring(0, 90)}`);
          return {
            type: 'hls',
            url: hlsProxyUrl(innerHlsUrl, cdnSameOriginReferer(innerHlsUrl)),
            referer: iframeSrc,
            originalUrl: innerHlsUrl
          };
        }

        const innerMp4 = innerHtml.match(/(https?:[\\\/][\\\/][^"'`\s>]+\.(?:mp4|mkv|webm)[^"'`\s>]*)/i) ||
                         innerHtml.match(/file:\s*["']([^"']+\.(?:mp4|mkv|webm)[^"']*)["']/i);
        if (innerMp4) {
          let mp4Url = (innerMp4[1] || innerMp4[0]).replace(/\\/g, '');
          if (mp4Url.startsWith('//')) mp4Url = 'https:' + mp4Url;
          return { type: 'mp4', url: mp4Url, referer: iframeSrc };
        }
      }
    }

    return { type: 'mp4', url: targetUrl };

  } catch (err) {
    console.error('[HLS Extractor Error]:', err.message);
    return { type: 'mp4', url: embedUrl };
  }
}

// Endpoint de resolución universal de medios
app.post('/api/resolve-media', async (req, res) => {
  const body = req.body || {};
  const url = body.url;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    let cleanUrl = url.trim();

    // 1. Google Drive (Formatos /file/d/ID, /open?id=ID, /uc?id=ID, etc.) - Directo (0% servidor)
    if (cleanUrl.includes('drive.google.com') || cleanUrl.includes('docs.google.com') || cleanUrl.includes('drive.usercontent.google.com')) {
      const match = cleanUrl.match(/(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=|uc\?.*id=)([a-zA-Z0-9_-]{20,})/i) ||
                    cleanUrl.match(/google\.com\/.*(?:file\/d\/|[?&]id=)([a-zA-Z0-9_-]{20,})/i);
      if (match && match[1]) {
        const fileId = match[1];
        const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
        return res.json({ type: 'gdrive', fileId: fileId, url: directUrl, isGDrive: true });
      }
    }

    // 2. YouTube (Directo 0% servidor)
    if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
      const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
      const videoId = ytMatch ? ytMatch[1] : null;
      return res.json({ type: 'youtube', url: cleanUrl, videoId: videoId });
    }

    // 3. Pixeldrain (Formatos /u/ID, /api/file/ID, /l/ID, etc.) - Directo (0% servidor)
    if (cleanUrl.includes('pixeldrain.com')) {
      const pxMatch = cleanUrl.match(/pixeldrain\.com\/(?:u|api\/file|l)\/([a-zA-Z0-9_-]+)/i);
      if (pxMatch && pxMatch[1]) {
        return res.json({ type: 'mp4', url: `https://pixeldrain.com/api/file/${pxMatch[1]}` });
      }
    }

    // 4. Dropbox (Convertir a raw=1)
    if (cleanUrl.includes('dropbox.com')) {
      let directDropbox = cleanUrl.replace(/\?dl=[01]/, '').replace(/&dl=[01]/, '');
      directDropbox += directDropbox.includes('?') ? '&raw=1' : '?raw=1';
      return res.json({ type: 'mp4', url: directDropbox });
    }

    // 5. MediaFire (Extracción del botón #downloadButton)
    if (cleanUrl.includes('mediafire.com')) {
      const mfDirect = cleanUrl.match(/(https?:\/\/download\d+\.mediafire\.com\/[^\s"'\?#]+)/i);
      if (mfDirect && mfDirect[1]) {
        return res.json({ type: 'mp4', url: mfDirect[1] });
      }
      try {
        const html = await safeFetchHtml(cleanUrl);
        const btnMatch = html.match(/href=["'](https?:\/\/download\d+\.mediafire\.com\/[^"']+)["']/i) ||
                         html.match(/id=["']downloadButton["'][^>]*href=["']([^"']+)["']/i) ||
                         html.match(/aria-label=["']Download file["'][^>]*href=["']([^"']+)["']/i);
        if (btnMatch && btnMatch[1]) {
          console.log(`[MediaFire Extractor] Enlace directo extraído: ${btnMatch[1].substring(0, 60)}...`);
          return res.json({ type: 'mp4', url: btnMatch[1] });
        }
      } catch (eMf) {
        console.warn('Error al extraer MediaFire:', eMf.message);
      }
    }

    // 6. TeraBox (Extracción de dlink o embed streaming)
    if (cleanUrl.includes('terabox') || cleanUrl.includes('1024tera') || cleanUrl.includes('mirrobox') || cleanUrl.includes('nebulabox') || cleanUrl.includes('freeterabox')) {
      const surlMatch = cleanUrl.match(/\/s\/1?([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/surl=1?([a-zA-Z0-9_-]+)/i);
      if (surlMatch && surlMatch[1]) {
        const surl = surlMatch[1];
        try {
          const embedUrl = `https://www.terabox.com/sharing/embed?surl=${surl}`;
          const resHtml = await fetch(embedUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
          });
          const html = await resHtml.text();
          const tokenMatch = html.match(/jsToken%20%3D%20a%7D%3Bfn%28%22([^"]+)%22%29/i) || html.match(/jsToken["']?\s*:\s*["']([^"']+)["']/i);
          const jsToken = tokenMatch && tokenMatch[1] ? tokenMatch[1] : '';
          const cookies = resHtml.headers.get('set-cookie') || '';

          if (jsToken) {
            const apiUrl = `https://www.terabox.com/api/shorturlinfo?shorturl=${surl}&root=1&jsToken=${jsToken}`;
            const resApi = await fetch(apiUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Cookie': cookies,
                'Referer': embedUrl
              }
            });
            if (resApi.ok) {
              const json = await resApi.json();
              if (json && json.list && json.list.length > 0) {
                const videoFile = json.list.find(f => f.category == 1 || (f.server_filename && f.server_filename.match(/\.(mp4|mkv|webm|mov|avi)/i))) || json.list[0];
                if (videoFile && videoFile.dlink) {
                  console.log(`[TeraBox Extractor] Enlace dlink extraído con éxito: ${videoFile.dlink.substring(0, 60)}...`);
                  return res.json({ type: 'mp4', url: videoFile.dlink });
                }
              }
            }
          }
          return res.json({ type: 'mp4', url: embedUrl });
        } catch (eTera) {
          console.warn('Error al extraer TeraBox:', eTera.message);
          return res.json({ type: 'mp4', url: `https://www.terabox.com/sharing/embed?surl=${surl}` });
        }
      }
    }

    // 7. GoFile (Extracción mediante API pública de GoFile)
    if (cleanUrl.includes('gofile.io')) {
      const gfMatch = cleanUrl.match(/gofile\.io\/(?:d|c)\/([a-zA-Z0-9_-]+)/i);
      if (gfMatch && gfMatch[1]) {
        const contentId = gfMatch[1];
        try {
          // Obtener token de invitado de GoFile
          const resAcc = await fetch('https://api.gofile.io/accounts', {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Content-Type': 'application/json'
            }
          });
          const jsonAcc = await resAcc.json();
          const token = (jsonAcc && jsonAcc.data) ? jsonAcc.data.token : '';

          // Consultar contenido del archivo en GoFile
          const resCont = await fetch(`https://api.gofile.io/contents/${contentId}?wt=40149b262358`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
          });
          const jsonCont = await resCont.json();
          if (jsonCont && jsonCont.status === 'ok' && jsonCont.data) {
            const children = jsonCont.data.children || jsonCont.data.contents || {};
            const keys = Object.keys(children);
            for (const k of keys) {
              const item = children[k];
              if (item && (item.link || item.directLink)) {
                const streamUrl = item.directLink || item.link;
                console.log(`[GoFile Extractor] Stream extraído: ${streamUrl.substring(0, 60)}...`);
                return res.json({ type: 'mp4', url: streamUrl });
              }
            }
          }
        } catch (eGf) {
          console.warn('Error al extraer GoFile:', eGf.message);
        }
      }
    }

    // 7. Enlaces .m3u8 directos
    if (cleanUrl.includes('.m3u8')) {
      return res.json({ type: 'hls', url: cleanUrl });
    }

    // 8. Video directo
    if (cleanUrl.match(/\.(mp4|mkv|webm|ogv|mov)(\?.*)?$/i)) {
      return res.json({ type: 'mp4', url: cleanUrl });
    }

    // 9. Extractor HLS específico para sitios embed (MediaFire / TeraBox embeds / Vimeus)
    const resolved = await extractHlsFromEmbed(cleanUrl);
    return res.json(resolved);

  } catch (err) {
    console.error('[Resolve Media Error]:', err.message);
    res.json({ type: 'mp4', url: req.body.url });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/embed-html — HTML crudo del embed vimeos/vimeus para extraer el HLS EN
// EL NAVEGADOR. Devuelve el HTML del embed reenviando el User-Agent del cliente:
// así el token t=/s= que firma la CDN queda atado al UA del navegador y el HLS
// se puede reproducir DIRECTO CDN → navegador (0% banda del servidor, video
// limpio y sincronizable). El HTML pesa ~50KB (solo texto, no video).
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/embed-html', async (req, res) => {
  const url = ((req.body && req.body.url) || '').trim();
  if (!url) return res.status(400).json({ error: 'URL requerida' });

  try {
    // Resolver el embed vimeos real (vimeus.com → vimeos.net) desde el server
    let embedUrl = url;
    if (isVimeoFamily(url)) {
      const resolved = await resolveVimeoEmbed(url);
      if (resolved) embedUrl = resolved;
    }
    if (!isVimeoFamily(embedUrl)) {
      return res.status(400).json({ error: 'URL no soportada para extracción en navegador' });
    }

    // Reenviar el UA del navegador (clave: la CDN firma el token con este UA)
    const clientUA = (req.headers['user-agent'] && /Mozilla|Chrome|Edg|Safari|Firefox/i.test(req.headers['user-agent']))
      ? req.headers['user-agent']
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const html = await safeFetchHtml(embedUrl, embedUrl, clientUA);
    if (!html || (!html.includes('<html') && !html.includes('<script'))) {
      return res.status(502).json({ error: 'El embed no devolvió HTML válido' });
    }
    res.json({ html, embedUrl });
  } catch (err) {
    console.error('[Embed-HTML Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO — Sala de Watch Party
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id}`);

  const cleanupUserPreviousRooms = (socketId) => {
    const result = roomManager.removeUserFromRoom(socketId);
    if (result) {
      socket.leave(result.roomId);
      if (!result.roomEmpty && result.room) {
        io.to(result.roomId).emit('user_left', {
          leftSocketId: socketId,
          users: roomManager.getUsersList(result.room),
          newHostId: result.room.hostId,
          sysMessage: result.sysMessage
        });
        io.to(result.roomId).emit('voice_room_updated', {
          voiceMembers: roomManager.getVoiceMembersList(result.room),
          users: roomManager.getUsersList(result.room)
        });
      }
    }
  };

  socket.on('leave_room', (data) => {
    cleanupUserPreviousRooms(socket.id);
  });

  socket.on('create_room', (data, callback) => {
    try {
      cleanupUserPreviousRooms(socket.id);
      const room = roomManager.createRoom(socket.id, data || {});
      const addResult = roomManager.addUserToRoom(room.id, socket.id, data || {});

      socket.join(room.id);

      if (typeof callback === 'function') {
        callback({
          success: true,
          room: {
            roomId: room.id,
            user: addResult.user,
            media: room.media,
            mediaState: {
              ...room.mediaState,
              calculatedTime: roomManager.getCalculatedCurrentTime(room)
            },
            users: roomManager.getUsersList(room),
            voiceMembers: roomManager.getVoiceMembersList(room),
            chatHistory: room.chatHistory
          }
        });
      }
    } catch (err) {
      console.error('Error al crear sala:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  socket.on('join_room', (data, callback) => {
    try {
      cleanupUserPreviousRooms(socket.id);
      const { roomId, username, avatar } = data || {};
      if (!roomId) {
        if (typeof callback === 'function') return callback({ success: false, error: 'Introduce un código de sala.' });
        return;
      }

      const cleanRoomId = String(roomId).trim().toUpperCase();
      const room = roomManager.getRoom(cleanRoomId);

      if (!room) {
        if (typeof callback === 'function') {
          return callback({ success: false, error: `La sala '${cleanRoomId}' no existe o expiró.` });
        }
        return;
      }

      const addResult = roomManager.addUserToRoom(cleanRoomId, socket.id, { username, avatar });

      if (addResult.error) {
        if (typeof callback === 'function') {
          return callback({ success: false, error: addResult.error });
        }
        return;
      }

      socket.join(room.id);

      socket.to(room.id).emit('user_joined', {
        user: addResult.user,
        users: roomManager.getUsersList(room),
        sysMessage: addResult.sysMessage
      });

      io.to(room.id).emit('voice_room_updated', {
        voiceMembers: roomManager.getVoiceMembersList(room),
        users: roomManager.getUsersList(room)
      });

      if (typeof callback === 'function') {
        callback({
          success: true,
          room: {
            roomId: room.id,
            user: addResult.user,
            media: room.media,
            mediaState: {
              ...room.mediaState,
              calculatedTime: roomManager.getCalculatedCurrentTime(room)
            },
            users: roomManager.getUsersList(room),
            voiceMembers: roomManager.getVoiceMembersList(room),
            chatHistory: room.chatHistory
          }
        });
      }
    } catch (err) {
      console.error('Error al unirse a sala:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  socket.on('kick_user', (data) => {
    const { roomId, targetSocketId } = data;
    const result = roomManager.kickUser(roomId, socket.id, targetSocketId);

    if (result) {
      io.to(targetSocketId).emit('kicked_from_room', { message: 'Has sido expulsado de la sala por el Host.' });
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) targetSocket.leave(roomId);

      io.to(roomId).emit('user_left', {
        leftSocketId: targetSocketId,
        users: roomManager.getUsersList(result.room),
        newHostId: result.room.hostId,
        sysMessage: result.sysMessage
      });
    }
  });

  socket.on('media_action', (data) => {
    const { roomId, action, currentTime } = data;
    const room = roomManager.getRoom(roomId);

    if (!room || room.hostId !== socket.id) return;

    let isPlaying = room.mediaState.isPlaying;
    if (action === 'play')  isPlaying = true;
    if (action === 'pause') isPlaying = false;

    roomManager.updateMediaState(roomId, { isPlaying, currentTime });

    socket.to(roomId).emit('sync_media_action', {
      action,
      currentTime,
      isPlaying,
      triggeredBy: room.users.get(socket.id)?.username || 'Host'
    });
  });

  socket.on('request_host_sync', (data) => {
    const { roomId } = data || {};
    const room = roomManager.getRoom(roomId) || roomManager.getRoomByUser(socket.id);

    if (!room) return;

    const calcTime = roomManager.getCalculatedCurrentTime(room);
    const isPlaying = room.mediaState ? !!room.mediaState.isPlaying : false;

    socket.emit('sync_media_action', {
      action: 'sync',
      currentTime: calcTime,
      isPlaying: isPlaying,
      triggeredBy: 'Host Sync'
    });
  });

  socket.on('change_media_source', (data, callback) => {
    const { roomId, mediaUrl } = data;
    const room = roomManager.getRoom(roomId);

    if (!room || room.hostId !== socket.id) {
      if (typeof callback === 'function') callback({ success: false, error: 'Solo el Host puede cambiar la película.' });
      return;
    }

    const changeResult = roomManager.changeMediaSource(roomId, mediaUrl);

    if (!changeResult) {
      if (typeof callback === 'function') callback({ success: false, error: 'URL no válida o no soportada.' });
      return;
    }

    io.to(roomId).emit('media_source_changed', {
      media: changeResult.media,
      mediaState: changeResult.mediaState,
      changedBy: room.users.get(socket.id)?.username || 'Host',
      sysMessage: changeResult.sysMessage
    });

    if (typeof callback === 'function') callback({ success: true, media: changeResult.media });
  });

  socket.on('send_chat_message', (data) => {
    const { roomId, text, gifUrl } = data;
    const message = roomManager.addChatMessage(roomId, socket.id, { text, gifUrl });
    if (message) io.to(roomId).emit('new_chat_message', message);
  });

  socket.on('send_reaction', (data) => {
    const { roomId, emoji } = data;
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    io.to(roomId).emit('new_reaction', { emoji, user: room.users.get(socket.id) });
  });

  socket.on('react_to_chat_message', (data) => {
    const { roomId, msgId, emoji } = data;
    const room = roomManager.getRoom(roomId);
    if (!room || !room.users.has(socket.id)) return;
    const user = room.users.get(socket.id);
    const result = roomManager.toggleMessageReaction(roomId, msgId, emoji, user.username);
    if (result) {
      io.to(roomId).emit('chat_message_reaction_updated', {
        msgId,
        reactions: result.reactions,
        user: { username: user.username, socketId: socket.id },
        emoji
      });
    }
  });

  socket.on('join_voice_room', (data) => {
    const { roomId } = data;
    const result = roomManager.joinVoiceRoom(roomId, socket.id);
    if (result) {
      const payload = {
        voiceMembers: result.voiceMembers,
        users: roomManager.getUsersList(result.room)
      };
      io.to(roomId).emit('voice_room_updated', payload);
      io.to(roomId).emit('voice_members_updated', payload);
    }
  });

  socket.on('leave_voice_room', (data) => {
    const { roomId } = data;
    const result = roomManager.leaveVoiceRoom(roomId, socket.id);
    if (result) {
      const payload = {
        voiceMembers: result.voiceMembers,
        users: roomManager.getUsersList(result.room)
      };
      io.to(roomId).emit('voice_room_updated', payload);
      io.to(roomId).emit('voice_members_updated', payload);
    }
  });

  socket.on('webrtc_signal', (data) => {
    const { targetSocketId, signal } = data;
    io.to(targetSocketId).emit('webrtc_signal', {
      senderSocketId: socket.id,
      signal
    });
  });

  socket.on('voice_speaking_state', (data) => {
    const { roomId, isSpeaking, isMuted } = data;
    const room = roomManager.getRoom(roomId);
    if (!room || !room.users.has(socket.id)) return;

    const user = room.users.get(socket.id);
    user.isSpeaking = isSpeaking;
    user.isMuted = isMuted;

    const payload = {
      socketId: socket.id,
      isSpeaking,
      isMuted
    };
    socket.to(roomId).emit('user_speaking_updated', payload);
    socket.to(roomId).emit('speaking_state_changed', payload);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Desconectado: ${socket.id}`);
    const result = roomManager.removeUserFromRoom(socket.id);

    if (result && !result.roomEmpty) {
      io.to(result.roomId).emit('user_left', {
        leftSocketId: socket.id,
        users: roomManager.getUsersList(result.room),
        newHostId: result.room.hostId,
        sysMessage: result.sysMessage
      });

      io.to(result.roomId).emit('voice_room_updated', {
        voiceMembers: roomManager.getVoiceMembersList(result.room),
        users: roomManager.getUsersList(result.room)
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n===================================================`);
  console.log(`🚀 SERVIDOR DUOPLAYX INICIADO`);
  console.log(`🌐 Acceso local: http://localhost:${PORT}`);
  console.log(`📺 Google Drive: MP4 con caché de URL y seeking nativo`);
  console.log(`===================================================\n`);
});
