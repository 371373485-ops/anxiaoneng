(function(){
'use strict';

var HISTORY_KEY='dashboard_global_search_history';
var MAX_HISTORY=50;
var USAGE_RULE_VERSION='2026-07-14';
var USAGE_RULES={
  can:[
    '精确查数：北京分公司2026年5月经营利润是多少？',
    '条件筛选：哪些分公司保费达成不好且亏损？',
    '排名查询：综合成本率最高的前5家是谁？',
    '主题分析：深圳成本咋样？广西人效行不行？',
    '趋势查询：深圳分公司近2年综合成本率趋势怎么样？',
    '机构对比：北京和上海哪个利润更好？',
    '准确指标名查询：车险实际、前台产能实际、整体成本执行率等 77 个看板指标'
  ],
  cannot:[
    '真实原因分析：例如“为什么利润下降”，当前只能查相关指标和趋势，不能判断真实业务原因。',
    '经营建议：例如“下一步怎么做”，全局搜索不直接给整改建议。',
    '外部知识：行业均值、同业表现、监管政策、当地市场原因等不在当前看板数据内。',
    '预测判断：例如“下个月会不会亏损”，当前没有预测模型。',
    '多轮省略追问：例如“那它去年呢”，建议每次写清机构、时间和指标。'
  ],
  clarify:[
    '“哪家最差 / 谁不好 / 问题最大”会先让你选择评价口径。',
    '“深圳怎么样”会先让你选择盈利能力、成本质量、人力效能或保费趋势。',
    '如果时间范围数据不足，系统会说明当前只有多少个月可用数据。'
  ],
  pattern:'推荐提问格式：机构 + 时间/范围 + 指标/主题 + 问题类型。例如：深圳分公司近2年综合成本率趋势怎么样？'
};

function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function attr(value){return esc(value).replace(/'/g,'&#39;');}
function engine(){return window.AIEngine||window.AnxiaonengAIEngine;}
function asArray(value){return Array.isArray(value)?value:(value==null?[]:[value]);}

function loadHistory(){
  try{
    var list=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
    return Array.isArray(list)?list:[];
  }catch(e){return [];}
}

function saveHistory(list){
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(list.slice(0,MAX_HISTORY)));}catch(e){}
}

function pushHistory(question,result){
  var list=loadHistory().filter(function(item){return item.question!==question;});
  list.unshift({question:question,type:result&&result.type||'',summary:result&&result.summary||'',createdAt:new Date().toISOString()});
  saveHistory(list);
}

function renderHistory(){
  var box=document.getElementById('global-search-history');
  if(!box)return;
  var list=loadHistory();
  if(!list.length){box.innerHTML='<div class="global-search-empty">暂无搜索历史</div>';return;}
  box.innerHTML=list.slice(0,10).map(function(item){
    return '<button class="global-search-history-item" onclick="runGlobalSearchFromHistory(\''+attr(item.question)+'\')">'+
      '<span><b>'+esc(typeLabel(item.type))+'</b> '+esc(item.question)+'</span><small>'+esc((item.summary||'').slice(0,64))+'</small></button>';
  }).join('');
}

function typeLabel(type){
  return {snapshot:'精确查数',theme:'主题分析',semantic:'主题分析',filter:'条件筛选',rank:'排名查询',trend:'趋势查询',compare:'机构对比',clarification:'需要补充',diagnosis:'暂不支持',recommendation:'暂不支持',mom:'环比查询',yoy:'同比查询',error:'错误'}[type]||type||'搜索';
}

function renderUsageRules(){
  function list(items){
    return '<ul>'+items.map(function(item){return '<li>'+esc(item)+'</li>';}).join('')+'</ul>';
  }
  return '<details class="global-search-rules">'+
    '<summary><span>📌 使用规则与能力边界</span><small>建议首次使用先看；功能变化时这里会同步更新 · '+esc(USAGE_RULE_VERSION)+'</small></summary>'+
    '<div class="global-search-rules-grid">'+
      '<section><h4>可以问</h4>'+list(USAGE_RULES.can)+'</section>'+
      '<section><h4>暂不能直接回答</h4>'+list(USAGE_RULES.cannot)+'</section>'+
      '<section><h4>模糊问题会先澄清</h4>'+list(USAGE_RULES.clarify)+'</section>'+
      '<section><h4>更稳的问法</h4><p>'+esc(USAGE_RULES.pattern)+'</p></section>'+
    '</div>'+
  '</details>';
}

function renderIntent(intent,type){
  if(!intent)return '';
  var confidence=Number(intent.confidence);
  var confidenceText=Number.isFinite(confidence)?Math.round(confidence*100)+'%':'-';
  var rows=[
    ['查询类型',typeLabel(type||intent.task||intent.intent)],
    ['标准化理解',intent.normalizedQuestion||'-'],
    ['置信度',confidenceText],
    ['澄清原因',intent.clarificationReason||'-'],
    ['机构',asArray(intent.orgs).join('、')||intent.org||'未指定'],
    ['时间',intent.period||'-'],
    ['范围',asArray(intent.range).length>1?asArray(intent.range).join('、'):'-'],
    ['主题',intent.themeLabel||intent.theme||'-'],
    ['指标',asArray(intent.metricLabels).join('、')||intent.metricLabel||intent.metric||'-'],
    ['单位',intent.metricUnit||'-'],
    ['排序方向',intent.sortDirection||'-'],
    ['条件',asArray(intent.conditions).map(function(c){return (c.label||c.metricLabel||c.metric)+' '+(c.operator||'')+' '+(c.value!=null?c.value:'');}).join('；')||'-']
  ];
  return '<details class="global-search-intent"><summary>查看问题理解与查询口径</summary><div class="global-search-intent-grid">'+rows.map(function(row){
    return '<span>'+esc(row[0])+'</span><em>'+esc(row[1])+'</em>';
  }).join('')+'</div></details>';
}

function renderResult(result){
  if(!result)return '';
  var html='<div class="global-search-result">';
  html+='<div class="global-search-result-head"><b>'+esc(result.summary||'搜索结果')+'</b></div>';
  var cards=result.cards||[];
  var visibleCards=cards.filter(function(card){
    var text=card.text||[card.rank?('第 '+card.rank+'/'+card.total+' 名'):null,card.org,card.metric,card.value,card.period].filter(Boolean).join(' · ');
    return !(cards.length===1&&text===(result.summary||''));
  });
  if(visibleCards.length){
    html+='<div class="global-search-cards">'+visibleCards.map(function(card){
      var text=card.text||[card.rank?('第 '+card.rank+'/'+card.total+' 名'):null,card.org,card.metric,card.value,card.period].filter(Boolean).join(' · ');
      if(result.type==='clarification'&&card.question){
        return '<button class="global-search-card global-search-clarification-option" onclick="runGlobalSearchFromHistory(\''+attr(card.question)+'\')">'+esc(text)+'</button>';
      }
      return '<div class="global-search-card">'+esc(text)+'</div>';
    }).join('')+'</div>';
  }
  html+=renderIntent(result.intent,result.type);
  var evidence=result.evidence||[];
  if(evidence.length){
    html+='<details class="global-search-evidence"><summary>查看证据（'+evidence.length+' 条）</summary><ul>'+
      evidence.slice(0,20).map(function(ev){return '<li>'+esc([ev.period,ev.org,ev.label,ev.formattedValue].filter(Boolean).join(' / '))+'</li>';}).join('')+
      '</ul></details>';
  }
  var limits=result.limitations||[];
  if(limits.length)html+='<div class="global-search-limits">限制：'+esc(limits.slice(0,5).join('；'))+'</div>';
  var candidates=result.intent&&result.intent.metricCandidates||[];
  if(result.type==='clarification'&&candidates.length){
    html+='<div class="global-search-limits">候选指标：'+esc(candidates.slice(0,8).map(function(m){return m.label+(m.unit?'（'+m.unit+'）':'');}).join('、'))+'</div>';
  }
  if(result.type==='clarification'){
    var reason=result.clarificationReason||result.intent&&result.intent.clarificationReason||'问题缺少明确查询口径。';
    html+='<div class="global-search-limits">澄清原因：'+esc(reason)+'</div>';
    html+='<div class="global-search-limits">建议按“机构 + 时间 + 指标/主题 + 问题类型”提问，系统会按标准查询取数，不生成开放式推测。</div>';
  }
  html+='</div>';
  return html;
}

function run(question){
  var input=document.getElementById('global-search-input');
  var output=document.getElementById('global-search-output');
  question=String(question||input&&input.value||'').trim();
  if(!question)return;
  if(input)input.value=question;
  if(!output)return;
  if(!engine()||typeof engine().runSearch!=='function'){
    output.innerHTML='<div class="global-search-error">全局搜索引擎未加载。</div>';
    return;
  }
  output.innerHTML='<div class="global-search-loading">正在解析问题并检索数据面板证据...</div>';
  try{
    var result=engine().runSearch(question);
    output.innerHTML=renderResult(result);
    pushHistory(question,result);
    renderHistory();
  }catch(error){
    output.innerHTML='<div class="global-search-error">搜索失败：'+esc(error.message)+'</div>';
  }
}

function clearOutput(){
  var output=document.getElementById('global-search-output');
  if(output)output.innerHTML='<div class="global-search-empty">输入问题后开始搜索。</div>';
}

function renderPanel(targetId){
  var tab=document.getElementById(targetId||'report-global-search-host')||document.getElementById('tab-report');
  if(!tab)return;
  var existing=document.getElementById('global-search-panel');
  if(existing)existing.remove();
  var quickGroups=[
    ['精确查数',['北京分公司2026-05经营利润是多少？','广西分公司综合成本率是多少？']],
    ['条件筛选',['哪些分公司保费达成不好且亏损？','哪些机构赔付率高？']],
    ['排名查询',['综合成本率最高的前5家是谁？','人均产能最低的10家是谁？']],
    ['主题分析',['广西分公司人力效能情况。','广东分公司盈利能力怎么样？']],
    ['趋势查询',['广东分公司近6个月保费趋势怎么样？','安徽分公司近3个月利润变化如何？']],
    ['机构对比',['北京和上海哪个利润更好？','广东和广西成本质量谁更差？']]
  ];
  var quickHtml=quickGroups.map(function(group){
    return '<div class="global-search-chip-group"><span>'+esc(group[0])+'</span>'+
      group[1].map(function(q){return '<button class="global-search-chip" onclick="runGlobalSearchFromHistory(\''+attr(q)+'\')">'+esc(q)+'</button>';}).join('')+
      '</div>';
  }).join('');
  var panel=document.createElement('div');
  panel.id='global-search-panel';
  panel.className='global-search-panel';
  panel.innerHTML='<style>'+
    '.global-search-panel{background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:14px;padding:14px 16px;margin-bottom:16px;box-shadow:0 8px 24px rgba(15,23,42,.05)}'+
    '.global-search-title{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}.global-search-title h3{margin:0 0 6px;font-size:22px;line-height:1.25;font-weight:800;color:var(--text,#0f172a)}.global-search-title small{color:var(--muted,#64748b);font-size:14px;line-height:1.7}'+
    '.global-search-row{display:flex;gap:8px}.global-search-row input{flex:1;padding:10px 12px;border:1px solid var(--border,#d1d5db);border-radius:10px;font-size:14px}.global-search-row button,.global-search-chip,.global-search-history-item{cursor:pointer}'+
    '.global-search-row button{padding:10px 16px;border:0;border-radius:10px;background:#1e3a5f;color:#fff;font-weight:700}.global-search-guide{margin:10px 0 12px;padding:10px;border:1px dashed #bfdbfe;border-radius:12px;background:#f8fbff}.global-search-guide-title{font-size:12px;color:#475569;cursor:pointer;font-weight:700}.global-search-guide[open] .global-search-guide-title{margin-bottom:8px}.global-search-chips{display:grid;gap:8px}.global-search-chip-group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.global-search-chip-group span{width:64px;color:#64748b;font-size:12px}.global-search-chip{cursor:pointer;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:999px;padding:5px 10px;font-size:12px}'+
    '.global-search-rules{margin:10px 0 12px;border:1px solid #dbeafe;border-radius:12px;background:#f8fbff}.global-search-rules summary{cursor:pointer;display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 12px;color:#1e3a5f;font-weight:700}.global-search-rules summary small{font-weight:400;color:#64748b}.global-search-rules-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:0 12px 12px}.global-search-rules section{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px}.global-search-rules h4{margin:0 0 6px;font-size:13px;color:#0f172a}.global-search-rules ul{margin:0;padding-left:18px;color:#475569;font-size:12px;line-height:1.65}.global-search-rules p{margin:0;color:#475569;font-size:12px;line-height:1.65}'+
    '.global-search-body{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:12px}.global-search-answer-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;color:var(--muted,#64748b)}.global-search-answer-head button{border:0;background:transparent;color:#2563eb;cursor:pointer}.global-search-output{min-height:86px}.global-search-history{border-left:1px solid var(--border,#e5e7eb);padding-left:12px}.global-search-history-head{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted,#64748b);margin-bottom:6px}.global-search-history-head button{border:0;background:transparent;color:#dc2626;cursor:pointer}'+
    '.global-search-history-item{display:block;width:100%;text-align:left;border:1px solid var(--border,#e5e7eb);background:#fff;border-radius:8px;padding:7px 8px;margin-bottom:6px}.global-search-history-item span{display:block;font-size:12px}.global-search-history-item small{display:block;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
    '.global-search-result{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#f8fafc}.global-search-result-head{display:flex;justify-content:space-between;gap:8px}.global-search-result-head b{font-size:15px;line-height:1.7}.global-search-result-head span{font-size:11px;color:#2563eb;background:#dbeafe;border-radius:999px;padding:2px 8px}.global-search-intent,.global-search-limits{font-size:12px;color:#64748b;margin-top:8px}.global-search-intent summary{cursor:pointer;color:#64748b;font-weight:600}.global-search-intent-grid{display:grid;grid-template-columns:80px minmax(0,1fr);gap:4px 8px;margin-top:8px}.global-search-intent-grid span{color:#64748b}.global-search-intent-grid em{font-style:normal;color:#334155}.global-search-cards{display:grid;gap:6px;margin-top:10px}.global-search-card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px;font-size:13px}.global-search-clarification-option{text-align:left;cursor:pointer;color:#1d4ed8}.global-search-clarification-option:hover{border-color:#93c5fd;background:#eff6ff}.global-search-evidence{margin-top:8px;font-size:12px}.global-search-loading,.global-search-empty,.global-search-error{color:#64748b;padding:12px}.global-search-error{color:#dc2626}'+
    '@media(max-width:900px){.global-search-body,.global-search-rules-grid{grid-template-columns:1fr}.global-search-history{border-left:0;border-top:1px solid var(--border,#e5e7eb);padding-left:0;padding-top:10px}.global-search-rules summary{align-items:flex-start;flex-direction:column}}'+
    '</style>'+
    '<div class="global-search-title"><div><h3>🔎 数据查询</h3><small>自然语言输入，底层按标准查询执行；支持全部准确指标名搜索，当前仅支持查数、筛选、排名、主题、趋势和对比。</small></div></div>'+
    renderUsageRules()+
    '<div class="global-search-row"><input id="global-search-input" placeholder="请尽量包含：机构 + 时间 + 指标/主题 + 问题类型，例如：广东分公司近6个月保费趋势怎么样" onkeydown="if(event.key===\'Enter\')runGlobalSearch()"><button onclick="runGlobalSearch()">搜索</button></div>'+
    '<details class="global-search-guide"><summary class="global-search-guide-title">标准问法示例</summary><div class="global-search-chips">'+quickHtml+'</div></details>'+
    '<div class="global-search-body"><div class="global-search-answer"><div class="global-search-answer-head"><b>回答内容</b><button onclick="clearGlobalSearchOutput()">清空回答</button></div><div id="global-search-output" class="global-search-output"><div class="global-search-empty">输入问题后开始搜索。</div></div></div><aside class="global-search-history"><div class="global-search-history-head"><b>搜索历史</b><button onclick="clearGlobalSearchHistory()">清空</button></div><div id="global-search-history"></div></aside></div>';
  tab.insertBefore(panel,tab.firstChild);
  renderHistory();
}

window.renderGlobalSearchPanel=renderPanel;
window.runGlobalSearch=run;
window.runGlobalSearchFromHistory=function(question){run(question);};
window.clearGlobalSearchOutput=clearOutput;
window.clearGlobalSearchHistory=function(){saveHistory([]);renderHistory();};
})();
