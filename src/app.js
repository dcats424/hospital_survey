require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const { helmetConfig } = require('./middleware/security');
const { sanitizeResponses, globalErrorHandler } = require('./middleware/errorHandler');
const { registerAll } = require('./routes');
const { tempDir } = require('./utils/constants');

const app = express();
app.disable('x-powered-by');

app.use(helmetConfig);
app.use(compression());
app.use(cors({
  origin: (process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, ''),
  credentials: true
}));
app.use(sanitizeResponses);

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || ('http://localhost:' + PORT)).replace(/\/$/, '');
const FRONTEND_DIST = path.join(__dirname, '../public/app');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];

const upload = multer({
  dest: tempDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed: ' + file.mimetype));
    }
  }
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const STATIC_MAX_AGE = process.env.NODE_ENV === 'production' ? '1y' : '0';
app.use(express.static(FRONTEND_DIST, { maxAge: STATIC_MAX_AGE }));
app.use(express.static(path.join(__dirname, '../public'), { maxAge: STATIC_MAX_AGE }));

if (process.env.NODE_ENV === 'production') {
  app.enable('trust proxy');
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'https' || req.secure) return next();
    const host = req.headers['host'] || req.hostname;
    res.redirect(301, 'https://' + host + req.originalUrl);
  });
}

app.get('/favicon.ico', (req, res) => res.status(204).end());

registerAll(app, { FRONTEND_DIST, BASE_URL, upload });

app.use(globalErrorHandler);

module.exports = { app, PORT, BASE_URL };
