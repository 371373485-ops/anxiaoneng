const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function createContext({ shareMode = false, withModel = false } = {}) {
  const context = {
    console,
    JSON,
    Object,
    Array,
    Number,
    String,
    Math,
    Date,
    Set,
    Promise,
    RegExp,
    isFinite,
    window: null,
    document: { body: { classList: { contains() { return shareMode; }, add() {} } } },
    location: { pathname: shareMode ? '/share/test-token' : '/', search: '' },
  };
  context.window = context;
  if (withModel) {
    context.AICLIENT = {
      calls: [],
      chat(messages) {
        this.calls.push(messages);
        return Promise.resolve(JSON.stringify({
          summary: 'A分公司经营利润为999.00万元。',
          facts: ['A分公司经营利润为999.00万元。'],
          analysis: ['这里故意返回不存在数字，用于验证前端反查。'],
          recommendations: ['核查经营利润异常。'],
          limitations: [],
          usedEvidence: [],
        }));
      },
    };
  }
  vm.createContext(context);
  return context;
}

function load(context, files) {
  for (const file of files) {
    vm.runInContext(
      fs.readFileSync(path.join(root, file), 'utf8'),
      context,
      { filename: file }
    );
  }
}

function installData(context) {
  const profit = (
    context.App.FIELDS.find((field) => field.k === '经营利润')
    || context.App.FIELDS.find((field) => String(field.k || '').includes('经营利润'))
    || context.App.FIELDS.find((field) => field.c)
    || context.App.FIELDS[0]
  ).k;
  const premium = (
    context.App.FIELDS.find((field) => field.k === '已赚保费')
    || context.App.FIELDS.find((field) => String(field.k || '').includes('已赚保费'))
    || context.App.FIELDS.find((field) => field.k !== profit)
    || { k: profit }
  ).k;
  context.__metricKey = profit;
  context.App.ALL_DATA = {
    currentMonth: '2026-02',
    currentPlanKey: 'auto',
    _plans: {
      '2026': {
        branches: [
          { orgId: 'ORG_A', n: 'Branch A', r: 'Region One', d: { '车险计划': 300, '财产险计划': 400, '人身险计划': 500, '经营利润年度计划': 60, '已赚保费计划': 200 } },
          { orgId: 'ORG_B', n: 'Branch B', r: 'Region Two', d: { '车险计划': 200, '财产险计划': 300, '人身险计划': 400, '经营利润年度计划': 40, '已赚保费计划': 150 } },
        ],
      },
    },
    actuals: {
      '2025-02': {
        branches: [
          { orgId: 'ORG_A', n: 'Branch A', r: 'Region One', d: { [profit]: 80, [premium]: 800, '已赚保费': 100, '经营利润': 10 } },
          { orgId: 'ORG_B', n: 'Branch B', r: 'Region Two', d: { [profit]: 40, [premium]: 700, '已赚保费': 100, '经营利润': 5 } },
        ],
      },
      '2025-12': {
        branches: [
          { orgId: 'ORG_A', n: 'Branch A', r: 'Region One', d: { [profit]: 100, [premium]: 850, '已赚保费': 100, '经营利润': 10 } },
          { orgId: 'ORG_B', n: 'Branch B', r: 'Region Two', d: { [profit]: 50, [premium]: 720, '已赚保费': 100, '经营利润': 5 } },
        ],
      },
      '2026-01': {
        branches: [
          { orgId: 'ORG_A', n: 'Branch A', r: 'Region One', d: { [profit]: 90, [premium]: 900, '已赚保费': 100, '经营利润': 20 } },
          { orgId: 'ORG_B', n: 'Branch B', r: 'Region Two', d: { [profit]: 60, [premium]: 750, '已赚保费': 100, '经营利润': 10 } },
        ],
      },
      '2026-02': {
        branches: [
          { orgId: 'ORG_A', n: 'Branch A', r: 'Region One', d: { [profit]: 120, [premium]: 1000 } },
          { orgId: 'ORG_B', n: 'Branch B', r: 'Region Two', d: { [profit]: 70, [premium]: 760 } },
        ],
      },
    },
  };
  context.App.currentMonth = '2026-02';
  context.App.currentPlanKey = 'auto';
  context.refreshMergedData();
  const values = {
    '2025-02': { 'Branch A': 80, 'Branch B': 40 },
    '2026-01': { 'Branch A': 90, 'Branch B': 60 },
    '2026-02': { 'Branch A': 120, 'Branch B': 70 },
  };
  Object.keys(values).forEach((period) => {
    const actual = context.App.ALL_DATA.actuals[period];
    (actual.branches || []).forEach((branch) => {
      branch.d[profit] = values[period][branch.n];
    });
  });
  const merged = context.App.ALL_DATA._merged && context.App.ALL_DATA._merged['2026-02'];
  (merged && merged.branches || []).forEach((branch) => {
    branch.d[profit] = values['2026-02'][branch.n];
  });
  if (context.App.DATA && context.App.DATA.branches) {
    context.App.DATA.branches.forEach((branch) => {
      branch.d[profit] = values['2026-02'][branch.n];
    });
  }
}

function bootstrap(options) {
  const context = createContext(options);
  load(context, [
    'dashboard-data.js',
    'dashboard-config.js',
    'dashboard-compute.js',
    'dashboard-diagnosis-index.js',
    'dashboard-ai-engine.js',
  ]);
  context.resolvePlanKey = () => {
    const year = String(context.App.currentMonth || '2026-01').split('-')[0];
    return context.App.ALL_DATA._plans && context.App.ALL_DATA._plans[year] ? year : 'auto';
  };
  installData(context);
  context.App.shareMode = !!options?.shareMode;
  return context;
}

async function testQueryBase() {
  const context = bootstrap();
  const engine = context.AIEngine;
  const metric = context.__metricKey;
  assert.ok(engine.listPeriods().includes('2026-02'));
  assert.ok(engine.listOrganizations().some((org) => org.name === 'Branch A'));
  assert.ok(engine.listMetrics().some((item) => item.metric === metric));

  const snap = engine.tools.getMetricSnapshot({ org: 'Branch A', period: '2026-02', metric });
  assert.strictEqual(snap.ok, true);
  assert.strictEqual(snap.value, 120);
  assert.strictEqual(snap.evidence[0].period, '2026-02');

  const mom = engine.tools.compareMoM({ org: 'Branch A', period: '2026-02', metric });
  assert.strictEqual(mom.ok, true);
  assert.strictEqual(mom.previous.period, '2026-01');
  assert.strictEqual(mom.difference, 30);

  const noCrossYearMom = engine.tools.compareMoM({ org: 'Branch A', period: '2026-01', metric });
  assert.strictEqual(noCrossYearMom.ok, false);
  assert.ok(noCrossYearMom.limitations.some((item) => item.includes('同一年')));

  const yoy = engine.tools.compareYoY({ org: 'Branch A', period: '2026-02', metric });
  assert.strictEqual(yoy.ok, true);
  assert.strictEqual(yoy.previous.period, '2025-02');
  assert.strictEqual(yoy.difference, 40);

  const rank = engine.tools.rankBranches({ period: '2026-02', metric, limit: 1 });
  assert.strictEqual(rank.top[0].org, 'Branch A');
}

async function testShareLocalAnalysisDoesNotCallModel() {
  const context = bootstrap({ shareMode: true, withModel: true });
  context.App.shareMode = true;
  const result = await context.AIEngine.ask(`Branch A 2026-02 ${context.__metricKey} 怎么样？`);
  assert.strictEqual(result.local, true);
  assert.strictEqual(context.AICLIENT.calls.length, 0);
  assert.ok(result.answer.usedEvidence.length > 0);
  assert.ok(!context.AIEngine.listOrganizations().some((org) => org.level === 'national'));
}

async function testAdminModelAnswerIsValidated() {
  const context = bootstrap({ withModel: true });
  const result = await context.AIEngine.ask(`Branch A 2026-02 ${context.__metricKey} 怎么样？`);
  assert.strictEqual(result.local, true);
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(context.AICLIENT.calls.length, 1);
  assert.ok(result.answer.validation.blockedNumbers.includes('999.00'));
  assert.strictEqual(result.answer.validation.passed, true);
  assert.strictEqual(result.answer.validation.unverifiedNumbers.length, 0);
  assert.ok(!JSON.stringify(result.answer.facts).includes('999.00'));
}

async function testRenderToleratesModelScalarFields() {
  const context = bootstrap();
  const html = context.AIEngine.renderAnswer({
    local: false,
    pack: { dataScope: { currentPeriod: '2026-02' }, evidence: [] },
    answer: {
      summary: 'ok',
      facts: '单条事实',
      analysis: { text: '对象分析' },
      recommendations: null,
      limitations: 123,
      usedEvidence: 'ev_demo',
      validation: { passed: true, unverifiedNumbers: [] },
    },
  });
  assert.ok(html.includes('单条事实'));
  assert.ok(html.includes('对象分析'));
  assert.ok(html.includes('ev_demo'));
}

async function testDeepReadingUsesRicherEvidenceAndClearLimits() {
  const context = bootstrap({ withModel: true });
  const result = await context.AIEngine.ask('请对 Branch A 做经营深度分析', { org: 'Branch A', mode: 'deep' });
  assert.strictEqual(result.local, true);
  assert.strictEqual(result.answer.validation.passed, true);
  assert.ok(result.pack.steps.length > 6);
  assert.ok(result.answer.facts.length >= 3);
  assert.ok(result.answer.analysis.some((item) => String(item).includes('判断')));
  assert.ok(result.answer.limitations.some((item) => String(item).includes('读取')));
  assert.ok(!result.answer.validation.unverifiedNumbers.length);
}

async function testYearOnlyFactQuestionUsesRequestedYear() {
  const context = bootstrap({ withModel: true });
  const result = await context.AIEngine.ask('Branch A 2025年综合成本率是多少');
  assert.strictEqual(result.local, true);
  assert.strictEqual(context.AICLIENT.calls.length, 0);
  assert.strictEqual(result.pack.queryPeriod, '2025-12');
  assert.ok(result.pack.queryPeriodLabel.includes('2025年'));
  assert.ok(result.pack.queryPeriodLabel.includes('2025-12'));
  assert.ok(result.answer.summary.includes('2025-12'));
  assert.ok(result.answer.summary.includes('综合成本率'));
  assert.ok(!result.answer.summary.includes('2026-02'));
}

async function testChineseYearMonthQuestionUsesExactMonth() {
  const context = bootstrap({ withModel: true });
  const result = await context.AIEngine.ask('Branch A 2026年1月的综合成本率是多少');
  assert.strictEqual(result.local, true);
  assert.strictEqual(context.AICLIENT.calls.length, 0);
  assert.strictEqual(result.pack.queryPeriod, '2026-01');
  assert.strictEqual(result.pack.queryPeriodLabel, '2026-01');
  assert.ok(result.answer.summary.includes('2026-01'));
  assert.ok(result.answer.summary.includes('综合成本率'));
  assert.ok(!result.answer.summary.includes('2026-02'));
}

async function testAnnualPlanValueIsStableWithinYear() {
  const context = bootstrap({ withModel: true });
  const jan = await context.AIEngine.ask('Branch A 2026年1月保费计划值是多少');
  const feb = await context.AIEngine.ask('Branch A 2026年2月保费计划值是多少');
  assert.strictEqual(jan.local, true);
  assert.strictEqual(feb.local, true);
  assert.strictEqual(context.AICLIENT.calls.length, 0);
  assert.strictEqual(jan.pack.queryPeriod, '2026-01');
  assert.strictEqual(feb.pack.queryPeriod, '2026-02');
  assert.ok(jan.answer.summary.includes('1200.00万元'));
  assert.ok(feb.answer.summary.includes('1200.00万元'));
  assert.ok(jan.answer.summary.includes('年度计划口径'));
  assert.ok(feb.answer.summary.includes('年度计划口径'));
}

function installDiagnosisIndexMock(context) {
  const record = {
    orgName: 'Branch A',
    orgId: 'ORG_A',
    orgType: 'branch',
    region: 'Region One',
    period: '2026-02',
    riskLevel: '高风险',
    riskScore: 88,
    summary: 'Branch A 高风险：利润和成本指标触发预警，需要解释原因并形成整改动作。',
    triggeredAlerts: [{
      ruleId: 'rule_diag_profit',
      severity: 'error',
      field: context.__metricKey,
      fieldLabel: 'Profit Metric',
      currentValue: 120,
      threshold: 100,
      op: '>',
      msg: 'profit alert from diagnosis index',
      unit: '万元',
      branchName: 'Branch A',
      regionName: null,
    }],
    triggeredMetrics: [context.__metricKey],
    facts: [{ text: 'diagnosis fact', evidenceId: 'ev_diag_high_risk' }],
    patterns: [{ name: 'risk pattern', trigger: 'alert triggered' }],
    inferences: [{ text: 'diagnosis reason', confidence: 'high' }],
    recommendations: [{ action: 'diagnosis remediation recommendation', metric: context.__metricKey }],
    evidenceMetrics: [{
      id: 'ev_diag_high_risk',
      orgName: 'Branch A',
      period: '2026-02',
      metricKey: context.__metricKey,
      metricId: 'metric_profit',
      metricLabel: 'Profit Metric',
      currentValue: 120,
      formattedValue: '120.00万元',
      benchmarkValue: 100,
      differenceValue: 20,
      unit: '万元',
      severity: 'error',
      ruleId: 'rule_diag_profit',
      source: 'diagnosis-index-mock',
    }],
    source: 'local_diagnosis',
    calculationVersion: 'mock-v1',
  };
  context.DiagnosisIndex = context.window.DiagnosisIndex = {
    build() { return [record]; },
    get(orgName, period) { return orgName === 'Branch A' && period === '2026-02' ? record : null; },
    list(period) { return period === '2026-02' ? [record] : []; },
    searchByRisk(riskLevel, period) { return riskLevel === '高风险' && period === '2026-02' ? [record] : []; },
    searchByMetric(metricKey, period) { return metricKey === context.__metricKey && period === '2026-02' ? [record] : []; },
    getEvidence(orgName, period) { return orgName === 'Branch A' && period === '2026-02' ? record.evidenceMetrics : []; },
  };
}

async function testDiagnosisIndexMockRiskQuestion() {
  const context = bootstrap();
  installDiagnosisIndexMock(context);
  const result = context.AIEngine.localAnswer('Branch A 为什么是高风险？', { org: 'Branch A', useDiagnosis: true });
  const summaryStep = result.pack.steps.find((step) => step.tool === 'getDiagnosisSummary' && step.ok);
  assert.ok(summaryStep);
  assert.strictEqual(result.answer.riskLevel, summaryStep.riskLevel);
  assert.ok(result.answer.summary.includes(summaryStep.riskLevel) || result.answer.summary.includes(summaryStep.summary));
  assert.ok(result.answer.usedEvidence.includes('ev_diag_high_risk'));
}

async function testDiagnosisIndexMockTriggeredAlertsQuestionDoesNotCallModel() {
  const context = bootstrap({ withModel: true });
  installDiagnosisIndexMock(context);
  const result = await context.AIEngine.ask('Branch A 触发了哪些预警？', { org: 'Branch A', useDiagnosis: true });
  assert.strictEqual(result.local, true);
  assert.strictEqual(context.AICLIENT.calls.length, 0);
  assert.ok(result.pack.steps.some((step) => step.tool === 'getTriggeredAlerts' && step.ok));
  assert.ok((result.answer.triggeredAlerts || []).some((alert) => alert.ruleId === 'rule_diag_profit'));
}

async function testDiagnosisIndexMockRecommendationsQuestion() {
  const context = bootstrap();
  installDiagnosisIndexMock(context);
  const result = context.AIEngine.localAnswer('Branch A 有什么整改建议？', { org: 'Branch A', useDiagnosis: true });
  assert.ok(result.answer.recommendations.some((item) => String(item).includes('diagnosis remediation recommendation')));
  assert.ok(result.pack.evidence.length > 0);
  assert.ok(result.pack.evidence.some((ev) => ev.id === 'ev_diag_high_risk'));
}

async function testDiagnosisIndexMockShareModeStaysLocal() {
  const context = bootstrap({ shareMode: true, withModel: true });
  installDiagnosisIndexMock(context);
  context.App.shareMode = true;
  const questions = [
    'Branch A 为什么是高风险？',
    'Branch A 触发了哪些预警？',
    'Branch A 有什么整改建议？',
  ];
  for (const question of questions) {
    const result = await context.AIEngine.ask(question, { org: 'Branch A', useDiagnosis: true });
    assert.strictEqual(result.local, true);
  }
  assert.strictEqual(context.AICLIENT.calls.length, 0);
}
async function testDiagnosisContextTakesPrecedenceOverIndex() {
  const context = bootstrap();
  installDiagnosisIndexMock(context);
  const diagnosisContext = {
    branch: 'Branch A',
    orgId: 'ORG_A',
    period: '2026-02',
    riskLevel: 'CONTEXT_RISK',
    score: 77,
    summary: 'context diagnosis summary should win',
    triggeredAlerts: [{ ruleId: 'ctx_rule', severity: 'error', field: context.__metricKey, fieldLabel: 'Context Metric', msg: 'context alert' }],
    triggeredMetrics: [context.__metricKey],
    recommendations: [{ action: 'context recommendation should win' }],
    evidence: [{
      id: 'ev_context_diag',
      metric: context.__metricKey,
      metricId: 'metric_context',
      label: 'Context Metric',
      currentValue: 77,
      benchmarkValue: 50,
      differenceValue: 27,
      unit: '万元',
      severity: 'error',
      ruleId: 'ctx_rule',
      source: 'diagnosis-context-test',
    }],
  };
  const pack = context.AIEngine.buildEvidencePack('Branch A 为什么是高风险？', {
    org: 'Branch A',
    period: '2026-02',
    mode: 'deep',
    useDiagnosis: true,
    diagnosisContext,
  });
  const summaryStep = pack.steps.find((step) => step.tool === 'getDiagnosisSummary' && step.ok);
  assert.ok(summaryStep);
  assert.strictEqual(summaryStep.riskLevel, 'CONTEXT_RISK');
  assert.ok(summaryStep.summary.includes('context diagnosis summary should win'));
  assert.ok(pack.evidence.some((ev) => ev.id === 'ev_context_diag'));
  assert.ok(!pack.evidence.some((ev) => ev.id === 'ev_diag_high_risk'));
  const answer = context.AIEngine.localAnswer('Branch A 为什么是高风险？', {
    org: 'Branch A',
    period: '2026-02',
    mode: 'deep',
    useDiagnosis: true,
    diagnosisContext,
  }).answer;
  assert.strictEqual(answer.riskLevel, 'CONTEXT_RISK');
  assert.ok(JSON.stringify(answer.recommendations).includes('context recommendation should win'));
}
async function testEvidencePackReadsDiagnosisIndex() {
  const context = bootstrap();
  const metric = context.__metricKey;
  context.App._alertResults = [{
    ruleId: 'rule_profit_watch',
    severity: 'warn',
    field: metric,
    fieldLabel: 'Profit Metric',
    currentValue: 120,
    threshold: 100,
    op: '>',
    msg: 'profit watch',
    unit: '万元',
    branchName: 'Branch A',
    regionName: null,
  }];
  context.buildDiagnosisModel = function buildDiagnosisModel(orgName) {
    return {
      orgId: orgName === 'Branch A' ? 'ORG_A' : 'ORG_B',
      orgName,
      period: '2026-02',
      riskLevel: orgName === 'Branch A' ? '中风险' : '正常',
      score: orgName === 'Branch A' ? 66 : 0,
      summary: orgName === 'Branch A' ? 'Branch A has diagnosis risk from local index.' : 'normal',
      facts: [{ text: 'diagnosis fact', evidenceId: 'ev_diag_profit' }],
      patterns: [{ name: 'pattern', trigger: 'watch' }],
      inferences: [{ text: 'diagnosis reason', confidence: 'medium' }],
      recommendations: [{ action: 'diagnosis recommendation', metric }],
      evidence: [{
        id: 'ev_diag_profit',
        metric,
        metricId: 'metric_profit',
        label: 'Profit Metric',
        currentValue: 120,
        benchmarkValue: 100,
        differenceValue: 20,
        unit: '万元',
        severity: 'warn',
        ruleId: 'rule_profit_watch',
        source: 'diagnosis-test',
      }],
      calculationVersion: 'calc-test',
    };
  };

  const pack = context.AIEngine.buildEvidencePack('Branch A 2026-02 为什么有风险，有什么整改建议和依据？', {
    org: 'Branch A',
    useDiagnosis: true,
  });
  assert.strictEqual(pack.useDiagnosis, true);
  assert.ok(pack.steps.some((step) => step.tool === 'getDiagnosisSummary' && step.ok));
  assert.ok(pack.steps.some((step) => step.tool === 'getDiagnosisEvidence' && step.ok));
  assert.ok(pack.steps.some((step) => step.tool === 'getTriggeredAlerts' && step.ok));
  assert.ok(pack.steps.some((step) => step.tool === 'getRecommendations' && step.ok));
  assert.ok(pack.evidence.some((ev) => ev.id === 'ev_diag_profit' && ev.source === 'diagnosis-test'));

  const local = context.AIEngine.localAnswer('Branch A 2026-02 为什么有风险，有什么整改建议和依据？', {
    org: 'Branch A',
    useDiagnosis: true,
  });
  assert.ok(JSON.stringify(local.answer.facts).includes('中风险'));
  assert.ok(JSON.stringify(local.answer.analysis).includes('profit watch'));
  assert.ok(JSON.stringify(local.answer.recommendations).includes('diagnosis recommendation'));
}

async function testEvidencePackDoesNotRequireDiagnosisIndex() {
  const context = bootstrap();
  context.DiagnosisIndex = null;
  context.window.DiagnosisIndex = null;
  const pack = context.AIEngine.buildEvidencePack('Branch A 2026-02 风险和建议', {
    org: 'Branch A',
    useDiagnosis: true,
  });
  assert.strictEqual(pack.useDiagnosis, false);
  assert.ok(!pack.steps.some((step) => String(step.tool || '').startsWith('getDiagnosis')));
  assert.ok(pack.steps.some((step) => step.tool === 'getMetricSnapshot'));
}
async function main() {
  await testQueryBase();
  await testShareLocalAnalysisDoesNotCallModel();
  await testAdminModelAnswerIsValidated();
  await testRenderToleratesModelScalarFields();
  await testDeepReadingUsesRicherEvidenceAndClearLimits();
  await testYearOnlyFactQuestionUsesRequestedYear();
  await testChineseYearMonthQuestionUsesExactMonth();
  await testAnnualPlanValueIsStableWithinYear();
  await testDiagnosisIndexMockRiskQuestion();
  await testDiagnosisIndexMockTriggeredAlertsQuestionDoesNotCallModel();
  await testDiagnosisIndexMockRecommendationsQuestion();
  await testDiagnosisIndexMockShareModeStaysLocal();
  await testDiagnosisContextTakesPrecedenceOverIndex();
  await testEvidencePackReadsDiagnosisIndex();
  await testEvidencePackDoesNotRequireDiagnosisIndex();
  console.log('PASS AI query base covers months, orgs, metrics, MoM, YoY and ranking');
  console.log('PASS share mode uses local deterministic analysis without model calls');
  console.log('PASS admin AI answer is checked against evidence numbers');
  console.log('PASS renderer tolerates scalar/object model fields');
  console.log('PASS deep reading uses richer evidence and clear limitations');
  console.log('PASS year-only fact questions use requested year data period');
  console.log('PASS Chinese year-month fact questions use the exact requested month');
  console.log('PASS annual plan values stay stable across months in the same year');
  console.log('PASS DiagnosisIndex mock answers risk, alerts, recommendations and share-local scenarios');
  console.log('PASS diagnosisContext takes precedence over rebuilt DiagnosisIndex records');
  console.log('PASS evidence pack reads DiagnosisIndex and merges diagnosis evidence');
  console.log('PASS AIEngine keeps working when DiagnosisIndex is unavailable');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
