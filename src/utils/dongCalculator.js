// ---------------------------------------------------------------------
// محاسبه دنگ — توابع خالص، بدون وابستگی به دیتابیس
// ---------------------------------------------------------------------

/**
 * participants: [{ name, paid, weight? }]
 * weight برای تقسیم غیرمساوی (مثلاً کسی که ۲ سهم می‌خورد weight=2)
 */
const calculateDong = (participants) => {
    const n = participants.length;
    const total = participants.reduce((s, p) => s + p.paid, 0);
    const totalWeight = participants.reduce((s, p) => s + (p.weight ?? 1), 0);

    // ۱) سهم هر نفر — عدد صحیح + پخش باقی‌مانده
    let allocated = 0;
    const withShare = participants.map(p => {
        const share = Math.floor((total * (p.weight ?? 1)) / totalWeight);
        allocated += share;
        return { ...p, share };
    });
    let remainder = total - allocated;
    for (let i = 0; remainder > 0; i = (i + 1) % n, remainder--) {
        withShare[i].share += 1;
    }

    // ۲) تراز
    const people = withShare.map(p => ({ ...p, balance: p.paid - p.share }));

    // ۳) تسویه حریصانه
    const creditors = people.filter(p => p.balance > 0)
        .map(p => ({ name: p.name, amount: p.balance }))
        .sort((a, b) => b.amount - a.amount);
    const debtors = people.filter(p => p.balance < 0)
        .map(p => ({ name: p.name, amount: -p.balance }))
        .sort((a, b) => b.amount - a.amount);

    const settlements = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const pay = Math.min(debtors[i].amount, creditors[j].amount);
        settlements.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
        debtors[i].amount -= pay;
        creditors[j].amount -= pay;
        if (debtors[i].amount === 0) i++;
        if (creditors[j].amount === 0) j++;
    }

    return { total, people, settlements };
};

module.exports = { calculateDong };
