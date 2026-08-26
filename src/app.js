const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
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

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// جلوگیری از NoSQL Injection
app.use(mongoSanitize());

// جلوگیری از XSS - sanitize دستی روی body
app.use((req, res, next) => {
  if (req.body) {
    const sanitizeValue = (value) => {
      if (typeof value === 'string') return xss(value);
      if (typeof value === 'object' && value !== null) {
        Object.keys(value).forEach(key => {
          value[key] = sanitizeValue(value[key]);
        });
      }
      return value;
    };
    req.body = sanitizeValue(req.body);
  }
  next();
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

app.use('/api/auth', authLimiter, authRoutes);
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
