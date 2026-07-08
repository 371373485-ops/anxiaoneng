/**
 * test_trend_analysis.mjs — 趋势分析模块单元测试
 * 测试 generateAnalysis() 的核心计算逻辑
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;

function assert(condition, name) {
  if (condition) { pass++; } else { fail++; console.error(`  FAIL: ${name}`); }
}

function approxEq(a, b, eps = 0.0001) {
  return Math.abs(a - b) < eps;
}

// 1. 趋势方向判断
function classifyTrend(changeMeasure, isImproving, flatThreshold) {
  if (changeMeasure < flatThreshold) return '基本持平';
  if (changeMeasure < 3) return isImproving ? '小幅改善' : '小幅下降';
  if (changeMeasure < 10) return isImproving ? '明显改善' : '明显下降';
  return isImproving ? '显著改善' : '显著下降';
}

assert(classifyTrend(0.5, true, 1) === '基本持平', 'flat: < 1% threshold');
assert(classifyTrend(2, true, 1) === '小幅改善', '1-3% improving');
assert(classifyTrend(2, false, 1) === '小幅下降', '1-3% declining');
assert(classifyTrend(5, true, 1) === '明显改善', '3-10% improving');
assert(classifyTrend(5, false, 1) === '明显下降', '3-10% declining');
assert(classifyTrend(15, true, 1) === '显著改善', '>10% improving');
assert(classifyTrend(15, false, 1) === '显著下降', '>10% declining');
assert(classifyTrend(1.5, true, 2) === '基本持平', 'amount metric 1.5% < 2% threshold');

// 2. 变化量计算（% vs 金额）
{
  const first = 0.85, last = 0.90;
  const change = last - first;
  const changePct = (change / Math.abs(first) * 100);
  const changeAbs = last - first;
  const pctDispVal = Math.abs(changeAbs * 100);
  assert(approxEq(pctDispVal, 5.0), '% metric changeDisp = 5.0pp');
  const amtDispVal = Math.abs(changePct);
  assert(approxEq(amtDispVal, 5.8824, 0.01), 'amount metric changeDisp = 5.88%');
}

{
  const first = 1000, last = 1200;
  const changePct = (200 / Math.abs(first) * 100);
  const amtDispVal = Math.abs(changePct);
  assert(approxEq(amtDispVal, 20.0), 'amount metric 1000->1200 = 20%');
}

// 3. 波动率
function volatilityDesc(range, avgVal) {
  const vol = avgVal !== 0 ? (range / Math.abs(avgVal) * 100) : 0;
  if (vol < 3) return '波动平缓';
  if (vol < 8) return '一般波动';
  if (vol < 20) return '波动较大';
  return '波动很大';
}

assert(volatilityDesc(0.01, 0.85) === '波动平缓', 'vol < 3%');
assert(volatilityDesc(0.05, 0.85) === '一般波动', '3-8%');
assert(volatilityDesc(0.15, 0.85) === '波动较大', '8-20%');
assert(volatilityDesc(0.25, 0.85) === '波动很大', '>20%');
assert(volatilityDesc(0.5, 0) === '波动平缓', 'avgVal=0 -> vol=0');

// 4. 月度最大波动
function calcMaxMomentum(vals, isPct) {
  let maxUp = 0, maxDown = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] != null && vals[i-1] != null) {
      const mom = vals[i] - vals[i-1];
      const momPct = vals[i-1] !== 0 ? mom / Math.abs(vals[i-1]) * 100 : 0;
      const momDisp = isPct ? mom * 100 : momPct;
      if (momDisp > Math.abs(maxUp)) { maxUp = momDisp; }
      if (momDisp < -Math.abs(maxDown)) { maxDown = momDisp; }
    }
  }
  return { maxUp, maxDown };
}

{
  const r = calcMaxMomentum([0.85, 0.88, 0.82, 0.90], true);
  assert(approxEq(r.maxUp, 8.0), '% maxUp = 8pp');
  assert(approxEq(r.maxDown, -6.0), '% maxDown = -6pp');
}

{
  const r = calcMaxMomentum([1000, 1100, 900, 1200], false);
  assert(approxEq(r.maxUp, 33.33, 0.1), 'amount maxUp = 33.33%');
  assert(approxEq(r.maxDown, -18.18, 0.1), 'amount maxDown = -18.18%');
}

{
  const r = calcMaxMomentum([0.85, null, 0.90], true);
  assert(r.maxUp === 0 && r.maxDown === 0, 'null gap -> no momentum');
}

// 5. 数据查找逻辑
const mockMerged = {
  '2026-01': {
    national: { COR: 0.85 },
    regions: { '第一责任区': { COR: 0.82 } },
    branches: [{ n: '北京', r: '第一责任区', d: { COR: 0.80 } }]
  }
};

function mockGetMetricValue(month, org, key) {
  const mdata = mockMerged[month];
  if (!mdata) return null;
  if (org === '全国') return mdata.national[key] ?? null;
  if (mdata.regions && mdata.regions[org]) return mdata.regions[org][key] ?? null;
  const b = (mdata.branches || []).find(x => x.n === org);
  return b && b.d ? (b.d[key] ?? null) : null;
}

assert(mockGetMetricValue('2026-01', '全国', 'COR') === 0.85, 'national lookup');
assert(mockGetMetricValue('2026-01', '第一责任区', 'COR') === 0.82, 'region lookup');
assert(mockGetMetricValue('2026-01', '北京', 'COR') === 0.80, 'branch lookup');
assert(mockGetMetricValue('2026-01', '不存在', 'COR') === null, 'nonexistent org');
assert(mockGetMetricValue('2026-02', '全国', 'COR') === null, 'nonexistent month');

// 6. 时间范围预设
const allMonths = ['2024-11','2024-12','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-12'];

function getMonths(preset, customStart, customEnd, currentMonth) {
  if (preset === 'custom' && customStart && customEnd)
    return allMonths.filter(m => m >= customStart && m <= customEnd);
  if (preset === 'ytd') {
    const yr = (currentMonth || allMonths[allMonths.length-1]).split('-')[0];
    return allMonths.filter(m => m.startsWith(yr));
  }
  if (preset === 'yoy') {
    const yr2 = (currentMonth || allMonths[allMonths.length-1]).split('-')[0];
    const mo = (currentMonth || allMonths[allMonths.length-1]).split('-')[1];
    return allMonths.filter(m =>
      (m.startsWith(yr2) && m.endsWith('-'+mo)) ||
      (m.startsWith(String(parseInt(yr2)-1)) && m.endsWith('-'+mo))
    ).sort();
  }
  if (preset === 'annualDec') return allMonths.filter(m => /-12$/.test(m)).sort();
  if (preset === 'recent3') return allMonths.slice(-3);
  if (preset === 'recent12') return allMonths.slice(-12);
  return allMonths.slice(-6);
}

assert(JSON.stringify(getMonths('recent3')) === JSON.stringify(['2026-04','2026-05','2026-12']), 'recent3');
assert(JSON.stringify(getMonths('recent6')) === JSON.stringify(['2026-01','2026-02','2026-03','2026-04','2026-05','2026-12']), 'recent6');
assert(JSON.stringify(getMonths('ytd','','','2026-04')) === JSON.stringify(['2026-01','2026-02','2026-03','2026-04','2026-05','2026-12']), 'ytd');
assert(JSON.stringify(getMonths('custom','2026-01','2026-03')) === JSON.stringify(['2026-01','2026-02','2026-03']), 'custom');
assert(JSON.stringify(getMonths('annualDec')) === JSON.stringify(['2024-12','2025-12','2026-12']), 'annualDec uses December only');

function fmtPeriod(m, preset) {
  if (!m) return '';
  return preset === 'annualDec' ? m.split('-')[0] + '年' : m.split('-')[1] + '月';
}
assert(fmtPeriod('2025-12', 'annualDec') === '2025年', 'annualDec label uses year');
assert(fmtPeriod('2025-12', 'recent6') === '12月', 'monthly label unchanged');

// 7. 排名计算
function getBranchRank(branches, name, key, direction) {
  const allVals = branches.map(b => ({ name: b.n, value: b.d[key] }))
    .filter(x => x.value != null && !isNaN(x.value));
  if (!allVals.length) return null;
  allVals.sort((a, b) => direction === 'asc' ? a.value - b.value : b.value - a.value);
  const t = allVals.find(x => x.name === name);
  return t ? allVals.indexOf(t) + 1 : null;
}

const mb = [
  { n: '北京', d: { COR: 0.80 } },
  { n: '上海', d: { COR: 0.88 } },
  { n: '广州', d: { COR: 0.85 } },
  { n: '深圳', d: { COR: 0.92 } },
];
assert(getBranchRank(mb, '北京', 'COR', 'asc') === 1, 'rank 1 (lowest COR, asc)');
assert(getBranchRank(mb, '深圳', 'COR', 'asc') === 4, 'rank 4 (highest COR, asc)');

const mb2 = [
  { n: '北京', d: { 保费: 100 } },
  { n: '上海', d: { 保费: 300 } },
  { n: '广州', d: { 保费: 200 } },
];
assert(getBranchRank(mb2, '上海', '保费', 'desc') === 1, 'rank 1 (highest, desc)');
assert(getBranchRank(mb2, '北京', '保费', 'desc') === 3, 'rank 3 (lowest, desc)');

// 8. 边界情况
assert([0.85].filter(v => v != null && !isNaN(v)).length < 2, 'single point insufficient');
assert([null,null,null].filter(v => v != null && !isNaN(v)).length === 0, 'all null');
{
  const first = 0;
  const changePct = first !== 0 ? (100 / Math.abs(first) * 100) : 0;
  assert(changePct === 0, 'first=0 -> changePct=0, no division by zero');
}

console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : `${pass} passed, ${fail} failed`}`);
console.log(`Total: ${pass + fail} assertions`);
process.exit(fail === 0 ? 0 : 1);
