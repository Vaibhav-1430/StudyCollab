const path = require('path');
const http = require('http');
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDB = require('./config/db');
const rateLimit = require('./middleware/rateLimit');
const errorHandler = require('./middleware/error');

dotenv.config();
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
app.use(
  cors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
      : true,
    credentials: true
  })
);
app.use(morgan('dev'));
app.use(rateLimit);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/files', require('./routes/files'));
app.use('/api/whiteboard', require('./routes/whiteboard'));
app.use('/api/config', require('./routes/config'));

const publicDir = path.join(__dirname, '..', 'public');
app.get('/login', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register', (req, res) =>
  res.sendFile(path.join(publicDir, 'register.html'))
);
app.get('/dashboard', (req, res) =>
  res.sendFile(path.join(publicDir, 'dashboard.html'))
);
app.get('/room/:code', (req, res) =>
  res.sendFile(path.join(publicDir, 'room.html'))
);

app.use(errorHandler);

const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
      : true,
    credentials: true
  }
});

app.set('io', io);
require('./socket')(io);

const PORT = process.env.PORT || 4000;

const bootstrap = async () => {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

bootstrap();
