const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
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

  // En el servidor remoto en la nube (Render), redirigir directamente para 0% consumo de ancho de banda
  if (!isLocalhostRequest(req)) {
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

// Proxy HLS inteligente (Localhost = Proxy completo local / Render = 302 Directo en 0%)
app.get('/api/hls-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const referer = req.query.referer || targetUrl;

  if (!targetUrl) return res.status(400).send('URL required');

  const isLocal = isLocalhostRequest(req);

  // Si no es local y es un segmento de video binario (.ts / .m4s / .mp4), redirigir directamente para 0% en Render
  if (!isLocal && (targetUrl.includes('.ts') || targetUrl.includes('.m4s') || targetUrl.includes('.mp4'))) {
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

        // Si es local, canalizar los segmentos por el proxy de localhost. Si es Render, usar URL directa.
        return isLocal 
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

    res.writeHead(status === 206 ? 206 : 200, {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    });
    proxyRes.pipe(res);

  } catch (err) {
    console.error('[HLS Proxy Error]:', err.message);
    res.redirect(302, targetUrl);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTOR SEGURIZADO DE HLS / M3U8 Y PROXY DE STREAMING
// ─────────────────────────────────────────────────────────────────────────────

async function safeFetchHtml(targetUrl, referer) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const domain = new URL(targetUrl).origin;
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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

async function extractHlsFromEmbed(embedUrl) {
  try {
    let targetUrl = embedUrl.trim();
    if (targetUrl.includes('vimeus.com/v/')) {
      targetUrl = targetUrl.replace('vimeus.com/v/', 'vimeus.com/e/');
    }
    if (targetUrl.includes('vimeos.net/v/')) {
      targetUrl = targetUrl.replace('vimeos.net/v/', 'vimeos.net/e/');
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

    // 1. Buscar .m3u8
    const m3u8Match = html.match(/(https?:[\\\/][\\\/][^"'`\s>]+\.m3u8[^"'`\s>]*)/i) ||
                      html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                      html.match(/source:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                      html.match(/src:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (m3u8Match) {
      let hlsUrl = (m3u8Match[1] || m3u8Match[0]).replace(/\\/g, '');
      if (hlsUrl.startsWith('//')) hlsUrl = 'https:' + hlsUrl;
      return { type: 'hls', url: hlsUrl, referer: targetUrl };
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

        const innerM3u8 = innerHtml.match(/(https?:[\\\/][\\\/][^"'`\s>]+\.m3u8[^"'`\s>]*)/i) ||
                          innerHtml.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i);
        if (innerM3u8) {
          let hlsUrl = (innerM3u8[1] || innerM3u8[0]).replace(/\\/g, '');
          if (hlsUrl.startsWith('//')) hlsUrl = 'https:' + hlsUrl;
          return { type: 'hls', url: hlsUrl, referer: iframeSrc };
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

    // 6. TeraBox (Extracción automática de API /shorturlinfo)
    if (cleanUrl.includes('terabox') || cleanUrl.includes('1024tera') || cleanUrl.includes('mirrobox') || cleanUrl.includes('nebulabox') || cleanUrl.includes('freeterabox')) {
      const surlMatch = cleanUrl.match(/\/s\/1?([a-zA-Z0-9_-]+)/i);
      if (surlMatch && surlMatch[1]) {
        const surl = surlMatch[1];
        try {
          const apiUrl = `https://www.terabox.com/api/shorturlinfo?shorturl=${surl}&root=1`;
          const resApi = await fetch(apiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
          });
          if (resApi.ok) {
            const json = await resApi.json();
            if (json && json.list && json.list.length > 0) {
              const videoFile = json.list.find(f => f.category == 1 || (f.server_filename && f.server_filename.match(/\.(mp4|mkv|webm|mov|avi)/i))) || json.list[0];
              if (videoFile && videoFile.dlink) {
                console.log(`[TeraBox Extractor] Enlace dlink extraído: ${videoFile.dlink.substring(0, 60)}...`);
                return res.json({ type: 'mp4', url: videoFile.dlink });
              }
            }
          }
        } catch (eTera) {
          console.warn('Error al extraer TeraBox:', eTera.message);
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
