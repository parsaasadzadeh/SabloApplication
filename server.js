require('dotenv').config();
const app = require('./src/app');
const startCronJobs = require('./src/utils/cronJobs');

const PORT = process.env.PORT

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.message);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  startCronJobs();
});
