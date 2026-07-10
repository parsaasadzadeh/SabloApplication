const cron = require("node-cron");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

function diffDays(date){

    const today=new Date();
    today.setHours(0,0,0,0);

    const due=new Date(date);
    due.setHours(0,0,0,0);

    return Math.floor(
        (due-today)/(1000*60*60*24)
    );

}

const createNotification=async(transaction,stage)=>{

    const exists=await Notification.findOne({
        relatedTransactionId:transaction._id,
        stage
    });

    if(exists) return;

    let title="یادآوری پرداخت قسط";

    let message="";

    if(stage==="3days"){
        message=`تنها ۳ روز تا سررسید قسط ${transaction.amount.toLocaleString()} تومان باقی مانده است.`;
    }

    if(stage==="1day"){
        message=`فقط ۱ روز تا سررسید قسط ${transaction.amount.toLocaleString()} تومان باقی مانده است.`;
    }

    if(stage==="today"){
        message=`امروز آخرین مهلت پرداخت قسط ${transaction.amount.toLocaleString()} تومان است.`;
    }

    await Notification.create({
        userId:transaction.userId,
        relatedTransactionId:transaction._id,
        title,
        message,
        stage
    });

    console.log("Notification Created");
};

const startCronJobs=()=>{

    // هر روز ساعت ۶ صبح
    cron.schedule("0 6 * * *",async()=>{

        console.log("Checking Installments...");

        try{

            const transactions=await Transaction.find({
                type:"INSTALLMENT",
                isPaid:false
            });

            for(const item of transactions){

                const days=diffDays(item.dueDate);

                if(days===3){
                    await createNotification(item,"3days");
                }

                if(days===1){
                    await createNotification(item,"1day");
                }

                if(days===0){
                    await createNotification(item,"today");
                }

            }

        }catch(err){

            console.error(err);

        }

    });

};

module.exports=startCronJobs;
