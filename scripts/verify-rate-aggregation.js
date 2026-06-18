const assert = require('assert');

function aggregateEarnedPremiumRate(branches, key) {
  let weightedSum = 0;
  let totalEarned = 0;
  let simpleSum = 0;
  let simpleCount = 0;

  for (const b of branches || []) {
    const d = b.d || {};
    const rate = Number(d[key]) || 0;
    const earned = Number(d['已赚保费']) || 0;
    simpleSum += rate;
    simpleCount += 1;
    if (earned > 0) {
      weightedSum += rate * earned;
      totalEarned += earned;
    }
  }

  if (totalEarned > 0) return weightedSum / totalEarned;
  return simpleCount > 0 ? simpleSum / simpleCount : 0;
}

const branches = [
  { n: '大体量分公司', r: '一区', d: { '已赚保费': 1000, '已赚赔付率实际': 0.2, '已赚费用率实际': 0.1 } },
  { n: '小体量分公司', r: '一区', d: { '已赚保费': 10, '已赚赔付率实际': 0.8, '已赚费用率实际': 0.5 } },
];

const expectedLoss = (0.2 * 1000 + 0.8 * 10) / 1010;
const expectedExpense = (0.1 * 1000 + 0.5 * 10) / 1010;

assert.strictEqual(aggregateEarnedPremiumRate(branches, '已赚赔付率实际'), expectedLoss);
assert.strictEqual(aggregateEarnedPremiumRate(branches, '已赚费用率实际'), expectedExpense);

const zeroEarnedBranches = [
  { d: { '已赚保费': 0, '已赚赔付率实际': 0.2 } },
  { d: { '已赚保费': 0, '已赚赔付率实际': 0.8 } },
];
assert.strictEqual(aggregateEarnedPremiumRate(zeroEarnedBranches, '已赚赔付率实际'), 0.5);

console.log('weighted loss rate =', expectedLoss.toFixed(6));
console.log('weighted expense rate =', expectedExpense.toFixed(6));
console.log('zero earned premium fallback = 0.500000');
