const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Route imports
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const agentRoutes = require('./routes/agents');
const chatRoutes = require('./routes/chats');
const businessRoutes = require('./routes/business');
const superAdminRoutes = require('./routes/superAdmin');

const app = express();
const server = http.createServer(app);

// ─── CORS — must be FIRST before everything ───────────────────────────────────
const corsOptions = {
  origin: function(origin, callback) {
    // Allow all origins
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});
global.io = io;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false }));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'MSChat API by MS Discoveries' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/super-admin', superAdminRoutes);

// ─── DEBUG ROUTES (temp) ──────────────────────────────────────────────────────
try {
  app.use('/debug', require('./routes/debug'));
} catch(e) { console.log('Debug routes not loaded'); }

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── SOCKET.IO EVENTS ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('agent:join', ({ agent_id, business_id }) => {
    socket.join(`business:${business_id}`);
    socket.join(`agent:${agent_id}`);
    console.log(`👤 Agent ${agent_id} joined`);
  });

  socket.on('visitor:join', ({ chat_id, business_id }) => {
    socket.join(`chat:${chat_id}`);
    socket.to(`business:${business_id}`).emit('new:chat', { chat_id });
  });

  socket.on('agent:accept', ({ chat_id, agent_id }) => {
    socket.join(`chat:${chat_id}`);
    io.to(`chat:${chat_id}`).emit('chat:accepted', { agent_id, chat_id });
  });

  socket.on('message:send', (data) => {
    io.to(`chat:${data.chat_id}`).emit('message:received', data);
  });

  socket.on('typing:start', ({ chat_id, sender_type }) => {
    socket.to(`chat:${chat_id}`).emit('typing:start', { sender_type });
  });

  socket.on('typing:stop', ({ chat_id }) => {
    socket.to(`chat:${chat_id}`).emit('typing:stop');
  });

  socket.on('agent:status', ({ agent_id, business_id, status }) => {
    socket.to(`business:${business_id}`).emit('agent:status_changed', { agent_id, status });
  });

  socket.on('chat:resolve', ({ chat_id, business_id }) => {
    io.to(`chat:${chat_id}`).emit('chat:resolved', { chat_id });
    io.to(`business:${business_id}`).emit('chat:resolved', { chat_id });
  });

  socket.on('disconnect', () => {
    console.log('🔌 Socket disconnected:', socket.id);
  });
});

// ─── CRON JOBS ────────────────────────────────────────────────────────────────
try { require('./utils/cron'); } catch(e) { console.error('Cron error:', e.message); }

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 MSChat API running on port ${PORT}`);
  console.log(`📧 Admin: ${process.env.SUPER_ADMIN_EMAIL}`);
});
