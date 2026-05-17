import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

// 1. Load Unified Env Variables from Root
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

// 2. Configure Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : '*',
    methods: ['GET', 'POST']
  }
});

// 3. Security Headers for SharedArrayBuffer (COOP / COEP)
// This is essential to enable high-performance multi-threaded memory buffer sharing!
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// 4. Standard Express Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 5. Connect to MongoDB (Graceful Database Sync)
const MONGODB_ENABLED = process.env.MONGODB_ENABLED === 'true' || process.env.NODE_ENV === 'production';
if (MONGODB_ENABLED) {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dawnhold';
  mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2000 })
    .then(() => console.log('📁 Database: Connected to MongoDB successfully.'))
    .catch((err) => {
      console.warn('⚠️ Database Warning: MongoDB connection failed.', err.message);
      console.warn('💡 Game server will continue running, but persistent saves/users will be disabled.');
    });
} else {
  console.log('📁 Database: MongoDB is disabled locally. Running in pure offline mode.');
}

// 6. Production Static Serving
if (process.env.NODE_ENV === 'production') {
  console.log('🚀 Production Mode: Serving static assets from frontend/dist.');
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
}

// 7. Base API Route Placeholder
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    project: 'Dawnhold',
    version: '1.0.0',
    databaseConnected: mongoose.connection.readyState === 1
  });
});

app.post('/api/log-error', (req, res) => {
  console.error('\n🔴🔴 BROWSER RUNTIME ERROR RECEIVED 🔴🔴');
  console.error(JSON.stringify(req.body, null, 2));
  console.error('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴\n');
  res.sendStatus(200);
});

// 8. Socket.io Real-time Command & Lobby Handler
io.on('connection', (socket) => {
  console.log(`🔌 Socket: User connected [ID: ${socket.id}]`);

  // Relay deterministic multiplayer input commands to all players in the game room
  socket.on('game-command', (data) => {
    // data structure: { roomId, playerId, tick, type: 'CMD_PLACE_BUILDING', payload: {...} }
    if (data.roomId) {
      socket.to(data.roomId).emit('game-command', data);
    }
  });

  // Handle player joining a specific match room / lobby
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`🔌 Socket: User ${socket.id} joined room [${roomId}]`);
    io.to(roomId).emit('player-joined', { playerId: socket.id });
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket: User disconnected [ID: ${socket.id}]`);
  });
});

// 9. SPA Catch-all (must be after other routes)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
    }
  });
}

// 10. Start Server
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(`☀️  DAWNHOLD GAME SERVER RUNNING`);
  console.log(`🟢 Address: http://localhost:${PORT}`);
  console.log(`🟢 Network: http://0.0.0.0:${PORT}`);
  console.log(`🟢 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`===================================================`);
});
// Trigger dev server reload
