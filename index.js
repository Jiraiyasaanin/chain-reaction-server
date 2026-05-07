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

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', ({ name, numPlayers }) => {
    const roomId = generateRoomCode();
    const player = { id: socket.id, name, colorIndex: 0 };
    
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

  socket.on('join_room', ({ roomId, name }) => {
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
    const player = { id: socket.id, name, colorIndex };
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

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove player from rooms
    for (const [roomId, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          // If host left, reassign host
          if (room.host === socket.id) {
            room.host = room.players[0].id;
          }
          io.to(roomId).emit('player_left', { id: socket.id, room });
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
