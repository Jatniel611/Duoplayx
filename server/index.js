const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');
const roomManager = require('./roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));

// ─────────────────────────────────────────────────────────────────────────────
// PROXY DE GOOGLE DRIVE — Solo MP4 (no requiere conversión)
// Resuelve URL final (UUID/confirm tokens) con caché, reenvía Range headers
// para que el navegador pueda hacer seeking nativo en el elemento <video>
// ─────────────────────────────────────────────────────────────────────────────

// Caché de URL final resuelta por fileId (evita re-resolver en cada Range request)
// TTL: 4 horas (las URLs de Drive expiran, pero tienen vida larga)
const driveUrlCache = new Map(); // fileId → { url, cookies, expiresAt }
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function makeHttpsRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...headers
      }
    };
    const r = https.request(opts, resolve);
    r.on('error', reject);
    r.end();
  });
}

function readBody(res) {
  return new Promise(resolve => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => resolve(d));
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

// Endpoint proxy: reenvía bytes del MP4 de Drive al navegador con soporte completo
// de Range requests (necesario para que el elemento <video> pueda hacer seeking)
app.get('/api/gdrive-stream/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId) return res.status(400).json({ error: 'File ID required' });

  try {
    const driveResult = await resolveDriveUrl(fileId);

    if (driveResult.error === 'QuotaExceeded') {
      return res.status(429).json({
        error: 'Google Drive quota exceeded',
        isQuotaError: true,
        message: 'Google Drive ha bloqueado temporalmente este enlace por superar la cuota diaria de descarga.'
      });
    }

    const { url: driveUrl, cookies } = driveResult;

    // Reenviar Range header del cliente a Drive (habilita seeking nativo)
    const reqHeaders = {};
    if (cookies) reqHeaders['Cookie'] = cookies;
    if (req.headers.range) reqHeaders['Range'] = req.headers.range;

    console.log(`[GDrive Stream] ${req.headers.range || 'no range'} → ${driveUrl.substring(0, 70)}...`);

    const driveRes = await makeHttpsRequest(driveUrl, reqHeaders);
    const status = driveRes.statusCode;
    const ct = driveRes.headers['content-type'] || 'video/mp4';

    // Si Drive devuelve HTML inesperadamente, verificar cuota
    if (ct.includes('text/html')) {
      driveUrlCache.delete(fileId);
      const body = await readBody(driveRes);
      if (body.includes('Quota exceeded') || body.includes('cuota de descarga')) {
        console.warn(`[GDrive Stream] ⚠️ Quota Exceeded detectado en stream para ${fileId}`);
        return res.status(429).json({
          error: 'Google Drive quota exceeded',
          isQuotaError: true,
          message: 'Se ha superado la cuota de descarga de este archivo en Google Drive.'
        });
      }
      console.error('[GDrive Stream] Got HTML, cache invalidated. Preview:', body.substring(0, 150));
      return res.status(502).json({ error: 'Drive devolvió HTML. Reintenta.' });
    }

    // Construir headers de respuesta
    const resHeaders = {
      'Content-Type': 'video/mp4',  // Siempre MP4 para el navegador
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    };

    if (driveRes.headers['content-length'])  resHeaders['Content-Length']  = driveRes.headers['content-length'];
    if (driveRes.headers['content-range'])   resHeaders['Content-Range']   = driveRes.headers['content-range'];

    // 206 Partial si Drive respondió 206, 200 en otro caso
    res.writeHead(status === 206 ? 206 : 200, resHeaders);
    driveRes.pipe(res);

    req.on('close', () => driveRes.destroy());

  } catch (err) {
    console.error('[GDrive Stream Error]:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO — Sala de Watch Party
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id}`);

  socket.on('create_room', (data, callback) => {
    try {
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
      const { roomId, username, avatar } = data;
      const room = roomManager.getRoom(roomId);

      if (!room) {
        if (typeof callback === 'function') {
          return callback({ success: false, error: 'La sala especificada no existe.' });
        }
        return;
      }

      const addResult = roomManager.addUserToRoom(roomId, socket.id, { username, avatar });

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

  socket.on('join_voice_room', (data) => {
    const { roomId } = data;
    const result = roomManager.joinVoiceRoom(roomId, socket.id);
    if (result) {
      io.to(roomId).emit('voice_room_updated', {
        voiceMembers: result.voiceMembers,
        users: roomManager.getUsersList(result.room)
      });
    }
  });

  socket.on('leave_voice_room', (data) => {
    const { roomId } = data;
    const result = roomManager.leaveVoiceRoom(roomId, socket.id);
    if (result) {
      io.to(roomId).emit('voice_room_updated', {
        voiceMembers: result.voiceMembers,
        users: roomManager.getUsersList(result.room)
      });
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

    socket.to(roomId).emit('user_speaking_updated', {
      socketId: socket.id,
      isSpeaking,
      isMuted
    });
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
