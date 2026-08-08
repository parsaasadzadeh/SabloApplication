// src/utils/compareVersions.js

/**
 * مقایسه دو ورژن با فرمت x.y.z
 * -1 => v1 قدیمی‌تره
 *  0 => برابرن
 *  1 => v1 جدیدتره
 */
function compareVersions(v1, v2) {
  const a = String(v1).split('.').map(Number);
  const b = String(v2).split('.').map(Number);
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    const num1 = a[i] || 0;
    const num2 = b[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

module.exports = compareVersions;
