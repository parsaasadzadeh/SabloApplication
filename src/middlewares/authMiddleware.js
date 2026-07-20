const jwt = require('jsonwebtoken');

exports.protect = (req, res, next) => {
    let token = req.headers.authorization;
    if (token && token.startsWith('Bearer')) {
        token = token.split(' ')[1];
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded; // ذخیره آیدی کاربر در ریکوئست
            next();
        } catch (error) {
            res.status(401).json({ message: 'توکن نامعتبر است' });
        }
    } else {
        res.status(401).json({ message: 'مجوز دسترسی ندارید، توکنی ارسال نشده است' });
    }
};
