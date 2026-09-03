const express = require('express');
const helmet = require('helmet');
const xss = require('xss');
const authRoutes = require('./routes/authRoutes');
const financeRoutes = require('./routes/financeRoutes');
const aiRoutes = require('./routes/aiRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const versionRoutes = require('./routes/version.routes');
const cronRoutes = require('./routes/cronRoutes');
const goalRoutes = require('./routes/goalRoutes');
const connectDB = require('./config/db');

connectDB();

const app = express();

app.use(helmet());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// جلوگیری از NoSQL Injection
app.use((req, res, next) => {
  const sanitizeObject = (obj) => {
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(key => {
        if (key.startsWith('$') || key.includes('.')) {
          delete obj[key];
        } else {
          sanitizeObject(obj[key]);
        }
      });
    }
  };
  if (req.body) sanitizeObject(req.body);
  next();
});

// جلوگیری از XSS
app.use((req, res, next) => {
  const sanitizeValue = (value) => {
    if (typeof value === 'string') return xss(value);
    if (typeof value === 'object' && value !== null) {
      Object.keys(value).forEach(key => {
        value[key] = sanitizeValue(value[key]);
      });
    }
    return value;
  };
  if (req.body) req.body = sanitizeValue(req.body);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/version', versionRoutes);
app.use('/api/goals', goalRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: 'Internal Server Error' });
});

module.exports = app;
