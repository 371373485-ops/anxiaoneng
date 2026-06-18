const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const requests = [];
const storage = new Map();

const context = {
  App: {},
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
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
    removeItem(key) {
      storage.delete(key);
    },
  },
  fetch(url, options) {
    requests.push({ url, options });
    return Promise.resolve({ ok: true, status: 200 });
  },
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  },
  window: {},
  confirm() {
    return true;
  },
  alert() {},
  toast() {},
  updateYearUI() {},
  updatePlanUI() {},
  updateMonthUI() {},
  destroyCharts() {},
  switchTab() {},
  runAlerts() {},
};
context.window = context;
vm.createContext(context);

for (const file of ['dashboard-compute.js', 'dashboard-data.js', 'dashboard-main.js']) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(code, context, { filename: file });
}

context.toast = function () {};
context.refreshMergedData = function () {
  context.App.ALL_DATA._merged = {};
};
context.updateYearUI = function () {};
context.updatePlanUI = function () {};
context.updateMonthUI = function () {};
context.destroyCharts = function () {};
context.switchTab = function () {};

async function main() {
  context.App.ALL_DATA = {
    _plans: {},
    actuals: {
      '2099-01': {
        branches: [{ n: '旧数据', r: '一区', d: {} }],
        regions: {},
        national: {},
      },
    },
    _merged: {
      '2099-01': {
        branches: [{ n: '旧数据', r: '一区', d: {} }],
        regions: {},
        national: {},
      },
    },
    _importTimes: {},
    currentMonth: '2099-01',
    currentPlanKey: 'auto',
  };
  context.App.currentMonth = '2099-01';
  context.App.currentPlanKey = 'auto';
  context.App.currentYear = '2099';

  const dataDescriptor = Object.getOwnPropertyDescriptor(context.App.DATA, 'branches');
  assert.strictEqual(typeof dataDescriptor.get, 'function');

  context.saveAllData();
  assert.ok(context.App._saveTimer, 'delayed save timer should exist');

  await context.clearAllData();
  await new Promise((resolve) => setTimeout(resolve, 2200));

  assert.strictEqual(requests.length, 1, 'only the clear backup request should occur');
  assert.strictEqual(requests[0].url, '/save-backup');
  assert.strictEqual(requests[0].options.headers['Content-Type'], 'application/json');

  const payload = JSON.parse(requests[0].options.body);
  assert.deepStrictEqual(payload.actuals, {});
  assert.strictEqual(context.App._saveTimer, null);

  const currentDescriptor = Object.getOwnPropertyDescriptor(context.App.DATA, 'branches');
  assert.strictEqual(typeof currentDescriptor.get, 'function');
  assert.deepStrictEqual(Array.from(context.App.DATA.branches), []);

  console.log('PASS one /save-backup request');
  console.log('PASS cleared actuals payload');
  console.log('PASS pending delayed save cancelled');
  console.log('PASS App.DATA.branches getter preserved and empty');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
