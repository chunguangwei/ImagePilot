/**
 * holidays —— 节日日期表（节日回忆用）
 *
 * 固定公历节日 + 农历节日（春节/中秋）的公历对照表（2015~2026 硬编码，静态历史数据）。
 * 范围语义：[start, end] 含两端，跨天节日覆盖假期高峰拍照日。
 */

// 春节（正月初一）公历日期
const CHUNJIE = {
  2015: '2015-02-19', 2016: '2016-02-08', 2017: '2017-01-28', 2018: '2018-02-16',
  2019: '2019-02-05', 2020: '2020-01-25', 2021: '2021-02-12', 2022: '2022-02-01',
  2023: '2023-01-22', 2024: '2024-02-10', 2025: '2025-01-29', 2026: '2026-02-17',
};
// 中秋公历日期
const ZHONGQIU = {
  2015: '2015-09-27', 2016: '2016-09-15', 2017: '2017-10-04', 2018: '2018-09-24',
  2019: '2019-09-13', 2020: '2020-10-01', 2021: '2021-09-21', 2022: '2022-09-10',
  2023: '2023-09-29', 2024: '2024-09-17', 2025: '2025-10-06', 2026: '2026-09-25',
};

function d(y, m, day) { return new Date(y, m - 1, day); }
function addDays(date, n) { const r = new Date(date); r.setDate(r.getDate() + n); return r; }

/**
 * 某年所有节日的日期范围。
 * @returns {Array<{key:string, zh:string, en:string, start:Date, end:Date}>}
 */
export function holidayRangesForYear(year) {
  const out = [
    { key: 'newyear', zh: '元旦', en: "New Year's Day", start: d(year, 1, 1), end: d(year, 1, 1) },
    { key: 'labor', zh: '五一', en: 'May Day', start: d(year, 5, 1), end: d(year, 5, 3) },
    { key: 'national', zh: '国庆', en: 'National Day', start: d(year, 10, 1), end: d(year, 10, 7) },
    { key: 'christmas', zh: '圣诞', en: 'Christmas', start: d(year, 12, 24), end: d(year, 12, 25) },
  ];
  if (CHUNJIE[year]) {
    const cj = new Date(CHUNJIE[year]);
    out.push({ key: 'chunjie', zh: '春节', en: 'Spring Festival', start: addDays(cj, -1), end: addDays(cj, 5) });   // 除夕~初六
  }
  if (ZHONGQIU[year]) {
    const zq = new Date(ZHONGQIU[year]);
    out.push({ key: 'zhongqiu', zh: '中秋', en: 'Mid-Autumn', start: zq, end: zq });
  }
  return out;
}

export default { holidayRangesForYear };
