const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function element() {
  return {
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    classList: { add() {}, remove() {} },
    setAttribute() {},
    appendChild() {},
    addEventListener() {},
    remove() {},
  };
}

function createContext({ pathname = '/', search = '', stored = null, response }) {
  const storage = new Map();
  if (stored) storage.set('anxiaoneng_v13', JSON.stringify(stored));
  const storageCalls = { get: 0, set: 0, remove: 0 };
  const main = element();
  const elements = new Map([
    ['shareBanner', element()],
    ['sharePeriod', element()],
    ['shareVersion', element()],
    ['sharePublishedAt', element()],
    ['shareModeLabel', element()],
  ]);
  const blocked = [];
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
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    location: { pathname, search, hostname: '127.0.0.1' },
    localStorage: {
      getItem(key) { storageCalls.get++; return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storageCalls.set++; storage.set(key, value); },
      removeItem(key) { storageCalls.remove++; storage.delete(key); },
    },
    fetch(url) {
      context.lastFetch = url;
      return Promise.resolve({
        ok: response.ok,
        status: response.status,
        text: () => Promise.resolve(JSON.stringify(response.body)),
      });
    },
    document: {
      readyState: 'loading',
      body: element(),
      addEventListener() {},
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        if (selector === '.main') return main;
        return null;
      },
      querySelectorAll() { return []; },
      createElement() { return element(); },
    },
    window: null,
    confirm() { return true; },
    alert() {},
    toast(message) { blocked.push(message); },
    showError() {},
    updateYearUI() {},
    updatePlanUI() {},
    updateMonthUI() {},
    updateMonthDropdown() {},
    destroyCharts() {},
    renderOverview() {},
    renderRegions() {},
    renderBranches() {},
    renderGuideTab() {},
    hideBranchDetail() {},
    runAlerts() {},
    initAlertRules() {},
    Chart: function () {},
    XLSX: { utils: {} },
  };
  context.window = context;
  vm.createContext(context);
  context.__test = { storage, storageCalls, main, elements, blocked };
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

function sharedResponse(allowExport = false) {
  return {
    ok: true,
    status: 200,
    body: {
      shareLinkId: 'share_1',
      mode: 'fixed',
      allowExport,
      aiEnabled: false,
      dataVersion: {
        id: 'data_published',
        period: '2026-06',
        publishedAt: '2026-06-20T08:00:00+00:00',
      },
      payload: {
        currentMonth: '2026-06',
        currentPlanKey: '2026-v1',
        actuals: {
          '2026-06': {
            branches: [{
              orgId: 'ORG_A',
              n: 'A分公司',
              r: '第一责任区',
              d: { 经营利润: 100, 已赚保费: 1000 },
            }],
          },
        },
        _plans: {
          '2026-v1': {
            branches: [{
              orgId: 'ORG_A',
              n: 'A分公司',
              r: '第一责任区',
              d: { 经营利润年度计划: 1200, 已赚保费计划: 10000 },
            }],
          },
        },
      },
    },
  };
}

const oldLocalData = {
  currentMonth: '2099-01',
  currentPlanKey: 'auto',
  actuals: {
    '2099-01': {
      branches: [{ orgId: 'ORG_B', n: 'B分公司', r: '第二责任区', d: { 经营利润: 999999 } }],
      regions: {},
      national: {},
    },
  },
  _plans: {},
};

async function testShareLoadsWithoutStorageAndRebuildsMerged() {
  const context = createContext({
    search: '?share=query-token',
    stored: oldLocalData,
    response: sharedResponse(false),
  });
  load(context, [
    'dashboard-data.js',
    'dashboard-config.js',
    'dashboard-compute.js',
    'dashboard-diagnosis-index.js',
    'dashboard-ai-engine.js',
    'dashboard-share.js',
    'dashboard-main.js',
    'dashboard-export.js',
  ]);
  context.renderAITab = () => { context.aiCalled = true; };
  context.renderAgentWorkspace = () => { context.aiCalled = true; };
  context.generateInterpretation = () => { context.aiCalled = true; };
  context.sendDiagnosisQuestion = () => { context.aiCalled = true; };
  context.editAlertRule = () => { context.ruleCalled = true; };
  context.createRemediationDraft = () => { context.remediationCalled = true; };
  context.installShareGuards();
  await context.loadSharedDashboard();

  assert.strictEqual(context.lastFetch, '/api/shared-data/query-token');
  assert.strictEqual(context.__test.storageCalls.get, 0, 'share mode must not read localStorage');
  assert.strictEqual(context.__test.storageCalls.set, 0, 'share mode must not write localStorage');
  assert.strictEqual(context.App.currentMonth, '2026-06');
  assert.strictEqual(context.App.currentPlanKey, '2026-v1');
  assert.ok(context.App.ALL_DATA._merged, '_merged should be rebuilt in browser');
  assert.ok(context.App.ALL_DATA._merged['2026-06']);
  assert.deepStrictEqual(
    Array.from(context.App.DATA.branches, (branch) => branch.n),
    ['A分公司']
  );
  assert.ok(!JSON.stringify(context.App.ALL_DATA).includes('B分公司'));

  const before = JSON.stringify(context.App.ALL_DATA);
  assert.strictEqual(context.saveAllData(), false);
  assert.strictEqual(context.importExcel({ files: [{}] }), false);
  assert.strictEqual(context.importPlanExcel({ files: [{}] }), false);
  assert.strictEqual(context.clearAllData(), false);
  assert.strictEqual(context.deletePlanVersion('2026-v1'), false);
  assert.strictEqual(context.exportData(), false);
  assert.strictEqual(context.doExport(), false);
  assert.notStrictEqual(context.switchTab('ai'), false);
  context.renderAITab();
  context.renderAgentWorkspace();
  context.generateInterpretation();
  context.sendDiagnosisQuestion();
  context.createRemediationDraft();
  context.editAlertRule();
  assert.strictEqual(context.aiCalled, true);
  assert.strictEqual(context.ruleCalled, undefined);
  assert.strictEqual(context.remediationCalled, undefined);
  assert.strictEqual(JSON.stringify(context.App.ALL_DATA), before);
  assert.strictEqual(context.__test.storageCalls.set, 0);
  const knownMetric = (
    context.App.FIELDS.find((field) => field.k === '经营利润')
    || context.App.FIELDS.find((field) => String(field.k || '').includes('经营利润'))
    || context.App.FIELDS.find((field) => field.c)
    || context.App.FIELDS[0]
  ).k;
  context.App.DATA.branches[0].d[knownMetric] = 123;
  context.App.ALL_DATA._merged['2026-06'].branches[0].d[knownMetric] = 123;
  const local = await context.AIEngine.ask(`${context.App.DATA.branches[0].n} 2026-06 ${knownMetric} 鎯呭喌`);
  assert.strictEqual(local.local, true, 'share mode must use local deterministic AI analysis');
  assert.ok(local.answer.usedEvidence.length > 0, 'local answer should cite evidence');
}

async function testShareDiagnosisQuestionDoesNotCallRemoteAI() {
  const context = createContext({
    search: '?share=diagnosis-token',
    response: sharedResponse(false),
  });
  load(context, [
    'dashboard-data.js',
    'dashboard-config.js',
    'dashboard-compute.js',
    'dashboard-diagnosis-index.js',
    'dashboard-ai-engine.js',
    'dashboard-share.js',
    'dashboard-main.js',
  ]);
  await context.loadSharedDashboard();
  context.App.shareMode = true;
  context.AICLIENT = {
    calls: [],
    chat(messages) {
      this.calls.push(messages);
      return Promise.resolve('remote should not be called');
    },
  };
  const branchName = context.App.DATA.branches[0].n;
  const metric = (
    context.App.FIELDS.find((field) => field.k === '缁忚惀鍒╂鼎')
    || context.App.FIELDS.find((field) => String(field.k || '').includes('缁忚惀鍒╂鼎'))
    || context.App.FIELDS.find((field) => field.c)
    || context.App.FIELDS[0]
  ).k;
  const record = {
    orgName: branchName,
    orgId: 'ORG_A',
    orgType: 'branch',
    region: 'Region One',
    period: '2026-06',
    riskLevel: 'HIGH_RISK',
    riskScore: 90,
    summary: 'share diagnosis risk summary',
    triggeredAlerts: [{
      ruleId: 'share_diag_rule',
      severity: 'error',
      field: metric,
      fieldLabel: 'Share Metric',
      currentValue: 123,
      threshold: 100,
      op: '>',
      msg: 'share diagnosis alert',
      unit: 'unit',
      branchName,
    }],
    triggeredMetrics: [metric],
    facts: [{ text: 'share diagnosis fact', evidenceId: 'ev_share_diag' }],
    patterns: [{ name: 'share diagnosis pattern' }],
    inferences: [{ text: 'share diagnosis reason' }],
    recommendations: [{ action: 'share diagnosis recommendation' }],
    evidenceMetrics: [{
      id: 'ev_share_diag',
      orgName: branchName,
      period: '2026-06',
      metricKey: metric,
      metricId: 'metric_share_diag',
      metricLabel: 'Share Metric',
      currentValue: 123,
      formattedValue: '123.00unit',
      benchmarkValue: 100,
      differenceValue: 23,
      unit: 'unit',
      severity: 'error',
      ruleId: 'share_diag_rule',
      source: 'share-diagnosis-mock',
    }],
    source: 'local_diagnosis',
    calculationVersion: 'share-test-v1',
  };
  context.DiagnosisIndex = context.window.DiagnosisIndex = {
    build() { return [record]; },
    get(orgName, period) { return orgName === branchName && period === '2026-06' ? record : null; },
    list(period) { return period === '2026-06' ? [record] : []; },
    searchByRisk() { return [record]; },
    searchByMetric() { return [record]; },
    getEvidence(orgName, period) { return orgName === branchName && period === '2026-06' ? record.evidenceMetrics : []; },
  };

  const result = await context.AIEngine.ask('这个机构为什么是高风险？', {
    org: branchName,
    period: '2026-06',
    useDiagnosis: true,
    mode: 'deep',
  });
  assert.strictEqual(result.local, true);
  assert.strictEqual(context.AICLIENT.calls.length, 0);
  assert.ok(result.answer.usedEvidence.length > 0);
  assert.strictEqual(result.answer.riskLevel, 'HIGH_RISK');
  assert.ok((result.answer.triggeredAlerts || []).some((alert) => alert.ruleId === 'share_diag_rule'));
  assert.ok((result.answer.recommendations || []).some((item) => String(item).includes('share diagnosis recommendation')));
}

async function testShareLoadsWithEmptyStorage() {
  const context = createContext({
    search: '?share=empty-storage-token',
    response: sharedResponse(false),
  });
  load(context, [
    'dashboard-data.js',
    'dashboard-config.js',
    'dashboard-compute.js',
    'dashboard-share.js',
    'dashboard-main.js',
  ]);
  await context.loadSharedDashboard();
  assert.strictEqual(context.__test.storageCalls.get, 0);
  assert.strictEqual(context.__test.storageCalls.set, 0);
  assert.strictEqual(context.App.DATA.branches[0].n, 'A分公司');
}
async function testPathTokenAndInvalidShareNeverFallsBack() {
  const context = createContext({
    pathname: '/share/path-token',
    stored: oldLocalData,
    response: { ok: false, status: 404, body: { detail: '分享链接不可用' } },
  });
  load(context, [
    'dashboard-data.js',
    'dashboard-config.js',
    'dashboard-compute.js',
    'dashboard-share.js',
    'dashboard-main.js',
  ]);
  let failed = false;
  try { await context.loadSharedDashboard(); } catch (error) { failed = true; }
  assert.ok(failed);
  assert.strictEqual(context.lastFetch, '/api/shared-data/path-token');
  assert.strictEqual(context.__test.storageCalls.get, 0);
  assert.strictEqual(context.__test.storageCalls.set, 0);
  assert.deepStrictEqual(Object.keys(context.App.ALL_DATA.actuals), []);
  assert.ok(context.__test.main.innerHTML.includes('分享数据不可用'));
  assert.ok(!context.__test.main.innerHTML.includes('B分公司'));
}

function testNormalModeStillUsesExistingStorageFlow() {
  const context = createContext({
    stored: oldLocalData,
    response: sharedResponse(false),
  });
  load(context, [
    'dashboard-data.js',
    'dashboard-config.js',
    'dashboard-compute.js',
    'dashboard-share.js',
    'dashboard-main.js',
  ]);
  assert.strictEqual(context.App.shareMode, false);
  context.initData();
  assert.ok(context.__test.storageCalls.get > 0);
  assert.strictEqual(context.App.currentMonth, '2099-01');
  assert.strictEqual(context.App.ALL_DATA.actuals['2099-01'].branches[0].n, 'B分公司');
  context.cancelPendingSave();
}

async function main() {
  await testShareLoadsWithEmptyStorage();
  await testShareLoadsWithoutStorageAndRebuildsMerged();
  await testShareDiagnosisQuestionDoesNotCallRemoteAI();
  await testPathTokenAndInvalidShareNeverFallsBack();
  testNormalModeStillUsesExistingStorageFlow();
  console.log('PASS share loads with empty/foreign localStorage ignored');
  console.log('PASS filtered data rebuilds _merged in browser');
  console.log('PASS read-only, export, AI and remediation guards');
  console.log('PASS share diagnosis questions stay local and do not call remote AI');
  console.log('PASS invalid token never falls back to old local data');
  console.log('PASS ordinary non-share mode remains unchanged');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
