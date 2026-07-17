// C1: Global error handler
window.onerror=function(msg,url,line,col,err){
  var p=document.getElementById('errPanel');
  if(p){
    p.style.display='block';
    p.innerHTML='ERROR: '+escapeHtml(msg)+' (line '+line+':'+col+')<br><small>'+escapeHtml(url)+'</small>';
  }
  console.error(msg,err);
  return false;
};

function showError(msg){
  var p=document.getElementById('errPanel');
  if(p){p.style.display='block';p.textContent=msg;setTimeout(function(){p.style.display='none';},8000);}
  console.error(msg);
}

function toast(msg,type){
  type=type||'info';
  var t=document.createElement('div');t.className='toast toast-'+type;t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},2800);
}

function findPlanBranch(planData,r,n){
  if(!planData||!planData.branches)return null;
  for(var i=0;i<planData.branches.length;i++){
    if(planData.branches[i].r===r&&planData.branches[i].n===n)return planData.branches[i].d;
  }
  return null;
}

function resolvePlanKey(){
  if(App.currentPlanKey!=='auto')return App.currentPlanKey;
  // Find the latest version for the current year
  var y=App.currentMonth.split('-')[0];
  var ks=App.ALL_DATA._plans?Object.keys(App.ALL_DATA._plans):[];
  var best=null,bestV=0;
  for(var i=0;i<ks.length;i++){
    if(ks[i].startsWith(y+'-v')){
      var v=parseInt(ks[i].split('-v')[1]);
      if(v>bestV){bestV=v;best=ks[i];}
    }else if(ks[i]===y){
      if(bestV===0)best=ks[i];
    }
  }
  return best||(y+'-v1');
}

function switchMonth(m){App.currentMonth=m;App.ALL_DATA.currentMonth=m;App.currentYear=m.split('-')[0];refreshMergedData();saveAllData();updateMonthUI();updatePlanUI();if(typeof updateMonthDropdown==='function')updateMonthDropdown();updateYearUI();destroyCharts();var _aict=document.getElementById('ai-content');if(_aict)_aict.removeAttribute('data-rendered');if(typeof runAlerts==='function')runAlerts();switchTab('overview');}

function switchPlan(pk){App.currentPlanKey=pk;App.ALL_DATA.currentPlanKey=pk;refreshMergedData();saveAllData();updatePlanUI();destroyCharts();var _aict=document.getElementById('ai-content');if(_aict)_aict.removeAttribute('data-rendered');if(typeof runAlerts==='function')runAlerts();switchTab('overview');}

function updateMonthUI(){
  var lb=document.getElementById('monthLabel');
  if(lb)lb.textContent=formatMonth(App.currentMonth);
}

function updatePlanUI(){
  var sel=document.getElementById('planSelect');
  if(!sel)return;
  sel.innerHTML='';
  var ao=document.createElement('option');ao.value='auto';ao.textContent='计划: 自动（同年度最新版）';if(App.currentPlanKey==='auto')ao.selected=true;sel.appendChild(ao);
  if(App.ALL_DATA._plans){
    // Collect years that have actual data
    var dataYears={};
    if(App.ALL_DATA.actuals){
      Object.keys(App.ALL_DATA.actuals).forEach(function(k){var y=k.split('-')[0];if(y)dataYears[y]=1;});
    }
    var years={};
    Object.keys(App.ALL_DATA._plans).sort().reverse().forEach(function(k){
      var parts=k.split('-');var y=parts[0];
      // Only show plan years that have corresponding actual data
      if(Object.keys(dataYears).length>0&&!dataYears[y])return;
      if(!years[y])years[y]=[];
      years[y].push(k);
    });
    var yearKeys=Object.keys(years).sort().reverse();
    yearKeys.forEach(function(y){
      var grp=document.createElement('optgroup');grp.label='━━ '+y+'年计划 ━━';
      years[y].forEach(function(k){
        var o=document.createElement('option');o.value=k;
        var label=k.split('-').slice(1).join('-')||'基线版本';
        o.textContent=label;if(k===App.currentPlanKey)o.selected=true;
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
  }
}

function formatMonth(k){var p=k.split('-');return p[0]+'年'+parseInt(p[1])+'月';}

function updateYearUI(){
  var sel=document.getElementById('yearSelect');
  if(!sel)return;
  sel.innerHTML='';
  var years={};
  if(App.ALL_DATA.actuals){
    Object.keys(App.ALL_DATA.actuals).forEach(function(k){
      var y=k.split('-')[0];if(y)years[y]=1;
    });
  }
  var yrList=Object.keys(years).sort();
  if(yrList.length===0)yrList=[App.currentYear||'2026'];
  yrList.forEach(function(y){
    var o=document.createElement('option');
    o.value=y;
    o.textContent=y+'年';
    if(y===App.currentYear)o.selected=true;
    sel.appendChild(o);
  });
}

function updateMonthDropdown(){
  var sel=document.getElementById('dataMonth');
  if(!sel)return;
  sel.innerHTML='';
  var year=App.currentYear||(App.currentMonth||'2026-04').split('-')[0];
  var cm=parseInt((App.currentMonth||'2026-04').split('-')[1])||4;
  var hasData={};
  if(App.ALL_DATA&&App.ALL_DATA.actuals){
    Object.keys(App.ALL_DATA.actuals).forEach(function(k){
      var ap=k.split('-');if(ap[0]===year)hasData[parseInt(ap[1])]=1;
    });
  }
  for(var m=1;m<=12;m++){
    var o=document.createElement('option');
    o.value=m;
    var hasD=!!hasData[m];
    o.textContent=(hasD?'● ':'○ ')+m+'月'+(hasD?'':' · 无数据');
    if(!hasD)o.style.color='#999';
    if(m===cm)o.selected=true;
    sel.appendChild(o);
  }
}

function setDataYear(y){
  App.currentYear=y;
  App.currentPlanKey='auto';App.ALL_DATA.currentPlanKey='auto';refreshMergedData();saveAllData();updatePlanUI();
  updateMonthDropdown();
  // Switch to first available month for this year
  var msel=document.getElementById('dataMonth');
  if(msel&&msel.options.length>0){
    var firstM=parseInt(msel.value)||4;
    setDataMonth(firstM);
  }
  updateYearUI();
  updatePlanUI();
}

function setDataMonth(m){
  App.currentMonth=App.currentYear+'-'+String(m).padStart(2,'0');
  App.ALL_DATA.currentMonth=App.currentMonth;
  // Check if actual data exists for this month
  var hasActual=App.ALL_DATA.actuals&&App.ALL_DATA.actuals[App.currentMonth];
  if(!hasActual){renderEmptyState('currentMonth');return;}
  // Rebuild merged data with correct year's plan
  refreshMergedData();saveAllData();updateMonthDropdown();
  // re-run alerts with new month data
  if(typeof runAlerts==='function') runAlerts();
  // re-render current tab
  var at=document.querySelector('.nav button.active');
  if(at) switchTab(at.dataset.tab||'overview');
  else switchTab('overview');
}

var DATA_MANAGEMENT_TABS={report:1,data:1,guide:1,export:1};
function renderDataManagementTab(t){
  if(t==='export')try{renderExportTab();}catch(e3){showError('数据导出渲染失败: '+e3.message);}
  if(t==='data')try{renderDataTab();}catch(e3){showError('预警规则渲染失败: '+e3.message);}
  if(t==='guide')try{renderGuideTab();}catch(e3){showError('指标说明渲染失败: '+e3.message);}
  if(t==='report')try{renderReportTab();}catch(e3){showError('数据查询渲染失败: '+e3.message);}
}
function switchDataManagementTab(t){
  try{
    if(!DATA_MANAGEMENT_TABS[t])t='report';
    App.dataManagementTab=t;
    document.querySelectorAll('.data-management-subtab').forEach(function(btn){
      btn.classList.toggle('active',btn.getAttribute('data-dm-tab')===t);
    });
    document.querySelectorAll('.data-management-pane').forEach(function(pane){
      pane.classList.toggle('active',pane.id==='data-management-pane-'+t);
      pane.style.display=pane.id==='data-management-pane-'+t?'':'none';
    });
    renderDataManagementTab(t);
    if(App.shareMode&&typeof applyShareVisibility==='function')applyShareVisibility();
  }catch(e){
    showError('数据管理子页切换失败: '+e.message);
  }
}
window.switchDataManagementTab=switchDataManagementTab;
function switchTab(t){
  try{
    var dataManagementSubTab=null;
    if(DATA_MANAGEMENT_TABS[t]){
      dataManagementSubTab=t;
      t='data-management';
    }else if(t==='data-management'){
      dataManagementSubTab=App.dataManagementTab||'report';
    }
    // Remove any empty-state overlay first
    var ov=document.querySelector('.empty-overlay');if(ov)ov.remove();
    // Restore tab display if hidden by empty state
    document.querySelectorAll('.tab').forEach(e=>e.style.display='');
    document.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));
    document.querySelectorAll('.nav button').forEach(e=>e.classList.remove('active'));
    var tel=document.getElementById('tab-'+t);if(tel)tel.classList.add('active');
    var btn=document.querySelector('.nav button[onclick*="'+t+'"]');if(btn)btn.classList.add('active');
    try{destroyCharts();}catch(e2){}
    if(t==='overview')try{renderOverview();}catch(e3){showError('概览渲染失败: '+e3.message);}
    if(t==='regions')try{renderRegions();}catch(e3){showError('责任区渲染失败: '+e3.message);}
    if(t==='branches'){hideBranchDetail();try{renderBranches();}catch(e3){showError('分公司渲染失败: '+e3.message);}}
    if(t==='data-management')switchDataManagementTab(dataManagementSubTab||'report');
    if(t==='ai')try{renderAITab();}catch(e3){showError('AI解读渲染失败: '+e3.message);}
    if(t==='trend')try{Trend.render();}catch(e3){showError('趋势渲染失败: '+e3.message);}
    if(App.isCompareMode)try{applyCompareMode();}catch(e3){showError('对比模式注入失败: '+e3.message);}
  }catch(e){
    showError('switchTab 崩溃: '+e.message);
  }
}

// 批量导入实际数据（支持多文件同时选中）
var _actualBatchFiles=[];_actualBatchIdx=0;_actualBatchCount=0;var _actualBatchSuccess=0;var _actualBatchFail=0;
function importExcel(input){
if(App&&App.debug)console.log("importExcel batch, files="+(input.files?input.files.length:0));
_actualBatchFiles=Array.prototype.slice.call(input.files||[]);
_actualBatchIdx=0;_actualBatchCount=_actualBatchFiles.length;_actualBatchSuccess=0;_actualBatchFail=0;
if(_actualBatchCount===0)return;
_actualProcessNext();
}
function _actualProcessNext(){
if(_actualBatchIdx>=_actualBatchCount){toast('实际数据导入完成：成功 '+_actualBatchSuccess+' 个，失败 '+_actualBatchFail+' 个',_actualBatchFail>0?'info':'success');destroyCharts();if(typeof runAlerts==='function')runAlerts();switchTab('overview');return;}
toast('正在导入第 '+(_actualBatchIdx+1)+'/'+_actualBatchCount+' 个文件...','info');
var file=_actualBatchFiles[_actualBatchIdx];_actualBatchIdx++;if(!file){_actualProcessNext();return;}
var reader=new FileReader();
reader.onload=function(e){
  try{
    var wb=XLSX.read(e.target.result,{type:'array'});
    var ws=wb.Sheets[wb.SheetNames[0]];
    var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
    var hr=-1;
    for(var i=0;i<Math.min(rows.length,10);i++){if(rows[i]&&rows[i][0]==='年度'){hr=i;break;}}
    if(hr<0){_actualBatchFail++;toast('未找到表头行（第1列需为"年度"），请用下载的模板格式','error');_actualProcessNext();return;}
    var hdrs=rows[hr],nb=[];
    var impYear='',impMonth='';
    for(var i=hr+1;i<rows.length;i++){
      var row=rows[i];if(!row||!row[4])continue;
      var bn=String(row[4]).trim();if(bn.includes('整体')||bn.includes('合计'))continue;
      if(!impYear){impYear=String(row[0]||'').trim();impMonth=String(row[2]||'').trim();}
      var bd={};
      for(var j=0;j<hdrs.length;j++){
        if(j>=row.length||row[j]==null){bd[hdrs[j]]=null;continue;}
        if(typeof row[j]==='number')bd[hdrs[j]]=row[j];
        else bd[hdrs[j]]=String(row[j]);
      }
      // Only keep actual fields
      var ad={};
      for(var ai=0;ai<App.ACTUAL_KEYS.length;ai++){var ak=App.ACTUAL_KEYS[ai];ad[ak]=bd[ak]!=null?bd[ak]:0;}
      nb.push({n:bn,r:row[3]||'',d:ad});
    }
    if(nb.length===0){_actualBatchFail++;toast('未找到分公司数据行','error');_actualProcessNext();return;}
    var mNum=impMonth.replace(/[^0-9]/g,'');
    if(!mNum)mNum='4';
    var mk=impYear+'-'+mNum.padStart(2,'0');
    if(!impYear){_actualBatchFail++;toast('未检测到年度信息','error');_actualProcessNext();return;}
    var yn=impYear+'年'+impMonth;
    if(!App.ALL_DATA.actuals)App.ALL_DATA.actuals={};
    if(App.ALL_DATA.actuals[mk]&&!confirm(yn+'的实际数据已存在，是否覆盖？')){_actualBatchFail++;_actualProcessNext();return;}
    // Aggregate
    var rm={};
    nb.forEach(function(b){if(!rm[b.r])rm[b.r]=[];rm[b.r].push(b);});
    var rm2={};
    App.REGIONS.forEach(function(rn){
      var bl=rm[rn]||[];if(bl.length===0)return;
      var agg={};
      App.ACTUAL_KEYS.forEach(function(fk){agg[fk]=bl.reduce(function(s,b){return s+(Number(b.d[fk])||0);},0);});
      ['已赚赔付率实际','已赚费用率实际'].forEach(function(k){agg[k]=bl.reduce(function(s,b){return s+(Number(b.d[k])||0);},0)/bl.length;});
      rm2[rn]=agg;
    });
    var na={};
    App.ACTUAL_KEYS.forEach(function(fk){na[fk]=nb.reduce(function(s,b){return s+(Number(b.d[fk])||0);},0);});
    ['已赚赔付率实际','已赚费用率实际'].forEach(function(k){na[k]=nb.reduce(function(s,b){return s+(Number(b.d[k])||0);},0)/nb.length;});
    App.ALL_DATA.actuals[mk]={branches:nb,regions:rm2,national:na};
    if(!App.ALL_DATA._importTimes)App.ALL_DATA._importTimes={};
    if(!App.ALL_DATA._importTimes.actuals)App.ALL_DATA._importTimes.actuals={};
    App.ALL_DATA._importTimes.actuals[mk]=new Date().toISOString();
    App.currentMonth=mk;App.ALL_DATA.currentMonth=mk;
    refreshMergedData();saveAllData();
    updateMonthUI();updatePlanUI();
    // Import validation summary
    var emptyNames=nb.filter(function(x){return !x.n||x.n.trim()==='';}).length;
    var zeroRows=nb.filter(function(x){var has=false;App.ACTUAL_KEYS.forEach(function(fk){if(Number(x.d[fk])!==0)has=true;});return !has;}).length;
    var summary='已导入 '+yn+' 实际数据：'+nb.length+' 家分公司';
    var warns=[];if(emptyNames>0)warns.push(emptyNames+'条分公司名称为空');if(zeroRows>0)warns.push(zeroRows+'条数据全为零');
    if(warns.length>0)summary+=' ('+warns.join('，')+')';
    toast(summary,warns.length>0?'info':'success');
    _actualBatchSuccess++;
    _actualProcessNext();
  }catch(err){
var ep=document.getElementById('errPanel');
if(ep){ep.style.display='block';ep.textContent='[Import Error] '+err.message+'\nStack: '+(err.stack||'');}
toast('解析失败: '+err.message,'error');
_actualBatchFail++;
_actualProcessNext();
}
};
reader.onerror=function(){
  _actualBatchFail++;
  toast('文件读取失败: '+(file&&file.name?file.name:'未知文件'),'error');
  _actualProcessNext();
};
reader.readAsArrayBuffer(file);
}

// 批量导入计划数据（支持多文件同时选中）
var _planBatchFiles=[];var _planBatchIdx=0;var _planBatchCount=0;var _planBatchSuccess=0;var _planBatchFail=0;
function importPlanExcel(input){
if(App&&App.debug)console.log("importPlanExcel batch, files="+(input.files?input.files.length:0));
_planBatchFiles=Array.prototype.slice.call(input.files||[]);
_planBatchIdx=0;_planBatchCount=_planBatchFiles.length;_planBatchSuccess=0;_planBatchFail=0;
if(_planBatchCount===0)return;
_planProcessNext();
}
function _planProcessNext(){
if(_planBatchIdx>=_planBatchCount){toast('计划数据导入完成：成功 '+_planBatchSuccess+' 个，失败 '+_planBatchFail+' 个',_planBatchFail>0?'info':'success');destroyCharts();switchTab('overview');return;}
toast('正在导入第 '+(_planBatchIdx+1)+'/'+_planBatchCount+' 个文件...','info');
var file=_planBatchFiles[_planBatchIdx];_planBatchIdx++;if(!file){_planProcessNext();return;}
var reader=new FileReader();
reader.onload=function(e){
  try{
    var wb=XLSX.read(e.target.result,{type:'array'});
    var ws=wb.Sheets[wb.SheetNames[0]];
    var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
    var hr=-1;
    for(var i=0;i<Math.min(rows.length,10);i++){
      if(rows[i]&&rows[i][0]==='年度'){hr=i;break;}
    }
    if(hr<0){_planBatchFail++;toast('表头未找到（第1列需为年度），请用下载的模板格式','error');_planProcessNext();return;}
    var hdrs=rows[hr],nb=[],impYear='';
    for(var i=hr+1;i<rows.length;i++){
      var row=rows[i];
      if(!row||!row[2])continue;
      var bn=String(row[2]).trim();
      if(bn.includes('整体')||bn.includes('合计'))continue;
      if(!impYear){impYear=String(row[0]||'').trim();}
      var bd={};
      for(var j=0;j<hdrs.length;j++){
        if(j>=row.length||row[j]==null){bd[hdrs[j]]=null;continue;}
        if(typeof row[j]==='number')bd[hdrs[j]]=row[j];
        else bd[hdrs[j]]=String(row[j]);
      }
      var pd={};
      for(var pi=0;pi<App.PLAN_KEYS.length;pi++){
        var pk=App.PLAN_KEYS[pi];
        pd[pk]=bd[pk]!=null?bd[pk]:0;
      }
      nb.push({n:bn,r:row[1]||'',d:pd});
    }
    if(nb.length===0){_planBatchFail++;toast('未找到分公司数据行','error');_planProcessNext();return;}
    var y2=impYear.replace(/[^0-9]/g,'');
    if(!y2){_planBatchFail++;toast('未检测到年度信息','error');_planProcessNext();return;}
    if(!y2)y2='2026';
    var maxV=0;
    if(App.ALL_DATA._plans){
      Object.keys(App.ALL_DATA._plans).forEach(function(k){
        if(k.startsWith(y2+'-v')){
          var v=parseInt(k.split('-v')[1]);
          if(v>maxV)maxV=v;
        }
      });
    }
    var pk2=y2+'-v'+(maxV+1);
    var yn=y2+'年 (版本'+(maxV+1)+')';
    if(!App.ALL_DATA._plans)App.ALL_DATA._plans={};
    if(App.ALL_DATA._plans[pk2]&&!confirm(yn+'的计划数据已存在，是否覆盖？')){_planBatchFail++;_planProcessNext();return;}
    var rm2={},na={};
    var rm={};
    nb.forEach(function(b){
      if(!rm[b.r])rm[b.r]=[];
      rm[b.r].push(b);
    });
    App.REGIONS.forEach(function(rn){
      var bl=rm[rn]||[];
      if(bl.length===0)return;
      var agg={};
      for(var fi=0;fi<App.PLAN_KEYS.length;fi++){
        var fk=App.PLAN_KEYS[fi];
        agg[fk]=bl.reduce(function(s,b){return s+(Number(b.d[fk])||0);},0);
      }
      rm2[rn]=agg;
    });
    for(var fi=0;fi<App.PLAN_KEYS.length;fi++){
      var fk=App.PLAN_KEYS[fi];
      na[fk]=nb.reduce(function(s,b){return s+(Number(b.d[fk])||0);},0);
    }
    App.ALL_DATA._plans[pk2]={branches:nb,regions:rm2,national:na};
    if(!App.ALL_DATA._importTimes)App.ALL_DATA._importTimes={};
    if(!App.ALL_DATA._importTimes.plans)App.ALL_DATA._importTimes.plans={};
    App.ALL_DATA._importTimes.plans[pk2]=new Date().toISOString();
    App.currentPlanKey=pk2;App.ALL_DATA.currentPlanKey=pk2;
    refreshMergedData();saveAllData();
    updatePlanUI();
    toast('已导入 '+yn+' 计划数据，'+nb.length+' 家分公司','success');
    _planBatchSuccess++;
    _planProcessNext();
  }catch(err){_planBatchFail++;toast('解析失败[计划]: '+err.message,'error');console.error('Plan import error:',err);_planProcessNext();}
};
reader.onerror=function(){
  _planBatchFail++;
  toast('文件读取失败[计划]: '+(file&&file.name?file.name:'未知文件'),'error');
  _planProcessNext();
};
reader.readAsArrayBuffer(file);
}

// Bootstrap handled by init() IIFE at end of file

function applyCompareMode(){
  if(!App.isCompareMode)return;
  // 对比模式下隐藏所有预警UI
  var ab=document.getElementById('alert-bar');if(ab)ab.style.display='none';
  var rb=document.getElementById('regions-badge');if(rb)rb.style.display='none';
  var bb=document.getElementById('branches-badge');if(bb)bb.style.display='none';
  // Call all table comparison injectors
  if(typeof injectOverviewCompare==='function')injectOverviewCompare();
  if(typeof injectRegionsCompare==='function')injectRegionsCompare();
  if(typeof injectBranchesCompare==='function')injectBranchesCompare();
  if(typeof injectBranchDetailCompare==='function')injectBranchDetailCompare();
}

// Populate year dropdown from available data
function populateCompareYears(){
  var cy=document.getElementById('compareYear');
  if(!cy)return;
  cy.innerHTML='';
  var years={};
  if(App.ALL_DATA&&App.ALL_DATA.actuals){
    Object.keys(App.ALL_DATA.actuals).forEach(function(k){var y=k.split('-')[0];if(y)years[y]=1;});
  }
  var yrList=Object.keys(years).sort();
  if(yrList.length===0)yrList=['2026'];
  yrList.forEach(function(y){var o=document.createElement('option');o.value=y;o.textContent=y+'年';cy.appendChild(o);});
}

// Refresh month dropdown to reflect data availability for the selected year
function refreshCompareMonths(optMonth){
  var cy=document.getElementById('compareYear');
  var cm=document.getElementById('compareMonth');
  if(!cy||!cm)return;
  var year=cy.value;
  cm.innerHTML='';
  var hasData={};
  if(App.ALL_DATA&&App.ALL_DATA.actuals){
    Object.keys(App.ALL_DATA.actuals).forEach(function(ak){
      var ap=ak.split('-');
      if(ap[0]===year)hasData[parseInt(ap[1])]=1;
    });
  }
  var found=false,selected=optMonth||null;
  for(var m=1;m<=12;m++){
    var o=document.createElement('option');
    o.value=m;
    var hasD=!!hasData[m];
    o.textContent=(hasD?'● ':'○ ')+m+'月'+(hasD?'':' · 无数据');
    if(!hasD)o.style.color='#999';
    // If a preferred month is specified, select it; otherwise select first with data
    if(selected!=null){
      if(m===selected){o.selected=true;found=true;}
    }else{
      if(hasD&&!found){o.selected=true;found=true;}
    }
    cm.appendChild(o);
  }
  if(!found){
    var oo=document.createElement('option');
    oo.value='1';oo.textContent='○ 1月 · 无数据';
    oo.selected=true;oo.style.color='#999';
    cm.appendChild(oo);
  }
}

function updateComparePeriodLabels(text, visible){
  ['headerComparePeriodLabel','barComparePeriodLabel'].forEach(function(id){
    var el=document.getElementById(id);
    if(!el)return;
    el.textContent=text||'';
    el.style.display=visible?'inline':'none';
  });
}

function toggleCompareMode(){
  try{
    App.isCompareMode=!App.isCompareMode;
    var btn=document.getElementById('btnCompare');if(!btn)return;
    var bar=document.getElementById('compareBar');if(!bar)return;
    if(App.isCompareMode){
      btn.textContent='\u{1f50d} 对比中...';btn.style.opacity='1';btn.style.background='rgba(59,130,246,.3)';
      bar.style.display='flex';bar.style.alignItems='center';bar.style.gap='4px';
      var cy=document.getElementById('compareYear');
      var cm=document.getElementById('compareMonth');
      if(!cy||!cm){showError('对比选择器未找到');return;}
      populateCompareYears();
      var curParts=(App.currentMonth||'2026-04').split('-');
      var defY=curParts[0],defM=parseInt(curParts[1])||4;
      if(defM===1){defM=12;defY=String(parseInt(defY)-1);}else{defM--;}
      cy.value=defY;refreshCompareMonths(defM);
      setComparePeriod();
    }else{
      btn.textContent='\u{1f50d} 对比模式';btn.style.opacity='.85';btn.style.background='rgba(59,130,246,.25)';
      bar.style.display='none';App.compareMonth=null;
      updateComparePeriodLabels('', false);
      destroyCharts();
      var at=document.querySelector('.nav button.active');
      if(at)switchTab(at.dataset.tab||'overview');else switchTab('overview');
      // 恢复预警角标（强制收起）
      var ab=document.getElementById('alert-bar');if(ab)ab.classList.remove('open');
      if(typeof renderNavBadge==='function') renderNavBadge(App._alertResults||[]);
      if(typeof renderAlertBar==='function') renderAlertBar(App._alertResults||[]);
    }
  }catch(e){showError('对比模式切换失败: '+e.message);}
}

function setComparePeriod(){
  try{
    if(!App.isCompareMode)return;var cy=document.getElementById('compareYear');var cm=document.getElementById('compareMonth');
    if(!cy||!cm)return;
    App.compareMonth=cy.value+'-'+String(cm.value).padStart(2,'0');
    updateComparePeriodLabels('vs '+formatMonth(App.compareMonth), true);
    refreshCompareData();destroyCharts();
    var at=document.querySelector('.nav button.active');
    if(at)switchTab(at.dataset.tab||'overview');else switchTab('overview');
  }catch(e){showError('setComparePeriod 失败: '+e.message);}
}

function exportData(){
  var json=JSON.stringify(App.ALL_DATA,null,2);
  var blob=new Blob([json],{type:'application/json'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  var d=new Date();
  var ts=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
  a.download='安效能数据备份_'+ts+'.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData(input){
  var file=input.files[0];
  if(!file)return;
  if(!confirm('恢复备份将覆盖当前所有数据（包括已导入的计划和实际数据），确认继续？')){input.value='';return;}
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=JSON.parse(e.target.result);
      if(!data._plans&&!data.actuals&&!data._merged){toast('文件格式不正确，不是有效的安效能数据备份文件','error');return;}
      App.ALL_DATA=data;
      App.currentMonth=data.currentMonth||'2026-04';
      App.currentPlanKey=data.currentPlanKey||'auto';
      App.currentYear=App.currentMonth.split('-')[0];
      saveAllData();
      updateYearUI();
      updateMonthUI();
      updatePlanUI();
      refreshMergedData();
      destroyCharts();
      switchTab('overview');
      toast('备份恢复成功！已加载 '+formatMonth(App.currentMonth)+' 数据。','success');
    }catch(err){
      toast('文件解析失败：'+err.message,'error');
    }
  };
  reader.readAsText(file);
  input.value='';
}

// --- Robust button binding ---
// ── Quick compare helpers ──
function quickCompare(type){
  var parts=App.currentMonth.split('-');
  var y=parseInt(parts[0]),m=parseInt(parts[1]);
  if(type==='prevMonth'){if(m===1){y--;m=12;}else{m--;}}
  else if(type==='prevYear'){y--;}
  var cmpM=y+'-'+String(m).padStart(2,'0');
  var hasData=App.ALL_DATA.actuals&&App.ALL_DATA.actuals[cmpM];
  if(!hasData){toast('该对比期无数据: '+formatMonth(cmpM)+'，请先导入','error');return;}
  // Enable compare mode if not already
  if(!App.isCompareMode){
    App.isCompareMode=true;
    var btn=document.getElementById('btnCompare');if(btn){btn.textContent='🔍 对比中...';btn.style.opacity='1';btn.style.background='rgba(59,130,246,.3)';}
    var bar=document.getElementById('compareBar');if(bar){bar.style.display='flex';bar.style.alignItems='center';bar.style.gap='4px';}
  }
  // Populate year dropdown if empty
  var cy=document.getElementById('compareYear');if(cy&&cy.options.length===0)populateCompareYears();
  if(cy)cy.value=String(y);
  refreshCompareMonths(m);
  // Set period and refresh
  App.compareMonth=cmpM;
  updateComparePeriodLabels('vs '+formatMonth(cmpM), true);
  refreshCompareData();destroyCharts();
  var at=document.querySelector('.nav button.active');
  if(at)switchTab(at.dataset.tab||'overview');else switchTab('overview');
  toast('已对比: '+formatMonth(App.currentMonth)+' vs '+formatMonth(cmpM),'info');
}

// ── Data management CRUD ──
function deletePlanVersion(pk){
  if(!confirm('确定删除计划版本 '+pk+' ？此操作不可恢复。'))return;
  if(App.ALL_DATA._plans)delete App.ALL_DATA._plans[pk];
  if(App.ALL_DATA._importTimes&&App.ALL_DATA._importTimes.plans)delete App.ALL_DATA._importTimes.plans[pk];
  saveAllData();
  updatePlanUI();
  toast('已删除计划版本: '+pk,'info');
}

function confirmClearAll(){
  if(!confirm('⚠️ 确定清空所有导入数据？\n此操作不可恢复！\n\n建议先点击「导出全部备份」保存当前数据。'))return;
  clearAllData();
}

function clearAllData(){
  cancelPendingSave();
  App.ALL_DATA._plans={};
  App.ALL_DATA.actuals={};
  App.ALL_DATA._merged={};
  App.ALL_DATA._importTimes={};
  App.ALL_DATA.currentMonth='2026-04';
  App.ALL_DATA.currentPlanKey='auto';
  App.currentMonth='2026-04';
  App.currentPlanKey='auto';
  App.currentYear='2026';
  saveAllData();
  cancelPendingSave();
  refreshMergedData();
  updateYearUI();
  updatePlanUI();
  updateMonthUI();
  destroyCharts();
  switchTab('overview');
  toast('所有数据已清空','info');
  return fetch('/save-backup',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(App.ALL_DATA)
  }).then(function(response){
    if(!response.ok)throw new Error('backup clear failed');
    return response;
  }).catch(function(){
    toast('本地数据已清空，但磁盘备份清空失败','error');
  });
}

// ── Button binding ──
(function bindBtn(){
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',bindBtn);
    return;
  }
  var b=document.getElementById('btnCompare');
  if(b){
    if(App&&App.debug)console.log('bindBtn: btnCompare found, attaching click');
    b.addEventListener('click',function(e){e.preventDefault();
      try{toggleCompareMode();}catch(err){showError('对比模式错误: '+err.message);}
    });
  }else{if(App&&App.debug)console.log('bindBtn: btnCompare NOT FOUND');}
})();

// --- Robust initialization ---
(function init(){
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);return;}
  if(App&&App.debug)console.log('init: DOM ready, App version check:',typeof App);
  try{
    if(typeof App==='undefined'){showError('App 对象未定义，请检查 dashboard-data.js 是否正常加载');return;}
    if(App.encryptedShareMode)return;
    // Show boot success briefly
    var ep=document.getElementById('errPanel');
    if(ep){ep.style.display='block';ep.style.background='#efe';ep.style.color='#060';ep.style.borderTop='2px solid green';ep.textContent='看板启动成功 | App: OK | currentMonth: '+(App.currentMonth||'未设置');setTimeout(function(){if(ep.textContent.indexOf('启动成功')>=0)ep.style.display='none';},3000);}
    initData();
    if(typeof initAlertRules==='function')initAlertRules();
    if (typeof runAlerts === 'function') runAlerts();
    updateYearUI();
    if(typeof updateMonthDropdown==='function')updateMonthDropdown();
    if(App&&App.debug)console.log('init OK, month=',App.currentMonth);
  }catch(e){
    showError('看板初始化失败: '+e.message);
    console.error('init error:',e);
  }
})();
