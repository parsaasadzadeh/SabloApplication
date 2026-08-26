const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

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

// ✅ CORS باز برای React Native — امنیت رو JWT انجام میده
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ✅ جلوگیری از ویروس دیتابیس
app.use(mongoSanitize());

// ✅ جلوگیری از XSS
app.use(xss());

// ✅ Rate limiting
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
