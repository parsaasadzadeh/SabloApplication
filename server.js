require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db');
const startCronJobs = require('./src/utils/cronJobs');

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        
        // روشن کردن کارگر همیشه بیدار سرور برای اقساط
        startCronJobs(); 
    });
});