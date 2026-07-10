const Notification=require("../models/Notification");

exports.getMyNotifications=async(req,res)=>{

    const notifications=await Notification.find({
        userId:req.user.id
    })
    .sort({createdAt:-1});

    const unreadCount=await Notification.countDocuments({
        userId:req.user.id,
        isRead:false
    });

    res.json({
        notifications,
        unreadCount
    });

};

exports.markAsRead=async(req,res)=>{

    await Notification.findByIdAndUpdate(
        req.params.id,
        {
            isRead:true
        }
    );

    res.json({
        success:true
    });

};
