const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const financeRoutes = require('./routes/financeRoutes');
const notificationRoutes = require('./routes/notificationRoutes'); 
const cronRoutes = require('./routes/cronRoutes'); 
const connectDB = require('./config/db');


connectDB()
const app = express();

app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/cron', cronRoutes);  
module.exports = app;
