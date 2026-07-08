(function(root,factory){
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.AnxiaonengUnlock=api;
  if(root.location&&api.shouldInstall(root.location))root.__anxiaonengEncryptedSharePending=true;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  var MESSAGE='密码错误或分享文件已损坏';
  function tokenFromLocation(location){
    var path=(location&&location.pathname)||'',match=path.match(/\/share\/([^/?#]+)/);
    if(match&&match[1])return decodeURIComponent(match[1]);
    try{return new URLSearchParams((location&&location.search)||'').get('share')||'';}catch(error){return '';}
  }
  function emptyData(){return {actuals:{},_plans:{},currentMonth:'',currentPlanKey:'auto'};}
  function encryptedBase(location){
    var path=(location&&location.pathname)||'/',marker=path.indexOf('/share/');
    if(marker>=0)return (location.origin||'')+path.slice(0,marker+1);
    return (location.origin||'')+path.slice(0,path.lastIndexOf('/')+1);
  }
  function encryptedUrl(token,base){return new URL('pages/data/'+encodeURIComponent(token)+'.json',base).toString();}
  function shouldInstall(location){
    if(!tokenFromLocation(location))return false;
    if(location&&/\.github\.io$/i.test(location.hostname||''))return true;
    try{return new URLSearchParams((location&&location.search)||'').get('encrypted')==='1';}catch(error){return false;}
  }
  function delayForFailures(count){return Math.min(8000,500*Math.pow(2,Math.max(0,count-1)));}
  function createController(options){
    var opts=options||{},cryptoApi=opts.cryptoApi||root.AnxiaonengCrypto,fetchFn=opts.fetch||root.fetch.bind(root),wait=opts.wait||function(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});};
    var envelope=null,failures=0,unlocked=false;
    async function load(url){
      var response=await fetchFn(url,{method:'GET',cache:'no-store',credentials:'omit',headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('分享文件不可用');
      envelope=await response.json();cryptoApi.validateEnvelope(envelope);return envelope.meta;
    }
    async function unlock(password){
      if(!envelope)throw new Error('分享文件不可用');
      try{
        var payload=await cryptoApi.decryptJson(envelope,password);cryptoApi.validateSharePayload(payload);unlocked=true;failures=0;return payload;
      }catch(error){failures++;await wait(delayForFailures(failures));throw new Error(MESSAGE);}
    }
    return {load:load,unlock:unlock,isUnlocked:function(){return unlocked;},failureCount:function(){return failures;}};
  }
  function renderUnlock(host,onSubmit){
    host.innerHTML='<section class="pages-unlock" role="dialog" aria-labelledby="pagesUnlockTitle"><div class="pages-unlock-card"><div class="pages-unlock-mark">🔐</div><h1 id="pagesUnlockTitle">解锁只读分享</h1><p>请输入管理者通过其他渠道发送的访问密码。</p><form id="pagesUnlockForm" autocomplete="off"><label for="pagesUnlockPassword">访问密码</label><input id="pagesUnlockPassword" type="password" minlength="16" required autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit">解锁看板</button><p id="pagesUnlockError" class="pages-unlock-error" role="alert" aria-live="polite"></p></form></div></section>';
    var form=host.querySelector('#pagesUnlockForm'),input=host.querySelector('#pagesUnlockPassword'),error=host.querySelector('#pagesUnlockError');
    form.addEventListener('submit',function(event){event.preventDefault();var password=input.value;input.value='';error.textContent='';form.querySelector('button').disabled=true;Promise.resolve(onSubmit(password)).catch(function(){error.textContent=MESSAGE;}).finally(function(){password=null;form.querySelector('button').disabled=false;input.focus();});});
    input.focus();
  }
  function install(app,dependencies){
    var deps=dependencies||{},location=deps.location||root.location,document=deps.document||root.document,token=tokenFromLocation(location);
    if(!token)return false;
    app.shareMode=true;app.encryptedShareMode=true;app.shareToken=token;app.ALL_DATA=emptyData();app.currentMonth='';app.currentPlanKey='auto';app.currentYear='';
    root.loadSharedDashboard=function(){
      var controller=createController(deps),host=document.getElementById('pagesUnlockRoot')||document.body,base=deps.baseUrl||encryptedBase(location);
      return controller.load(encryptedUrl(token,base)).then(function(meta){
        return new Promise(function(resolve,reject){
          renderUnlock(host,function(password){return controller.unlock(password).then(function(payload){
            app.ALL_DATA=JSON.parse(JSON.stringify(payload));app.currentMonth=payload.currentMonth;app.currentPlanKey=payload.currentPlanKey;app.currentYear=(app.currentMonth||'').split('-')[0]||'';
            app.shareMeta={mode:'encrypted',allowExport:true,aiEnabled:true,dataVersion:{id:meta.dataVersion,period:app.currentMonth,publishedAt:meta.createdAt}};
            if(typeof root.refreshMergedData!=='function')throw new Error('看板计算模块未加载');
            root.refreshMergedData();host.innerHTML='';if(typeof root.applyShareVisibility==='function')root.applyShareVisibility();resolve(app.shareMeta);return payload;
          }).catch(function(error){throw error;});});
        });
      }).catch(function(error){app.ALL_DATA=emptyData();if(typeof root.showShareEmpty==='function')root.showShareEmpty(error.message);throw error;});
    };
    return true;
  }
  return {ERROR_MESSAGE:MESSAGE,tokenFromLocation:tokenFromLocation,encryptedBase:encryptedBase,encryptedUrl:encryptedUrl,shouldInstall:shouldInstall,delayForFailures:delayForFailures,createController:createController,install:install,emptyData:emptyData};
});
