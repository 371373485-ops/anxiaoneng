// dashboard-trend.js — 多期趋势分析模块 v2
// 交互逻辑：每个指标 = 一个独立图表卡片，平级排列
// 卡片内：选指标 → 选机构 → 选时间 → 可选添加对比机构

(function(){
'use strict';

var COLORS = ['#2563eb','#dc2626','#059669','#d97706','#7c3aed','#0891b2','#db2777','#65a30d'];

// 注入 CSS（含移动端适配）
if(!document.getElementById('trend-css')){
  var style = document.createElement('style');
  style.id = 'trend-css';
  style.textContent = [
    '.trend-toolbar{background:var(--card);border-radius:8px;padding:12px 16px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06);display:flex;align-items:center;justify-content:space-between}',
    '.trend-toolbar h3{font-size:15px;font-weight:700}',
    '.trend-toolbar .tb-right{display:flex;gap:8px;align-items:center}',
    '.trend-toolbar select{padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;min-width:160px}',
    '.trend-toolbar button{padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600}',
    '',
    '.trend-card{background:var(--card);border-radius:8px;padding:16px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}',
    '.trend-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}',
    '.trend-card-head .ch-left{display:flex;align-items:center;gap:8px}',
    '.trend-card-head .ch-icon{font-size:16px}',
    '.trend-card-head select.trend-metric-sel{padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-weight:600;min-width:160px}',
    '.trend-card-head .trend-close-btn{padding:4px 10px;border:1px solid #fecaca;border-radius:6px;background:#fff5f5;color:#dc2626;cursor:pointer;font-size:12px}',
    '',
    '.trend-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}',
    '.trend-filters .tf-group label{font-size:11px;color:var(--muted);display:block;margin-bottom:2px}',
    '.trend-filters select,.trend-filters input{padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;min-width:120px}',
    '.trend-filters .tf-custom{display:flex;gap:4px}',
    '',
    '.trend-compare-tags{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}',
    '.trend-compare-tags .ct-tag{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;font-size:11px;color:#fff}',
    '.trend-compare-tags .ct-tag button{border:none;background:none;cursor:pointer;color:#fff;font-size:12px;padding:0}',
    '',
    '.trend-chart-table{display:flex;gap:16px;align-items:stretch}',
    '.trend-chart-wrap{flex:1.5;min-width:0;position:relative;height:360px}',
    '.trend-table-wrap{flex:1;max-height:360px;overflow-y:auto;min-width:0}',
    '.trend-table-wrap table{width:100%;border-collapse:collapse;font-size:12px}',
    '.trend-table-wrap th{padding:5px 8px;text-align:left;border-bottom:2px solid #e5e7eb;white-space:nowrap;background:#f8f9fa}',
    '.trend-table-wrap th.num{text-align:right}',
    '.trend-table-wrap td{padding:4px 8px;border-bottom:1px solid #f0f0f0;white-space:nowrap}',
    '.trend-table-wrap td.num{text-align:right}',
    '.trend-table-wrap .rank-tag{color:#9ca3af;font-size:11px}',
    '',
    '@media(max-width:768px){',
    '  .trend-toolbar{flex-direction:column;align-items:flex-start;gap:8px;padding:10px 12px}',
    '  .trend-toolbar .tb-right{width:100%;flex-wrap:wrap}',
    '  .trend-toolbar select{min-width:0;flex:1;font-size:12px}',
    '  .trend-toolbar button{font-size:12px;padding:6px 12px;white-space:nowrap}',
    '  .trend-card{padding:12px}',
    '  .trend-card-head .trend-metric-sel{min-width:0;font-size:12px;flex:1}',
    '  .trend-card-head .trend-close-btn{font-size:11px;padding:3px 8px}',
    '  .trend-filters{gap:6px}',
    '  .trend-filters select,.trend-filters input{min-width:0;font-size:11px;padding:4px 6px}',
    '  .trend-chart-table{flex-direction:column;gap:12px}',
    '  .trend-chart-wrap{height:240px;flex:none;width:100%}',
    '  .trend-table-wrap{max-height:none;overflow-x:auto;flex:none;width:100%}',
    '  .trend-table-wrap table{font-size:10px}',
    '  .trend-table-wrap th,.trend-table-wrap td{padding:3px 4px}',
    '}'
  ].join('\n');
  document.head.appendChild(style);
}

// ── 可用月份 ──
function getAvailableMonths(){
  var merged = (App.ALL_DATA && App.ALL_DATA._merged) || {};
  return Object.keys(merged).sort();
}

// ── 取数据 ──
function getMetricValue(month, org, metricKey){
  var merged = (App.ALL_DATA && App.ALL_DATA._merged) || {};
  var mdata = merged[month];
  if(!mdata) return null;
  if(org === '全国' || org === '整体'){
    var v = (mdata.national || {})[metricKey];
    return (v != null && !isNaN(v)) ? v : null;
  }
  if(mdata.regions && mdata.regions[org]){
    var rv = mdata.regions[org][metricKey];
    return (rv != null && !isNaN(rv)) ? rv : null;
  }
  var b = (mdata.branches || []).find(function(x){ return x.n === org; });
  if(b && b.d){
    var bv = b.d[metricKey];
    return (bv != null && !isNaN(bv)) ? bv : null;
  }
  return null;
}

function getBranchesInRegion(regionName){
  var merged = (App.ALL_DATA && App.ALL_DATA._merged) || {};
  var firstMonth = Object.keys(merged)[0];
  if(!firstMonth) return [];
  var mdata = merged[firstMonth];
  return (mdata.branches || []).filter(function(b){
    return !regionName || regionName==='全国' || b.r === regionName;
  }).map(function(b){ return b.n; });
}

function fmtMonth(m){
  if(!m) return '';
  return m.split('-')[1] + '月';
}

function metricUnit(key){
  var f = (App.FIELDS || []).find(function(x){ return x.k === key; });
  return f ? (f.u || '') : '';
}

// ── 解析时间范围 ──
function getMonths(preset, customStart, customEnd){
  var all = getAvailableMonths();
  if(!all.length) return [];
  if(preset === 'custom' && customStart && customEnd){
    return all.filter(function(m){ return m >= customStart && m <= customEnd; });
  }
  if(preset === 'ytd'){
    var yr = (App.currentMonth || all[all.length-1]).split('-')[0];
    return all.filter(function(m){ return m.startsWith(yr); });
  }
  if(preset === 'yoy'){
    var yr2 = (App.currentMonth || all[all.length-1]).split('-')[0];
    var mo = (App.currentMonth || all[all.length-1]).split('-')[1];
    return all.filter(function(m){
      return (m.startsWith(yr2) && m.endsWith('-'+mo)) ||
             (m.startsWith(String(parseInt(yr2)-1)) && m.endsWith('-'+mo));
    }).sort();
  }
  if(preset === 'recent3') return all.slice(-3);
  if(preset === 'recent12') return all.slice(-12);
  return all.slice(-6);
}

// ══════════ 图表卡片 ══════════

var cards = [];
var cardCounter = 0;

function addCard(metricKey){
  cardCounter++;
  var card = {
    id: 'trend-card-' + cardCounter,
    metric: metricKey || '综合成本率实际（整体利润口径）',
    branch: '全国',
    preset: 'recent6',
    customStart: '',
    customEnd: '',
    compareBranches: [],
    chart: null
  };
  cards.push(card);
  renderCards();
}

function removeCard(id){
  cards = cards.filter(function(c){ return c.id !== id; });
  if(cards.length === 0) addCard();
  else renderCards();
}

// ── 渲染所有卡片 ──
function renderCards(){
  var ct = document.getElementById('tab-trend');
  if(!ct) return;
  
  var allMonths = getAvailableMonths();
  var fields = App.FIELDS || [];
  var fieldGroups = {};
  fields.forEach(function(f){ if(!fieldGroups[f.g]) fieldGroups[f.g] = []; fieldGroups[f.g].push(f); });
  
  var branchNames = getBranchesInRegion('全国');
  
  var h = '<div class="trend-toolbar">';
  h += '<h3>📉 多期趋势分析</h3>';
  h += '<div class="tb-right">';
  h += '<select id="trend-new-metric">';
  Object.keys(fieldGroups).forEach(function(g){
    h += '<optgroup label="'+g+'">';
    fieldGroups[g].forEach(function(f){ h += '<option value="'+f.k+'">'+f.l+'</option>'; });
    h += '</optgroup>';
  });
  h += '</select>';
  h += '<button onclick="Trend.addCard(document.getElementById(\'trend-new-metric\').value)">+ 添加图表</button>';
  h += '</div></div>';
  
  h += '<div id="trend-cards">';
  cards.forEach(function(card){
    h += renderCardHTML(card, fieldGroups, branchNames, allMonths);
  });
  h += '</div>';
  
  ct.innerHTML = h;
  
  cards.forEach(function(card){
    renderCardChart(card);
  });
}

function renderCardHTML(card, fieldGroups, branchNames, allMonths){
  var s = card;
  
  var h = '<div class="trend-card">';
  
  // 卡片头
  h += '<div class="trend-card-head">';
  h += '<div class="ch-left">';
  h += '<span class="ch-icon">📊</span>';
  h += '<select class="trend-metric-sel" onchange="Trend.updateCard(\''+s.id+'\',\'metric\',this.value)">';
  Object.keys(fieldGroups).forEach(function(g){
    h += '<optgroup label="'+g+'">';
    fieldGroups[g].forEach(function(f){ h += '<option value="'+f.k+'"'+(s.metric===f.k?' selected':'')+'>'+f.l+'</option>'; });
    h += '</optgroup>';
  });
  h += '</select>';
  h += '</div>';
  h += '<button class="trend-close-btn" onclick="Trend.removeCard(\''+s.id+'\')">✕ 关闭</button>';
  h += '</div>';
  
  // 筛选行
  h += '<div class="trend-filters">';
  
  h += '<div class="tf-group"><label>机构</label>';
  h += '<select onchange="Trend.updateCard(\''+s.id+'\',\'branch\',this.value)">';
  h += '<option value="全国"'+(s.branch==='全国'?' selected':'')+'>全国汇总</option>';
  ['第一责任区','第二责任区','第三责任区','第四责任区'].forEach(function(r){
    h += '<option value="'+r+'"'+(s.branch===r?' selected':'')+'>'+r+'</option>';
  });
  branchNames.forEach(function(bn){
    h += '<option value="'+bn+'"'+(s.branch===bn?' selected':'')+'>'+bn+'</option>';
  });
  h += '</select></div>';
  
  h += '<div class="tf-group"><label>时间范围</label>';
  h += '<select id="'+s.id+'-preset" onchange="Trend.updateCard(\''+s.id+'\',\'preset\',this.value);var cw=document.getElementById(\''+s.id+'-custom\');cw.style.display=this.value===\'custom\'?\'flex\':\'none\'">';
  h += '<option value="recent6"'+(s.preset==='recent6'?' selected':'')+'>近6个月</option>';
  h += '<option value="recent3"'+(s.preset==='recent3'?' selected':'')+'>近3个月</option>';
  h += '<option value="recent12"'+(s.preset==='recent12'?' selected':'')+'>近12个月</option>';
  h += '<option value="ytd"'+(s.preset==='ytd'?' selected':'')+'>本年逐月</option>';
  h += '<option value="yoy"'+(s.preset==='yoy'?' selected':'')+'>年度同比</option>';
  h += '<option value="custom"'+(s.preset==='custom'?' selected':'')+'>自定义</option>';
  h += '</select></div>';
  
  h += '<div id="'+s.id+'-custom" class="tf-custom" style="display:'+(s.preset==='custom'?'flex':'none')+'">';
  h += '<input type="month" value="'+s.customStart+'" min="'+allMonths[0]+'" max="'+allMonths[allMonths.length-1]+'" onchange="Trend.updateCard(\''+s.id+'\',\'customStart\',this.value)" title="起始月">';
  h += '<input type="month" value="'+s.customEnd+'" min="'+allMonths[0]+'" max="'+allMonths[allMonths.length-1]+'" onchange="Trend.updateCard(\''+s.id+'\',\'customEnd\',this.value)" title="结束月">';
  h += '</div>';
  
  h += '<div class="tf-group"><label>+ 对比机构</label>';
  h += '<select onchange="if(this.value){Trend.addCompare(\''+s.id+'\',this.value);this.value=\'\'}">';
  h += '<option value="">添加对比...</option>';
  ['全国','第一责任区','第二责任区','第三责任区','第四责任区'].forEach(function(r){
    if(r !== s.branch) h += '<option value="'+r+'">'+r+'</option>';
  });
  branchNames.forEach(function(bn){
    if(bn !== s.branch && s.compareBranches.indexOf(bn) < 0) h += '<option value="'+bn+'">'+bn+'</option>';
  });
  h += '</select></div>';
  
  h += '</div>';
  
  // 对比标签
  if(s.compareBranches.length > 0){
    h += '<div class="trend-compare-tags">';
    s.compareBranches.forEach(function(bn, i){
      var c = COLORS[(i+1)%COLORS.length];
      h += '<span class="ct-tag" style="background:'+c+'">'+bn+'<button onclick="Trend.removeCompare(\''+s.id+'\',\''+bn.replace(/'/g,'\\\'')+'\')">×</button></span>';
    });
    h += '</div>';
  }
  
  // 图表 + 表格
  h += '<div class="trend-chart-table">';
  h += '<div class="trend-chart-wrap"><canvas id="'+s.id+'-chart"></canvas></div>';
  h += '<div id="'+s.id+'-table" class="trend-table-wrap"></div>';
  h += '</div>';
  
  h += '</div>';
  return h;
}

// ── 排名函数 ──
function getBranchRank(branchName, month, metricKey, direction){
  var merged = (App.ALL_DATA && App.ALL_DATA._merged) || {};
  var mdata = merged[month];
  if(!mdata) return null;
  var allVals = [];
  (mdata.branches || []).forEach(function(b){
    var v = b.d && b.d[metricKey];
    if(v != null && !isNaN(v)) allVals.push({name: b.n, value: v});
  });
  if(!allVals.length) return null;
  allVals.sort(function(a,b){ return direction==='asc' ? a.value - b.value : b.value - a.value; });
  var target = allVals.find(function(x){ return x.name === branchName; });
  if(!target) return null;
  return allVals.indexOf(target) + 1;
}

function getRegionRank(regionName, month, metricKey, direction){
  var merged = (App.ALL_DATA && App.ALL_DATA._merged) || {};
  var mdata = merged[month];
  if(!mdata) return null;
  var regions = ['第一责任区','第二责任区','第三责任区','第四责任区'];
  var allVals = [];
  regions.forEach(function(rn){
    var rd = mdata.regions && mdata.regions[rn];
    if(rd && rd[metricKey] != null && !isNaN(rd[metricKey])){
      allVals.push({name: rn, value: rd[metricKey]});
    }
  });
  if(!allVals.length) return null;
  allVals.sort(function(a,b){ return direction==='asc' ? a.value - b.value : b.value - a.value; });
  var target = allVals.find(function(x){ return x.name === regionName; });
  if(!target) return null;
  return allVals.indexOf(target) + 1;
}

function getOrgRank(orgName, month, metricKey, direction){
  if(orgName === '全国' || orgName === '整体') return null;
  var branchNames = getBranchesInRegion('全国');
  if(branchNames.indexOf(orgName) >= 0) return getBranchRank(orgName, month, metricKey, direction);
  var regionNames = ['第一责任区','第二责任区','第三责任区','第四责任区'];
  if(regionNames.indexOf(orgName) >= 0) return getRegionRank(orgName, month, metricKey, direction);
  return null;
}

// ── 渲染图表 ──
function renderCardChart(card){
  if(card.chart){ try{ card.chart.destroy(); }catch(e){} }
  var canvas = document.getElementById(card.id + '-chart');
  if(!canvas) return;
  
  var months = getMonths(card.preset, card.customStart, card.customEnd);
  var unit = metricUnit(card.metric);
  var isPct = unit === '%';
  var f = (App.FIELDS || []).find(function(x){ return x.k === card.metric; }) || {};
  var direction = f.rd || 'desc';
  
  function fmtVal(v){
    if(v == null) return '无数据';
    return isPct ? (v*100).toFixed(2)+'%' : v.toFixed(2);
  }
  
  var allOrgs = [{name: card.branch, isMain: true}];
  card.compareBranches.forEach(function(bn){ allOrgs.push({name: bn, isMain: false}); });
  
  var datasets = allOrgs.map(function(org, i){
    var data = months.map(function(m){ return getMetricValue(m, org.name, card.metric); });
    var ranks = months.map(function(m){ return getOrgRank(org.name, m, card.metric, direction); });
    return {
      label: org.name,
      data: data,
      _ranks: ranks,
      _hasRank: org.name !== '全国' && org.name !== '整体',
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: org.isMain ? COLORS[i % COLORS.length] + '15' : 'transparent',
      fill: org.isMain && card.compareBranches.length === 0,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 7,
      spanGaps: true,
      borderWidth: org.isMain ? 2.5 : 1.5
    };
  });
  
  card.chart = new Chart(canvas, {
    type: 'line',
    data: { labels: months.map(fmtMonth), datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2,
      plugins: {
        legend: {
          display: card.compareBranches.length > 0,
          position: 'bottom',
          labels: { font: { size: 11 }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: function(ctx){
              var v = ctx.parsed.y;
              var label = ctx.dataset.label + ': ' + fmtVal(v);
              if(ctx.dataset._hasRank && v != null){
                var rank = ctx.dataset._ranks[ctx.dataIndex];
                if(rank){
                  var total = getBranchesInRegion('全国').length;
                  label += '  (第' + rank + '/' + total + '名)';
                }
              }
              return label;
            }
          }
        }
      },
      scales: {
        y: { ticks: { callback: function(v){ return isPct ? (v*100).toFixed(0)+'%' : v.toFixed(0); } } }
      }
    }
  });
  
  renderDataTable(card, months);
}

// ── 渲染表格 ──
function renderDataTable(card, months){
  var el = document.getElementById(card.id + '-table');
  if(!el) return;
  var unit = metricUnit(card.metric);
  var isPct = unit === '%';
  var f = (App.FIELDS || []).find(function(x){ return x.k === card.metric; }) || {};
  var direction = f.rd || 'desc';
  
  function fv(v){
    if(v == null) return '—';
    return isPct ? (v*100).toFixed(2)+'%' : v.toFixed(2);
  }
  
  var allOrgs = [{name: card.branch, isMain: true}].concat(
    card.compareBranches.map(function(bn){ return {name: bn, isMain: false}; })
  );
  
  var h = '<table><thead><tr>';
  h += '<th>机构</th>';
  months.forEach(function(m){ h += '<th class="num">'+fmtMonth(m)+'</th>'; });
  h += '</tr></thead><tbody>';
  
  allOrgs.forEach(function(org, i){
    var isBranch = org.name !== '全国' && org.name !== '整体';
    var bg = org.isMain ? ' style="background:#f0f7ff"' : '';
    h += '<tr'+bg+'>';
    h += '<td style="font-weight:'+(org.isMain?'600':'400')+';color:'+COLORS[i%COLORS.length]+'">'+org.name+'</td>';
    months.forEach(function(m){
      var v = getMetricValue(m, org.name, card.metric);
      var rank = isBranch ? getOrgRank(org.name, m, card.metric, direction) : null;
      h += '<td class="num">' + fv(v);
      if(rank) h += ' <span class="rank-tag">#'+rank+'</span>';
      h += '</td>';
    });
    h += '</tr>';
  });
  
  h += '</tbody></table>';
  el.innerHTML = h;
}

// ══════════ 操作 API ══════════

window.Trend = {
  render: function(){
    if(cards.length === 0) addCard();
    else renderCards();
  },
  addCard: function(metricKey){ addCard(metricKey); },
  removeCard: function(id){ removeCard(id); },
  updateCard: function(id, field, value){
    var card = cards.find(function(c){ return c.id === id; });
    if(!card) return;
    card[field] = value;
    renderCards();
  },
  addCompare: function(id, branchName){
    var card = cards.find(function(c){ return c.id === id; });
    if(!card) return;
    if(card.compareBranches.length >= 9) return;
    if(card.compareBranches.indexOf(branchName) < 0 && branchName !== card.branch){
      card.compareBranches.push(branchName);
      renderCards();
    }
  },
  removeCompare: function(id, branchName){
    var card = cards.find(function(c){ return c.id === id; });
    if(!card) return;
    card.compareBranches = card.compareBranches.filter(function(b){ return b !== branchName; });
    renderCards();
  }
};

})();
