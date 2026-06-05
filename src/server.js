require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const { sessions } = require('./middleware/auth');
const { app, PORT, BASE_URL } = require('./app');
const { boot } = require('./config/bootstrap');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.BASE_URL || 'http://localhost:' + PORT,
    credentials: true
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('unauthorized'));
  }
  const session = sessions.get(token);
  if (!session) {
    return next(new Error('unauthorized'));
  }
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    sessions.delete(token);
    return next(new Error('session_expired'));
  }
  if (!session.permissions?.includes('responses')) {
    return next(new Error('forbidden'));
  }
  socket.adminUser = session;
  next();
});

app.set('io', io);

boot(server, PORT, BASE_URL).catch((error) => {
  console.error('Boot failed:', error);
  process.exit(1);
});
