(function(){
  'use strict';

  var CALCULATION_VERSION = 'diagnosis-index-v1';
  var state = {
    period: null,
    records: [],
    byKey: {},
    builtAt: null,
    calculationVersion: CALCULATION_VERSION
  };

  function app(){
    return window.App || {};
  }

  function clone(value){
    if(value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch(e){
      if(Array.isArray(value)) return value.slice();
      if(typeof value === 'object') return Object.assign({}, value);
      return value;
    }
  }

  function array(value){
    return Array.isArray(value) ? value : [];
  }

  function stableHash(input){
    var str = '';
    try { str = JSON.stringify(input); }
    catch(e){ str = String(input); }
    var h = 2166136261;
    for(var i=0;i<str.length;i++){
      h ^= str.charCodeAt(i);
      h += (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24);
    }
    return (h >>> 0).toString(36);
  }

  function keyOf(orgName, period){
    return String(period || '') + '::' + String(orgName || '');
  }

  function currentPeriod(){
    var A = app();
    return A.currentMonth || (A.ALL_DATA && A.ALL_DATA.currentMonth) || '';
  }

  function fieldList(){
    return array(app().FIELDS);
  }

  function fieldMeta(metricKey){
    var A = app();
    if(A && typeof A.getMetricMeta === 'function'){
      var metricMeta = A.getMetricMeta(metricKey);
      if(metricMeta){
        return {
          key: metricKey,
          metricId: metricMeta.metricId || metricMeta.id || metricKey,
          label: metricMeta.label || metricMeta.l || metricKey,
          unit: metricMeta.unit || metricMeta.u || '',
          calculationVersion: metricMeta.calculationVersion || metricMeta.version || null
        };
      }
    }
    var meta = fieldList().find(function(item){ return item && item.k === metricKey; }) || {};
    return {
      key: metricKey,
      metricId: meta.metricId || meta.id || meta.k || metricKey,
      label: meta.l || meta.label || metricKey,
      unit: meta.u || meta.unit || '',
      calculationVersion: meta.calculationVersion || null
    };
  }

  function asNumber(value){
    if(value === '' || value == null) return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function formatValue(value, unit){
    var n = asNumber(value);
    if(n == null) return value == null ? '' : String(value);
    if(unit === '%') return (n * 100).toFixed(2) + '%';
    if(unit === '人') return Math.round(n).toLocaleString('zh-CN') + unit;
    if(unit) return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + unit;
    return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function severityRank(severity){
    if(severity === 'error' || severity === '高风险') return 3;
    if(severity === 'warn' || severity === '中风险') return 2;
    if(severity === 'info' || severity === '提示' || severity === '关注') return 1;
    return 0;
  }

  function scoreFromAlerts(alerts){
    var score = 0;
    array(alerts).forEach(function(alert){
      if(alert.severity === 'error') score += 30;
      else if(alert.severity === 'warn') score += 15;
      else score += 5;
    });
    return Math.min(100, score);
  }

  function normalizeRiskLevel(level, alerts){
    if(level) return String(level);
    var max = array(alerts).reduce(function(acc, item){
      return Math.max(acc, severityRank(item && item.severity));
    }, 0);
    if(max >= 3) return '高风险';
    if(max >= 2) return '中风险';
    if(max >= 1) return '低风险';
    return '正常';
  }

  function normalizeRiskScore(model, alerts, riskLevel){
    var score = asNumber(model && (model.riskScore != null ? model.riskScore : model.score));
    if(score == null) score = scoreFromAlerts(alerts);
    if(riskLevel === '高风险') score = Math.max(score, 80);
    else if(riskLevel === '中风险') score = Math.max(score, 50);
    else if(riskLevel === '低风险' || riskLevel === '关注') score = Math.max(score, 20);
    else if(!array(alerts).length) score = Math.min(score, 10);
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function branchOrgId(branch, orgName){
    var A = app();
    if(A && typeof A.getOrgId === 'function'){
      try { return A.getOrgId(orgName, 'branch') || orgName; }
      catch(e){}
    }
    return branch.orgId || branch.id || branch.org_id || orgName;
  }

  function normalizeEvidenceMetric(raw, orgName, period, fallback){
    fallback = fallback || {};
    var metricKey = raw.metricKey || raw.metric || raw.field || raw.metric_id || raw.metricId || fallback.metricKey || '';
    var meta = fieldMeta(metricKey);
    var metricId = raw.metricId || raw.metric_id || meta.metricId || metricKey;
    var label = raw.metricLabel || raw.label || raw.fieldLabel || meta.label || metricKey;
    var unit = raw.unit != null ? raw.unit : (meta.unit || '');
    var currentValue = raw.currentValue != null ? raw.currentValue : raw.current_value;
    var benchmarkValue = raw.benchmarkValue != null ? raw.benchmarkValue : (raw.benchmark_value != null ? raw.benchmark_value : raw.threshold);
    var differenceValue = raw.differenceValue != null ? raw.differenceValue : raw.difference;
    var currentNumber = asNumber(currentValue);
    var benchmarkNumber = asNumber(benchmarkValue);
    if(differenceValue == null && currentNumber != null && benchmarkNumber != null){
      differenceValue = currentNumber - benchmarkNumber;
    }
    var id = raw.id || ('ev_' + stableHash([orgName, period, metricId, currentValue, benchmarkValue, raw.ruleId || raw.rule_id || fallback.ruleId]));
    return {
      id: id,
      orgName: raw.orgName || orgName,
      period: raw.period || period,
      metricKey: metricKey,
      metricId: metricId,
      metricLabel: label,
      currentValue: currentValue,
      formattedValue: raw.formattedValue || raw.formatted_value || formatValue(currentValue, unit),
      benchmarkValue: benchmarkValue == null ? null : benchmarkValue,
      differenceValue: differenceValue == null ? null : differenceValue,
      unit: unit,
      severity: raw.severity || fallback.severity || null,
      ruleId: raw.ruleId || raw.rule_id || fallback.ruleId || null,
      source: raw.source || fallback.source || 'local_diagnosis'
    };
  }

  function evidenceFromAlert(alert, orgName, period){
    return normalizeEvidenceMetric({
      id: alert.evidenceId,
      field: alert.field,
      fieldLabel: alert.fieldLabel,
      currentValue: alert.currentValue,
      benchmarkValue: alert.threshold,
      unit: alert.unit,
      severity: alert.severity,
      ruleId: alert.ruleId,
      source: 'alert_rule'
    }, orgName, period);
  }

  function evidenceFromBranchSnapshot(branch, orgName, period, metricKey){
    if(!metricKey || !branch || !branch.d) return null;
    if(branch.d[metricKey] == null) return null;
    return normalizeEvidenceMetric({
      field: metricKey,
      currentValue: branch.d[metricKey],
      source: 'branch_snapshot'
    }, orgName, period);
  }

  function uniqueById(items){
    var seen = {};
    return array(items).filter(function(item){
      if(!item || !item.id) return false;
      if(seen[item.id]) return false;
      seen[item.id] = true;
      return true;
    });
  }

  function triggeredMetricKeys(alerts, model){
    var map = {};
    array(alerts).forEach(function(alert){
      if(alert && alert.field) map[alert.field] = true;
    });
    array(model && model.riskFactors).forEach(function(item){
      if(item && item.metric) map[item.metric] = true;
      if(item && item.metricKey) map[item.metricKey] = true;
    });
    array(model && model.facts).forEach(function(item){
      if(item && item.isRiskMetric && item.metric) map[item.metric] = true;
      if(item && item.isRiskMetric && item.metricKey) map[item.metricKey] = true;
    });
    return Object.keys(map);
  }

  function buildRecord(branch, period, alerts){
    var orgName = branch.n || branch.name || branch.orgName || '';
    var model = null;
    if(typeof window.buildDiagnosisModel === 'function'){
      try { model = window.buildDiagnosisModel(orgName, alerts) || null; }
      catch(e){ model = null; }
    }
    var riskLevel = normalizeRiskLevel(model && model.riskLevel, alerts);
    var riskScore = normalizeRiskScore(model, alerts, riskLevel);
    var metricKeys = triggeredMetricKeys(alerts, model);
    var evidence = [];
    array(model && model.evidence).forEach(function(item){
      evidence.push(normalizeEvidenceMetric(item || {}, orgName, period));
    });
    array(alerts).forEach(function(alert){
      evidence.push(evidenceFromAlert(alert, orgName, period));
    });
    if(!evidence.length){
      var preferred = (app().KEY_SET && typeof app().KEY_SET.forEach === 'function') ? [] : fieldList().slice(0, 5).map(function(f){ return f.k; });
      if(app().KEY_SET && typeof app().KEY_SET.forEach === 'function') app().KEY_SET.forEach(function(k){ preferred.push(k); });
      preferred.slice(0, 8).forEach(function(metricKey){
        var item = evidenceFromBranchSnapshot(branch, orgName, period, metricKey);
        if(item) evidence.push(item);
      });
    }
    evidence = uniqueById(evidence);
    var summary = (model && model.summary) || (orgName + ' ' + period + (riskLevel === '正常' ? ' 当前未触发规则预警。' : ' 当前为' + riskLevel + '，触发' + array(alerts).length + '条预警。'));
    return {
      orgName: orgName,
      orgId: (model && model.orgId) || branchOrgId(branch, orgName),
      orgType: 'branch',
      region: branch.r || branch.region || branch.regionName || null,
      period: (model && model.period) || period,
      riskLevel: riskLevel,
      riskScore: riskScore,
      summary: summary,
      triggeredAlerts: clone(alerts) || [],
      triggeredMetrics: metricKeys,
      facts: clone(model && model.facts) || [],
      patterns: clone(model && model.patterns) || [],
      inferences: clone(model && model.inferences) || [],
      recommendations: clone(model && model.recommendations) || [],
      evidenceMetrics: evidence,
      source: 'local_diagnosis',
      calculationVersion: (model && model.calculationVersion) || CALCULATION_VERSION
    };
  }

  function build(){
    var A = app();
    var period = currentPeriod();
    var branches = array(A.DATA && A.DATA.branches);
    var alerts = array(A._alertResults).filter(function(item){ return item && item.branchName; });
    var alertsByBranch = {};
    alerts.forEach(function(alert){
      var name = alert.branchName;
      if(!alertsByBranch[name]) alertsByBranch[name] = [];
      alertsByBranch[name].push(alert);
    });
    var records = branches.map(function(branch){
      var name = branch.n || branch.name || branch.orgName || '';
      return buildRecord(branch, period, alertsByBranch[name] || []);
    }).filter(function(record){ return !!record.orgName; });
    var byKey = {};
    records.forEach(function(record){
      byKey[keyOf(record.orgName, record.period)] = record;
    });
    state.period = period;
    state.records = records;
    state.byKey = byKey;
    state.builtAt = new Date().toISOString();
    state.calculationVersion = CALCULATION_VERSION;
    return records;
  }

  function ensure(period){
    var desired = period || currentPeriod();
    if(!state.records.length || state.period !== desired) build();
  }

  function list(period){
    ensure(period);
    var p = period || state.period;
    return state.records.filter(function(record){ return !p || record.period === p; });
  }

  function get(orgName, period){
    ensure(period);
    var p = period || state.period;
    return state.byKey[keyOf(orgName, p)] || null;
  }

  function searchByRisk(riskLevel, period){
    return list(period).filter(function(record){ return record.riskLevel === riskLevel; });
  }

  function searchByMetric(metricKey, period){
    return list(period).filter(function(record){
      if(array(record.triggeredMetrics).indexOf(metricKey) >= 0) return true;
      return array(record.evidenceMetrics).some(function(item){
        return item.metricKey === metricKey || item.metricId === metricKey;
      });
    });
  }

  function getEvidence(orgName, period){
    var record = get(orgName, period);
    return record ? array(record.evidenceMetrics) : [];
  }

  window.DiagnosisIndex = {
    build: build,
    get: get,
    list: list,
    searchByRisk: searchByRisk,
    searchByMetric: searchByMetric,
    getEvidence: getEvidence,
    _state: state,
    calculationVersion: CALCULATION_VERSION
  };
})();
