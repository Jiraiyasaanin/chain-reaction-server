const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Store rooms
// Room = { id, status: 'waiting' | 'playing', players: [{ id, name, colorIndex }], numPlayers, host }
const rooms = new Map();
const disconnectTimers = new Map();

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', ({ name, numPlayers, userId }) => {
    const roomId = generateRoomCode();
    const player = { id: socket.id, userId, name, colorIndex: 0 };
    
    rooms.set(roomId, {
      id: roomId,
      status: 'waiting',
      players: [player],
      numPlayers,
      host: socket.id
    });

    socket.join(roomId);
    socket.emit('room_created', { roomId, player, room: rooms.get(roomId) });
  });

  socket.on('join_room', ({ roomId, name, userId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      return socket.emit('error', 'Room not found');
    }
    if (room.status !== 'waiting') {
      return socket.emit('error', 'Game already in progress');
    }
    if (room.players.length >= room.numPlayers) {
      return socket.emit('error', 'Room is full');
    }

    const colorIndex = room.players.length;
    const player = { id: socket.id, userId, name, colorIndex };
    room.players.push(player);

    socket.join(roomId);
    socket.emit('room_joined', { roomId, player, room });
    socket.to(roomId).emit('player_joined', { player, room });
  });

  socket.on('start_game', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.host === socket.id) {
      room.status = 'playing';
      io.to(roomId).emit('game_started', { room });
    }
  });

  socket.on('make_move', ({ roomId, row, col }) => {
    // Relying on deterministic client lockstep for zero-lag animations.
    // The server relays the move to all clients in the room.
    io.to(roomId).emit('move_made', { row, col, playerId: socket.id });
  });

  socket.on('reset_game', ({ roomId }) => {
    io.to(roomId).emit('game_reset');
  });

  socket.on('return_to_lobby', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.status = 'waiting';
      io.to(roomId).emit('returned_to_lobby', { room });
    }
  });

  socket.on('rejoin_room', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.userId === userId);
    if (player) {
      if (disconnectTimers.has(userId)) {
        clearTimeout(disconnectTimers.get(userId));
        disconnectTimers.delete(userId);
      }
      
      if (room.host === player.id) {
         room.host = socket.id;
      }
      player.id = socket.id;
      socket.join(roomId);
      
      socket.emit('rejoined_room', { room, player });
      socket.to(roomId).emit('player_joined', { player, room });
    }
  });

  socket.on('disconnect', () => {
    let disconnectedPlayer = null;
    let disconnectedRoomId = null;
    for (const [roomId, room] of rooms.entries()) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        disconnectedPlayer = player;
        disconnectedRoomId = roomId;
        break;
      }
    }

    if (disconnectedPlayer) {
      const timer = setTimeout(() => {
        const room = rooms.get(disconnectedRoomId);
        if (room) {
          const pIdx = room.players.findIndex(p => p.userId === disconnectedPlayer.userId);
          if (pIdx !== -1) {
            room.players.splice(pIdx, 1);
            if (room.players.length === 0) {
              rooms.delete(disconnectedRoomId);
            } else {
              if (room.host === disconnectedPlayer.id) {
                room.host = room.players[0].id;
              }
              io.to(disconnectedRoomId).emit('player_left', { id: disconnectedPlayer.id, room });
            }
          }
        }
        disconnectTimers.delete(disconnectedPlayer.userId);
      }, 60000); // 60 seconds grace period
      
      disconnectTimers.set(disconnectedPlayer.userId, timer);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
