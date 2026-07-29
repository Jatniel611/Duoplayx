/**
 * RoomManager - Administra el estado de las salas, expulsión de usuarios, canal de voz y chat
 * Streaming de Google Drive Garantizado en HTML5 Nativo
 */

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  parseMediaSource(mediaInput) {
    if (!mediaInput) return null;

    if (typeof mediaInput === 'object') {
      return mediaInput;
    }

    if (typeof mediaInput !== 'string') return null;
    let url = mediaInput.trim();

    // 1. Google Drive
    const gdriveRegex = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/file\/d\/)([a-zA-Z0-9_-]+)/;
    const gdriveMatch = url.match(gdriveRegex);

    if (gdriveMatch && gdriveMatch[1]) {
      const fileId = gdriveMatch[1];
      return {
        type: 'gdrive',
        url: `/api/gdrive-stream/${fileId}`,
        rawUrl: url,
        fileId: fileId,
        isGDrive: true
      };
    }

    // 2. YouTube
    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const ytMatch = url.match(ytRegex);

    if (ytMatch && ytMatch[1]) {
      return { type: 'youtube', url: url, videoId: ytMatch[1] };
    }

    // 3. Pixeldrain (convertir /u/ID a /api/file/ID)
    if (url.includes('pixeldrain.com')) {
      if (url.includes('/u/')) {
        const fileId = url.split('/u/')[1].split('/')[0].split('?')[0];
        url = `https://pixeldrain.com/api/file/${fileId}`;
      }
      return { type: 'mp4', url: url };
    }

    // 4. Enlaces HLS .m3u8
    if (url.includes('.m3u8')) {
      return { type: 'hls', url: url };
    }

    // 5. Detección de MP4 u otros formatos directos (incluyendo enlaces API como pixeldrain.com/api/file/...)
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
      return { type: 'mp4', url: url };
    }

    return null;
  }

  createRoom(hostSocketId, options = {}) {
    const roomId = options.roomId ? options.roomId.toUpperCase() : this.generateRoomCode();
    
    const defaultMedia = this.parseMediaSource(options.mediaUrl || 'https://www.youtube.com/watch?v=5qap5aO4i9A') || {
      type: 'youtube',
      url: 'https://www.youtube.com/watch?v=5qap5aO4i9A',
      videoId: '5qap5aO4i9A'
    };

    const room = {
      id: roomId,
      hostId: hostSocketId,
      hostControlsOnly: true,
      media: defaultMedia,
      mediaState: {
        isPlaying: false,
        currentTime: 0,
        lastUpdatedTimestamp: Date.now()
      },
      users: new Map(),
      voiceUsers: new Set(),
      bannedSockets: new Set(),
      chatHistory: []
    };

    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    if (!roomId || typeof roomId !== 'string') return null;
    return this.rooms.get(roomId.trim().toUpperCase());
  }

  addUserToRoom(roomId, socketId, userData) {
    const room = this.getRoom(roomId);
    if (!room) return { error: 'La sala especificada no existe.' };

    if (room.bannedSockets.has(socketId)) {
      return { error: 'Has sido expulsado/baneado de esta sala.' };
    }

    const isHost = room.users.size === 0 || room.hostId === socketId;
    if (isHost) room.hostId = socketId;

    const user = {
      socketId,
      username: userData.username || `Usuario-${socketId.substr(0, 4)}`,
      avatar: userData.avatar || '⚡',
      isHost,
      inVoiceRoom: true,
      isMuted: true,
      isSpeaking: false,
      joinedAt: Date.now()
    };

    room.users.set(socketId, user);
    room.voiceUsers.add(socketId);

    const sysMessage = {
      id: Date.now() + Math.random().toString(),
      user: { username: 'Sistema', avatar: '🤖' },
      text: `${user.username} se ha unido a la sala 🎉`,
      timestamp: Date.now(),
      type: 'system'
    };
    room.chatHistory.push(sysMessage);
    if (room.chatHistory.length > 100) room.chatHistory.shift();

    return { room, user, sysMessage };
  }

  kickUser(roomId, hostSocketId, targetSocketId) {
    const room = this.getRoom(roomId);
    if (!room || room.hostId !== hostSocketId) return null;
    if (!room.users.has(targetSocketId)) return null;

    const targetUser = room.users.get(targetSocketId);
    room.users.delete(targetSocketId);
    room.voiceUsers.delete(targetSocketId);
    room.bannedSockets.add(targetSocketId);

    const sysMessage = {
      id: Date.now() + Math.random().toString(),
      user: { username: 'Sistema', avatar: '🛑' },
      text: `El Host expulsó a ${targetUser.username} de la sala.`,
      timestamp: Date.now(),
      type: 'system'
    };
    room.chatHistory.push(sysMessage);

    return { room, kickedUser: targetUser, sysMessage };
  }

  joinVoiceRoom(roomId, socketId, isMuted = false) {
    const room = this.getRoom(roomId);
    if (!room || !room.users.has(socketId)) return null;

    room.voiceUsers.add(socketId);
    const user = room.users.get(socketId);
    user.inVoiceRoom = true;
    user.isMuted = !!isMuted;

    return { room, voiceMembers: this.getVoiceMembersList(room) };
  }

  leaveVoiceRoom(roomId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    room.voiceUsers.delete(socketId);
    if (room.users.has(socketId)) {
      const user = room.users.get(socketId);
      user.inVoiceRoom = false;
      user.isMuted = true;
      user.isSpeaking = false;
    }

    return { room, voiceMembers: this.getVoiceMembersList(room) };
  }

  getVoiceMembersList(room) {
    const list = [];
    room.voiceUsers.forEach(socketId => {
      if (room.users.has(socketId)) {
        list.push(room.users.get(socketId));
      }
    });
    return list;
  }

  removeUserFromRoom(socketId) {
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.users.has(socketId)) {
        const user = room.users.get(socketId);
        room.users.delete(socketId);
        room.voiceUsers.delete(socketId);

        if (room.users.size === 0) {
          this.rooms.delete(roomId);
          return { roomId, user: null, roomEmpty: true };
        }

        if (room.hostId === socketId) {
          const nextSocketId = room.users.keys().next().value;
          room.hostId = nextSocketId;
          const newHost = room.users.get(nextSocketId);
          newHost.isHost = true;
        }

        const sysMessage = {
          id: Date.now() + Math.random().toString(),
          user: { username: 'Sistema', avatar: '🤖' },
          text: `${user.username} ha salido de la sala 👋`,
          timestamp: Date.now(),
          type: 'system'
        };
        room.chatHistory.push(sysMessage);

        return { roomId, user, roomEmpty: false, room };
      }
    }
    return null;
  }

  updateMediaState(roomId, stateUpdate) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    if (typeof stateUpdate.isPlaying === 'boolean') {
      room.mediaState.isPlaying = stateUpdate.isPlaying;
    }
    if (typeof stateUpdate.currentTime === 'number') {
      room.mediaState.currentTime = stateUpdate.currentTime;
    }

    room.mediaState.lastUpdatedTimestamp = Date.now();
    return room.mediaState;
  }

  getCalculatedCurrentTime(room) {
    if (!room.mediaState.isPlaying) {
      return room.mediaState.currentTime;
    }
    const elapsedSeconds = (Date.now() - room.mediaState.lastUpdatedTimestamp) / 1000;
    return room.mediaState.currentTime + elapsedSeconds;
  }

  changeMediaSource(roomId, newUrl) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const parsedMedia = this.parseMediaSource(newUrl);
    if (!parsedMedia) return null;

    room.media = parsedMedia;
    room.mediaState = {
      isPlaying: true,
      currentTime: 0,
      lastUpdatedTimestamp: Date.now()
    };

    let mediaTypeName = 'Video MP4';
    if (parsedMedia.type === 'youtube') mediaTypeName = 'YouTube';
    else if (parsedMedia.isGDrive) mediaTypeName = 'Google Drive Video 📁';

    const sysMessage = {
      id: Date.now() + Math.random().toString(),
      user: { username: 'Sistema', avatar: '🎬' },
      text: `El Host cambió la película a: ${mediaTypeName}`,
      timestamp: Date.now(),
      type: 'system'
    };
    room.chatHistory.push(sysMessage);

    return { media: room.media, mediaState: room.mediaState, sysMessage };
  }

  addChatMessage(roomId, socketId, messageData) {
    const room = this.getRoom(roomId);
    if (!room || !room.users.has(socketId)) return null;

    const user = room.users.get(socketId);
    const text = typeof messageData.text === 'string' ? messageData.text.trim() : '';
    const gifUrl = typeof messageData.gifUrl === 'string' ? messageData.gifUrl.trim() : null;

    if (!text && !gifUrl) return null;

    const message = {
      id: Date.now() + Math.random().toString(),
      user: {
        username: user.username,
        avatar: user.avatar,
        isHost: user.isHost
      },
      text: text.substring(0, 500),
      gifUrl: gifUrl,
      timestamp: Date.now(),
      type: gifUrl ? 'gif' : 'chat'
    };

    room.chatHistory.push(message);
    if (room.chatHistory.length > 100) room.chatHistory.shift();

    return message;
  }

  toggleMessageReaction(roomId, msgId, emoji, username) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const msg = room.chatHistory.find(m => m.id === msgId);
    if (!msg) return null;

    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const idx = msg.reactions[emoji].indexOf(username);
    if (idx !== -1) {
      msg.reactions[emoji].splice(idx, 1);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji].push(username);
    }

    return { msgId, reactions: msg.reactions };
  }

  getUsersList(room) {
    if (!room || !room.users) return [];
    return Array.from(room.users.values());
  }

  getVoiceMembersList(room) {
    if (!room || !room.voiceUsers) return [];
    return Array.from(room.voiceUsers).map(socketId => {
      const u = room.users.get(socketId);
      return u ? { socketId: u.socketId, username: u.username, avatar: u.avatar, isMuted: u.isMuted, isSpeaking: u.isSpeaking } : null;
    }).filter(Boolean);
  }
}

module.exports = new RoomManager();
