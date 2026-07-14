const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function createContext() {
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
    document: { body: { classList: { contains() { return false; }, add() {} } } },
    location: { pathname: '/', search: '' },
  };
  context.window = context;
  vm.createContext(context);
  return context;
}

function load(context, files) {
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
}

function field(context, pattern) {
  const found = context.App.FIELDS.find((item) => pattern.test(`${item.k} ${item.l}`));
  assert.ok(found, `missing field ${pattern}`);
  return found.k;
}

function makeRecord(keys, values) {
  const rec = {};
  Object.keys(values).forEach((key) => { rec[keys[key]] = values[key]; });
  return rec;
}

function fillAllFieldValues(context, rec, periodIndex, branchIndex) {
  context.App.FIELDS.forEach((field, fieldIndex) => {
    if (rec[field.k] != null) return;
    const base = 10 + periodIndex * 2 + branchIndex + fieldIndex / 10;
    if (field.u === '%') rec[field.k] = 0.5 + ((periodIndex + branchIndex + fieldIndex) % 70) / 100;
    else if (field.u === '人') rec[field.k] = Math.round(100 + branchIndex * 25 + fieldIndex);
    else if (field.u === '万元/人') rec[field.k] = base;
    else rec[field.k] = base * 100;
  });
  return rec;
}

function installData(context) {
  const keys = {
    premium: field(context, /保费实际合计/),
    target: field(context, /时间进度计划达成率|保费达成率/),
    profit: field(context, /^经营利润\s|经营利润\|?|经营利润$/),
    profitTarget: field(context, /时间进度达成率|利润达成率/),
    cost: field(context, /综合成本率实际|综合成本率/),
    loss: field(context, /已赚赔付率实际|赔付率/),
    expense: field(context, /已赚费用率实际|费用率/),
    productivity: field(context, /整体人均产能实际|整体产能/),
    perProfit: field(context, /整体人均利润实际|人均利润/),
    laborCost: field(context, /整体人力成本保费率实际|人力成本保费率/),
    headcount: field(context, /整体人员实际|人员实际/),
  };
  const branches = [
    ['北京分公司', '华北', { premium: 90000, target: 1.05, profit: 8000, profitTarget: 1.2, cost: 0.86, loss: 0.55, expense: 0.31, productivity: 70, perProfit: 6.2, laborCost: 0.06, headcount: 1000 }],
    ['上海分公司', '华东', { premium: 86000, target: 1.01, profit: 7600, profitTarget: 1.1, cost: 0.88, loss: 0.58, expense: 0.3, productivity: 68, perProfit: 6.0, laborCost: 0.065, headcount: 980 }],
    ['广东分公司', '华南', { premium: 120000, target: 1.08, profit: 9500, profitTarget: 1.25, cost: 0.84, loss: 0.52, expense: 0.29, productivity: 75, perProfit: 6.7, laborCost: 0.055, headcount: 1200 }],
    ['广西分公司', '华南', { premium: 50000, target: 0.96, profit: 1800, profitTarget: 0.92, cost: 0.97, loss: 0.68, expense: 0.34, productivity: 45, perProfit: 1.8, laborCost: 0.095, headcount: 760 }],
    ['安徽分公司', '华东', { premium: 42000, target: 0.82, profit: -500, profitTarget: 0.6, cost: 1.08, loss: 1.12, expense: 0.36, productivity: 38, perProfit: -0.7, laborCost: 0.12, headcount: 680 }],
    ['天津分公司', '华北', { premium: 36000, target: 0.88, profit: -200, profitTarget: 0.75, cost: 1.03, loss: 0.62, expense: 0.41, productivity: 35, perProfit: -0.3, laborCost: 0.11, headcount: 520 }],
    ['深圳分公司', '华南', { premium: 68000, target: 1.02, profit: 4200, profitTarget: 1.05, cost: 0.91, loss: 0.57, expense: 0.34, productivity: 62, perProfit: 4.9, laborCost: 0.07, headcount: 740 }],
  ];
  const actuals = {};
  ['2025-05', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].forEach((period, index) => {
    actuals[period] = {
      branches: branches.map(([name, region, values], branchIndex) => {
        const factor = 0.82 + index * 0.03 + branchIndex * 0.005;
        return {
          orgId: name,
          n: name,
          r: region,
          d: fillAllFieldValues(context, makeRecord(keys, {
            premium: values.premium * factor,
            target: values.target,
            profit: values.profit * factor,
            profitTarget: values.profitTarget,
            cost: values.cost,
            loss: values.loss,
            expense: values.expense,
            productivity: values.productivity,
            perProfit: values.perProfit,
            laborCost: values.laborCost,
            headcount: values.headcount,
          }), index, branchIndex),
        };
      }),
    };
  });
  context.App.ALL_DATA = { currentMonth: '2026-05', currentPlanKey: 'auto', actuals };
  context.App.currentMonth = '2026-05';
  context.App.currentPlanKey = 'auto';
  context.refreshMergedData();
}

function bootstrap() {
  const context = createContext();
  load(context, [
    'dashboard-data.js',
    'dashboard-config.js',
    'dashboard-compute.js',
    'dashboard-diagnosis-index.js',
    'dashboard-ai-engine.js',
    'dashboard-metric-dictionary.js',
    'dashboard-query-intent.js',
  ]);
  context.resolvePlanKey = () => 'auto';
  installData(context);
  if (context.DashboardQueryIntent) context.DashboardQueryIntent.install();
  return context;
}

function assertQuestion(engine, question, expected) {
  const intent = engine.parseSearchIntent(question);
  if (!expected.unsupported && expected.task) assert.equal(intent.task, expected.task, `${question}: expected task ${expected.task}, got ${intent.task}`);
  if (expected.org) assert.ok(intent.orgs.includes(expected.org), `${question}: missing org ${expected.org}`);
  if (expected.theme) assert.equal(intent.theme, expected.theme, `${question}: expected theme ${expected.theme}, got ${intent.theme}`);
  if (expected.metric) assert.ok(intent.metrics.includes(expected.metric), `${question}: expected metric ${expected.metric}, got ${intent.metrics.join(',')}`);
  if (expected.condition) assert.ok(intent.conditions.some((item) => item.key === expected.condition), `${question}: missing condition ${expected.condition}`);
  if (expected.normalizedContains) {
    expected.normalizedContains.forEach((text) => {
      assert.ok(String(intent.normalizedQuestion || '').includes(text), `${question}: expected normalizedQuestion containing ${text}; got ${intent.normalizedQuestion}`);
    });
  }
  const result = engine.runSearch(question);
  assert.equal(result.type, expected.type || expected.task, `${question}: result type mismatch`);
  assert.equal(result.validation.passed, true);
  if (expected.hasCards !== false) assert.ok(result.cards.length > 0, `${question}: expected cards; intent=${JSON.stringify(intent)} result=${JSON.stringify(result)}`);
  if (expected.minCards) assert.ok(result.cards.length >= expected.minCards, `${question}: expected at least ${expected.minCards} cards; result=${JSON.stringify(result)}`);
  if (expected.contains) assert.ok(JSON.stringify(result).includes(expected.contains), `${question}: expected ${expected.contains}; result=${JSON.stringify(result)}`);
  if (expected.notContains) assert.ok(!JSON.stringify(result).includes(expected.notContains), `${question}: unexpected ${expected.notContains}; result=${JSON.stringify(result)}`);
  if (expected.limitations) assert.ok(result.limitations.length > 0, `${question}: expected limitations`);
  if (expected.limitContains) assert.ok(result.limitations.some((item) => item.includes(expected.limitContains)), `${question}: expected limitation containing ${expected.limitContains}; result=${JSON.stringify(result)}`);
  if (expected.optionContains) {
    expected.optionContains.forEach((text) => {
      assert.ok(result.cards.some((card) => JSON.stringify(card).includes(text)), `${question}: expected clarification option ${text}; result=${JSON.stringify(result)}`);
    });
  }
  if (expected.noConcreteData) {
    assert.equal(result.evidence.length, 0, `${question}: clarification should not include evidence data`);
    assert.equal(result.answerable, false, `${question}: clarification should be marked not directly answerable`);
    assert.ok(result.cards.every((card) => card.question && card.clarification), `${question}: clarification cards should be standard question options`);
  }
  if (expected.unsupported) {
    assert.equal(result.type, 'clarification', `${question}: unsupported question must return clarification`);
    assert.ok(result.summary.includes('当前无法按标准查询准确回答') || result.summary.includes('开放式'), `${question}: expected clarification summary`);
  }
  return result;
}

function assertMetricRegistry(context) {
  const dict = context.DashboardMetricDictionary;
  const registry = dict.buildMetricRegistry(context.App.FIELDS);
  assert.equal(registry.length, context.App.FIELDS.length, 'registry must include every App.FIELDS metric');
  registry.forEach((metric) => {
    assert.ok(metric.key, `missing key for ${JSON.stringify(metric)}`);
    assert.ok(metric.label, `missing label for ${metric.key}`);
    assert.ok(metric.unit !== undefined, `missing unit for ${metric.key}`);
    assert.ok(metric.direction, `missing direction for ${metric.key}`);
    assert.ok(Array.isArray(metric.aliases) && metric.aliases.length >= 1, `missing aliases for ${metric.key}`);
  });
  const units = new Set(registry.map((metric) => metric.unit));
  ['万元', '%', '万元/人', '人'].forEach((unit) => assert.ok(units.has(unit), `missing unit ${unit}`));
  assert.equal(dict.resolveMetric(registry, '经营利润').metric, '经营利润');
  assert.equal(dict.resolveMetric(registry, '保费').metric, '保费实际合计');
  assert.equal(dict.resolveMetric(registry, '综合成本率').unit, '%');
}

function main() {
  const context = bootstrap();
  const engine = context.AIEngine;
  assertMetricRegistry(context);
  const cases = [
    // 主题分析：不少于 8 条
    ['广西分公司人力效能情况', { task: 'theme', org: '广西分公司', theme: 'productivity', contains: '人力效能', notContains: '保费实际合计为' }],
    ['广西人效怎么样', { task: 'theme', org: '广西分公司', theme: 'productivity' }],
    ['广西人员产出好不好', { task: 'theme', org: '广西分公司', theme: 'productivity' }],
    ['广西分公司盈利能力怎么样', { task: 'theme', org: '广西分公司', theme: 'profitability' }],
    ['广西分公司成本质量如何', { task: 'theme', org: '广西分公司', theme: 'cost_quality' }],
    ['广西分公司目标达成情况', { task: 'theme', org: '广西分公司', theme: 'target' }],
    ['广东分公司保费规模怎么样', { task: 'theme', org: '广东分公司', theme: 'premium' }],
    ['北京分公司利润质量怎么样', { task: 'theme', org: '北京分公司', theme: 'profitability' }],
    ['上海分公司赔付情况如何', { task: 'theme', org: '上海分公司', theme: 'cost_quality' }],
    ['深圳成本咋样', { task: 'theme', org: '深圳分公司', theme: 'cost_quality' }],
    ['广西人效行不行', { task: 'theme', org: '广西分公司', theme: 'productivity', normalizedContains: ['广西分公司', '人力效能', '主题分析'] }],

    // 条件筛选：不少于 8 条
    ['哪些分公司保费达成不好且亏损', { task: 'filter', condition: 'target_low', contains: '安徽分公司' }],
    ['哪些分公司利润为负', { task: 'filter', condition: 'profit_negative', contains: '天津分公司' }],
    ['利润为负的机构有哪些', { task: 'filter', condition: 'profit_negative', contains: '安徽分公司' }],
    ['哪些机构赔付率高', { task: 'filter', condition: 'loss_high', contains: '安徽分公司' }],
    ['哪些分公司综合成本率高', { task: 'filter', condition: 'cost_high', contains: '安徽分公司' }],
    ['列出保费没达标的分公司', { task: 'filter', condition: 'target_low', contains: '广西分公司' }],
    ['找出成本高的机构', { task: 'filter', condition: 'cost_high', contains: '天津分公司' }],
    ['有哪些分公司目标未完成', { task: 'filter', condition: 'target_low', contains: '安徽分公司' }],
    ['哪些机构赔付高且亏损', { task: 'filter', condition: 'loss_high', contains: '安徽分公司' }],
    ['哪些公司亏得厉害', { task: 'filter', condition: 'profit_negative', contains: '天津分公司' }],
    ['赔付不太好的机构有哪些', { task: 'filter', condition: 'loss_high', contains: '安徽分公司' }],

    // 排名查询：不少于 8 条
    ['综合成本率最高的前5家是谁', { task: 'rank', contains: '综合成本率' }],
    ['目标达成最差的分公司', { task: 'rank', contains: '达成' }],
    ['人均产能最低的10家', { task: 'rank', contains: '人均' }],
    ['经营利润最高的前3家分公司', { task: 'rank', contains: '经营利润' }],
    ['保费最高的前5家', { task: 'rank', contains: '保费' }],
    ['赔付率最高的前3家', { task: 'rank', contains: '赔付率' }],
    ['费用率最低的前5家', { task: 'rank', contains: '费用率' }],
    ['人均利润最低的分公司排名', { task: 'rank', contains: '人均' }],

    // 趋势查询：不少于 8 条
    ['广东分公司近6个月保费趋势怎么样', { task: 'trend', org: '广东分公司', contains: '趋势' }],
    ['广东近6个月经营利润走势', { task: 'trend', org: '广东分公司', contains: '经营利润' }],
    ['北京分公司近3个月保费变化', { task: 'trend', org: '北京分公司', contains: '趋势' }],
    ['上海近6个月综合成本率走势', { task: 'trend', org: '上海分公司', contains: '综合成本率' }],
    ['广西近6个月人均产能趋势', { task: 'trend', org: '广西分公司', contains: '人均' }],
    ['安徽近3个月利润变化如何', { task: 'trend', org: '安徽分公司', contains: '经营利润' }],
    ['天津最近费用率走势', { task: 'trend', org: '天津分公司', contains: '费用率' }],
    ['广东分公司近6个月赔付率波动', { task: 'trend', org: '广东分公司', contains: '赔付率' }],
    ['深圳分公司近2年的综合成本率是多少', { task: 'trend', org: '深圳分公司', contains: '综合成本率', normalizedContains: ['深圳分公司', '近24个月', '综合成本率', '趋势'] }],
    ['深圳分公司近两年综合成本率走势', { task: 'trend', org: '深圳分公司', contains: '综合成本率' }],
    ['广东最近一年保费趋势怎么样', { task: 'trend', org: '广东分公司', contains: '保费' }],
    ['安徽今年以来经营利润变化如何', { task: 'trend', org: '安徽分公司', contains: '经营利润' }],
    ['北京过去24个月保费趋势怎么样', { task: 'trend', org: '北京分公司', contains: '保费', limitations: true, limitContains: '未覆盖完整近24个月' }],
    ['天津上半年经营利润变化如何', { task: 'trend', org: '天津分公司', contains: '经营利润' }],
    ['广东保费掉了没', { task: 'trend', org: '广东分公司', metric: '保费实际合计', contains: '保费', minCards: 2 }],
    ['安徽利润下滑了吗', { task: 'trend', org: '安徽分公司', metric: '经营利润', contains: '经营利润', minCards: 2 }],

    // 机构对比：不少于 8 条
    ['北京和上海哪个利润更好', { task: 'compare', contains: '北京分公司' }],
    ['北京分公司和上海分公司综合成本率对比', { task: 'compare', contains: '上海分公司' }],
    ['广东和广西保费达成率对比', { task: 'compare', contains: '广西分公司' }],
    ['安徽和天津谁的成本率更高', { task: 'compare', contains: '天津分公司' }],
    ['北京与广东人均产能比较', { task: 'compare', contains: '广东分公司' }],
    ['上海和广东哪个保费更高', { task: 'compare', contains: '上海分公司' }],
    ['广西和安徽谁利润更好', { task: 'compare', contains: '安徽分公司' }],
    ['天津和安徽费用率对比', { task: 'compare', contains: '天津分公司' }],

    // 精确查数：不少于 8 条
    ['北京分公司2026-05经营利润是多少', { task: 'snapshot', org: '北京分公司', contains: '经营利润' }],
    ['2026年5月广西综合成本率是多少', { task: 'snapshot', org: '广西分公司', contains: '综合成本率' }],
    ['上海分公司保费是多少', { task: 'snapshot', org: '上海分公司', contains: '保费' }],
    ['广东分公司赔付率是多少', { task: 'snapshot', org: '广东分公司', contains: '赔付率' }],
    ['天津分公司费用率是多少', { task: 'snapshot', org: '天津分公司', contains: '费用率' }],
    ['安徽分公司人均产能是多少', { task: 'snapshot', org: '安徽分公司', contains: '人均' }],
    ['广西分公司利润达成率是多少', { task: 'snapshot', org: '广西分公司', contains: '利润' }],
    ['北京分公司人员是多少', { task: 'snapshot', org: '北京分公司', contains: '人员' }],
    ['北京分公司车险计划是多少', { task: 'snapshot', org: '北京分公司', contains: '车险计划' }],
    ['北京分公司车险实际是多少', { task: 'snapshot', org: '北京分公司', contains: '车险实际' }],
    ['上海分公司财产险实际是多少', { task: 'snapshot', org: '上海分公司', contains: '财产险实际' }],
    ['广东分公司人身险达成率是多少', { task: 'snapshot', org: '广东分公司', contains: '人身险达成率' }],
    ['广西分公司前台产能实际是多少', { task: 'snapshot', org: '广西分公司', contains: '前台产能' }],
    ['广西分公司后台产能达成率是多少', { task: 'snapshot', org: '广西分公司', contains: '后台产能达成率' }],
    ['安徽分公司整体成本执行率是多少', { task: 'snapshot', org: '安徽分公司', contains: '整体成本执行率' }],
    ['天津分公司后台实际人数是多少', { task: 'snapshot', org: '天津分公司', contains: '后台实际' }],

    // 开放式和缺失信息：不得生成假结果
    ['安徽为什么利润下降', { task: 'snapshot', type: 'clarification', org: '安徽分公司', unsupported: true }],
    ['安徽分公司有什么改善建议', { task: 'theme', type: 'clarification', org: '安徽分公司', unsupported: true }],
    ['安徽分公司风险情况', { task: 'theme', type: 'clarification', org: '安徽分公司', unsupported: true }],
    ['广东分公司下一步怎么做', { task: 'snapshot', type: 'clarification', org: '广东分公司', unsupported: true }],
    ['不存在机构人力效能怎么样', { task: 'theme', type: 'clarification', limitations: true }],
    ['不存在指标是多少', { task: 'snapshot', type: 'clarification', limitations: true }],
    ['哪家最差', { type: 'clarification', optionContains: ['综合成本率最高的前5家是谁？', '经营利润最低的前5家是谁？', '保费达成率最低的前5家是谁？', '赔付率最高的前5家是谁？', '人均产能最低的前5家是谁？'], normalizedContains: ['选择评价口径'], noConcreteData: true }],
    ['谁不好', { type: 'clarification', optionContains: ['综合成本率最高的前5家是谁？'], noConcreteData: true }],
    ['深圳怎么样', { type: 'clarification', org: '深圳分公司', optionContains: ['深圳分公司盈利能力怎么样？', '深圳分公司成本质量怎么样？', '深圳分公司人力效能怎么样？', '深圳分公司近6个月保费趋势怎么样？'], noConcreteData: true }],
    ['问题最大的分公司是谁', { type: 'clarification', optionContains: ['经营利润最低的前5家是谁？'], noConcreteData: true }],
    ['哪些公司不好', { type: 'clarification', optionContains: ['赔付率最高的前5家是谁？'], noConcreteData: true }],
    ['哪个机构最有问题', { type: 'clarification', optionContains: ['人均产能最低的前5家是谁？'], noConcreteData: true }],
  ];
  cases.forEach(([question, expected]) => assertQuestion(engine, question, expected));
  const filter = engine.runSearch('哪些分公司保费达成不好且亏损');
  assert.ok(filter.cards.every((card) => /分公司/.test(card.org)));
  const theme = engine.runSearch('广西分公司人力效能情况');
  assert.ok(theme.cards.length >= 2);
  const trend = engine.runSearch('广东分公司近6个月保费趋势怎么样');
  assert.ok(trend.cards.length >= 2);
  const rank = engine.runSearch('综合成本率最高的前5家是谁');
  assert.ok(/低值更优|高值更优/.test(rank.summary));
  const costRank = engine.runSearch('整体成本执行率最高的前5家');
  assert.ok(JSON.stringify(costRank.cards).includes('%'), 'rank should preserve percent unit');
  assert.ok(/高值更优|低值更优/.test(costRank.summary), 'rank should explain metric direction');
  const compare = engine.runSearch('北京和上海前台成本实际对比');
  assert.ok(compare.summary.includes('万元'), 'compare should preserve amount unit');
  context.App.FIELDS.forEach((fieldItem) => {
    const result = engine.runSearch(`北京分公司${fieldItem.k}是多少`);
    assert.equal(result.type, 'snapshot', `${fieldItem.k}: exact metric key should resolve to snapshot`);
    assert.ok(result.cards.length > 0, `${fieldItem.k}: exact metric key should return data`);
    assert.ok(JSON.stringify(result).includes(fieldItem.l), `${fieldItem.k}: result should include metric label ${fieldItem.l}`);
  });
  console.log('PASS semantic search intent and execution cases');
}

main();
