(function(){
'use strict';

var A={run:null,busy:false,pilot:null,pilotLoading:false};
function esc(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v==null?'':v);}
function headers(){
  return {
    'Content-Type':'application/json',
    'X-User-Id':localStorage.getItem('diagnosis-user')||'local-admin',
    'X-Role':localStorage.getItem('diagnosis-role')||'admin',
    'X-Branches':localStorage.getItem('diagnosis-branches')||'*'
  };
}
function api(path,options){
  options=options||{};options.headers=Object.assign({},headers(),options.headers||{});
  return fetch(path,options).then(function(response){
    return response.text().then(function(text){
      var body={};try{body=text?JSON.parse(text):{};}catch(e){body={detail:text};}
      if(!response.ok)throw new Error(body.detail||('请求失败 '+response.status));
      return body;
    });
  });
}
function statusLabel(status){
  return {
    planned:'已规划',running:'分析中',waiting_user:'等待补充',
    failed:'执行失败',completed:'已完成',cancelled:'已取消',
    insufficient_evidence:'证据不足',validation_failed:'校验未通过',
    human_review_required:'等待人工评审',degraded:'已降级'
  }[status]||status||'尚未开始';
}
function stepList(run){
  if(!run||!run.steps||!run.steps.length)return '<p class="agent-empty">提交经营目标后，将显示分析计划和确定性工具调用。</p>';
  return '<ol class="agent-steps">'+run.steps.map(function(step){
    var output=step.output?'<details><summary>查看工具结果摘要</summary><pre>'+esc(JSON.stringify(step.output,null,2))+'</pre></details>':'';
    return '<li class="agent-step step-'+esc(step.status)+'"><span class="step-state">'+esc(statusLabel(step.status))+'</span><div><b>'+esc(step.title)+'</b><small>'+esc(step.toolName)+'</small>'+output+'</div></li>';
  }).join('')+'</ol>';
}
function resultView(result){
  if(!result)return '';
  var report=result.validationReport;
  if(report&&!report.passed){
    return '<section class="agent-blocked"><h4>内容已被可靠性门禁阻止</h4>'+
      '<p>模型或合成结果未向用户展示。请查看以下阻断原因，或继续使用规则诊断。</p>'+
      '<div class="agent-blockers">'+(report.blockers||[]).map(function(item){return '<span>'+esc(item)+'</span>';}).join('')+'</div>'+
      validationView(report)+'</section>';
  }
  function evidenceButtons(ids){
    return (ids||[]).map(function(id){
      return '<button class="link-btn" onclick="showDiagnosisEvidence(\''+esc(id)+'\')">证据 '+esc(id)+'</button>';
    }).join(' ');
  }
  return '<section class="agent-result"><div class="agent-result-head"><span class="result-tag fact-tag">事实</span><h4>智能体分析结果</h4></div>'+
    '<p class="agent-summary">'+esc(result.summary)+'</p>'+
    '<div class="agent-result-grid"><div><h5>确定性事实</h5>'+
    ((result.facts||[]).map(function(item){return '<article class="agent-item"><b>'+esc(item.text)+'</b><p>'+esc(item.metricId)+' · '+esc(item.value)+' '+esc(item.unit||'')+'</p>'+evidenceButtons(item.evidenceIds)+'</article>';}).join('')||'<p class="agent-empty">暂无可验证事实。</p>')+
    '</div><div><h5>分析推断</h5>'+
    ((result.inferences||[]).map(function(item){return '<article class="agent-item"><span class="result-tag inference-tag">推断</span><b>'+esc(item.text)+'</b><p>置信度 '+esc(item.confidence)+'</p>'+evidenceButtons(item.evidenceIds)+'</article>';}).join('')||'<p class="agent-empty">未生成超出证据的推断。</p>')+
    '</div><div><h5>改善建议</h5>'+
    ((result.recommendations||[]).map(function(item){return '<article class="agent-item"><span class="result-tag recommendation-tag">建议</span><b>'+esc(item.title)+'</b><p>'+esc(item.action)+'</p><small>'+esc(item.metricId)+' · '+esc(item.direction)+' · '+esc(item.ownerRole)+'</small>'+evidenceButtons(item.evidenceIds)+'</article>';}).join('')||'<p class="agent-empty">暂无满足完整性要求的建议。</p>')+
    '</div></div><div class="agent-limitations"><b>限制：</b>'+esc((result.limitations||[]).join('；'))+'</div>'+
    validationView(report)+'</section>';
}
function validationView(report){
  if(!report)return '';
  var dimensions=[
    ['数字',report.numericAccuracy],['证据',report.evidenceValidity],
    ['机构隔离',report.organizationIsolation],['指标一致性',report.metricConsistency],
    ['相关性',report.relevance],['建议具体性',report.specificity],
    ['因果安全',report.causalSafety],['安全',report.security]
  ];
  return '<details class="validation-report"><summary>可靠性校验报告 · '+(report.passed?'通过':'未通过')+'</summary>'+
    '<div class="validation-grid">'+dimensions.map(function(entry){
      var item=entry[1]||{};
      return '<span class="'+(item.passed?'passed':'blocked')+'"><b>'+esc(entry[0])+'</b><small>'+Math.round((item.score||0)*100)+'%</small></span>';
    }).join('')+'</div>'+
    (report.requiresHumanReview?'<p class="review-required">该结果需要人工评审后才能形成正式结论。</p>':'')+
    '</details>';
}
function missingInputs(run){
  var missing=run&&run.plan&&run.plan.missingInputs||[];
  if(run&&run.status==='waiting_user'&&missing.length){
    return '<div class="agent-missing"><b>需要补充信息：</b>'+missing.map(esc).join('、')+
      '<button class="btn-sm" onclick="resumeAgentRun()">使用当前机构和周期继续</button></div>';
  }
  return '';
}
function statusNotice(run){
  if(!run)return '';
  if(run.status==='insufficient_evidence'){
    return '<div class="agent-missing"><b>证据不足：</b>当前机构和周期没有足够的确定性数据，系统未生成经营结论。</div>';
  }
  if(run.status==='validation_failed'){
    return '<div class="agent-blocked"><b>校验未通过：</b>候选内容已阻止展示，可继续使用规则诊断。</div>';
  }
  if(run.status==='human_review_required'){
    return '<div class="agent-missing"><b>等待人工评审：</b>自动校验已通过，但高风险结果不能直接形成正式结论。</div>';
  }
  if(run.status==='degraded'){
    return '<div class="agent-missing"><b>AI已降级：</b>当前展示规则诊断，生成式AI未参与正式结论。</div>';
  }
  return '';
}
function pilotView(){
  if(!A.pilot)return '<div class="agent-pilot" id="agent-pilot"><span class="agent-empty">试点指标加载中…</span></div>';
  var p=A.pilot,helpful=p.helpfulRate==null?'暂无反馈':Math.round(p.helpfulRate*100)+'%';
  var gate=p.latestReleaseGate?(p.latestReleaseGate.passed?'通过':'阻断'):'未生成';
  return '<div class="agent-pilot" id="agent-pilot"><h4>受控试点运行指标</h4><div class="agent-pilot-grid">'+
    '<span><b>'+esc(p.runs.total)+'</b><small>智能体任务</small></span>'+
    '<span><b>'+esc(Math.round(p.failureRate*100))+'%</b><small>失败率</small></span>'+
    '<span><b>'+esc(helpful)+'</b><small>有帮助率</small></span>'+
    '<span><b>'+esc(p.taskConversions)+'</b><small>整改任务转化</small></span>'+
    '<span><b>'+esc(p.averageToolLatencyMs)+'ms</b><small>平均工具延迟</small></span>'+
    '<span><b>'+esc(gate)+'</b><small>最新发布门禁</small></span>'+
    '</div></div>';
}
function loadPilot(){
  if(A.pilotLoading)return;A.pilotLoading=true;
  api('/api/pilot-metrics').then(function(metrics){A.pilot=metrics;render();})
    .catch(function(){A.pilot={runs:{total:0},failureRate:0,helpfulRate:null,taskConversions:0,averageToolLatencyMs:0,latestEvaluation:null};render();})
    .finally(function(){A.pilotLoading=false;});
}
function render(){
  var root=document.getElementById('agent-workspace');if(!root)return;
  var run=A.run;
  root.innerHTML='<section class="diagnosis-card agent-panel"><div class="diagnosis-card-head"><div><small>目标 → 计划 → 工具 → 校验 → 闭环</small><h3>经营智能体工作流</h3></div><span class="agent-status status-'+esc(run&&run.status||'idle')+'">'+esc(statusLabel(run&&run.status))+'</span></div>'+
    '<div class="agent-compose"><textarea id="agent-goal" maxlength="2000" placeholder="例如：分析本月综合成本率异常的主要表现，并给出可转为整改任务的建议"></textarea>'+
    '<div class="agent-actions"><select id="agent-task-type"><option value="analysis">经营分析</option><option value="remediation">形成整改草稿</option><option value="review">整改复盘</option></select>'+
    '<select id="agent-risk-level"><option value="medium">一般风险</option><option value="high">高风险·需人工评审</option></select>'+
    '<select id="agent-validation-policy"><option value="strict">严格校验</option><option value="standard">标准校验</option></select>'+
    '<button class="btn" onclick="startAgentRun()" '+(A.busy?'disabled':'')+'>'+(A.busy?'执行中…':'开始分析')+'</button>'+
    (run&&['planned','running','waiting_user','failed'].indexOf(run.status)>=0?'<button class="btn-sm" onclick="cancelAgentRun()">取消任务</button>':'')+'</div></div>'+
    missingInputs(run)+statusNotice(run)+'<div class="agent-plan"><h4>执行计划</h4>'+stepList(run)+'</div>'+
    resultView(run&&run.result)+pilotView()+'</section>';
  if(!A.pilot)loadPilot();
}
function diagnosisContext(){
  var workspace=window.getDiagnosisWorkspace&&window.getDiagnosisWorkspace();
  var diagnosis=workspace&&workspace.diagnosis;
  return {workspace:workspace,diagnosis:diagnosis};
}
function ensureDiagnosis(){
  var context=diagnosisContext(),diagnosis=context.diagnosis;
  if(!diagnosis)return Promise.reject(new Error('请先选择可诊断机构'));
  if(diagnosis.id)return Promise.resolve(diagnosis);
  return api('/api/diagnoses',{method:'POST',body:JSON.stringify(diagnosis)}).then(function(saved){
    Object.assign(diagnosis,saved);return diagnosis;
  });
}
window.startAgentRun=function(){
  var goal=(document.getElementById('agent-goal')||{}).value;
  goal=goal&&goal.trim();if(!goal){toast('请输入经营分析目标','error');return;}
  var taskType=(document.getElementById('agent-task-type')||{}).value||'analysis';
  var riskLevel=(document.getElementById('agent-risk-level')||{}).value||'medium';
  var validationPolicy=(document.getElementById('agent-validation-policy')||{}).value||'strict';
  A.busy=true;render();
  ensureDiagnosis().then(function(diagnosis){
    return api('/api/agent-runs',{method:'POST',body:JSON.stringify({
      goal:goal,orgId:diagnosis.orgId,branch:diagnosis.branch,period:diagnosis.period,
      taskType:taskType,riskLevel:riskLevel,validationPolicy:validationPolicy,
      idempotencyKey:'ui_'+Date.now()+'_'+Math.random().toString(16).slice(2)
    })});
  }).then(function(run){A.run=run;toast('智能体工作流已完成','success');})
    .catch(function(error){toast(error.message,'error');})
    .finally(function(){A.busy=false;render();});
};
window.resumeAgentRun=function(){
  if(!A.run)return;
  var context=diagnosisContext(),diagnosis=context.diagnosis||{};
  A.busy=true;render();
  api('/api/agent-runs/'+encodeURIComponent(A.run.id)+'/inputs',{
    method:'POST',body:JSON.stringify({
      orgId:diagnosis.orgId,branch:diagnosis.branch,period:diagnosis.period
    })
  }).then(function(run){A.run=run;toast('已补充信息并恢复执行','success');})
    .catch(function(error){toast(error.message,'error');})
    .finally(function(){A.busy=false;render();});
};
window.cancelAgentRun=function(){
  if(!A.run)return;
  api('/api/agent-runs/'+encodeURIComponent(A.run.id)+'/cancel',{method:'POST',body:'{}'})
    .then(function(run){A.run=run;toast('智能体任务已取消','info');render();})
    .catch(function(error){toast(error.message,'error');});
};
window.renderAgentWorkspace=render;
})();
