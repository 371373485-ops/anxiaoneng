(function(){
'use strict';

function shareToken(){
  var path=(window.location&&window.location.pathname)||'';
  var match=path.match(/\/share\/([^/?#]+)/);
  if(match&&match[1])return decodeURIComponent(match[1]);
  try{return new URLSearchParams((window.location&&window.location.search)||'').get('share')||'';}
  catch(e){return '';}
}

var token=shareToken();
App.shareMode=!!token;
App.shareToken=token||null;
App.shareMeta=null;
App.shareLoadError=null;
App.isReadOnly=function(){return !!App.shareMode;};
App.shareCanExport=function(){return !!(App.shareMode&&App.shareMeta&&App.shareMeta.allowExport);};
App.blockReadOnlyAction=function(action){
  if(!App.shareMode)return false;
  if(typeof toast==='function')toast('只读分享模式不能执行'+(action||'该操作'),'error');
  return true;
};

function emptyData(){return {_plans:{},actuals:{},currentMonth:'',currentPlanKey:'auto'};}
function setText(id,value){var el=document.getElementById(id);if(el)el.textContent=value==null?'—':String(value);}
function publishedText(value){
  if(!value)return '—';
  var date=new Date(value);
  return isNaN(date.getTime())?String(value):date.toLocaleString();
}
function escapeText(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function applyShareVisibility(){
  if(!App.shareMode)return;
  if(document.body)document.body.classList.add('share-mode');
  document.querySelectorAll('[data-share-restricted],[data-share-ai]').forEach(function(el){
    el.style.display='none';el.setAttribute('aria-hidden','true');
  });
  document.querySelectorAll('[data-share-export]').forEach(function(el){
    var visible=App.shareCanExport();
    el.style.display=visible?'':'none';el.setAttribute('aria-hidden',visible?'false':'true');
  });
  var banner=document.getElementById('shareBanner');if(banner)banner.style.display='flex';
  var meta=App.shareMeta||{},version=meta.dataVersion||{};
  setText('sharePeriod',version.period||App.currentMonth);
  setText('shareVersion',version.id);
  setText('sharePublishedAt',publishedText(version.publishedAt));
  setText('shareModeLabel',meta.mode==='fixed'?'固定版本（fixed）':'最新发布（latest）');
}

function showShareEmpty(message){
  App.ALL_DATA=emptyData();App.currentMonth='';App.currentPlanKey='auto';App.currentYear='';
  App.shareLoadError=message||'分享数据不可用';
  applyShareVisibility();
  var main=document.querySelector('.main');
  if(main)main.innerHTML='<section class="share-empty" id="shareEmptyState">'+
    '<div class="share-empty-icon">🔒</div><h2>分享数据不可用</h2>'+
    '<p>'+escapeText(App.shareLoadError)+'</p>'+
    '<small>链接可能无效、已停用、已过期，或当前没有可用的发布版本。</small></section>';
}

function loadSharedDashboard(){
  if(!App.shareMode)return Promise.resolve(null);
  App.ALL_DATA=emptyData();App.currentMonth='';App.currentPlanKey='auto';App.currentYear='';
  return fetch('/api/shared-data/'+encodeURIComponent(App.shareToken),{
    method:'GET',headers:{Accept:'application/json'},cache:'no-store'
  }).then(function(response){
    return response.text().then(function(text){
      var body={};try{body=text?JSON.parse(text):{};}catch(e){}
      if(!response.ok)throw new Error(body.detail||('分享数据加载失败（'+response.status+'）'));
      return body;
    });
  }).then(function(body){
    if(!body||!body.payload||!body.dataVersion)throw new Error('分享数据响应不完整');
    App.ALL_DATA=JSON.parse(JSON.stringify(body.payload));delete App.ALL_DATA._merged;
    App.currentMonth=App.ALL_DATA.currentMonth||body.dataVersion.period||'';
    App.currentPlanKey=App.ALL_DATA.currentPlanKey||'auto';
    App.currentYear=(App.currentMonth||'').split('-')[0]||'';
    App.ALL_DATA.currentMonth=App.currentMonth;App.ALL_DATA.currentPlanKey=App.currentPlanKey;
    App.shareMeta=body;App.shareLoadError=null;
    if(typeof refreshMergedData!=='function')throw new Error('看板计算模块未加载');
    refreshMergedData();applyShareVisibility();return body;
  }).catch(function(error){showShareEmpty(error.message);throw error;});
}

function wrap(name,label,allow){
  var original=window[name];if(typeof original!=='function'||original.__shareGuarded)return;
  var guarded=function(){
    if(App.shareMode&&!(allow&&allow())){App.blockReadOnlyAction(label);return false;}
    return original.apply(this,arguments);
  };
  guarded.__shareGuarded=true;guarded.__shareOriginal=original;window[name]=guarded;
}
function installShareGuards(){
  if(!App.shareMode)return;
  [
    ['saveAllData','保存数据'],['resetAllData','重置数据'],
    ['importExcel','导入实际数据'],['importPlanExcel','导入计划数据'],
    ['importData','恢复备份'],['exportData','导出备份'],
    ['deletePlanVersion','删除计划'],['confirmClearAll','清空数据'],
    ['clearAllData','清空数据'],['toggleAllAlertRules','编辑预警规则'],
    ['toggleAlertRule','编辑预警规则'],['editAlertRule','编辑预警规则'],
    ['saveAlertRuleEdit','编辑预警规则'],['deleteAlertRule','删除预警规则'],
    ['addAlertRule','新增预警规则'],['syncDiagnosisSnapshot','同步诊断'],
    ['renderAITab','AI解读'],['renderAgentWorkspace','智能分析'],
    ['generateInterpretation','AI解读'],['askPreset','AI追问'],
    ['sendDiagnosisQuestion','AI追问'],['startAgentRun','智能分析'],
    ['resumeAgentRun','智能分析'],['cancelAgentRun','智能分析'],
    ['createRemediationDraft','创建整改任务'],['createAIRemediationDraft','创建整改任务'],
    ['saveRemediationDraft','保存整改任务'],['renderRemediationWorkspace','整改任务'],
    ['advanceRemediationTask','更新整改任务'],['reviewRemediationTask','整改复盘']
  ].forEach(function(item){wrap(item[0],item[1]);});
  wrap('doExport','导出数据',App.shareCanExport);
}

window.loadSharedDashboard=loadSharedDashboard;
window.applyShareVisibility=applyShareVisibility;
window.showShareEmpty=showShareEmpty;
window.installShareGuards=installShareGuards;
if(window.AnxiaonengUnlock&&AnxiaonengUnlock.shouldInstall(window.location)){AnxiaonengUnlock.install(App);}
})();
