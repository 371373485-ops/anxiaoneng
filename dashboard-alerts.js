// 指标预警引擎（全国 + 所有分公司）

// 调试：在浏览器控制台执行 debugAlerts() 查看所有预警详情
function debugAlerts() {
  if (!App._alertResults) { if(App&&App.debug)console.log('尚未运行预警，请先切换Tab或刷新'); return; }
  var results = App._alertResults;
  var rules = App.ALL_DATA._alertRules || App.DEFAULT_ALERT_RULES;
  if(App&&App.debug)console.log('=== 预警规则 (' + rules.length + '条) ===');
  rules.forEach(function(r, i) {
    var status = r.disabled ? ' [已禁用]' : '';
    var fi = App.FIELDS.find(function(f) { return f.k === r.field; });
    if(App&&App.debug)console.log((i+1) + '. ' + (fi ? fi.l : r.field) + ' ' + r.op + ' ' + r.value + ' (' + r.severity + ')' + status);
  });
  if(App&&App.debug)console.log('=== 触发结果 (' + results.length + '条) ===');
  if (results.length === 0) { if(App&&App.debug)console.log('(无触发)'); return; }
  // 按层级分组
  var nat = results.filter(function(r) { return !r.branchName && !r.regionName; });
  var reg = results.filter(function(r) { return r.regionName; });
  var br = results.filter(function(r) { return r.branchName; });
  if(App&&App.debug)console.log('--- 全国 (' + nat.length + ') ---');
  nat.forEach(function(r) { if(App&&App.debug)console.log(r.severity + ' | ' + r.fieldLabel + ' = ' + r.currentValue + ' ' + r.op + ' ' + r.threshold); });
  if(App&&App.debug)console.log('--- 责任区 (' + reg.length + ') ---');
  reg.forEach(function(r) { if(App&&App.debug)console.log(r.severity + ' | ' + r.regionName + ' | ' + r.fieldLabel + ' = ' + r.currentValue + ' ' + r.op + ' ' + r.threshold); });
  if(App&&App.debug)console.log('--- 分公司 (' + br.length + ') ---');
  br.forEach(function(r) { if(App&&App.debug)console.log(r.severity + ' | ' + r.branchName + ' | ' + r.fieldLabel + ' = ' + r.currentValue + ' ' + r.op + ' ' + r.threshold); });
}

// 调试：查看指定分公司/责任区所有指标值
function dumpData(name) {
  var branches = App.DATA.branches || [];
  var regions = App.DATA.regions || {};
  var nat = App.DATA.national || {};
  
  if (!name || name === '全国') {
    if(App&&App.debug)console.log('=== 全国数据 ===');
    App.FIELDS.forEach(function(f) { if(App&&App.debug)console.log(f.l + ': ' + (nat[f.k]!=null ? nat[f.k] : '(无)')); });
    return;
  }
  
  // Check regions
  if (regions[name]) {
    if(App&&App.debug)console.log('=== 责任区: ' + name + ' ===');
    App.FIELDS.forEach(function(f) { if(App&&App.debug)console.log(f.l + ': ' + (regions[name][f.k]!=null ? regions[name][f.k] : '(无)')); });
    return;
  }
  
  // Check branches
  var b = branches.find(function(b) { return b.n === name; });
  if (b) {
    if(App&&App.debug)console.log('=== 分公司: ' + name + ' ===');
    var d = b.d || {};
    App.FIELDS.forEach(function(f) { if(App&&App.debug)console.log(f.l + ': ' + (d[f.k]!=null ? d[f.k] : '(无)')); });
    return;
  }
  
  if(App&&App.debug)console.log('未找到: ' + name + '。用法: dumpData("分公司名") 或 dumpData("全国") 或 dumpData("责任区名")');
}

// 默认预警规则（注意：% 类指标内部是小数，阈值用小数；万元/人/万元类用实际值）
App.DEFAULT_ALERT_RULES = [
  { field:'时间进度计划达成率',             op:'<',  value:0.80, severity:'error', msg:'保费达成率低于80%' },
  { field:'时间进度达成率',                 op:'<',  value:0.80, severity:'error', msg:'利润达成率低于80%' },
  { field:'综合成本率实际（整体利润口径）', op:'>=', value:1.00, severity:'error', msg:'综合成本率超过100%' }
];

// 严重级别配置
App.ALERT_COLORS = {
  error: { color:'#b91c1c', bg:'#fee2e2', border:'#fca5a5', icon:'🔴', label:'严重' },
  warn:  { color:'#92400e', bg:'#fef3c7', border:'#fcd34d', icon:'🟠', label:'警告' },
  info:  { color:'#1e40af', bg:'#dbeafe', border:'#93c5fd', icon:'🔵', label:'提示' }
};

// 初始化规则（首次加载默认禁用，用户需主动启用）
function initAlertRules() {
  var firstLoad = !App.ALL_DATA._alertRules;
  if (firstLoad) {
    App.ALL_DATA._alertRules = JSON.parse(JSON.stringify(App.DEFAULT_ALERT_RULES));
  } else {
    // 迁移旧规则：百分比阈值从 90/95/65 转为 0.90/0.95/0.65
    App.ALL_DATA._alertRules.forEach(function(r) {
      var fi = App.FIELDS.find(function(f) { return f.k === r.field; });
      if (fi && fi.u === '%' && r.value > 1) {
        r.value = r.value / 100;
      }
    });
  }
  // 确保每条规则有 id
  App.ALL_DATA._alertRules.forEach(function(r, i) {
    if (!r.id) r.id = 'ar_' + i + '_' + Date.now();
  });
}

// 对单条数据检查所有规则
function checkDataAgainstRules(data, branchName, rules, results, regionName) {
  rules.forEach(function(rule) {
    if (rule.disabled) return;
    var raw = data[rule.field];
    // 跳过空值：null、undefined、空字符串不参与比较
    if (raw === null || raw === undefined || raw === '') return;
    var current = Number(raw);
    if (isNaN(current)) return;
    var triggered = false;
    switch(rule.op) {
      case '>':  triggered = current > rule.value; break;
      case '<':  triggered = current < rule.value; break;
      case '>=': triggered = current >= rule.value; break;
      case '<=': triggered = current <= rule.value; break;
      case '!=': triggered = current !== rule.value; break;
    }
    if (triggered) {
      var fieldInfo = App.FIELDS.find(function(f) { return f.k === rule.field; });
      results.push({
        ruleId: rule.id,
        severity: rule.severity,
        field: rule.field,
        fieldLabel: fieldInfo ? fieldInfo.l : rule.field,
        currentValue: current,
        threshold: rule.value,
        op: rule.op,
        msg: rule.msg,
        unit: fieldInfo ? fieldInfo.u : '',
        branchName: branchName || null,
        regionName: regionName || null
      });
    }
  });
}

// 运行预警检查 — 全国 + 责任区 + 所有分公司
function runAlerts() {
  var rules = App.ALL_DATA._alertRules || [];
  var activeRules = rules.filter(function(r) { return !r.disabled; });
  
  // 无启用规则时清除所有预警
  if (activeRules.length === 0) {
    App._alertResults = [];
    var ab = document.getElementById('alert-bar'); if(ab) ab.style.display = 'none';
    var rb = document.getElementById('regions-badge'); if(rb) rb.style.display = 'none';
    var bb = document.getElementById('branches-badge'); if(bb) bb.style.display = 'none';
    var ai = document.getElementById('ai-badge'); if(ai) { ai.textContent = '0'; ai.style.display = 'none'; }
    return;
  }
  
  var results = [];
  
  // 检查全国汇总
  checkDataAgainstRules(App.DATA.national, null, activeRules, results);
  
  // 检查每个责任区
  var regionData = App.DATA.regions || {};
  (App.REGIONS || []).forEach(function(r) {
    var rd = regionData[r];
    if (rd) checkDataAgainstRules(rd, null, activeRules, results, r);
  });
  
  // 检查每个分公司
  var branches = App.DATA.branches || [];
  branches.forEach(function(b) {
    checkDataAgainstRules(b.d || b, b.n, activeRules, results);
  });
  
  // 存储结果供渲染使用
  App._alertResults = results;
  
  // 渲染预警 UI
  renderAlertBar(results);
  renderNavBadge(results);
  
  return results;
}

// 顶部汇总条
function renderAlertBar(results) {
  var bar = document.getElementById('alert-bar');
  if (!bar) return;
  
  if (results.length === 0) {
    bar.style.display = 'none';
    return;
  }
  
  bar.style.display = 'block';
  var errors = results.filter(function(r) { return r.severity === 'error'; });
  var warns = results.filter(function(r) { return r.severity === 'warn'; });
  var infos = results.filter(function(r) { return r.severity === 'info'; });
  
  // 统计涉及的分公司和责任区数
  var branchSet = {};
  var regionSet = {};
  results.forEach(function(r) { if (r.branchName) branchSet[r.branchName] = true; if (r.regionName) regionSet[r.regionName] = true; });
  var branchCount = Object.keys(branchSet).length;
  var regionCount = Object.keys(regionSet).length;
  
  var parts = [];
  if (errors.length) parts.push(errors.length + '项严重');
  if (warns.length) parts.push(warns.length + '项警告');
  if (infos.length) parts.push(infos.length + '项提示');
  
  var summary = '⚠️ ' + results.length + ' 项指标异常（' + parts.join(' / ') + '）';
  var scopeParts = [];
  if (regionCount > 0) scopeParts.push(regionCount + ' 个责任区');
  if (branchCount > 0) scopeParts.push(branchCount + ' 个分公司');
  if (scopeParts.length > 0) summary += ' 涉及 ' + scopeParts.join('、');
  
  var expanded = bar.classList.contains('open');
  
  var h = '<div class="alert-summary" onclick="var p=this.parentNode;p.classList.toggle(\'open\')" style="cursor:pointer;font-weight:600;font-size:13px">' + summary + ' <span class="alert-toggle">' + (expanded ? '▲' : '▼') + '</span></div>';
  h += '<div class="alert-detail">';
  
  // 按层级分组：全国、责任区、分公司
  var nationalItems = results.filter(function(r) { return !r.branchName && !r.regionName; });
  var regionItems = results.filter(function(r) { return r.regionName; });
  var branchItems = results.filter(function(r) { return r.branchName; });
  
  function renderAlertItem(r) {
    var ac = App.ALERT_COLORS[r.severity] || App.ALERT_COLORS.info;
    var fv = fmtVal(r.currentValue, r.unit);
    var th = fmtVal(r.threshold, r.unit);
    var s = '<div class="alert-item" style="padding:6px 12px;border-left:3px solid ' + ac.color + ';margin:4px 0;background:' + ac.bg + ';border-radius:4px;font-size:12px">';
    s += '<span style="margin-right:6px">' + ac.icon + '</span>';
    s += '<b>' + escapeHtml(r.fieldLabel) + '</b> &nbsp;当前: <b style="color:' + ac.color + '">' + escapeHtml(fv) + '</b>';
    s += ' &nbsp;' + escapeHtml(r.op) + ' ' + escapeHtml(th);
    s += ' &nbsp;<span style="color:' + ac.color + '">[' + escapeHtml(ac.label) + ']</span>';
    if (r.regionName) s += ' &nbsp;<span style="color:#6b21a8;font-size:11px">— ' + escapeHtml(r.regionName) + '</span>';
    if (r.branchName) s += ' &nbsp;<span style="color:#888;font-size:11px">— ' + escapeHtml(r.branchName) + '</span>';
    s += '</div>';
    return s;
  }
  
  if (nationalItems.length > 0) {
    h += '<div style="font-size:11px;color:#888;padding:4px 12px;margin-top:4px">📊 全国</div>';
    nationalItems.forEach(function(r) { h += renderAlertItem(r); });
  }
  
  if (regionItems.length > 0) {
    h += '<div style="font-size:11px;color:#888;padding:4px 12px;margin-top:8px">🗺️ 责任区</div>';
    regionItems.forEach(function(r) { h += renderAlertItem(r); });
  }
  
  if (branchItems.length > 0) {
    h += '<div style="font-size:11px;color:#888;padding:4px 12px;margin-top:8px">🏢 分公司</div>';
    branchItems.forEach(function(r) { h += renderAlertItem(r); });
  }
  
  h += '</div>';
  bar.innerHTML = h;
  
  if (!expanded) {
    var detail = bar.querySelector('.alert-detail');
    if (detail) detail.style.display = 'none';
  }
}

// 导航栏角标 — 分别在责任区对比 / 分公司明细 tab 上显示预警数量
function renderNavBadge(results) {
  var regBadge = document.getElementById('regions-badge');
  var brBadge = document.getElementById('branches-badge');
  
  // 对比模式下隐藏 tab 角标
  if (App.isCompareMode) {
    if (regBadge) regBadge.style.display = 'none';
    if (brBadge) brBadge.style.display = 'none';
    return;
  }
  var regResults = results.filter(function(r) { return r.regionName; });
  if (regBadge) {
    var regRegions = {}; regResults.forEach(function(r) { regRegions[r.regionName] = true; });
    var regCount = Object.keys(regRegions).length;
    if (regCount === 0) {
      regBadge.style.display = 'none';
    } else {
      regBadge.style.display = 'inline-block';
      regBadge.textContent = regCount;
      var hasRegError = regResults.some(function(r) { return r.severity === 'error'; });
      regBadge.style.background = hasRegError ? '#dc2626' : '#d97706';
    }
  }
  
  // 分公司预警数量
  var brResults = results.filter(function(r) { return r.branchName; });
  if (brBadge) {
    var brSet = {}; brResults.forEach(function(r) { brSet[r.branchName] = true; });
    var brCount = Object.keys(brSet).length;
    if (brCount === 0) {
      brBadge.style.display = 'none';
    } else {
      brBadge.style.display = 'inline-block';
      brBadge.textContent = brCount;
      var hasBrError = brResults.some(function(r) { return r.severity === 'error'; });
      brBadge.style.background = hasBrError ? '#dc2626' : '#d97706';
    }
  }
}

// 预警配置面板
var _alertEditId = null; // 当前正在编辑的规则 id
function renderAlertConfig() {
  var rules = App.ALL_DATA._alertRules || App.DEFAULT_ALERT_RULES;
  
  var h = '<div class="data-section"><h4>🔔 预警规则设置</h4>';
  h += '<p style="font-size:11px;color:#888;margin:4px 0 12px">规则对<strong>全国汇总 + 所有分公司</strong>同时生效。修改/删除立即生效。编辑需先禁用规则。</p>';
  
  h += '<div class="tbl-wrap"><table><thead><tr><th>指标</th><th>条件</th><th>阈值</th><th>级别</th><th>说明</th><th>操作</th></tr></thead><tbody>';
  rules.forEach(function(r, i) {
    var ac = App.ALERT_COLORS[r.severity] || App.ALERT_COLORS.info;
    var fieldInfo = App.FIELDS.find(function(f) { return f.k === r.field; });
    var label = fieldInfo ? fieldInfo.l : r.field;
    var disabledStyle = r.disabled ? 'opacity:.4' : '';
    var isEditing = _alertEditId === r.id;
    
    if (isEditing) {
      // 编辑模式
      h += '<tr style="background:#fffbeb;' + disabledStyle + '">';
      h += '<td><select id="editAlertField" style="padding:2px 4px;border-radius:3px;border:1px solid #ccc;font-size:11px;max-width:140px">';
      App.FIELDS.forEach(function(f) {
        h += '<option value="' + escapeHtml(f.k) + '"' + (f.k === r.field ? ' selected' : '') + '>' + escapeHtml(f.l) + '</option>';
      });
      h += '</select></td>';
      h += '<td><select id="editAlertOp" style="padding:2px 4px;border-radius:3px;border:1px solid #ccc;font-size:11px">';
      ['>=','<=','>','<','!='].forEach(function(op) {
        h += '<option value="' + escapeHtml(op) + '"' + (op === r.op ? ' selected' : '') + '>' + escapeHtml(op) + '</option>';
      });
      h += '</select></td>';
      var editVal = fieldInfo && fieldInfo.u==='%' ? (r.value*100) : r.value;
      h += '<td><input id="editAlertValue" type="number" step="any" value="' + escapeHtml(editVal) + '" style="padding:2px 4px;border-radius:3px;border:1px solid #ccc;font-size:11px;width:60px">' + (fieldInfo ? ' ' + escapeHtml(fieldInfo.u) : '') + '</td>';
      h += '<td><select id="editAlertSeverity" style="padding:2px 4px;border-radius:3px;border:1px solid #ccc;font-size:11px">';
      Object.keys(App.ALERT_COLORS).forEach(function(s) {
        var ac2 = App.ALERT_COLORS[s];
        h += '<option value="' + escapeHtml(s) + '"' + (s === r.severity ? ' selected' : '') + '>' + escapeHtml(ac2.icon + ' ' + ac2.label) + '</option>';
      });
      h += '</select></td>';
      h += '<td><input id="editAlertMsg" value="' + escapeHtml(r.msg||'') + '" style="padding:2px 4px;border-radius:3px;border:1px solid #ccc;font-size:11px;width:120px"></td>';
      h += '<td style="white-space:nowrap">';
      h += '<button class="btn-xs" onclick="saveAlertRuleEdit(\'' + escapeJsString(r.id) + '\')" style="margin-right:4px;font-size:10px;padding:2px 6px;background:#059669;color:#fff;border:none;border-radius:3px;cursor:pointer">保存</button>';
      h += '<button class="btn-xs" onclick="cancelAlertRuleEdit()" style="font-size:10px;padding:2px 6px;background:#6b7280;color:#fff;border:none;border-radius:3px;cursor:pointer">取消</button>';
      h += '</td></tr>';
    } else {
      // 展示模式
      h += '<tr style="' + disabledStyle + '">';
      h += '<td>' + escapeHtml(label) + '</td>';
      h += '<td>' + escapeHtml(r.op) + '</td>';
      h += '<td>' + escapeHtml(fieldInfo && fieldInfo.u==='%' ? (r.value*100) : r.value) + (fieldInfo ? ' ' + escapeHtml(fieldInfo.u) : '') + '</td>';
      h += '<td><span style="color:' + ac.color + ';font-weight:600">' + escapeHtml(ac.icon + ' ' + ac.label) + '</span></td>';
      h += '<td style="font-size:11px;color:#666">' + escapeHtml(r.msg) + '</td>';
      h += '<td style="white-space:nowrap">';
      h += '<button class="btn-xs" onclick="toggleAlertRule(\'' + escapeJsString(r.id) + '\')" style="margin-right:4px;font-size:10px;padding:2px 6px">' + (r.disabled ? '启用' : '禁用') + '</button>';
      if (r.disabled) {
        h += '<button class="btn-xs" onclick="editAlertRule(\'' + escapeJsString(r.id) + '\')" style="margin-right:4px;font-size:10px;padding:2px 6px;background:#2563eb;color:#fff;border:none;border-radius:3px;cursor:pointer">编辑</button>';
      }
      h += '<button class="btn-xs danger" onclick="deleteAlertRule(\'' + escapeJsString(r.id) + '\')" style="font-size:10px;padding:2px 6px">删除</button>';
      h += '</td></tr>';
    }
  });
  h += '</tbody></table></div>';
  
  // 一键启用/禁用
  var allDisabled = rules.every(function(r) { return r.disabled; });
  var allEnabled = rules.every(function(r) { return !r.disabled; });
  h += '<div style="margin-top:12px;display:flex;gap:8px">';
  h += '<button onclick="toggleAllAlertRules(true)" style="padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;' + (allEnabled ? 'opacity:.4;cursor:default' : '') + '" ' + (allEnabled ? 'disabled' : '') + '>🔔 一键全部启用</button>';
  h += '<button onclick="toggleAllAlertRules(false)" style="padding:6px 16px;background:#6b7280;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;' + (allDisabled ? 'opacity:.4;cursor:default' : '') + '" ' + (allDisabled ? 'disabled' : '') + '>🔕 一键全部禁用</button>';
  h += '</div>';
  
  // 添加新规则
  h += '<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px">';
  h += '<span style="font-weight:600;font-size:13px">+ 添加新规则</span>';
  h += '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">';
  h += '<select id="newAlertField" style="padding:4px 8px;border-radius:4px;border:1px solid #ccc;font-size:12px;max-width:160px">';
  App.FIELDS.forEach(function(f) {
    h += '<option value="' + escapeHtml(f.k) + '">' + escapeHtml(f.l) + '</option>';
  });
  h += '</select>';
  h += '<select id="newAlertOp" style="padding:4px 8px;border-radius:4px;border:1px solid #ccc;font-size:12px"><option value=">=">>=</option><option value="<="><=</option><option value=">">></option><option value="<"><</option><option value="!=">!=</option></select>';
  h += '<input id="newAlertValue" type="number" step="any" placeholder="阈值" style="padding:4px 8px;border-radius:4px;border:1px solid #ccc;font-size:12px;width:80px">';
  h += '<select id="newAlertSeverity" style="padding:4px 8px;border-radius:4px;border:1px solid #ccc;font-size:12px"><option value="error">🔴 严重</option><option value="warn">🟠 警告</option><option value="info">🔵 提示</option></select>';
  h += '<input id="newAlertMsg" placeholder="说明文字" style="padding:4px 8px;border-radius:4px;border:1px solid #ccc;font-size:12px;width:160px">';
  h += '<button onclick="addAlertRule()" style="padding:4px 12px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">添加</button>';
  h += '</div></div>';
  
  h += '</div>';
  return h;
}

// 规则操作函数
function toggleAllAlertRules(enable) {
  var rules = App.ALL_DATA._alertRules || [];
  rules.forEach(function(r) { r.disabled = !enable; });
  App._rulesConfigured = true; App.ALL_DATA.__rulesConfigured = true;
  saveAllData();
  runAlerts();
  var dp = document.getElementById('data-panel');
  if (dp && document.getElementById('tab-data').classList.contains('active')) {
    renderDataTab();
  }
  toast(enable ? '所有预警规则已启用' : '所有预警规则已禁用', 'success');
}

function toggleAlertRule(id) {
  // 如果正在编辑此规则，先取消编辑
  if (_alertEditId === id) _alertEditId = null;
  var rules = App.ALL_DATA._alertRules || [];
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].id === id) {
      rules[i].disabled = !rules[i].disabled;
      break;
    }
  }
  App._rulesConfigured = true; App.ALL_DATA.__rulesConfigured = true;
  saveAllData();
  runAlerts();
  // 刷新配置面板
  var dp = document.getElementById('data-panel');
  if (dp && document.getElementById('tab-data').classList.contains('active')) {
    renderDataTab();
  }
}

// 编辑规则（仅禁用状态下可编辑）
function editAlertRule(id) {
  _alertEditId = id;
  App._rulesConfigured = true; App.ALL_DATA.__rulesConfigured = true;
  var dp = document.getElementById('data-panel');
  if (dp) renderDataTab();
}

function cancelAlertRuleEdit() {
  _alertEditId = null;
  var dp = document.getElementById('data-panel');
  if (dp) renderDataTab();
}

function saveAlertRuleEdit(id) {
  var rules = App.ALL_DATA._alertRules || [];
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].id === id) {
      var field = document.getElementById('editAlertField').value;
      var op = document.getElementById('editAlertOp').value;
      var value = parseFloat(document.getElementById('editAlertValue').value);
      var severity = document.getElementById('editAlertSeverity').value;
      var msg = document.getElementById('editAlertMsg').value;
      
      if (isNaN(value)) { toast('请输入有效的阈值', 'error'); return; }
      
      // % 类指标用户输入百分数，内部存储小数
      var fi = App.FIELDS.find(function(f) { return f.k === field; });
      if (fi && fi.u === '%') value = value / 100;
      
      rules[i].field = field;
      rules[i].op = op;
      rules[i].value = value;
      rules[i].severity = severity;
      rules[i].msg = msg || '自定义规则';
      break;
    }
  }
  _alertEditId = null;
  App._rulesConfigured = true; App.ALL_DATA.__rulesConfigured = true;
  saveAllData();
  runAlerts();
  toast('规则已更新', 'success');
  var dp = document.getElementById('data-panel');
  if (dp && document.getElementById('tab-data').classList.contains('active')) {
    renderDataTab();
  }
}

function deleteAlertRule(id) {
  if (!confirm('确认删除此预警规则？')) return;
  App.ALL_DATA._alertRules = (App.ALL_DATA._alertRules || []).filter(function(r) {
    return r.id !== id;
  });
  saveAllData();
  runAlerts();
  var dp = document.getElementById('data-panel');
  if (dp && document.getElementById('tab-data').classList.contains('active')) {
    renderDataTab();
  }
}

function addAlertRule() {
  var field = document.getElementById('newAlertField').value;
  var op = document.getElementById('newAlertOp').value;
  var value = parseFloat(document.getElementById('newAlertValue').value);
  var severity = document.getElementById('newAlertSeverity').value;
  var msg = document.getElementById('newAlertMsg').value || '自定义规则';
  
  if (isNaN(value)) { toast('请输入有效的阈值', 'error'); return; }
  
  // % 类指标用户输入百分数，内部存储小数
  var fi = App.FIELDS.find(function(f) { return f.k === field; });
  if (fi && fi.u === '%') value = value / 100;
  
  var rules = App.ALL_DATA._alertRules || [];
  rules.push({
    id: 'ar_' + Date.now(),
    field: field, op: op, value: value,
    severity: severity, msg: msg
  });
  App.ALL_DATA._alertRules = rules;
  App._rulesConfigured = true; App.ALL_DATA.__rulesConfigured = true;
  saveAllData();
  toast('规则已添加（对全国+所有分公司生效）', 'success');
  runAlerts();
  var dp = document.getElementById('data-panel');
  if (dp && document.getElementById('tab-data').classList.contains('active')) {
    renderDataTab();
  }
}

