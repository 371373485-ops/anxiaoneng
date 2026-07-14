(function(){
'use strict';

var REPORT_CACHE_KEY='dashboard_branch_report_cache_v1';
var DIMENSIONS=[
  ['overview','经营概览'],
  ['target','目标达成'],
  ['profit','盈利能力'],
  ['cost','成本质量'],
  ['productivity','人力效能'],
  ['trend','趋势变化'],
  ['ranking','排名对标'],
  ['risk','风险预警'],
  ['diagnosis','诊断结论'],
  ['recommendation','改进建议']
];

function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function engine(){return window.AIEngine||window.AnxiaonengAIEngine;}

function branches(){
  if(engine()&&typeof engine().listOrganizations==='function'){
    return engine().listOrganizations().filter(function(o){return o.level==='branch';});
  }
  return (window.App&&App.DATA&&App.DATA.branches||[]).map(function(b){return {name:b.n,region:b.r||'',level:'branch'};});
}

function periods(){
  if(engine()&&typeof engine().listPeriods==='function')return engine().listPeriods();
  return Object.keys(window.App&&App.ALL_DATA&&App.ALL_DATA.actuals||{}).sort();
}

function saveCachedReport(payload){
  try{localStorage.setItem(REPORT_CACHE_KEY,JSON.stringify(payload));}catch(e){}
}

function loadCachedReport(){
  try{
    var raw=localStorage.getItem(REPORT_CACHE_KEY);
    return raw?JSON.parse(raw):null;
  }catch(e){return null;}
}

function clearCachedReport(){
  try{localStorage.removeItem(REPORT_CACHE_KEY);}catch(e){}
}

function renderOptions(){
  var bs=branches(), ps=periods(), cur=window.App&&App.currentMonth||ps[ps.length-1]||'';
  return '<div class="report-form">'+
    '<label>分公司<select id="report-org">'+bs.map(function(b){return '<option value="'+esc(b.name)+'">'+esc(b.name)+(b.region?' · '+esc(b.region):'')+'</option>';}).join('')+'</select></label>'+
    '<label>时间范围<select id="report-range" onchange="updateReportCustomRange()"><option value="current">当前月</option><option value="recent3">近 3 个月</option><option value="recent6">近 6 个月</option><option value="annual">年度累计</option><option value="custom">自定义</option></select></label>'+
    '<label class="report-custom">开始<select id="report-start">'+ps.map(function(p){return '<option value="'+esc(p)+'">'+esc(p)+'</option>';}).join('')+'</select></label>'+
    '<label class="report-custom">结束<select id="report-end">'+ps.map(function(p){return '<option value="'+esc(p)+'" '+(p===cur?'selected':'')+'>'+esc(p)+'</option>';}).join('')+'</select></label>'+
    '<label>报告风格<select id="report-style"><option value="management">管理汇报版</option><option value="brief">简洁版</option><option value="diagnosis">问题诊断版</option></select></label>'+
    '</div>'+
    '<div class="report-dimensions">'+DIMENSIONS.map(function(d){return '<label><input type="checkbox" name="report-dim" value="'+d[0]+'" '+(d[0]==='appendix'?'':'checked')+'> '+d[1]+'</label>';}).join('')+'</div>'+
    '<div class="report-actions"><button onclick="generateDashboardReport()">一键生成分公司分析报告</button><button class="secondary" onclick="resetDashboardReport()">重置报告</button><span id="report-status"></span></div>';
}

function sectionTitle(id,title){
  var map={
    summary:'报告摘要',
    overview:'核心指标解读',
    target:'目标达成分析',
    profit:'盈利能力分析',
    cost:'成本质量分析',
    productivity:'人力效能分析',
    trend:'趋势与对标',
    risk:'风险诊断',
    recommendation:'管理建议',
    appendix:'数据证据附录'
  };
  return map[id]||title||id;
}

function renderDocument(result){
  var doc=result&&result.document;
  if(!doc)return '<div class="report-empty">暂无报告。</div>';
  var visibleSections=(doc.sections||[]).filter(function(section){return section.id!=='appendix';});
  var html='<article class="report-document"><header><h2>'+esc(doc.title||'分公司分析报告')+'</h2><p>'+esc(doc.summary||'')+'</p></header>';
  visibleSections.forEach(function(section){
    html+='<section><h3>'+esc(sectionTitle(section.id,section.title))+'</h3>';
    if(section.paragraphs&&section.paragraphs.length){
      html+='<div class="report-paragraphs">'+section.paragraphs.map(function(text){return '<p>'+esc(text)+'</p>';}).join('')+'</div>';
    }
    if(section.items&&section.items.length){
      html+='<div class="report-highlights">'+section.items.map(function(item){
        var text=item==='insufficient_data'?'数据不足：当前看板未提供该维度可用证据。':item;
        return '<span>'+esc(text)+'</span>';
      }).join('')+'</div>';
    }
    html+='</section>';
  });
  if(doc.limitations&&doc.limitations.length)html+='<footer><b>限制说明</b><ul>'+doc.limitations.slice(0,8).map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul></footer>';
  html+='</article>';
  return html;
}

function selectedDimensions(){
  return Array.prototype.slice.call(document.querySelectorAll('input[name="report-dim"]:checked')).map(function(node){return node.value;});
}

function currentOptions(){
  return {
    org:document.getElementById('report-org')&&document.getElementById('report-org').value,
    rangeType:document.getElementById('report-range')&&document.getElementById('report-range').value,
    customStart:document.getElementById('report-start')&&document.getElementById('report-start').value,
    customEnd:document.getElementById('report-end')&&document.getElementById('report-end').value,
    style:document.getElementById('report-style')&&document.getElementById('report-style').value,
    dimensions:selectedDimensions()
  };
}

function applyCachedOptions(options){
  if(!options)return;
  var set=function(id,value){var el=document.getElementById(id);if(el&&value!=null)el.value=value;};
  set('report-org',options.org);
  set('report-range',options.rangeType);
  set('report-start',options.customStart);
  set('report-end',options.customEnd);
  set('report-style',options.style);
  if(options.dimensions){
    Array.prototype.slice.call(document.querySelectorAll('input[name="report-dim"]')).forEach(function(node){
      node.checked=options.dimensions.indexOf(node.value)>=0;
    });
  }
  updateCustom();
}

function generate(){
  var status=document.getElementById('report-status'), out=document.getElementById('report-output');
  if(!engine()||typeof engine().generateBranchReport!=='function'){
    if(out)out.innerHTML='<div class="report-error">报告引擎未加载。</div>';
    return;
  }
  var options=currentOptions();
  if(status)status.textContent='正在生成...';
  try{
    var result=engine().generateBranchReport(options);
    if(out)out.innerHTML=renderDocument(result);
    saveCachedReport({options:options,result:result,createdAt:new Date().toISOString()});
    if(status)status.textContent='已生成，切换标签或刷新页面不会丢失';
  }catch(error){
    if(out)out.innerHTML='<div class="report-error">生成失败：'+esc(error.message)+'</div>';
    if(status)status.textContent='';
  }
}

function reset(){
  clearCachedReport();
  var out=document.getElementById('report-output'), status=document.getElementById('report-status');
  if(out)out.innerHTML='<div class="report-empty">报告已重置，请重新选择条件后生成。</div>';
  if(status)status.textContent='已重置';
}

function render(){
  var root=document.getElementById('tab-report');
  if(!root)return;
  root.innerHTML='<style>'+
    '.report-page{display:grid;gap:14px}.report-config,.report-document{background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:14px;padding:16px;box-shadow:0 8px 24px rgba(15,23,42,.04)}'+
    '.report-config h2{margin:0 0 6px}.report-config p{margin:0 0 12px;color:var(--muted,#64748b)}.report-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.report-form label{font-size:12px;color:#475569}.report-form select{display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #d1d5db;border-radius:8px;background:#fff}'+
    '.report-custom{display:none}.report-dimensions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.report-dimensions label{border:1px solid #dbeafe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:5px 10px;font-size:12px}.report-actions{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}.report-actions button{border:0;border-radius:10px;background:#1e3a5f;color:#fff;font-weight:700;padding:10px 16px;cursor:pointer}.report-actions button.secondary{background:#e2e8f0;color:#334155}.report-actions span{font-size:12px;color:#64748b}'+
    '.report-document header{border-bottom:1px solid #e5e7eb;margin-bottom:12px}.report-document h2{margin:0 0 6px}.report-document h3{margin:16px 0 8px;font-size:16px}.report-document p{line-height:1.9;margin:8px 0;color:#334155}.report-highlights{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.report-highlights span{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:5px 10px;font-size:12px;color:#334155}.report-document footer{margin-top:12px;border-top:1px solid #e5e7eb;padding-top:10px;color:#64748b}.report-empty,.report-error{padding:20px;color:#64748b}.report-error{color:#dc2626}'+
    '</style><div class="report-page"><div id="report-global-search-host"></div><section class="report-config"><h2>📋 生成报告</h2><p>数据查询用于追问与核对；报告生成用于形成管理汇报型分析。已生成报告会保存在本浏览器，除非手动重置。</p>'+renderOptions()+'</section><div id="report-output" class="report-empty">请选择条件后生成报告。</div></div>';
  updateCustom();
  if(typeof window.renderGlobalSearchPanel==='function')window.renderGlobalSearchPanel('report-global-search-host');
  var cached=loadCachedReport();
  if(cached&&cached.result){
    applyCachedOptions(cached.options);
    var out=document.getElementById('report-output'), status=document.getElementById('report-status');
    if(out)out.innerHTML=renderDocument(cached.result);
    if(status)status.textContent='已恢复上次生成的报告';
  }
}

function updateCustom(){
  var isCustom=(document.getElementById('report-range')||{}).value==='custom';
  Array.prototype.slice.call(document.querySelectorAll('.report-custom')).forEach(function(node){node.style.display=isCustom?'block':'none';});
}

window.renderReportTab=render;
window.generateDashboardReport=generate;
window.resetDashboardReport=reset;
window.updateReportCustomRange=updateCustom;
})();
