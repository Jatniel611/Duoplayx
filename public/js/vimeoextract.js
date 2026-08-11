// ─────────────────────────────────────────────────────────────────────────────
// VimeoExtractor — extrae el HLS de embeds vimeus/vimeos EN EL NAVEGADOR.
//
// Por qué: la CDN de vimeos (s13/s8.vimeos.net, p2/p3.vimeos.zip) firma el token
// t=/s= del master .m3u8 con el User-Agent del que pide el HTML del embed.
// Si el server extrae el HLS (con su UA), el navegador (otro UA) recibe 403.
// La única forma de reproducir directo CDN → navegador (0% banda del servidor,
// video limpio y sincronizable) es que CADA navegador pida su propio HTML del
// embed a /api/embed-html (que reenvía el UA del cliente), desempaquete el JS y
// extraiga el master con un token válido para SU UA.
//
// Uso: const master = await VimeoExtractor.extractVimeos(embedUrl);
//      playerManager._playHLSStream(master, embedUrl, autoPlay);
// ─────────────────────────────────────────────────────────────────────────────
window.VimeoExtractor = (function () {
  'use strict';

  // Desempaquetador Dean Edwards SIN vm (decoder manual, funciona en navegador)
  function unpackDeanEdwardsJs(code) {
    if (!code || typeof code !== 'string') return code;
    try {
      var evalRegex = /eval\(function\(p,a,c,k,e,d\)[\s\S]+?\.split\('\|'\)\s*\)\s*\)/g;
      var matches = code.match(evalRegex);
      if (!matches) return code;

      var unpackedAll = code;
      for (var i = 0; i < matches.length; i++) {
        var packedSnippet = matches[i];
        var parts = packedSnippet.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
        if (!parts) continue;
        var p = parts[1];
        var a = parseInt(parts[2], 10);
        var c = parseInt(parts[3], 10);
        var k = parts[4].split('|');
        var ef = function (ch) {
          return (ch < a ? '' : ef(Math.floor(ch / a))) + ((ch = ch % a) > 35 ? String.fromCharCode(ch + 29) : ch.toString(36));
        };
        while (c--) {
          if (k[c]) {
            p = p.replace(new RegExp('\\b' + ef(c) + '\\b', 'g'), k[c]);
          }
        }
        unpackedAll += '\n' + p;
      }
      return unpackedAll;
    } catch (err) {
      return code;
    }
  }

  // Encuentra la URL .m3u8 / .urlset/master en HTML o JS desempaquetado
  function findM3u8Url(text) {
    if (!text || typeof text !== 'string') return null;
    var m = text.match(/(https?:[\\\/][\\\/][^"'`\s>]+\.(?:m3u8|urlset)[^"'`\s>]*)/i) ||
           text.match(/file:\s*["']([^"']+\.(?:m3u8|urlset)[^"']*)["']/i) ||
           text.match(/source:\s*["']([^"']+\.(?:m3u8|urlset)[^"']*)["']/i) ||
           text.match(/src:\s*["']([^"']+\.(?:m3u8|urlset)[^"']*)["']/i);
    if (!m) return null;
    var url = (m[1] || m[0]).replace(/\\/g, '');
    if (url.indexOf('//') === 0) url = 'https:' + url;
    return url;
  }

  // URL absoluta de /api/... contra el origen del socket (funciona en APK/Electron)
  function apiUrl(path) {
    if (window.socketManager && typeof window.socketManager.resolveMediaUrl === 'function') {
      return window.socketManager.resolveMediaUrl(path);
    }
    return path;
  }

  // Pide el HTML crudo del embed a /api/embed-html (el server reenvía el UA del navegador)
  async function fetchEmbedHtml(embedUrl) {
    const res = await fetch(apiUrl('/api/embed-html'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: embedUrl })
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data || data.error) {
      throw new Error((data && data.error) || ('HTTP ' + res.status));
    }
    return { html: data.html, embedUrl: data.embedUrl || embedUrl };
  }

  // Extrae la URL del master m3u8 (token firmado para el UA de ESTE navegador)
  async function extractVimeos(embedUrl) {
    const { html } = await fetchEmbedHtml(embedUrl);
    const unpacked = unpackDeanEdwardsJs(html);
    const master = findM3u8Url(unpacked);
    if (!master) {
      throw new Error('No se encontró el HLS en el embed (' + embedUrl.substring(0, 60) + ')');
    }
    return master;
  }

  // Comprueba si el CDN acepta ESTE navegador con el token extraído (el CDN
  // sirve ACAO:* → fetch CORS directo). 200 = puede reproducir directo; 403 =
  // token honeypot (nube) → el navegador debe caer a iframe del embed.
  async function checkMaster(masterUrl) {
    try {
      const res = await fetch(masterUrl, { mode: 'cors', cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        return text.indexOf('#EXTM3U') === 0;
      }
      console.warn('[Vimeo] checkMaster:', res.status);
      return false;
    } catch (err) {
      console.warn('[Vimeo] checkMaster error:', err.message);
      return false;
    }
  }

  return {
    unpackDeanEdwardsJs: unpackDeanEdwardsJs,
    findM3u8Url: findM3u8Url,
    fetchEmbedHtml: fetchEmbedHtml,
    extractVimeos: extractVimeos,
    checkMaster: checkMaster
  };
})();
