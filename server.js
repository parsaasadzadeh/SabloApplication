require('dotenv').config();
const app = require('./src/app');

const startCronJobs = require('./src/utils/cronJobs');

const PORT = process.env.PORT || 5000;


    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        
        // روشن کردن کارگر همیشه بیدار سرور برای اقساط
        startCronJobs(); 
    });
