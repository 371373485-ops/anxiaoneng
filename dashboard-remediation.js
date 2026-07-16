// 整改任务草稿、状态流转、统计与下一周期复盘。
(function(){
'use strict';
var R={tasks:[]};
function esc(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v==null?'':v);}
function workspace(){return window.getDiagnosisWorkspace&&getDiagnosisWorkspace();}
function headers(){return {'Content-Type':'application/json','X-User-Id':localStorage.getItem('diagnosis-user')||'local-admin','X-Role':localStorage.getItem('diagnosis-role')||'admin','X-Branches':localStorage.getItem('diagnosis-branches')||'*'};}
function api(path,options){options=options||{};options.headers=Object.assign({},headers(),options.headers||{});return fetch(path,options).then(function(r){return r.text().then(function(t){var b={};try{b=t?JSON.parse(t):{};}catch(e){}if(!r.ok)throw new Error(b.detail||'请求失败');return b;});});}
function ensureDiagnosis(){
  var w=workspace();if(!w||!w.apiAvailable)return Promise.reject(new Error('整改任务仅在内部服务模式可用'));
  if(w.diagnosis.id)return Promise.resolve(w.diagnosis);
  return api('/api/diagnoses',{method:'POST',body:JSON.stringify(w.diagnosis)}).then(function(saved){w.diagnosis=Object.assign({},w.diagnosis,saved);return w.diagnosis;});
}
function form(recommendation,index){
  var w=workspace(),diagnosis=w.diagnosis,metric=recommendation.metric||'',evidenceIds=Array.isArray(recommendation.evidenceIds)?recommendation.evidenceIds:[],evidence=(diagnosis.evidence||[]).find(function(item){return evidenceIds.indexOf(item.id)>=0;});
  if(!evidence&&recommendation.metricId)evidence=(diagnosis.evidence||[]).find(function(item){return item.metricId===recommendation.metricId;});
  if(!evidence&&metric)evidence=(diagnosis.evidence||[]).find(function(item){return item.metric===metric;});
  var drawer=document.getElementById('diagnosis-drawer');if(!drawer)return;
  drawer.classList.add('open');
  drawer.innerHTML='<button class="drawer-close" onclick="this.parentNode.classList.remove(\'open\')">×</button><small>整改任务草稿</small><h3>'+esc(recommendation.title||'经营改善任务')+'</h3>'+
    (recommendation.requiresEvidenceReview?'<div class="recommendation-evidence-warning">需人工补充依据：该建议暂未绑定有效证据，仅可作为草稿。</div>':'')+
    '<div class="task-form"><label>任务标题<input id="task-title" value="'+esc(recommendation.title||'')+'"></label><label>问题描述<textarea id="task-desc">'+esc(recommendation.text||recommendation.action||'')+'</textarea></label><label>整改措施<textarea id="task-action">'+esc(recommendation.action||'')+'</textarea></label>'+
    '<div class="task-form-row"><label>责任部门<input id="task-dept"></label><label>责任人<input id="task-owner"></label></div><div class="task-form-row"><label>完成期限<input id="task-due" type="date"></label><label>目标值<input id="task-target" type="number" step="any"></label></div>'+
    '<button class="btn" onclick="saveRemediationDraft('+index+',\''+esc(metric)+'\','+(evidence&&evidence.currentValue!=null?evidence.currentValue:'null')+')">保存草稿</button></div>';
}
window.createRemediationDraft=function(index){var w=workspace();form(w.diagnosis.recommendations[index],index);};
window.createAIRemediationDraft=function(index){var w=workspace();form(w.interpretation.recommendations[index],index);};
window.saveRemediationDraft=function(index,metric,currentValue){
  var w=workspace(),source=w.interpretation?w.interpretation.recommendations:w.diagnosis.recommendations,rec=source[index]||{};
  ensureDiagnosis().then(function(diagnosis){
    return api('/api/remediation-tasks',{method:'POST',body:JSON.stringify({
      diagnosisId:diagnosis.id,recommendationIndex:index,title:document.getElementById('task-title').value,
      riskMetrics:metric?[metric]:[],description:document.getElementById('task-desc').value,
      action:document.getElementById('task-action').value,ownerDepartment:document.getElementById('task-dept').value||null,
      ownerName:document.getElementById('task-owner').value||null,dueDate:document.getElementById('task-due').value||null,
      currentValue:currentValue,targetValue:document.getElementById('task-target').value?Number(document.getElementById('task-target').value):null,
      metric:metric||null,metricId:rec.metricId||null,direction:rec.direction||null,
      evidenceIds:Array.isArray(rec.evidenceIds)?rec.evidenceIds:[],bindingReason:rec.bindingReason||null,
      requiresEvidenceReview:!!rec.requiresEvidenceReview,sourceRecommendationId:rec.id||null
    })});
  }).then(function(){toast('整改任务草稿已创建','success');document.getElementById('diagnosis-drawer').classList.remove('open');})
    .catch(function(e){toast(e.message,'error');});
};
function nextStatus(status){return {draft:'confirmed',confirmed:'in_progress',in_progress:'completed',completed:'closed'}[status];}
function statusLabel(status){return {draft:'待确认',confirmed:'已确认',in_progress:'进行中',completed:'已完成',closed:'已关闭'}[status]||status;}
function actionLabel(status){return {confirmed:'确认任务',in_progress:'开始执行',completed:'标记完成',closed:'关闭任务'}[status]||status;}
function taskCard(task){
  var next=nextStatus(task.status),overdue=task.dueDate&&task.status!=='closed'&&task.status!=='completed'&&task.dueDate<new Date().toISOString().slice(0,10);
  return '<article class="task-card '+(overdue?'overdue':'')+'"><div><span class="task-status">'+esc(statusLabel(task.status))+'</span><h4>'+esc(task.title)+'</h4><p>'+esc(task.action||task.description)+'</p><small>'+esc(task.branch)+' · '+esc(task.period)+' · '+esc(task.ownerDepartment||'待分配')+'/'+esc(task.ownerName||'待分配')+' · '+esc(task.dueDate||'未设期限')+'</small></div><div>'+
    (next?'<button class="btn-sm" onclick="advanceRemediationTask(\''+esc(task.id)+'\',\''+next+'\')">'+esc(actionLabel(next))+'</button>':'')+
    (task.status==='completed'?'<button class="btn-sm" onclick="reviewRemediationTask(\''+esc(task.id)+'\')">生成复盘</button>':'')+'</div></article>';
}
window.renderRemediationWorkspace=function(){
  var w=workspace(),ct=document.getElementById('ai-content');if(!ct)return;
  if(!w||!w.apiAvailable){toast('整改任务仅在内部服务模式可用','error');return;}
  api('/api/remediation-tasks'+(w.diagnosis&&w.diagnosis.branch?'?branch='+encodeURIComponent(w.diagnosis.branch):'')).then(function(tasks){
    R.tasks=tasks;var counts={draft:0,confirmed:0,in_progress:0,completed:0,closed:0,overdue:0};
    tasks.forEach(function(t){counts[t.status]=(counts[t.status]||0)+1;if(t.dueDate&&t.dueDate<new Date().toISOString().slice(0,10)&&!['completed','closed'].includes(t.status))counts.overdue++;});
    ct.innerHTML='<div class="diagnosis-toolbar"><button class="btn-sm" onclick="renderAITab()">← 返回诊断</button><h3>整改任务工作台</h3></div>'+
      '<div class="diagnosis-summary-row"><div><strong>'+counts.draft+'</strong><span>待确认</span></div><div><strong>'+counts.in_progress+'</strong><span>进行中</span></div><div><strong>'+counts.completed+'</strong><span>已完成</span></div><div><strong>'+counts.overdue+'</strong><span>已逾期</span></div></div>'+
      '<div class="task-list">'+(tasks.length?tasks.map(taskCard).join(''):'<div class="diagnosis-empty">暂无整改任务</div>')+'</div>';
  }).catch(function(e){toast(e.message,'error');});
};
window.advanceRemediationTask=function(id,status){
  var task=R.tasks.find(function(item){return item.id===id;}),patch={status:status};
  if(status==='confirmed'&&task&&(!task.ownerDepartment||!task.ownerName||!task.dueDate)){
    var owner=prompt('请输入责任人');if(!owner)return;
    var department=prompt('请输入责任部门');if(!department)return;
    var due=prompt('请输入完成期限（YYYY-MM-DD）');if(!due)return;
    patch.ownerName=owner;patch.ownerDepartment=department;patch.dueDate=due;
  }
  api('/api/remediation-tasks/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(patch)})
    .then(function(){toast('任务状态已更新','success');renderRemediationWorkspace();}).catch(function(e){toast(e.message,'error');});
};
window.reviewRemediationTask=function(id){
  var w=workspace(),months=Object.keys(App.ALL_DATA.actuals||{}).sort().filter(function(month){return month>w.diagnosis.period;});
  if(!months.length){toast('暂无后续有效数据周期','error');return;}
  var next=months[0],branch=w.diagnosis.branch,nextDiagnosis=window.buildStructuredDiagnosis(branch);
  nextDiagnosis.period=next;
  var oldMonth=App.currentMonth;
  App.currentMonth=next;nextDiagnosis=window.buildStructuredDiagnosis(branch);App.currentMonth=oldMonth;
  api('/api/diagnoses',{method:'POST',body:JSON.stringify(nextDiagnosis)}).then(function(saved){
    return api('/api/remediation-tasks/'+encodeURIComponent(id)+'/reviews',{method:'POST',body:JSON.stringify({diagnosisId:saved.id})});
  }).then(function(review){alert(review.result+'\n变化：'+(review.changeValue==null?'数据不足':review.changeValue.toFixed(4))+'\n'+review.limitations);})
    .catch(function(e){toast(e.message,'error');});
};
})();
