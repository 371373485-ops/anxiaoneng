const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dashboard-diagnosis-index.js'), 'utf8');

const context = {
  console,
  Date,
  window: {},
};
context.window.window = context.window;
context.window.App = {
  currentMonth: '2026-05',
  FIELDS: [
    { k: '经营利润', l: '经营利润', u: '万元', metricId: 'metric_profit' },
    { k: '综合成本率实际（整体利润口径）', l: '综合成本率', u: '%', metricId: 'metric_cost_rate' },
    { k: '保费实际合计', l: '保费实际合计', u: '万元', metricId: 'metric_premium' },
  ],
  DATA: {
    branches: [
      { n: '测试A分公司', r: '第一责任区', orgId: 'BR_A', d: { '经营利润': -12.3, '保费实际合计': 1000 } },
      { n: '测试B分公司', r: '第二责任区', orgId: 'BR_B', d: { '经营利润': 88.8, '保费实际合计': 2000 } },
    ],
  },
  _alertResults: [
    {
      ruleId: 'rule_profit_negative',
      severity: 'error',
      field: '经营利润',
      fieldLabel: '经营利润',
      currentValue: -12.3,
      threshold: 0,
      op: '<',
      msg: '经营利润为负',
      unit: '万元',
      branchName: '测试A分公司',
      regionName: null,
    },
  ],
  getOrgId(name) {
    return name === '测试A分公司' ? 'BR_A' : 'BR_B';
  },
  getMetricMeta(key) {
    const field = this.FIELDS.find((item) => item.k === key);
    if (!field) return null;
    return {
      metricId: field.metricId,
      label: field.l,
      unit: field.u,
      calculationVersion: 'test-calc-v1',
    };
  },
};
context.window.buildDiagnosisModel = function buildDiagnosisModel(orgName, alerts) {
  if (orgName === '测试A分公司') {
    return {
      orgId: 'BR_A',
      orgName,
      period: '2026-05',
      riskLevel: '高风险',
      score: 92,
      summary: '测试A分公司存在经营利润风险。',
      facts: [{ text: '经营利润为负', metric: '经营利润', isRiskMetric: true }],
      patterns: [{ name: '盈利承压', trigger: '利润为负' }],
      inferences: [{ text: '需要核查费用与赔付结构', confidence: '中' }],
      recommendations: [{ action: '核查利润异常原因', metric: '经营利润' }],
      evidence: [
        {
          id: 'ev_profit_a',
          metric: '经营利润',
          metricId: 'metric_profit',
          label: '经营利润',
          currentValue: -12.3,
          benchmarkValue: 0,
          differenceValue: -12.3,
          unit: '万元',
          severity: 'error',
          ruleId: 'rule_profit_negative',
          source: 'dashboard:2026-05',
        },
      ],
      calculationVersion: 'calc-v1',
    };
  }
  return {
    orgId: 'BR_B',
    orgName,
    period: '2026-05',
    riskLevel: '正常',
    score: 0,
    summary: '测试B分公司当前未触发规则预警。',
    facts: [],
    patterns: [],
    inferences: [],
    recommendations: [],
    evidence: [],
    calculationVersion: 'calc-v1',
  };
};

vm.createContext(context);
vm.runInContext(source, context);

assert.ok(context.window.DiagnosisIndex, 'DiagnosisIndex should be exported');

const records = context.window.DiagnosisIndex.build();
assert.strictEqual(records.length, 2, 'one record per branch');
assert.ok(Array.isArray(records), '1. should build DiagnosisIndex records');

const a = context.window.DiagnosisIndex.get('测试A分公司', '2026-05');
assert.ok(a, 'A record should exist');
assert.strictEqual(a.orgName, '测试A分公司', '2. should read diagnosis record by org');
assert.strictEqual(a.orgId, 'BR_A');
assert.strictEqual(a.orgType, 'branch');
assert.strictEqual(a.region, '第一责任区');
assert.strictEqual(a.period, '2026-05');
assert.strictEqual(a.riskLevel, '高风险', '3. should read riskLevel');
assert.ok(a.riskScore >= 80);
assert.strictEqual(a.source, 'local_diagnosis');
assert.ok(Array.isArray(a.triggeredAlerts), '4. should read triggeredAlerts');
assert.strictEqual(a.triggeredAlerts.length, 1, '4. should preserve triggered alert entries');
assert.ok(a.triggeredMetrics.includes('经营利润'));
assert.ok(Array.isArray(a.recommendations), '5. should read recommendations');
assert.strictEqual(a.recommendations.length, 1, '5. should preserve recommendation entries');
assert.ok(Array.isArray(a.evidenceMetrics), '6. should read evidenceMetrics');
assert.ok(a.evidenceMetrics.some((item) => (
  item.id === 'ev_profit_a'
  && item.orgName === '测试A分公司'
  && item.period === '2026-05'
  && item.metricKey === '经营利润'
  && item.metricId === 'metric_profit'
  && item.metricLabel === '经营利润'
  && item.currentValue === -12.3
  && item.benchmarkValue === 0
  && item.differenceValue === -12.3
  && item.unit === '万元'
  && item.severity === 'error'
  && item.ruleId === 'rule_profit_negative'
  && item.source === 'dashboard:2026-05'
)), 'normalized evidence metric should contain required fields');

const b = context.window.DiagnosisIndex.get('测试B分公司', '2026-05');
assert.ok(b, '7. org without alerts should not throw and should still have record');
assert.strictEqual(b.riskLevel, '正常');
assert.strictEqual(b.triggeredAlerts.length, 0);
assert.ok(Array.isArray(b.evidenceMetrics));

assert.strictEqual(context.window.DiagnosisIndex.searchByRisk('高风险', '2026-05').length, 1);
const profitRecords = context.window.DiagnosisIndex.searchByMetric('经营利润', '2026-05');
assert.ok(profitRecords.some((record) => record.orgName === '测试A分公司'));
assert.strictEqual(context.window.DiagnosisIndex.getEvidence('测试A分公司', '2026-05').length >= 1, true);
assert.strictEqual(context.window.DiagnosisIndex.getEvidence('不存在分公司', '2026-05').length, 0);

console.log('DiagnosisIndex tests passed');
