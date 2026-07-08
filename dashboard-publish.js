(function(){
'use strict';

var P={
  versions:[],links:[],organizations:[],oneTimeToken:null,loaded:false,
  identity:null,identityChecked:false,identityPromise:null
};

function allowed(){
  return !!(window.App&&!App.shareMode&&P.identityChecked&&P.identity&&P.identity.role==='admin');
}
function guard(action){
  if(allowed())return true;
  publishMessage('无权执行'+(action||'管理操作')+'。仅已认证管理员可使用数据发布与分享管理。','error');
  return false;
}
function headers(){
  var result={'Content-Type':'application/json'};
  try{
    var userId=localStorage.getItem('diagnosis-user');
    var userRole=localStorage.getItem('diagnosis-role');
    var branches=localStorage.getItem('diagnosis-branches');
    if(userId)result['X-User-Id']=userId;
    if(userRole)result['X-Role']=userRole;
    if(branches)result['X-Branches']=branches;
  }catch(e){}
  return result;
}function api(path,options){
  options=options||{};options.headers=Object.assign({},headers(),options.headers||{});
  return fetch(path,options).then(function(response){
    return response.text().then(function(text){
      var body={};try{body=text?JSON.parse(text):{};}catch(e){body={detail:text};}
      if(!response.ok){
        var detail=body.detail||body.error||('请求失败 '+response.status);
        var message=typeof detail==='string'?detail:(detail.message||'请求失败 '+response.status);
        var error=new Error(message);error.status=response.status;error.detail=detail;throw error;
      }
      return body;
    });
  });
}
function ensureIdentity(){
  if(window.App&&App.shareMode){
    P.identity={userId:null,role:'public',branches:[]};P.identityChecked=true;
    return Promise.resolve(P.identity);
  }
  if(P.identityChecked)return Promise.resolve(P.identity);
  if(P.identityPromise)return P.identityPromise;
  P.identityPromise=api('/api/me').then(function(identity){
    P.identity=identity&&typeof identity==='object'?identity:{userId:null,role:'public',branches:[]};
    P.identityChecked=true;return P.identity;
  }).catch(function(){
    P.identity={userId:null,role:'public',branches:[]};P.identityChecked=true;return P.identity;
  });
  return P.identityPromise;
}function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function fmtDate(value){if(!value)return '—';var d=new Date(value);return isNaN(d.getTime())?String(value):d.toLocaleString('zh-CN');}
function fmtSize(value){var n=Number(value)||0;if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(2)+' MB';}
function el(id){return document.getElementById(id);}
function publishMessage(message,type){
  var node=el('publishMessage');if(!node)return;
  node.className='publish-message show '+(type||'info');node.textContent=message;
}
function clearMessage(){var node=el('publishMessage');if(node){node.className='publish-message';node.textContent='';}}
function currentPeriod(){return (App.currentMonth||App.ALL_DATA.currentMonth||'').slice(0,7);}
function detailReport(detail){
  if(!detail||typeof detail!=='object')return null;
  return {
    passed:false,errors:detail.errors||[],warnings:detail.warnings||[],
    branchCount:detail.branchCount||0,period:detail.period||currentPeriod()
  };
}
function renderValidation(report){
  var node=el('publishValidation');if(!node)return;
  if(!report){node.innerHTML='';return;}
  var errors=report.errors||[],warnings=report.warnings||[];
  var html='<div class="publish-validation"><b>'+(report.passed?'校验通过':'校验未通过')+'</b>'+
    ' · 机构数 '+esc(report.branchCount||0);
  if(errors.length)html+='<div class="errors">错误<ul>'+errors.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul></div>';
  if(warnings.length)html+='<div class="warnings">警告<ul>'+warnings.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul></div>';
  node.innerHTML=html+'</div>';
}
function renderToken(){
  var box=el('publishToken');if(!box)return;
  if(!P.oneTimeToken){box.className='publish-token';box.innerHTML='';return;}
  var url=location.origin+'/share/'+encodeURIComponent(P.oneTimeToken.token);
  box.className='publish-token show';
  box.innerHTML='<b>请立即保存 Token</b><div>明文 Token 仅在本次'+esc(P.oneTimeToken.reason)+'后显示。</div>'+
    '<code id="publishTokenValue">'+esc(P.oneTimeToken.token)+'</code>'+
    '<div class="publish-row"><button class="publish-btn" onclick="copyPublishedToken()">复制分享地址</button>'+
    '<button class="publish-btn secondary" onclick="dismissPublishedToken()">我已保存，关闭</button></div>'+
    '<small>'+esc(url)+'</small>';
}
function versionRows(){
  if(!P.versions.length)return '<tr><td colspan="8">暂无数据版本</td></tr>';
  return P.versions.map(function(v){
    var action=v.status==='draft'?'<button class="publish-btn secondary" onclick="validateDataVersion(\''+esc(v.id)+'\')">校验</button>':
      (v.status==='validated'?'<button class="publish-btn warn" onclick="publishDataVersion(\''+esc(v.id)+'\')">发布</button>':'—');
    return '<tr><td>'+esc(v.period)+'</td><td><span class="publish-status '+esc(v.status)+'">'+esc(v.status)+'</span></td>'+
      '<td>'+fmtDate(v.createdAt)+'</td><td>'+fmtDate(v.validatedAt)+'</td><td>'+fmtDate(v.publishedAt)+'</td>'+
      '<td>'+fmtSize(v.payloadSize)+'</td><td>'+esc((v.validationReport&&v.validationReport.branchCount)||'—')+'</td><td>'+action+'</td></tr>';
  }).join('');
}
function linkRows(){
  if(!P.links.length)return '<tr><td colspan="8">暂无分享链接</td></tr>';
  return P.links.map(function(link){
    return '<tr><td>'+esc(link.mode)+'</td><td>'+esc(link.fixedDataVersionId||'最新发布')+'</td>'+
      '<td>'+(link.enabled?'启用':'停用')+'</td><td>'+esc((link.allowedOrgIds||[]).length)+'</td>'+
      '<td>'+(link.allowExport?'允许':'禁止')+'</td><td>'+fmtDate(link.expiresAt)+'</td><td>'+fmtDate(link.updatedAt)+'</td>'+
      '<td><button class="publish-btn secondary" onclick="toggleShareLink(\''+esc(link.id)+'\','+(!link.enabled)+')">'+(link.enabled?'停用':'启用')+'</button> '+
      '<button class="publish-btn warn" onclick="rotateShareToken(\''+esc(link.id)+'\')">轮换 Token</button></td></tr>';
  }).join('');
}
function fixedOptions(){
  return P.versions.filter(function(v){return v.status==='published';}).map(function(v){
    return '<option value="'+esc(v.id)+'">'+esc(v.period)+' · '+esc(v.id)+'</option>';
  }).join('');
}
function orgOptions(){
  if(!P.organizations.length)return '<span>暂无可选机构</span>';
  return P.organizations.map(function(org){
    return '<label><input type="checkbox" name="publishOrg" value="'+esc(org.orgId)+'"> '+esc(org.name)+'</label>';
  }).join('');
}
function renderBody(){
  var root=el('publish-admin-root');if(!root)return;
  root.innerHTML='<section class="publish-admin">'+
    '<div id="publishMessage" class="publish-message" role="alert"></div>'+
    '<div class="publish-card"><h4>🚀 数据发布</h4><div class="publish-row"><label>数据周期</label>'+
    '<input id="publishPeriod" value="'+esc(currentPeriod())+'" placeholder="YYYY-MM">'+
    '<button class="publish-btn" onclick="createDataDraft()">上传当前数据为 draft</button>'+
    '<button class="publish-btn secondary" onclick="refreshPublishManagement()">刷新</button></div>'+
    '<div id="publishValidation"></div><div class="publish-table-wrap"><table class="publish-table"><thead><tr>'+
    '<th>周期</th><th>状态</th><th>创建时间</th><th>校验时间</th><th>发布时间</th><th>数据大小</th><th>机构数</th><th>操作</th>'+
    '</tr></thead><tbody>'+versionRows()+'</tbody></table></div></div>'+
    '<div class="publish-card"><h4>🔗 分享链接管理</h4><div id="publishToken" class="publish-token"></div>'+
    '<div class="publish-row"><label>模式</label><select id="shareModeInput" onchange="updateFixedVersionVisibility()"><option value="latest">latest 最新发布</option><option value="fixed">fixed 固定版本</option></select>'+
    '<select id="fixedVersionInput" style="display:none">'+fixedOptions()+'</select>'+
    '<label><input type="checkbox" id="shareAllowExport"> 允许导出</label>'+
    '<label>有效期</label><input type="datetime-local" id="shareExpiresAt"></div>'+
    '<div class="publish-row"><b style="font-size:12px">允许访问的机构</b><div class="publish-orgs" id="publishOrganizations">'+orgOptions()+'</div></div>'+
    '<button class="publish-btn" onclick="createShareLink()">创建分享链接</button>'+
    '<div class="publish-table-wrap" style="margin-top:14px"><table class="publish-table"><thead><tr>'+
    '<th>模式</th><th>固定版本</th><th>状态</th><th>机构数</th><th>导出</th><th>有效期</th><th>更新时间</th><th>操作</th>'+
    '</tr></thead><tbody>'+linkRows()+'</tbody></table></div></div></section>';
  renderToken();
}
function mount(){
  var panel=el('data-panel');
  if(!panel||window.App&&App.shareMode)return Promise.resolve(false);
  return ensureIdentity().then(function(){
    if(!allowed())return false;
    var root=el('publish-admin-root');
    if(!root){root=document.createElement('div');root.id='publish-admin-root';panel.appendChild(root);}
    renderBody();
    if(!P.loaded)return refreshPublishManagement().then(function(){return true;});
    return true;
  });
}
function loadAll(){
  return Promise.all([
    api('/api/data-versions'),
    api('/api/share-links'),
    api('/api/organizations?type=branch')
  ]).then(function(results){
    P.versions=results[0]||[];P.links=results[1]||[];P.organizations=results[2]||[];P.loaded=true;renderBody();return results;
  });
}
function refreshPublishManagement(){
  if(!guard('刷新发布管理'))return Promise.resolve(false);
  clearMessage();publishMessage('正在加载发布与分享信息…','info');
  return loadAll().then(function(){publishMessage('发布与分享信息已刷新。','success');return true;})
    .catch(function(error){publishMessage('加载失败：'+error.message,'error');return false;});
}
function createDataDraft(){
  if(!guard('创建数据版本'))return Promise.resolve(false);
  var period=(el('publishPeriod')&&el('publishPeriod').value)||currentPeriod();
  publishMessage('正在上传当前数据…','info');renderValidation(null);
  return api('/api/data-versions',{method:'POST',body:JSON.stringify({period:period,payload:App.ALL_DATA})})
    .then(function(version){return loadAll().then(function(){publishMessage('draft 创建成功：'+version.id,'success');return version;});})
    .catch(function(error){publishMessage('创建 draft 失败：'+error.message,'error');return false;});
}
function validateDataVersion(id){
  if(!guard('校验数据版本'))return Promise.resolve(false);
  publishMessage('正在校验数据版本…','info');
  return api('/api/data-versions/'+encodeURIComponent(id)+'/validate',{method:'POST'})
    .then(function(version){return loadAll().then(function(){renderValidation(version.validationReport);publishMessage('数据校验通过。','success');return version;});})
    .catch(function(error){var report=detailReport(error.detail);renderValidation(report);publishMessage('数据校验失败：'+error.message,'error');return false;});
}
function publishDataVersion(id){
  if(!guard('发布数据版本'))return Promise.resolve(false);
  if(!confirm('确认发布该数据版本？同周期当前已发布版本将被归档。'))return Promise.resolve(false);
  publishMessage('正在发布数据版本…','info');
  return api('/api/data-versions/'+encodeURIComponent(id)+'/publish',{method:'POST'})
    .then(function(version){return loadAll().then(function(){publishMessage('数据版本已发布。','success');return version;});})
    .catch(function(error){publishMessage('发布失败：'+error.message,'error');return false;});
}
function selectedOrgs(){
  return Array.prototype.slice.call(document.querySelectorAll('input[name="publishOrg"]:checked')).map(function(node){return node.value;});
}
function expiryValue(){
  var value=el('shareExpiresAt')&&el('shareExpiresAt').value;
  if(!value)return null;var date=new Date(value);return isNaN(date.getTime())?value:date.toISOString();
}
function createShareLink(){
  if(!guard('创建分享链接'))return Promise.resolve(false);
  var mode=el('shareModeInput').value,orgs=selectedOrgs();
  var body={mode:mode,enabled:true,allowedOrgIds:orgs,allowExport:!!el('shareAllowExport').checked,expiresAt:expiryValue()};
  if(mode==='fixed')body.fixedDataVersionId=el('fixedVersionInput').value;
  publishMessage('正在创建分享链接…','info');
  return api('/api/share-links',{method:'POST',body:JSON.stringify(body)})
    .then(function(link){P.oneTimeToken={token:link.token,reason:'创建'};return loadAll().then(function(){publishMessage('分享链接创建成功，请立即保存 Token。','success');return link;});})
    .catch(function(error){publishMessage('创建分享链接失败：'+error.message,'error');return false;});
}
function toggleShareLink(id,enabled){
  if(!guard(enabled?'启用分享链接':'停用分享链接'))return Promise.resolve(false);
  publishMessage('正在更新分享链接…','info');
  return api('/api/share-links/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({enabled:enabled})})
    .then(function(link){return loadAll().then(function(){publishMessage(enabled?'分享链接已启用。':'分享链接已停用。','success');return link;});})
    .catch(function(error){publishMessage('更新分享链接失败：'+error.message,'error');return false;});
}
function rotateShareToken(id){
  if(!guard('轮换 Token'))return Promise.resolve(false);
  if(!confirm('确认轮换 Token？旧 Token 将立即失效。'))return Promise.resolve(false);
  publishMessage('正在轮换 Token…','info');
  return api('/api/share-links/'+encodeURIComponent(id)+'/rotate',{method:'POST'})
    .then(function(link){P.oneTimeToken={token:link.token,reason:'轮换'};return loadAll().then(function(){publishMessage('Token 已轮换，旧 Token 已失效。','success');return link;});})
    .catch(function(error){publishMessage('Token 轮换失败：'+error.message,'error');return false;});
}
function updateFixedVersionVisibility(){
  var fixed=el('fixedVersionInput'),mode=el('shareModeInput');if(fixed&&mode)fixed.style.display=mode.value==='fixed'?'':'none';
}
function copyPublishedToken(){
  if(!P.oneTimeToken)return Promise.resolve(false);
  var value=location.origin+'/share/'+P.oneTimeToken.token;
  if(navigator.clipboard&&navigator.clipboard.writeText){
    return navigator.clipboard.writeText(value).then(function(){publishMessage('分享地址已复制。','success');return true;})
      .catch(function(){publishMessage('复制失败，请手动复制。','error');return false;});
  }
  publishMessage('浏览器不支持自动复制，请手动复制。','error');return Promise.resolve(false);
}
function dismissPublishedToken(){P.oneTimeToken=null;renderToken();}

function exportShareData(){
  var raw=App.ALL_DATA||{};
  var payload={actuals:{},_plans:{},currentMonth:raw.currentMonth||'',currentPlanKey:raw.currentPlanKey||'auto',_importTimes:raw._importTimes||{},_alertRules:raw._alertRules||[]};
  Object.keys(raw.actuals||{}).forEach(function(k){var m=JSON.parse(JSON.stringify(raw.actuals[k]));delete m.national;delete m.regions;payload.actuals[k]=m;});
  Object.keys(raw._plans||{}).forEach(function(k){var m=JSON.parse(JSON.stringify(raw._plans[k]));delete m.national;delete m.regions;payload._plans[k]=m;});
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='share-data-'+payload.currentMonth+'.json';a.click();
  toast('\u6570\u636e\u5df2\u5bfc\u51fa\u3002\u63a5\u4e0b\u6765\u53ef\u7528\u300c\u52a0\u5bc6\u5206\u4eab\u6570\u636e\u300d\u751f\u6210\u52a0\u5bc6\u5206\u4eab\u6587\u4ef6\u3002','info');
}
function encryptShareData(){
  var raw=App.ALL_DATA||{};
  if(!raw.currentMonth){toast('\u8bf7\u5148\u5bfc\u5165\u6570\u636e\u540e\u518d\u52a0\u5bc6\u5206\u4eab\u3002','error');return;}
  if(typeof AnxiaonengCrypto==='undefined'||typeof AnxiaonengCrypto.encryptJson!=='function'){toast('\u52a0\u5bc6\u6a21\u5757\u672a\u52a0\u8f7d\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u540e\u91cd\u8bd5\u3002','error');return;}
  var payload={actuals:{},_plans:{},currentMonth:raw.currentMonth||'',currentPlanKey:raw.currentPlanKey||'auto',_importTimes:raw._importTimes||{},_alertRules:raw._alertRules||[]};
  Object.keys(raw.actuals||{}).forEach(function(k){var m=JSON.parse(JSON.stringify(raw.actuals[k]));delete m.national;delete m.regions;payload.actuals[k]=m;});
  Object.keys(raw._plans||{}).forEach(function(k){var m=JSON.parse(JSON.stringify(raw._plans[k]));delete m.national;delete m.regions;payload._plans[k]=m;});
  var password=prompt('\u8bbe\u7f6e\u8bbf\u95ee\u5bc6\u7801\uff08\u81f3\u5c1116\u4f4d\u5b57\u7b26\uff09\uff1a');
  if(!password||password.length<16){alert('\u5bc6\u7801\u81f3\u5c11\u9700\u898116\u4e2a\u5b57\u7b26\u3002');return;}
  var confirm=prompt('\u518d\u6b21\u8f93\u5165\u5bc6\u7801\u786e\u8ba4\uff1a');
  if(password!==confirm){alert('\u4e24\u6b21\u5bc6\u7801\u8f93\u5165\u4e0d\u4e00\u81f4\u3002');return;}
  var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var arr=new Uint8Array(48);crypto.getRandomValues(arr);
  var token='';for(var i=0;i<48;i++)token+=chars[arr[i]%chars.length];
  AnxiaonengCrypto.encryptJson(payload,password,{createdAt:new Date().toISOString(),dataVersion:payload.currentMonth+'-v1'}).then(function(envelope){
    var dataBlob=new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'});
    var a1=document.createElement('a');a1.href=URL.createObjectURL(dataBlob);a1.download=token+'.json';a1.click();
    setTimeout(function(){
      var repo=window.location.hostname.indexOf('github')>=0?window.location.pathname.split('/')[1]:'\u4ed3\u5e93\u540d';
      var guide='\u52a0\u5bc6\u5206\u4eab\u6587\u4ef6\u5df2\u751f\u6210\uff1a'+token+'.json\n\n\u90e8\u7f72\u6b65\u9aa4\uff1a\n1. \u5c06\u8be5\u6587\u4ef6\u653e\u5230\u9879\u76ee\u7684 pages/data/ \u76ee\u5f55\u4e0b\n2. git add pages/data/'+token+'.json\n3. git commit -m "\u66f4\u65b0\u5206\u4eab\u6570\u636e"\n4. git push\n5. GitHub Actions -> Deploy encrypted GitHub Pages -> Run workflow\n6. \u5206\u4eab\u94fe\u63a5: https://\u4f60\u7684\u7528\u6237\u540d.github.io/'+repo+'/share/'+token+'/\n7. \u544a\u77e5\u63a5\u6536\u65b9\u8bbf\u95ee\u5bc6\u7801';
      alert(guide);
      toast('\u52a0\u5bc6\u5b8c\u6210\uff0c\u8bf7\u6309\u5f39\u7a97\u6307\u5f15\u5b8c\u6210\u90e8\u7f72\u3002','success');
    },500);
  }).catch(function(err){alert('\u52a0\u5bc6\u5931\u8d25\uff1a'+err.message);toast('\u52a0\u5bc6\u5931\u8d25\uff1a'+err.message,'error');});
}

var originalRender=window.renderDataTab;
if(typeof originalRender==='function'){
  window.renderDataTab=function(){var result=originalRender.apply(this,arguments);mount();return result;};
}

window.renderPublishManagement=mount;
window.refreshPublishManagement=refreshPublishManagement;
window.createDataDraft=createDataDraft;
window.validateDataVersion=validateDataVersion;
window.publishDataVersion=publishDataVersion;
window.createShareLink=createShareLink;
window.toggleShareLink=toggleShareLink;
window.rotateShareToken=rotateShareToken;
window.updateFixedVersionVisibility=updateFixedVersionVisibility;
window.copyPublishedToken=copyPublishedToken;
window.dismissPublishedToken=dismissPublishedToken;
window.exportShareData=exportShareData;
window.encryptShareData=encryptShareData;
window.__publishState=P;
})();
