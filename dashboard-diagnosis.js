// 智能经营诊断前端：结构化规则诊断、AI解读、证据、追问与反馈。
(function(){
'use strict';

var D={
  apiAvailable:false,aiEnabled:false,model:null,diagnosis:null,interpretation:null,
  selectedBranch:null,conversationId:null,controller:null,healthChecked:false
};
function esc(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
function val(v,u){return v==null||!isFinite(Number(v))?'—':(u==='%'?(Number(v)*100).toFixed(1)+'%':Number(v).toFixed(2)+(u?' '+u:''));}
function branchData(name){
  var b=(App.DATA.branches||[]).find(function(x){return x.n===name;});
  return b?(b.d||b):null;
}
function alertsFor(name){
  return (App._alertResults||[]).filter(function(item){return item.branchName===name;});
}
function stableHash(value){
  var text=JSON.stringify(value),hash=2166136261;
  for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16);
}
function identityHeaders(){
  return {
    'Content-Type':'application/json',
    'X-User-Id':localStorage.getItem('diagnosis-user')||'local-admin',
    'X-Role':localStorage.getItem('diagnosis-role')||'admin',
    'X-Branches':localStorage.getItem('diagnosis-branches')||'*'
  };
}
function api(path,options){
  options=options||{};
  options.headers=Object.assign({},identityHeaders(),options.headers||{});
  return fetch(path,options).then(function(response){
    return response.text().then(function(text){
      var body={};try{body=text?JSON.parse(text):{};}catch(e){body={detail:text};}
      if(!response.ok)throw new Error(body.detail||body.error||('请求失败 '+response.status));
      return body;
    });
  });
}
function buildDiagnosis(branch){
  if(typeof window.buildDiagnosisModel!=='function')throw new Error('统一诊断内核未加载');
  return window.buildDiagnosisModel(branch,alertsFor(branch));
}
function branchNames(){
  var alerted={};(App._alertResults||[]).forEach(function(item){if(item.branchName)alerted[item.branchName]=1;});
  var names=Object.keys(alerted);
  if(!names.length)names=(App.DATA.branches||[]).map(function(item){return item.n;});
  return names.sort();
}
function statusBar(){
  var imported=App.ALL_DATA._importTimes&&App.ALL_DATA._importTimes.actuals&&App.ALL_DATA._importTimes.actuals[App.currentMonth];
  var service=D.apiAvailable?(D.aiEnabled?'AI服务可用':'AI已关闭'):'规则诊断演示';
  return '<div class="diagnosis-status"><span>报告周期：<b>'+esc(App.currentMonth)+'</b></span><span>数据更新：<b>'+esc(imported?new Date(imported).toLocaleString():'未知')+'</b></span><span>规则状态：<b>已生成</b></span><span>AI状态：<b>'+esc(service)+'</b></span><span class="diagnosis-warning">仅供管理参考</span></div>';
}
function renderEvidenceList(diagnosis){
  var referenced={};
  (diagnosis.facts||[]).forEach(function(item){
    if((item.isRiskMetric||item.isAttention)&&item.evidenceId)referenced[item.evidenceId]=true;
  });
  (diagnosis.attentionItems||[]).forEach(function(item){
    if(item.evidenceId)referenced[item.evidenceId]=true;
  });
  var items=(diagnosis.evidence||[]).filter(function(item){return referenced[item.id];});
  var warnings=items.filter(function(item){return !!item.ruleId;});
  var comparisons=items.filter(function(item){
    return !item.ruleId&&App.KEY_SET&&App.KEY_SET.has(item.metric)&&
      (item.rank||item.benchmarkValue!=null);
  });
  items=warnings.concat(comparisons);
  if(!items.length)return '<div class="diagnosis-evidence-empty">当前没有需要举证的风险或异常结论。</div>';
  function rows(list){
    return list.map(function(item){
    var basis='暂无判断基准',deviation='—',conclusion='需要关注该指标表现';
    if(item.ruleId){
      conclusion=item.alertMessage||'触发预警规则';
      basis=item.alertOperator&&item.alertThreshold!=null?
        ('预警线 '+item.alertOperator+' '+val(item.alertThreshold,item.unit)):'自定义预警规则';
      if(item.alertThreshold!=null&&item.currentValue!=null){
        var gap=Number(item.currentValue)-Number(item.alertThreshold);
        deviation=item.unit==='%'?
          ((gap>0?'+':'')+(gap*100).toFixed(1)+'个百分点'):
          ((gap>0?'+':'')+val(gap,item.unit));
      }
    }else if(item.rank){
      conclusion='同口径机构排名偏后';
      basis='机构排名 '+item.rank.rank+'/'+item.rank.total;
      deviation='位于后 '+Math.round((item.rank.total-item.rank.rank+1)/item.rank.total*100)+'%';
    }else if(item.benchmarkValue!=null){
      basis=(item.benchmarkLabel||'对标值')+' '+val(item.benchmarkValue,item.unit);
      if(item.differenceValue!=null){
        deviation=item.unit==='%'?
          ((Number(item.differenceValue)>0?'+':'')+(Number(item.differenceValue)*100).toFixed(1)+'个百分点'):
          ((Number(item.differenceValue)>0?'+':'')+val(item.differenceValue,item.unit));
      }
    }
    var severity=item.severity||'attention';
    var severityLabel={error:'严重',warn:'警告',info:'提示',attention:'关注'}[severity]||'关注';
    var purpose='用于校验风险结论并确定后续核查优先级';
    if(/赔付|综合成本/.test(item.metric))purpose='用于判断赔付与成本风险，支持赔案及险种结构核查';
    else if(/保费达成|时间进度计划达成/.test(item.metric))purpose='用于判断业务进度风险，支持渠道及险种缺口核查';
    else if(/人均|人员|人力/.test(item.metric))purpose='用于判断人效风险，支持人员配置与产能匹配核查';
    else if(/费用/.test(item.metric))purpose='用于判断费用管控风险，支持费用科目与预算偏差核查';
    return '<article class="diagnosis-basis-card basis-'+esc(severity)+'">'+
      '<div class="basis-head"><div><span class="basis-level">'+esc(severityLabel)+'</span><b>'+esc(item.label)+'</b></div><button class="link-btn" onclick="showDiagnosisEvidence(\''+esc(item.id)+'\')">查看详情</button></div>'+
      '<p class="basis-conclusion">'+esc(conclusion)+'</p>'+
      '<div class="basis-values"><span><small>当前表现</small><strong>'+esc(val(item.currentValue,item.unit))+'</strong></span><span><small>判断基准</small><strong>'+esc(basis)+'</strong></span><span><small>偏离程度</small><strong>'+esc(deviation)+'</strong></span></div>'+
      '<p class="basis-purpose"><small>如何使用</small>'+esc(purpose)+'</p></article>';
    }).join('');
  }
  var visibleLimit=5,visible=items.slice(0,visibleLimit),hidden=items.slice(visibleLimit);
  return '<div class="diagnosis-evidence-list">'+rows(visible)+
    (hidden.length?'<details class="evidence-more"><summary>展开更多诊断依据（'+hidden.length+'项）</summary><div class="evidence-more-list">'+rows(hidden)+'</div></details>':'')+
    '</div>';
}
function renderRuleDiagnosis(diagnosis){
  var riskFacts=(diagnosis.facts||[]).filter(function(item){return item.isRiskMetric||item.isAttention;});
  function factRows(items){
    return items.map(function(item){
      var level=item.severity||'neutral';
      var label={error:'严重',warn:'警告',info:'提示',attention:'关注',neutral:'事实'}[level]||'事实';
      return '<div class="diagnosis-fact fact-'+esc(level)+'"><div><span class="fact-level">'+esc(label)+'</span><b>'+esc(item.text)+'</b></div>'+
        (item.anomalyReason?'<p>'+esc(item.anomalyReason)+'</p>':'')+
        '<button class="link-btn" onclick="showDiagnosisEvidence(\''+esc(item.evidenceId)+'\')">查看依据</button></div>';
    }).join('');
  }
  function recommendationGroups(items){
    var definitions=[
      {key:'business',label:'业务端'},
      {key:'claims',label:'理赔端'},
      {key:'efficiency',label:'人效端'},
      {key:'management',label:'管理端'}
    ];
    return definitions.map(function(group){
      var rows=items.map(function(item,index){return {item:item,index:index};})
        .filter(function(entry){return (entry.item.domain||'management')===group.key;});
      if(!rows.length)return '';
      return '<section class="recommendation-group recommendation-'+group.key+'"><h5>'+esc(group.label)+'<span>'+rows.length+'项</span></h5>'+
        rows.map(function(entry){var item=entry.item;return '<div class="recommendation"><div class="recommendation-meta">'+esc(item.period||'')+'</div><b>'+esc(item.title)+'</b><p>'+esc(item.action)+'</p><button class="btn-sm" onclick="createRemediationDraft('+entry.index+')">转为整改任务</button></div>';}).join('')+
        '</section>';
    }).join('');
  }
  return '<section class="diagnosis-card"><div class="diagnosis-card-head"><div><small>确定性事实底座</small><h3>基础诊断报告</h3></div><span class="risk-chip risk-'+esc(diagnosis.riskLevel)+'">'+esc(diagnosis.riskLevel)+'</span></div>'+
    '<p class="diagnosis-lead">'+esc(diagnosis.summary)+'</p>'+
    '<div class="diagnosis-grid"><div><h4>风险与异常事实</h4>'+(riskFacts.length?factRows(riskFacts):'<p class="fact-empty">当前未发现规则预警或明显对标异常。</p>')+'</div>'+
    '<div><h4>分析推断</h4>'+diagnosis.inferences.map(function(item){return '<p><span class="trust-tag">推断</span>'+esc(item.text)+'</p>';}).join('')+'</div>'+
    '<div><h4>经营特征判断</h4><p class="section-purpose">综合多项指标归纳当前经营表现，回答“呈现什么特征”，不替代原因核查。</p>'+
    (diagnosis.patterns.length?diagnosis.patterns.map(function(item){
      return '<div class="pattern-item"><div><span class="pattern-tag">特征</span><b>'+esc(item.name)+'</b></div>'+
        (item.trigger?'<p><small>组合表现</small>'+esc(item.trigger)+'</p>':'')+
        '<p><small>管理解读</small>'+esc(item.businessMeaning)+'</p></div>';
    }).join(''):'<p class="fact-empty">当前未发现需要特别提示的组合经营特征。</p>')+'</div>'+
    '<div><h4>待核查</h4>'+diagnosis.investigations.map(function(item){return '<p>'+esc(typeof item==='string'?item:item.text)+'</p>';}).join('')+'</div>'+
    '<div><h4>管理建议</h4><p class="section-purpose">按执行领域归类，便于明确牵头责任。</p>'+recommendationGroups(diagnosis.recommendations)+'</div></div>'+
    '<div class="limitations"><b>数据局限：</b>'+diagnosis.limitations.map(esc).join('；')+'</div>'+
    // ── 一对一 AI 深度解读 ──
    '<div id="ai-deep-'+esc(diagnosis.branch)+'" style="margin-top:12px;border-top:1px solid #e5e7eb;padding-top:12px">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
    '<h4 style="font-size:13px;font-weight:700">🤖 AI 深度解读 · '+esc(diagnosis.branch)+'</h4>'+
    '<button id="ai-deep-btn-'+esc(diagnosis.branch)+'" onclick="generateBranchDeepReading(\''+esc(diagnosis.branch)+'\')" style="padding:5px 14px;border:1px solid #7c3aed;border-radius:6px;background:#f5f3ff;color:#7c3aed;cursor:pointer;font-size:12px;font-weight:600">生成 AI 深度解读</button>'+
    '</div>'+
    '<div id="ai-deep-content-'+esc(diagnosis.branch)+'" style="min-height:40px;font-size:13px;line-height:1.7;color:var(--text)"></div></div>'+
    '</section>';
}
function renderInterpretation(payload){
  if(!payload)return '<section class="diagnosis-card ai-panel"><div class="diagnosis-card-head"><div><small>按需生成</small><h3>AI深度解读</h3></div><button class="btn" '+(!D.aiEnabled?'disabled title="生成式AI未启用"':'onclick="generateInterpretation()"')+'>生成AI深度解读</button></div><p class="empty-copy">'+(D.aiEnabled?'AI将基于已保存的诊断快照和证据生成结构化解读。':'当前仅提供规则诊断；配置内部后端并启用AI后可生成深度解读。')+'</p></section>';
  return '<section class="diagnosis-card ai-panel"><div class="diagnosis-card-head"><div><small>模型增强 · '+esc(D.model||'')+'</small><h3>AI深度解读</h3></div><button class="btn-sm" onclick="generateInterpretation()">重新生成</button></div>'+
    '<p class="diagnosis-lead">'+esc(payload.summary)+'</p>'+
    '<div class="diagnosis-grid"><div><h4>关键事实</h4>'+payload.facts.map(function(item){return '<p>'+esc(item.text)+' <button class="link-btn" onclick="showDiagnosisEvidence(\''+esc(item.evidenceId)+'\')">查看依据</button></p>';}).join('')+'</div>'+
    '<div><h4>潜在驱动因素</h4>'+payload.inferences.map(function(item){return '<p><span class="trust-tag">置信度 '+esc(item.confidence||'未标注')+'</span>'+esc(item.text)+'</p>';}).join('')+'</div>'+
    '<div><h4>待核查数据</h4>'+payload.investigations.map(function(item){return '<p>'+esc(typeof item==='string'?item:(item.text||JSON.stringify(item)))+'</p>';}).join('')+'</div>'+
    '<div><h4>建议</h4>'+payload.recommendations.map(function(item,index){return '<div class="recommendation"><b>'+esc(item.title||'改善建议')+'</b><p>'+esc(item.action||item.text||'')+'</p><button class="btn-sm" onclick="createAIRemediationDraft('+index+')">转为整改任务</button></div>';}).join('')+'</div></div>'+
    '<div class="feedback-bar">这份解读是否有帮助？ <button onclick="sendDiagnosisFeedback(\'helpful\')">有帮助</button><button onclick="sendDiagnosisFeedback(\'not_helpful\')">没有帮助</button><button onclick="sendDiagnosisFeedback(\'numeric_error\')">数字错误</button><button onclick="sendDiagnosisFeedback(\'missing_evidence\')">结论缺少依据</button><button onclick="sendDiagnosisFeedback(\'not_actionable\')">建议不可执行</button></div></section>';
}
function renderChat(){
  var disabled=!D.aiEnabled||!D.diagnosis||!D.diagnosis.id;
  var prompts=['为什么该分公司被判定为高风险？','哪项指标对综合成本率影响最大？','管理层本周应优先核查什么？','请将建议整理为整改清单。'];
  return '<section class="diagnosis-card chat-panel"><div class="diagnosis-card-head"><div><small>机构与周期独立会话</small><h3>交互追问</h3></div></div>'+
    '<div class="prompt-chips">'+prompts.map(function(item){return '<button '+(disabled?'disabled':'onclick="askPreset(this.textContent)"')+'>'+esc(item)+'</button>';}).join('')+'</div>'+
    '<div id="diagnosis-chat-log" class="chat-log"><p class="empty-copy">围绕当前报告继续追问；切换机构或月份后会话自动隔离。</p></div>'+
    '<div class="chat-compose"><textarea id="diagnosis-question" maxlength="2000" placeholder="输入经营分析问题…" '+(disabled?'disabled':'')+'></textarea><button class="btn" onclick="sendDiagnosisQuestion()" '+(disabled?'disabled':'')+'>发送</button><button class="btn-sm" onclick="cancelDiagnosisQuestion()" '+(disabled?'disabled':'')+'>取消</button></div></section>';
}
function render(){
  var ct=document.getElementById('ai-content');if(!ct)return;
  var names=branchNames();
  if(!D.selectedBranch||names.indexOf(D.selectedBranch)<0)D.selectedBranch=names[0]||null;
  if(!D.selectedBranch){
    ct.innerHTML=statusBar()+'<div class="diagnosis-empty"><h3>暂无可诊断机构</h3><p>请先导入经营数据。</p></div>';return;
  }
  if(!D.diagnosis||D.diagnosis.branch!==D.selectedBranch||D.diagnosis.period!==App.currentMonth){
    D.diagnosis=buildDiagnosis(D.selectedBranch);D.interpretation=null;
    D.conversationId='conv_'+stableHash([D.selectedBranch,App.currentMonth,D.diagnosis.dataVersion]);
  }
  ct.innerHTML=statusBar()+
    '<div class="diagnosis-toolbar"><div><label>诊断机构</label><select id="diagnosis-branch" onchange="selectDiagnosisBranch(this.value)">'+names.map(function(name){return '<option '+(name===D.selectedBranch?'selected':'')+'>'+esc(name)+'</option>';}).join('')+'</select></div><button class="btn-sm" onclick="syncDiagnosisSnapshot()">同步诊断快照</button></div>'+
    '<div class="diagnosis-summary-row"><div><strong>'+names.filter(function(name){return buildDiagnosis(name).riskLevel==='高风险';}).length+'</strong><span>高风险机构</span></div><div><strong>'+names.filter(function(name){return buildDiagnosis(name).riskLevel==='中风险';}).length+'</strong><span>中风险机构</span></div><div><strong>'+names.length+'</strong><span>涉及机构</span></div><div><strong>'+(App._alertResults||[]).length+'</strong><span>告警总数</span></div></div>'+
    renderRuleDiagnosis(D.diagnosis)+
    // 个性化分析（全局功能）
    '<section class="diagnosis-card" style="margin-top:16px"><div class="diagnosis-card-head"><div><small>全量数据 · 自然语言提问</small><h3>💬 个性化分析</h3></div></div>'+
    '<p style="font-size:12px;color:var(--muted);margin-bottom:10px">基于看板全量数据，输入分析需求，AI 会精准读取数据并生成报告。</p>'+
    '<div id="ai-ca-msgs" style="min-height:60px;margin-bottom:12px;font-size:13px;line-height:1.7"></div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">'+
    [{icon:'📊',t:'全国经营概览',q:'请分析'+(App.currentMonth||'').split('-')[0]+'年全国整体经营情况，包括保费达成、利润和COR表现'},
     {icon:'🏢',t:'责任区对比',q:'请对比四个责任区'+(App.currentMonth||'').split('-')[0]+'年的综合成本率、赔付率和费用率差异'},
     {icon:'📈',t:'趋势分析',q:'请分析全国综合成本率近两年的变化趋势'},
     {icon:'👥',t:'人效诊断',q:'请分析各责任区'+(App.currentMonth||'').split('-')[0]+'年人均产能和人均利润的差异'}
    ].map(function(q){return '<button class="btn-sm" onclick="document.getElementById(\'ai-ca-input\').value=\''+q.q.replace(/'/g,'\\\'')+'\';sendAnalyze()" style="border:1px solid #d1d5db;background:#fff">'+q.icon+' '+q.t+'</button>';}).join('')+
    '</div>'+
    '<div style="display:flex;gap:8px"><input id="ai-ca-input" placeholder="如：请分析河南分公司近三年综合成本率变化情况" style="flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();sendAnalyze();}" autocomplete="off"><button class="btn" onclick="sendAnalyze()">发送</button></div></section>'+
    '<div id="diagnosis-drawer" class="diagnosis-drawer" aria-live="polite"></div>';
  if(window.renderAgentWorkspace)window.renderAgentWorkspace();
}
function checkHealth(){
  if(D.healthChecked)return Promise.resolve();
  D.healthChecked=true;
  return fetch('/api/health',{headers:identityHeaders()}).then(function(r){
    if(!r.ok)throw new Error('offline');return r.json();
  }).then(function(body){
    D.apiAvailable=!!body&&!!body.ok;D.aiEnabled=!!(body&&body.aiEnabled);D.model=body&&body.model;
  }).catch(function(){D.apiAvailable=false;D.aiEnabled=false;});
}
function persistDiagnosis(){
  if(!D.apiAvailable)return Promise.reject(new Error('当前为静态演示模式，未连接内部诊断服务'));
  return api('/api/diagnoses',{method:'POST',body:JSON.stringify(D.diagnosis)}).then(function(saved){
    D.diagnosis=Object.assign({},D.diagnosis,saved);return D.diagnosis;
  });
}

window.renderAITab=function(){
  // 诊断模块未完善，直接使用规则报告+AI问答
  if(typeof window._renderRulesReport==='function'){
    window._renderRulesReport();
  }else{
    // fallback: 如果规则报告不存在，渲染简单提示
    var ct=document.getElementById('ai-content');
    if(ct)ct.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">AI 功能加载中...</div>';
  }
};
window.selectDiagnosisBranch=function(name){D.selectedBranch=name;D.diagnosis=null;D.interpretation=null;D.healthChecked=false;render();};
window.syncDiagnosisSnapshot=function(){
  persistDiagnosis().then(function(){toast('诊断快照与证据已保存','success');render();}).catch(function(e){toast(e.message,'error');});
};
window.generateInterpretation=function(){
  var button=document.querySelector('.ai-panel .btn,.ai-panel .btn-sm');if(button){button.disabled=true;button.textContent='生成中…';}
  persistDiagnosis().then(function(diagnosis){
    return api('/api/diagnoses/'+encodeURIComponent(diagnosis.id)+'/interpretations',{method:'POST',body:'{}'});
  }).then(function(payload){D.interpretation=payload;toast('AI深度解读已生成','success');render();})
    .catch(function(e){toast(e.message+'；基础诊断仍可正常使用','error');render();});
};
window.showDiagnosisEvidence=function(id){
  var local=(D.diagnosis.evidence||[]).find(function(item){return item.id===id;});
  function show(item){
    var drawer=document.getElementById('diagnosis-drawer');if(!drawer)return;
    drawer.classList.add('open');
    drawer.innerHTML='<button class="drawer-close" onclick="this.parentNode.classList.remove(\'open\')">×</button><small>数据证据</small><h3>'+esc(item.label||item.metric)+'</h3>'+
      '<dl><dt>指标编码</dt><dd>'+esc(item.metricId||item.metric_id||'')+'</dd><dt>当前值</dt><dd>'+esc(val(item.currentValue!=null?item.currentValue:item.current_value,item.unit))+'</dd><dt>对标值</dt><dd>'+esc(val(item.benchmarkValue!=null?item.benchmarkValue:item.benchmark_value,item.unit))+'</dd><dt>对标对象</dt><dd>'+esc(item.benchmarkLabel||item.benchmark_label||'暂不提供对标')+'</dd><dt>对标策略</dt><dd>'+esc(item.benchmarkStrategy||item.benchmark_strategy||item.benchmarkType||item.benchmark_type||'none')+'</dd><dt>改善方向</dt><dd>'+esc(item.direction||'neutral')+'</dd><dt>周期</dt><dd>'+esc(D.diagnosis.period)+'</dd><dt>来源</dt><dd>'+esc(item.source)+'</dd><dt>规则</dt><dd>'+esc(item.ruleId||item.rule_id||'未触发规则')+'</dd></dl>';
  }
  if(local)show(local);else if(D.apiAvailable)api('/api/evidence/'+encodeURIComponent(id)).then(show).catch(function(e){toast(e.message,'error');});
};
window.sendDiagnosisFeedback=function(type){
  if(!D.interpretation)return;
  api('/api/feedback',{method:'POST',body:JSON.stringify({targetId:D.interpretation.id,targetType:'interpretation',branch:D.diagnosis.branch,period:D.diagnosis.period,feedbackType:type})})
    .then(function(){toast('反馈已记录','success');}).catch(function(e){toast(e.message,'error');});
};
window.askPreset=function(question){var input=document.getElementById('diagnosis-question');if(input){input.value=question;sendDiagnosisQuestion();}};
window.cancelDiagnosisQuestion=function(){if(D.controller){D.controller.abort();D.controller=null;toast('已取消生成','info');}};
window.sendDiagnosisQuestion=function(){
  var input=document.getElementById('diagnosis-question'),question=input&&input.value.trim();if(!question)return;
  var log=document.getElementById('diagnosis-chat-log');if(!log)return;
  log.querySelector('.empty-copy')&&log.querySelector('.empty-copy').remove();
  log.insertAdjacentHTML('beforeend','<div class="chat-message user">'+esc(question)+'</div><div class="chat-message assistant"><span class="chat-stream"></span></div>');
  var stream=log.querySelector('.chat-message:last-child .chat-stream');input.value='';
  D.controller=new AbortController();

  // ── 直接调 /ai/chat（统一路径，不依赖 /api/conversations） ──
  if(true){
    var ctx={
      period:D.diagnosis&&D.diagnosis.period,
      branch:D.diagnosis&&D.diagnosis.branch,
      riskLevel:D.diagnosis&&D.diagnosis.riskLevel,
      summary:D.diagnosis&&D.diagnosis.summary,
      facts:(D.diagnosis&&D.diagnosis.facts||[]).slice(0,10),
      patterns:(D.diagnosis&&D.diagnosis.patterns||[]).slice(0,5),
      inferences:(D.diagnosis&&D.diagnosis.inferences||[]).slice(0,8),
      recommendations:(D.diagnosis&&D.diagnosis.recommendations||[]).slice(0,5)
    };
    var _stream=document.createElement('div');
    stream.textContent='';
    AICLIENT.stream([
      {role:'system',content:'你是安效能诊断助手。'+JSON.stringify(ctx)},
      {role:'user',content:question}
    ],function(chunk){
      if(chunk===null){D.controller=null;return;}
      stream.textContent+=chunk;
      log.scrollTop=log.scrollHeight;
    }).then(function(){D.controller=null;})
    .catch(function(e){
      if(e.name==='AbortError')return;
      stream.textContent='请求失败：'+e.message;
      D.controller=null;
    });
    return;
  }

  // ── 原有路径：通过 /api/conversations ──
  persistDiagnosis().then(function(diagnosis){
    return fetch('/api/conversations/'+encodeURIComponent(D.conversationId)+'/messages',{
      method:'POST',headers:identityHeaders(),signal:D.controller.signal,
      body:JSON.stringify({diagnosisId:diagnosis.id,question:question})
    });
  }).then(function(response){
    if(!response.ok)return response.text().then(function(t){throw new Error(t||'追问失败');});
    var reader=response.body.getReader(),decoder=new TextDecoder(),buffer='';
    function read(){
      return reader.read().then(function(result){
        if(result.done)return;
        buffer+=decoder.decode(result.value,{stream:true});
        var parts=buffer.split('\n\n');buffer=parts.pop();
        parts.forEach(function(part){
          part.split('\n').forEach(function(line){
            if(line.indexOf('data: ')!==0)return;
            var data=JSON.parse(line.slice(6));
            if(data.error)throw new Error(data.error);
            if(data.content)stream.textContent+=data.content;
          });
        });
        log.scrollTop=log.scrollHeight;return read();
      });
    }
    return read();
  }).catch(function(e){if(e.name!=='AbortError'){stream.textContent='生成失败：'+e.message;toast(e.message,'error');}})
    .finally(function(){D.controller=null;});
};
window.getDiagnosisWorkspace=function(){return D;};
window.buildStructuredDiagnosis=buildDiagnosis;

// ══════════ AI 深度解读（一对一）+ 个性化分析 ══════════

function fmtAI(text){
  if(!text)return '';
  var html=text;
  html=html.replace(/```([\s\S]*?)```/g,function(m,c){return '<pre style="background:#f5f5f5;padding:10px;border-radius:4px;overflow-x:auto;font-size:12px">'+c.replace(/</g,'&lt;')+'</pre>';});
  html=html.replace(/^### (.+)$/gm,'<h4 style="font-size:13px;font-weight:700;margin:10px 0 4px">$1</h4>');
  html=html.replace(/^## (.+)$/gm,'<h3 style="font-size:14px;font-weight:700;margin:12px 0 6px">$1</h3>');
  html=html.replace(/^# (.+)$/gm,'<h2 style="font-size:15px;font-weight:700;margin:14px 0 8px">$1</h2>');
  html=html.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  html=html.replace(/^- (.+)$/gm,'<li style="margin-left:18px;list-style:disc">$1</li>');
  html=html.replace(/^\d+\. (.+)$/gm,'<li style="margin-left:18px;list-style:decimal">$1</li>');
  html=html.replace(/\n\n/g,'</p><p style="margin:6px 0">');
  html=html.replace(/\n/g,'<br>');
  return '<p style="margin:6px 0">'+html+'</p>';
}

window.generateBranchDeepReading=function(branchName){
  var btnId='ai-deep-btn-'+branchName;
  var ctId='ai-deep-content-'+branchName;
  var btn=document.getElementById(btnId);
  var ct=document.getElementById(ctId);
  if(!btn||!ct)return;
  btn.disabled=true;btn.textContent='生成中…';
  ct.innerHTML='<span style="color:var(--muted)">正在分析 '+branchName+' 的诊断数据...</span>';

  var diag=buildDiagnosis(branchName);
  var ctx={
    period:App.currentMonth,
    branch:branchName,
    riskLevel:diag.riskLevel,
    summary:diag.summary,
    facts:(diag.facts||[]).slice(0,8),
    patterns:(diag.patterns||[]).slice(0,5),
    inferences:(diag.inferences||[]).slice(0,6),
    recommendations:(diag.recommendations||[]).slice(0,5)
  };
  var question='请基于以上诊断数据，为'+branchName+'生成深度经营分析报告。要求：\n'+
    '1. 风险根因分析：关键指标偏离程度及根本原因\n'+
    '2. 经营模式诊断：COR分解（赔付率vs费用率贡献）、人效分析\n'+
    '3. 与分公司整体的对比：哪些指标显著劣于均值\n'+
    '4. 改进建议：按优先级排序，每条需有具体行动方案和预期效果\n'+
    '5. 所有数据必须严格使用上下文中提供的数值，禁止编造或修改任何数字';

  var _text='',_started=false;
  ct.innerHTML='';
  AICLIENT.stream([
    {role:'system',content:'你是财产保险经营分析专家。'+JSON.stringify(ctx)},
    {role:'user',content:question}
  ],function(chunk){
    if(chunk===null){btn.disabled=false;btn.textContent='重新生成';return;}
    if(!_started){_started=true;ct.innerHTML='';}
    _text+=chunk;ct.innerHTML=fmtAI(_text);
    ct.scrollTop=ct.scrollHeight;
  }).catch(function(e){
    ct.innerHTML='<span style="color:#dc2626">生成失败：'+e.message+'</span>';
    btn.disabled=false;btn.textContent='生成 AI 深度解读';
  });
};

window.sendAnalyze=function(){
  var input=document.getElementById('ai-ca-input');
  if(!input)return;
  var question=input.value.trim();
  if(!question)return;
  input.value='';
  var msgs=document.getElementById('ai-ca-msgs');
  if(!msgs)return;
  msgs.insertAdjacentHTML('beforeend',
    '<div style="text-align:right;margin-bottom:8px"><span style="display:inline-block;padding:8px 14px;background:#2563eb;color:#fff;border-radius:12px 12px 2px 12px;font-size:13px">'+question.replace(/</g,'&lt;')+'</span></div>');
  var aiId='ai-ca-'+Date.now();
  msgs.insertAdjacentHTML('beforeend',
    '<div id="'+aiId+'" style="margin-bottom:12px"><span style="color:var(--muted)">正在解析问题并查询数据...</span></div>');
  var el=document.getElementById(aiId);

  // sessionId 持久化
  var sid=localStorage.getItem('ai-agent-sid')||'';

  var _text2='',_started2=false;
  AICLIENT.stream([
    {role:'system',content:'你是安效能智能助手。用户会提问看板数据相关问题，请基于上下文分析回答。'},
    {role:'user',content:question}
  ],function(chunk){
    if(chunk===null)return;
    if(!_started2){_started2=true;el.innerHTML='';}
    _text2+=chunk;el.innerHTML=fmtAI(_text2);
    el.scrollTop=el.scrollHeight;
  }).catch(function(e){
    el.innerHTML='<span style="color:#dc2626">分析失败：'+e.message+'</span>';
  });
};
// Evidence-based diagnosis AI overrides.
window.generateBranchDeepReading=function(branchName){
  var btn=document.getElementById('ai-deep-btn-'+branchName);
  var ct=document.getElementById('ai-deep-content-'+branchName);
  if(!btn||!ct)return;
  if(!window.AIEngine){ct.innerHTML='<span style="color:#dc2626">AI查询底座未加载</span>';return;}
  if(App.shareMode){ct.innerHTML='<div style="padding:16px;color:var(--muted)">分享模式提供本地智能分析，不开放大模型深度解读。</div>';return;}
  btn.disabled=true;btn.textContent='生成中…';
  ct.innerHTML='<span style="color:var(--muted)">正在查询证据并生成深度分析…</span>';
  AIEngine.ask('请基于证据包，对 '+branchName+' 做经营深度分析，输出关键事实、风险判断、建议和限制。',{org:branchName,mode:'deep'})
    .then(function(result){ct.innerHTML=AIEngine.renderAnswer(result);})
    .catch(function(error){ct.innerHTML='<span style="color:#dc2626">分析失败：'+esc(error.message)+'</span>';})
    .finally(function(){btn.disabled=false;btn.textContent='重新生成';});
};

window.sendDiagnosisQuestion=function(){
  var input=document.getElementById('diagnosis-question'), question=input&&input.value.trim();if(!question)return;
  var log=document.getElementById('diagnosis-chat-log');if(!log)return;
  log.querySelector('.empty-copy')&&log.querySelector('.empty-copy').remove();
  log.insertAdjacentHTML('beforeend','<div class="chat-message user">'+esc(question)+'</div><div class="chat-message assistant"><span class="chat-stream">正在查询证据…</span></div>');
  var stream=log.querySelector('.chat-message:last-child .chat-stream');input.value='';
  if(!window.AIEngine){stream.textContent='AI查询底座未加载';return;}
  AIEngine.ask(question,{
    org:D.diagnosis&&D.diagnosis.branch,
    period:D.diagnosis&&D.diagnosis.period,
    mode:'deep',
    useDiagnosis:true,
    diagnosisContext:D.diagnosis||null
  }).then(function(result){
    stream.innerHTML=AIEngine.renderAnswer(result);
    log.scrollTop=log.scrollHeight;
  }).catch(function(error){
    stream.textContent='分析失败：'+error.message;
  });
};

window.sendAnalyze=function(){
  var input=document.getElementById('ai-ca-input');
  if(!input)return;
  var question=input.value.trim();
  if(!question)return;
  input.value='';
  var msgs=document.getElementById('ai-ca-msgs');
  if(!msgs)return;
  msgs.insertAdjacentHTML('beforeend',
    '<div style="text-align:right;margin-bottom:8px"><span style="display:inline-block;padding:8px 14px;background:#2563eb;color:#fff;border-radius:12px 12px 2px 12px;font-size:13px">'+esc(question)+'</span></div>');
  var aiId='ai-evidence-'+Date.now();
  msgs.insertAdjacentHTML('beforeend','<div id="'+aiId+'" style="margin-bottom:12px"><span style="color:var(--muted)">正在查询看板数据和证据…</span></div>');
  var el=document.getElementById(aiId);
  if(!window.AIEngine){el.innerHTML='<span style="color:#dc2626">AI查询底座未加载</span>';return;}
  AIEngine.ask(question).then(function(result){
    el.innerHTML=AIEngine.renderAnswer(result);
    msgs.scrollTop=msgs.scrollHeight;
  }).catch(function(error){
    el.innerHTML='<span style="color:#dc2626">分析失败：'+esc(error.message)+'</span>';
  });
};
})();
