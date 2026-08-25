const CATEGORIES = [
    // زندگی روزمره
    { id: 'food', label: 'غذا و رستوران', icon: '🍔' },
    { id: 'coffee', label: 'قهوه و کافه', icon: '☕' },
    { id: 'grocery', label: 'خرید روزانه', icon: '🛒' },
    
    // قبوض و مسکن
    { id: 'rent', label: 'اجاره', icon: '🏠' },
    { id: 'electricity', label: 'برق', icon: '⚡' },
    { id: 'water', label: 'آب', icon: '💧' },
    { id: 'gas', label: 'گاز', icon: '🔥' },
    { id: 'internet', label: 'اینترنت', icon: '🌐' },
    { id: 'phone', label: 'تلفن و شارژ', icon: '📱' },
    
    // حمل‌ونقل
    { id: 'transport', label: 'حمل‌ونقل', icon: '🚗' },
    { id: 'fuel', label: 'بنزین', icon: '⛽' },
    
    // سلامت
    { id: 'health', label: 'سلامت و دارو', icon: '💊' },
    { id: 'sport', label: 'ورزش', icon: '🏋️' },
    
    // تفریح و سبک زندگی
    { id: 'entertainment', label: 'تفریح', icon: '🎮' },
    { id: 'clothing', label: 'پوشاک', icon: '👕' },
    { id: 'cigarette', label: 'سیگار', icon: '🚬' },
    
    // درآمد
    { id: 'salary', label: 'حقوق', icon: '💰' },
    { id: 'freelance', label: 'درآمد آزاد', icon: '💻' },
    
    // سایر — وقتی هیچکدام نبود
    { id: 'other', label: 'سایر', icon: '📦' },
];

module.exports = CATEGORIES;
