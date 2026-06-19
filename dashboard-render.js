App.TP_NOTE="* TP = 当前月份/12（根据数据月份动态计算），用于将年度计划值折算为截至当前月份的累计目标值";

function escapeHtml(value){
  return String(value == null ? '' : value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
window.escapeHtml = escapeHtml;

function escapeJsString(value){
  return escapeHtml(String(value == null ? '' : value)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/\r/g,'\\r')
    .replace(/\n/g,'\\n')
    .replace(/\u2028/g,'\\u2028')
    .replace(/\u2029/g,'\\u2029'));
}
window.escapeJsString = escapeJsString;

function renderIndicatorGuide(){
  var gh=`<div class="section"><div class="sec-header" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')"><span class="arrow">▶</span><h3>📋 指标说明</h3><span class="badge">68项</span></div><div class="sec-body open">`;
  gh+='<p style="color:#666;font-size:12px;margin:8px 0">'+App.TP_NOTE+'<br><span style=color:#888>本模块与看板指标同步更新。若发现描述与实际计算不一致，请反馈核实。</span></p>';
  INDICATOR_DESC.forEach(function(grp){
    gh+='<h4 style="margin:12px 0 4px;color:#1e40af">'+grp.g+'类</h4>';
    gh+='<div class="tbl-wrap"><table><thead><tr><th width="18%">指标</th><th width="32%">口径/公式</th><th width="8%">来源</th><th width="42%">准确性风险</th></tr></thead><tbody>';
    grp.items.forEach(function(it){
      var sc=it.s.indexOf('手动')>=0?'style="color:#d97706;font-weight:600"':'style="color:#059669"';
      gh+='<tr><td><b>'+it.k+'</b></td><td style="font-size:11px">'+it.f+'</td><td '+sc+'>'+it.s+'</td><td style="font-size:11px;color:#666">'+it.r+'</td></tr>';
    });
    gh+='</tbody></table></div>';
  });
  gh+='</div></div>';
  return gh;
}

function renderGuideTab(){
  var g=document.getElementById('tab-guide');
  if(!g||g.dataset.built==='1'||typeof INDICATOR_DESC==='undefined')return;
  g.dataset.built='1';
  var h='<div class="section" style="padding:0 16px"><p style="color:#666;font-size:12px;margin:0 0 12px 0">* TP = 当前月份/12（固定为4/12），用于将年度计划值折算为截至当前月份的累计目标值。本模块与看板指标同步更新。若发现与实际计算不一致请反馈。</p>';
  INDICATOR_DESC.forEach(function(grp){
    h+='<div class="sec-group" style="background:var(--card);border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-bottom:14px;overflow:hidden">';
    h+='<div class="guide-toggle" style="display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;user-select:none;border-bottom:1px solid #f0f0f0">';
    h+='<span class="sec-arrow" style="display:inline-block;transition:transform .2s;font-size:10px;color:var(--muted)">\u25b6</span>';
    h+='<span style="font-weight:600;font-size:14px;color:#1e40af">'+grp.g+'</span></div>';
    h+='<div class="sec-body" style="display:none"><div class="tbl-wrap" style="box-shadow:none;border-radius:0;margin-bottom:0">';
    h+='<table><thead><tr><th width="18%">指标</th><th width="32%">口径/公式</th><th width="8%">来源</th><th width="42%">准确性风险</th></tr></thead><tbody>';
    grp.items.forEach(function(it){
      h+='<tr><td><b>'+it.k+'</b></td><td style="font-size:11px">'+it.f+'</td>';
      h+='<td style="color:'+(it.s==='自动'?'#059669':'#d97706')+';font-weight:600">'+it.s+'</td>';
      h+='<td style="font-size:11px;color:#666">'+it.r+'</td></tr>';
    });
    h+='</tbody></table></div></div></div>';
  });
  h+='</div>';
  g.innerHTML=h;
  // Click delegation
  g.addEventListener('click',function(e){
    var hdr=e.target.closest('.guide-toggle');
    if(!hdr)return;
    var sgroup=hdr.parentElement;
    var body=sgroup.querySelector('.sec-body');
    var arrow=sgroup.querySelector('.sec-arrow');
    if(!body)return;
    var shown=body.style.display!=='none';
    body.style.display=shown?'none':'block';
    if(arrow)arrow.style.transform=shown?'':'rotate(90deg)';
    hdr.classList.toggle('open');
  });
}

function renderOverview(){
    var nat=App.DATA.national;
    var cd=App.isCompareMode?getCompareData('national'):null;
    var kpiLabels=['保费实际合计','保费达成率','经营利润','利润达成率','综合成本率','整体产能(实际)','整体人均利润(实际)','后台产能(实际)','整体保费率(实际)','后台保费率(实际)','整体实际','后台实际'];
    document.getElementById('overview-kpi').innerHTML=App.FIELDS.filter(f=>kpiLabels.includes(f.l)).map(f=>{var v2=cd?Number(cd[f.k])||0:0;var delta=cd?(nat[f.k]||0)-v2:0;var deltaHTML='';if(cd){var dc=diffColor(f.rd,f.u,delta);var ds=(delta>=0?'+':'')+fmtVal(delta,f.u);deltaHTML='<div class="kpi-delta" style="color:'+dc+'">vs '+escapeHtml(formatMonth(App.compareMonth))+': '+escapeHtml(ds)+'</div>';}let v=nat[f.k]||0,cls=f.u==='万元'?(v>=0?'c-green':'c-red'):(f.u==='%'?((f.rd==='desc'&&v>=1)||(f.rd==='asc'&&v<=0.98)?'c-green':'c-red'):'c-blue');return'<div class="kpi-card '+cls+'" data-field="'+escapeHtml(f.k)+'"><div class="kl">'+escapeHtml(f.l)+'</div><div class="kv">'+escapeHtml(fmtVal(v,f.u))+'</div>'+deltaHTML+'</div>';}).join('');
    let sh='';['保费','效益','效能','人员'].forEach(g=>{var gf=App.FIELDS.filter(f=>f.g===g);sh+='<div class="section"><div class="sec-header" onclick="this.classList.toggle(\'open\');this.nextElementSibling.classList.toggle(\'open\')"><span class="arrow">▶</span><h3>'+escapeHtml(g)+'明细</h3><span class="badge">'+gf.length+'项</span></div><div class="sec-body"><div class="tbl-wrap"><table><thead><tr><th>指标</th><th class="num">数值</th><th>单位</th><th>来源</th></tr></thead><tbody>';gf.forEach(f=>{sh+='<tr><td>'+escapeHtml(f.l)+'</td><td class="num"><b>'+escapeHtml(fmtVal(nat[f.k]||0,f.u))+'</b></td><td>'+escapeHtml(f.u)+'</td><td class="computed">'+(f.m?'手动填写':'自动计算')+'</td></tr>';});sh+='</tbody></table></div></div></div>';});document.getElementById('overview-sections').innerHTML=sh;
    if(App.isCompareMode){injectOverviewCompare();}
    renderAlertDots();
}

function renderRegions(){
    // Top KPI cards — same fields as core table (KEY_SET)
    var kfs2=App.FIELDS.filter(f=>App.KEY_SET.has(f.k));
    let kh='';App.REGIONS.forEach(r=>{var d=App.DATA.regions[r]||{};kh+='<div class="region-card"><h4>'+escapeHtml(r)+'</h4>';kfs2.forEach(f=>{kh+='<div class="metric" data-field="'+escapeHtml(f.k)+'"><span>'+escapeHtml(f.l)+'</span><span class="mv">'+escapeHtml(fmtVal(d[f.k]||0,f.u))+'</span></div>';});kh+='</div>';});document.getElementById('regions-kpi').innerHTML=kh;

    // Key metrics table (折叠隐藏，对比模式下自动展开)
    var kfs=App.FIELDS.filter(f=>App.KEY_SET.has(f.k));
    let kt='<div class="section collapsible"><div class="sec-header'+(App.isCompareMode?' open':'')+'" onclick="this.classList.toggle(\'open\');this.nextElementSibling.classList.toggle(\'open\')"><span class="arrow">▶</span><h3>📊 核心指标对比</h3></div><div class="sec-body'+(App.isCompareMode?' open':'')+'">';
    kt+='<div class="tbl-wrap"><table><thead><tr><th class="s0">核心指标</th><th class="s1">单位</th>';
    App.REGIONS.forEach(r=>kt+='<th class="num" data-rname="'+escapeHtml(r)+'">'+escapeHtml(r)+'</th>');kt+='</tr></thead><tbody>';
    kfs.forEach(f=>{kt+='<tr><td class="s0"><b>'+escapeHtml(f.l)+'</b></td><td class="s1 computed">'+escapeHtml(f.u)+'</td>';App.REGIONS.forEach(r=>{let v=(App.DATA.regions[r]||{})[f.k]||0;kt+='<td class="num '+getColor(f.u,f.rd,v)+'" data-field="'+escapeHtml(f.k)+'">'+escapeHtml(fmtVal(v,f.u))+'</td>';});kt+='</tr>';});
    kt+='</tbody></table></div></div></div>';
    document.getElementById('regions-key-table').innerHTML=kt;
    requestAnimationFrame(function(){requestAnimationFrame(function(){var t=document.querySelector('#regions-key-table table');if(t)fixStickyColumns(t);});});

    // Charts (collapsible by group)
    let chartsHtml='';
    var cmpClass=App.isCompareMode?' compare-mode':'';
    ['保费','效益','效能','人员'].forEach(g=>{
        var gf=App.FIELDS.filter(f=>f.g===g),cg=App.CHART_GROUPS[g]||[];
        chartsHtml+='<div class="section"><div class="sec-header open" onclick="this.classList.toggle(\'open\');this.nextElementSibling.classList.toggle(\'open\');setTimeout(renderRegionsCharts,150)"><span class="arrow">▶</span><h3>'+escapeHtml(g)+'对比</h3><span class="badge">'+cg.length+'张图</span></div><div class="sec-body open"><div class="chart-grid'+cmpClass+'">';
        cg.forEach((c,i)=>chartsHtml+='<div class="chart-card"><h4>'+escapeHtml(c.title)+'</h4><div class="chart-wrap"><canvas id="rc-'+escapeHtml(g)+'-'+i+'"></canvas></div></div>');
        chartsHtml+='</div></div></div>';
    });
    document.getElementById('regions-charts').innerHTML=chartsHtml;

    // Full detail toggle (collapsed by default) — with compare support
    let dt='<div class="more-toggle" onclick="var t=this;t.classList.toggle(\'open\');document.getElementById(\'regions-full-detail\').classList.toggle(\'open\')"><span class="mt-arrow">▶</span> 查看全部67项指标明细</div>';
    dt+='<div class="more-body" id="regions-full-detail">';
    ['保费','效益','效能','人员'].forEach(g=>{
        var gf=App.FIELDS.filter(f=>f.g===g);
        dt+='<div class="tbl-wrap"><table><thead><tr><th>'+g+'</th>';
        App.REGIONS.forEach(r=>{dt+='<th class="num cmp-region-col" data-region="'+escapeHtml(r)+'">'+escapeHtml(r)+'</th>';});dt+='</tr></thead><tbody>';
        gf.forEach(f=>{dt+='<tr><td>'+escapeHtml(f.l)+'</td>';App.REGIONS.forEach(r=>{let v=(App.DATA.regions[r]||{})[f.k]||0;dt+='<td class="num '+getColor(f.u,f.rd,v)+'" data-region="'+escapeHtml(r)+'" data-field="'+escapeHtml(f.k)+'">'+escapeHtml(fmtVal(v,f.u))+'</td>';});dt+='</tr>';});
        dt+='</tbody></table></div>';
    });
    dt+='</div>';
    document.getElementById('regions-detail').innerHTML=dt;

    renderRegionsCharts();
    renderRegionAlertMarks();
}

function renderBranches(){
  var s=(document.getElementById('branchSearch').value||'').toLowerCase();
  var g=document.getElementById('branchGroup').value;
  var regFilter=document.getElementById('branchRegion').value||'all';
  var br=App.DATA.branches.slice();
  if(s)br=br.filter(function(b){return b.n.toLowerCase().includes(s);});
  if(regFilter!=='all')br=br.filter(function(b){return b.r===regFilter;});
  var df=g==='all'?App.FIELDS.filter(function(f){return App.KEY_SET.has(f.k);}):App.FIELDS.filter(function(f){return f.g===g&&App.KEY_SET.has(f.k);});
  var ro={'第一责任区':0,'第二责任区':1,'第三责任区':2,'第四责任区':3};
  
  // Sort state (stored on branches-table element)
  var tbl=document.getElementById('branches-table');
  var sortCol=tbl.dataset.sortCol||'';
  var sortDir=tbl.dataset.sortDir||'';
  if(sortCol&&sortDir){
    var sf=App.FIELDS.find(function(f){return f.k===sortCol;});
    if(sf){
      br.sort(function(a,b){
        var va=Number((a.d||{})[sortCol])||0,vb=Number((b.d||{})[sortCol])||0;
        var asc=App.RANK_ASC[sortCol];
        if(sortDir==='asc')return asc?va-vb:vb-va;
        return asc?vb-va:va-vb;
      });
    }
  }else{
    br.sort(function(a,b){return (ro[a.r]||9)-(ro[b.r]||9);});
  }
  
  var h='<table><thead><tr onclick="event.stopPropagation()"><th class="s0">#</th><th class="s1">责任区</th><th class="s2">分公司</th>';
  df.forEach(function(f,fi){
    var dirIcon='';
    if(sortCol===f.k)dirIcon=sortDir==='asc'?' ▲':' ▼';
    h+='<th class="num sortable" onclick="sortBranches(\''+escapeJsString(f.k)+'\')" title="点击排序" data-fk="'+escapeHtml(f.k)+'">'+escapeHtml(f.l)+escapeHtml(dirIcon)+'</th>';
  });
  h+='</tr></thead><tbody>';
  br.forEach(function(b,bi){
    var bn=escapeHtml(b.n),brn=escapeHtml(b.r),jsBn=escapeJsString(b.n),jsBr=escapeJsString(b.r);
    h+='<tr class="clickable-row" onclick="showBranchDetail(\''+jsBn+'\',\''+jsBr+'\')"><td class="s0" style="color:var(--text2);font-size:11px">'+(bi+1)+'</td><td class="s1">'+brn+'</td><td class="s2" data-fname="'+bn+'"><b>'+bn+'</b></td>';
    df.forEach(function(f,fi){
      var v=Number((b.d||{})[f.k])||0;
      h+='<td class="num '+getColor(f.u,f.rd,v)+'" data-field="'+f.k.replace(/"/g,'&quot;')+'" title="'+f.l.replace(/"/g,'&quot;')+'">'+fmtVal(v,f.u)+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  if(g==='all'){
    h+='<div style="margin-top:8px;font-size:11px;color:var(--text2)">显示核心指标，<a style="color:var(--primary);cursor:pointer" onclick="toggleAllFields()">查看全部 '+App.FIELDS.length+'项指标</a></div>';
  }
  document.getElementById('branches-table').innerHTML=h;
  renderBranchAlertMarks();
  requestAnimationFrame(function(){requestAnimationFrame(function(){var t=document.querySelector('#branches-table table');if(t)fixStickyColumns(t);});});
}

function showBranchDetail(name,region){
  document.getElementById('branches-list-view').style.display='none';
  document.getElementById('branch-detail-view').style.display='block';
  App.branchRanks=rankAllBranches();
  renderBranchDetail(name,region);
}

function toggleAllFields(){
  App.showingAllFields=!App.showingAllFields;
  var g=document.getElementById('branchGroup');
  if(App.showingAllFields){
    g.value='all';
    renderAllBranches();
  }else{
    renderBranches();
  }
}

function renderAllBranches(){
  var s=(document.getElementById('branchSearch').value||'').toLowerCase();
  var regFilter=document.getElementById('branchRegion').value||'all';
  var br=App.DATA.branches.slice();if(s)br=br.filter(function(b){return b.n.toLowerCase().includes(s);});
  if(regFilter!=='all')br=br.filter(function(b){return b.r===regFilter;});
  var df=App.FIELDS;
  var ro={'第一责任区':0,'第二责任区':1,'第三责任区':2,'第四责任区':3};
  
  var tbl=document.getElementById('branches-table');
  var sortCol=tbl.dataset.sortCol||'';
  var sortDir=tbl.dataset.sortDir||'';
  if(sortCol&&sortDir){
    var sf=App.FIELDS.find(function(f){return f.k===sortCol;});
    if(sf){
      br.sort(function(a,b){
        var va=Number((a.d||{})[sortCol])||0,vb=Number((b.d||{})[sortCol])||0;
        var asc=App.RANK_ASC[sortCol];
        if(sortDir==='asc')return asc?va-vb:vb-va;
        return asc?vb-va:va-vb;
      });
    }
  }else{
    br.sort(function(a,b){return (ro[a.r]||9)-(ro[b.r]||9);});
  }
  
  var h='<table><thead><tr><th class="s0">#</th><th class="s1">责任区</th><th class="s2">分公司</th>';
  df.forEach(function(f,fi){
    var dirIcon='';
    if(sortCol===f.k)dirIcon=sortDir==='asc'?' ▲':' ▼';
    h+='<th class="num sortable" onclick="sortBranches(\''+escapeJsString(f.k)+'\')" title="点击排序" data-fk="'+escapeHtml(f.k)+'">'+escapeHtml(f.l)+escapeHtml(dirIcon)+'</th>';
  });
  h+='</tr></thead><tbody>';
  br.forEach(function(b,bi){
    var bn=escapeHtml(b.n),brn=escapeHtml(b.r),jsBn=escapeJsString(b.n),jsBr=escapeJsString(b.r);
    h+='<tr class="clickable-row" onclick="showBranchDetail(\''+jsBn+'\',\''+jsBr+'\')"><td class="s0" style="color:var(--text2);font-size:11px">'+(bi+1)+'</td><td class="s1">'+brn+'</td><td class="s2" data-fname="'+bn+'"><b>'+bn+'</b></td>';
    df.forEach(function(f,fi){
      var v=Number((b.d||{})[f.k])||0;
      h+='<td class="num '+getColor(f.u,f.rd,v)+'" data-field="'+f.k.replace(/"/g,'&quot;')+'" title="'+f.l.replace(/"/g,'&quot;')+'">'+fmtVal(v,f.u)+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  h+='<div style="margin-top:8px;font-size:11px;color:var(--text2);clear:both"><a style="color:var(--primary);cursor:pointer" onclick="toggleAllFields()">收起，只显示核心指标</a></div>';
  document.getElementById('branches-table').innerHTML=h;
  renderBranchAlertMarks();
  requestAnimationFrame(function(){requestAnimationFrame(function(){var t=document.querySelector('#branches-table table');if(t)fixStickyColumns(t);});});
}

function hideBranchDetail(){
  document.getElementById('branches-list-view').style.display='block';
  document.getElementById('branch-detail-view').style.display='none';
  App.branchRanks=null;
}

function renderBranchDetail(name,region){
  var branches=App.DATA.branches;
  var bd=null;
  for(var i=0;i<branches.length;i++){
    if(branches[i].n===name){bd=branches[i];break;}
  }
  if(!bd){document.getElementById('branch-detail-content').innerHTML='<p>未找到分公司数据</p>';return;}
  var d=bd.d,ranks=App.branchRanks[name]||{},total=branches.length;

  // Compute overall averages
  var nat=App.DATA.national;
  var avg={};
  App.FIELDS.forEach(function(f){
    var sum=0,c=0;
    branches.forEach(function(b){
      var v=Number((b.d||{})[f.k]);
      if(!isNaN(v)){sum+=v;c++;}
    });
    avg[f.k]=c>0?sum/c:0;
  });
  // 特定指标使用全国数据覆盖均值
  function cmpVal(fk){return App.NAT_CMP.has(fk)?(Number(nat[fk])||0):(avg[fk]||0);}

  // Rank badge class
  function rankBadge(r,tot){
    if(r<=Math.ceil(tot*0.3))return'top';
    if(r>=Math.ceil(tot*0.7))return'low';
    return'mid';
  }

  // Diff format
  function diffFmt(val,avgVal,u){
    var d=val-avgVal;
    if(Math.abs(avgVal)<1e-9)return'<span class="computed">-</span>';
    var sign=d>=0?'+':'';
    var cls=d>0?'diff-up':'diff-down';
    var arrow=d>=0?'↑':'↓';
    if(u==='%')return'<span class="'+cls+'">'+arrow+sign+(d*100).toFixed(2)+'pp</span>';
    if(u==='万元'){var ad=Math.abs(d);var ds=ad<100&&ad>0?d.toFixed(2):Math.round(d).toLocaleString();return'<span class="'+cls+'">'+arrow+sign+ds+'万</span>';}
    if(u==='万元/人')return'<span class="'+cls+'">'+arrow+sign+d.toFixed(2)+'万元/人</span>';
    return'<span class="'+cls+'">'+arrow+sign+d.toFixed(2)+'</span>';
  }  var html='';
  var safeName=escapeHtml(name),safeRegion=escapeHtml(region);
  html+='<div class="breadcrumb"><a onclick="hideBranchDetail()">各分公司明细</a> &gt; '+safeName+'</div>';
  html+='<div class="branch-header"><h2>'+safeName+'</h2><span style="color:var(--text2);font-size:13px">'+safeRegion+'</span><span style="color:var(--text2);font-size:11px">共'+total+'家分公司</span></div>';

  // KPI cards: key metrics with vs-average and rank
  var kpiKeys=[
    {k:'保费实际合计',l:'保费合计'},
    {k:'时间进度计划达成率',l:'保费时间进度计划达成率'},
    {k:'经营利润',l:'经营利润'},
    {k:'当月经营利润',l:'当月经营利润'},
    {k:'时间进度达成率',l:'利润时间进度计划达成率'},
    {k:'综合成本率实际（整体利润口径）',l:'综合成本率'},
    {k:'已赚赔付率实际',l:'已赚赔付率'},
    {k:'已赚费用率实际',l:'已赚费用率'},
    {k:'整体人均产能实际',l:'人均产能'},{k:'整体人均利润实际',l:'人均利润'},
    {k:'整体人力成本保费率实际',l:'人力成本保费率'}
  ];
  html+='<div class="kpi-cards">';
  kpiKeys.forEach(function(kp){
    var f=App.FIELDS.find(function(x){return x.k===kp.k;});
    if(!f)return;
    var v=Number(d[kp.k])||0,av=cmpVal(kp.k)||0;
    if(App.isCompareMode){var cmpBr=getCompareData('branches')||[];var cb=cmpBr.find(function(x){return x.n===name;});if(cb&&cb.d)av=Number(cb.d[kp.k])||0;}
    var rk=ranks[kp.k]||'-';
    html+='<div class="kpi-card">';
    html+='<h4>'+escapeHtml(kp.l)+'</h4>';
    html+='<div class="val">'+fmtVal(v,f.u)+'</div>';
    html+='<div class="rank">排名 <span class="badge-rank '+rankBadge(rk,total)+'">'+rk+'/'+total+'</span></div>';
    html+='<div class="avg">'+(App.isCompareMode?formatMonth(App.compareMonth):(App.NAT_CMP.has(f.k)?'分公司整体':'整体均值'))+' '+fmtVal(av,f.u)+'</div>';
    html+='<div class="diff">'+diffFmt(v,av,f.u)+'</div>';
    html+='</div>';
  });
  html+='</div>';

  // Full indicator detail tables by group (collapsible sections)
  // Phase 1/4预留: comparison columns structure
  var groups=['保费','效益','效能','人员'];
  groups.forEach(function(g){
    var gf=App.FIELDS.filter(function(f){return f.g===g;});
    var ck=App.CORE_KEYS[g]||[];
    var cfs=gf.filter(function(f){return ck.indexOf(f.k)>=0;});
    var rest=gf.filter(function(f){return ck.indexOf(f.k)<0;});
    
    // Chart section for core indicators
    html+='<div class="section"><div class="sec-header open" onclick="this.classList.toggle(\'open\');this.nextElementSibling.classList.toggle(\'open\');var cv=document.getElementById(\'br-chart-'+escapeJsString(g)+'\');if(cv&&this.classList.contains(\'open\')){renderBranchChart(\''+escapeJsString(g)+'\',\''+escapeJsString(name)+'\');}"><span class="arrow">▶</span><h3>'+escapeHtml(g)+'类指标 ('+gf.length+'项)</h3></div><div class="sec-body open">';
    
    // Bar chart: branch vs average for core indicators (only if same unit, else just table)
    html+='<div id="br-charts-'+g+'" class="branch-charts"></div>';
    
    // Core indicators table
    var cmpLabel=App.isCompareMode?'vs '+formatMonth(App.compareMonth):'整体均值';
    html+='<div class="tbl-wrap"><table><thead><tr><th>指标</th><th>单位</th><th class="num">当前值</th><th class="col-rank">排名</th><th class="num">'+escapeHtml(cmpLabel)+'</th><th class="num">差值</th></tr></thead><tbody>';
    cfs.forEach(function(f){
      var v=Number((d||{})[f.k])||0,av=cmpVal(f.k)||0;if(App.isCompareMode){var cmpBr5=getCompareData('branches')||[];var cb5=cmpBr5.find(function(x){return x.n===name;});if(cb5&&cb5.d)av=Number(cb5.d[f.k])||0;}var rk=ranks[f.k]||'-';
      html+='<tr><td>'+escapeHtml(f.l)+'</td><td class="computed">'+escapeHtml(f.u)+'</td>';
      html+='<td class="num '+getColor(f.u,f.rd,v)+'">'+fmtVal(v,f.u)+'</td>';
      html+='<td class="col-rank"><span class="badge-rank '+rankBadge(rk,total)+'">'+rk+'/'+total+'</span></td>';
      html+='<td class="num">'+fmtVal(av,f.u)+'</td>';
      html+='<td class="num">'+diffFmt(v,av,f.u)+'</td>';
      html+='</tr>';
    });
    html+='</tbody></table></div>';
    
    // Remaining indicators (collapsible)
    if(rest.length>0){
      html+='<div class="more-toggle" onclick="var t=this;t.classList.toggle(\'open\');t.nextElementSibling.classList.toggle(\'open\')"><span class="mt-arrow">▶</span> 查看其余 '+rest.length+'项指标</div>';
      html+='<div class="more-body"><div class="tbl-wrap"><table><thead><tr><th>指标</th><th>单位</th><th class="num">当前值</th><th class="col-rank">排名</th><th class="num">'+escapeHtml(cmpLabel)+'</th><th class="num">差值</th></tr></thead><tbody>';
      rest.forEach(function(f){
        var v=Number((d||{})[f.k])||0,av=cmpVal(f.k)||0;if(App.isCompareMode){var cmpBr5=getCompareData('branches')||[];var cb5=cmpBr5.find(function(x){return x.n===name;});if(cb5&&cb5.d)av=Number(cb5.d[f.k])||0;}var rk=ranks[f.k]||'-';
        html+='<tr><td>'+escapeHtml(f.l)+'</td><td class="computed">'+escapeHtml(f.u)+'</td>';
        html+='<td class="num '+getColor(f.u,f.rd,v)+'">'+fmtVal(v,f.u)+'</td>';
        html+='<td class="col-rank"><span class="badge-rank '+rankBadge(rk,total)+'">'+rk+'/'+total+'</span></td>';
        html+='<td class="num">'+fmtVal(av,f.u)+'</td>';
        html+='<td class="num">'+diffFmt(v,av,f.u)+'</td>';
        html+='</tr>';
      });
      html+='</tbody></table></div></div>';
    }
    
    html+='</div></div>';
  });document.getElementById('branch-detail-content').innerHTML=html;
  setTimeout(function(){['保费','效益','效能','人员'].forEach(function(g){var c=document.getElementById('br-charts-'+g);if(c)c.innerHTML='';renderBranchChart(g,name);});},150);

function renderBranchChart(group,name){
  var container=document.getElementById('br-charts-'+group);
  if(!container)return;
  container.innerHTML='';
  var branches=App.DATA.branches;
  var bd=null;for(var i=0;i<branches.length;i++){if(branches[i].n===name){bd=branches[i];break;}}
  if(!bd)return;
  var d=bd.d||{},ck=App.CORE_KEYS[group]||[];
  if(!ck.length)return;
  var cfs=App.FIELDS.filter(function(f){return ck.indexOf(f.k)>=0;});
  // 效能组：按指标类型分组（人均产能/人均利润/保费率/利润值），而非按单位
  var chartGroups=[];
  if(group==='效能'){
    var effGroups=[
      {title:'人均产能（万元/人）',filter:function(k){return k.indexOf('人均产能实际')>=0&&k.indexOf('利润')<0;}},
      {title:'人均利润（万元/人）',filter:function(k){return k.indexOf('人均利润实际')>=0;}},
      {title:'保费率（%）',filter:function(k){return k.indexOf('保费率实际')>=0;}},
      {title:'利润值（万元）',filter:function(k){return k.indexOf('利润值实际')>=0;}}
    ];
    effGroups.forEach(function(g){var fs=cfs.filter(function(f){return g.filter(f.k);});if(fs.length)chartGroups.push({label:g.title,fields:fs,isPct:g.title.indexOf('%')>=0});});
  }else{
    var byUnit={};
    cfs.forEach(function(f){
      if(f.u==='万元'){byUnit[f.k]=[f];}
      else{if(!byUnit[f.u])byUnit[f.u]=[];byUnit[f.u].push(f);}
    });
    var unitNames={'万元':'金额（万元）','%':'比率（%）','万元/人':'人均（万元/人）','人':'人数'};
    Object.keys(byUnit).forEach(function(u){var ufs=byUnit[u];chartGroups.push({label:(unitNames[u]||(ufs[0].u==='万元'?'金额（万元）':u)),fields:ufs,isPct:u==='%'});});
  }
  chartGroups.forEach(function(cg,ui){
    var ufs=cg.fields;
    var unitLabel=cg.label;
    var canvasId='br-chart-'+group+'-'+ui;
    var avg={};
    var nat=App.DATA.national;
    ufs.forEach(function(f){
      var s=0,c2=0;
      branches.forEach(function(b){var v=Number((b.d||{})[f.k]);if(!isNaN(v)){s+=v;c2++;}});
      avg[f.k]=c2>0?s/c2:0;
    });
    // 特定指标使用全国数据覆盖均值
    function cmpVal(fk){return App.NAT_CMP.has(fk)?(Number(nat[fk])||0):(avg[fk]||0);}
    var isPct=cg.isPct;
    var labels=ufs.map(function(f){return f.l;});
    var branchData=ufs.map(function(f){var v=Number(d[f.k])||0;return isPct?v*100:v;});
    var avgData=ufs.map(function(f){var v=cmpVal(f.k);return isPct?v*100:v;});
    var barH=200;
    var cmpLabel=ufs.some(function(f){return App.NAT_CMP.has(f.k);})?'分公司整体':'整体均值';
    container.insertAdjacentHTML('beforeend','<div class="chart-card"><h4>'+escapeHtml(name)+' vs '+escapeHtml(cmpLabel)+' — '+escapeHtml(unitLabel)+'</h4><div class="chart-wrap" style="height:'+barH+'px"><canvas id="'+escapeHtml(canvasId)+'"></canvas></div></div>');
    var canvas=document.getElementById(canvasId);
    if(!canvas)return;
    if(App.charts[canvasId])App.charts[canvasId].destroy();
    try{
      App.charts[canvasId]=new Chart(canvas,{
        type:'bar',
        data:{labels:labels,datasets:(function(){
          var dss=[
            {label:name,data:branchData,backgroundColor:'#3b82f6',hoverBackgroundColor:'#2563eb',borderRadius:4},
            {label:cmpLabel,data:avgData,backgroundColor:'#94a3b8',hoverBackgroundColor:'#64748b',borderRadius:4}
          ];
          if(App.isCompareMode){
            var cmpBr=(getCompareData('branches')||[]).find(function(b){return b.n===name;});
            var cmpBd=cmpBr&&cmpBr.d?cmpBr.d:{};
            var compareData=ufs.map(function(f){var cv2=Number(cmpBd[f.k])||0;return isPct?cv2*100:cv2;});
            dss.push({label:name+'对比期',data:compareData,backgroundColor:'rgba(59,130,246,.3)',borderColor:'#3b82f6',borderWidth:1,borderRadius:4});
          }
          return dss;
        })()},
        options:{
          _unit:isPct?'%':(ufs[0]?.u||''),
          responsive:true,maintainAspectRatio:false,
          barThickness:20,maxBarThickness:24,
          scales:{x:{ticks:{maxRotation:30,font:{size:11}},grid:{display:false}},y:{grid:{color:'#e5e7eb'},ticks:isPct?{callback:function(v){return v+'%'}}:{}}},
          plugins:{
            tooltip:{callbacks:{label:function(ctx){var v=ctx.raw;return ctx.dataset.label+': '+(isPct?v.toFixed(2)+'%':v.toLocaleString());}}},
            legend:{position:'top'}
          }
        }
      });
    }catch(e){}
  });
}



  // 月份选择器初始化
  var ms=document.getElementById('dataMonth');
  if(ms){var m=parseInt((App.currentMonth||'2026-04').split('-')[1])||4;ms.value=m;}

}

// --- Comparison column injection helpers ---
var _fieldByLabel=null;
function _getFieldByLabel(){
  if(_fieldByLabel)return _fieldByLabel;
  _fieldByLabel={};
  App.FIELDS.forEach(function(f){_fieldByLabel[f.l]=f;});
  return _fieldByLabel;
}

function injectOverviewCompare(){
  var sections=document.getElementById('overview-sections');
  if(!sections)return;
  var tables=sections.querySelectorAll('table');
  tables.forEach(function(tbl){
    var thead=tbl.querySelector('thead tr');
    if(thead&&!thead.querySelector('.cmp-col')){
      var hData=document.createElement('th');hData.textContent='对比期值';hData.className='cmp-col num cmp-hdr';
      var hDelta=document.createElement('th');hDelta.textContent='变化Δ';hDelta.className='cmp-col num cmp-hdr';
      thead.appendChild(hData);thead.appendChild(hDelta);
    }
    var fl=_getFieldByLabel();
    var cd=getCompareData('national')||{};
    var rows=tbl.querySelectorAll('tbody tr');
    rows.forEach(function(row){
      if(row.querySelector('.cmp-col'))return;
      var cells=row.querySelectorAll('td');
      if(cells.length<2)return;
      var label=cells[0].textContent.trim();
      var f=fl[label];if(!f)return;
      var v2=(App.DATA.national||{})[f.k]||0;
      var cv=Number(cd[f.k])||0;
      var delta=v2-cv;
      var clr=diffColor(f.rd,f.u,delta);
      var cell1=document.createElement('td');cell1.className='cmp-col num cmp-data';cell1.textContent=fmtVal(cv,f.u);
      var cell2=document.createElement('td');cell2.className='cmp-col num cmp-delta';cell2.style.cssText='font-weight:700;font-size:15px;color:'+clr;cell2.textContent=(delta>=0?'+':'')+fmtVal(delta,f.u);
      row.appendChild(cell1);row.appendChild(cell2);
      // Highlight entire row if significant change
      if(Math.abs(delta)>0&&clr!=='#888'){row.style.background='var(--cmp-bg)';}
    });
  });
}

function injectRegionsCompare(){
  // Inject into key metrics table
  var tbl=document.querySelector('#regions-key-table table');
  if(tbl)_injectOneRegionsTable(tbl);
  // Also inject into full detail tables
  var detailTables=document.querySelectorAll('#regions-full-detail table');
  detailTables.forEach(function(dt){_injectOneRegionsTable(dt);});
  var dt2=document.querySelector('#regions-key-table table');if(dt2)requestAnimationFrame(function(){requestAnimationFrame(function(){fixStickyColumns(dt2);});});
}
function _injectOneRegionsTable(tbl){
  if(!tbl)return;
  var cd=getCompareData('regions')||{};
  var thead=tbl.querySelector('thead tr');
  // Detect start column: key table (核心指标|单位|第一责任区...) starts at 2, detail table (保费|第一责任区...) starts at 1
  var hcells0=thead?thead.querySelectorAll('th'):[];
  var startCol=2;
  if(hcells0.length>1){
    var h1text=hcells0[1].textContent.trim();
    if(App.REGIONS.indexOf(h1text)>=0)startCol=1;
  }
  if(thead&&!thead.querySelector('.cmp-col')){
    var hcells=thead.querySelectorAll('th');
    for(var hi=hcells.length-1;hi>=startCol;hi--){
      var dh=document.createElement('th');dh.className='cmp-col num cmp-hdr';dh.textContent='Δ';dh.style.cssText='font-size:10px;background:#e8f0fe;border-right:2px solid #2563eb';
      hcells[hi].after(dh);
    }
  }
  var fl=_getFieldByLabel();
  var rows=tbl.querySelectorAll('tbody tr');
  rows.forEach(function(row){
    if(row.querySelector('.cmp-col'))return;
    var cells=row.querySelectorAll('td');if(cells.length<=startCol)return;
    var label=cells[0].textContent.trim();var f=fl[label];if(!f)return;
    var origCells=[];
    for(var ci=startCol;ci<cells.length;ci++){if(!cells[ci].classList.contains('cmp-col'))origCells.push(ci);}
    App.REGIONS.forEach(function(r,ri){
      var ci=origCells[ri];if(ci===undefined)return;
      var cv=Number((cd[r]||{})[f.k])||0;
      var v=(App.DATA.regions[r]||{})[f.k]||0;
      var delta=v-cv;var clr=diffColor(f.rd,f.u,delta);
      var td=document.createElement('td');td.className='cmp-col num cmp-delta';td.style.cssText='font-weight:700;font-size:14px;color:'+clr+';background:var(--cmp-bg);border-right:2px solid #2563eb';
      td.textContent=(delta>=0?'+':'')+fmtVal(delta,f.u);
      cells[ci].after(td);
    });
  });
}

function injectBranchesCompare(){
  var tbl=document.querySelector('#branches-table table');if(!tbl)return;
  var thead=tbl.querySelector('thead tr');
  // Collect field keys from data-fk attributes on header cells
  var hdrKeys=[];
  var hdrCells=thead?thead.querySelectorAll('th'):[];
  for(var hi=3;hi<hdrCells.length;hi++){
    if(!hdrCells[hi].classList.contains('cmp-col')){
      hdrKeys.push(hdrCells[hi].getAttribute('data-fk')||'');
    }
  }
  // Add compare header columns
  if(thead&&!thead.querySelector('.cmp-col')){
    var hcells=thead.querySelectorAll('th');
    for(var hi2=hcells.length-1;hi2>=3;hi2--){
      if(hcells[hi2].classList.contains('cmp-col'))continue;
      var dh=document.createElement('th');dh.className='cmp-col num cmp-hdr';
      dh.textContent='vs '+formatMonth(App.compareMonth);
      dh.style.cssText='font-size:10px;background:#fef3c7;color:#92400e;border-right:2px solid #f59e0b';
      hcells[hi2].after(dh);
    }
  }
  var cd=getCompareData('branches')||[];
  if(!cd.length)return;
  var cmpMap={};cd.forEach(function(b){cmpMap[b.n]=b.d||{};});
  var rows=tbl.querySelectorAll('tbody tr');
  rows.forEach(function(row){
    if(row.querySelector('.cmp-col'))return;
    var cells=row.querySelectorAll('td');if(cells.length<4)return;
    var bn=cells[2].textContent.trim();
    var cbd=cmpMap[bn];if(!cbd)return;
    var origCells=[];
    for(var j=3;j<cells.length;j++){if(!cells[j].classList.contains('cmp-col'))origCells.push(j);}
    for(var k=0;k<Math.min(origCells.length,hdrKeys.length);k++){
      var fk=hdrKeys[k];if(!fk)continue;
      var ff=App.FIELDS.find(function(x){return x.k===fk;});
      if(!ff)continue;
      var curBr=(App.DATA.branches||[]).find(function(bx){return bx.n===bn;})||{d:{}};
      var vv=Number((curBr.d||{})[ff.k])||0;
      var cvv=Number(cbd[ff.k])||0;
      var delta=vv-cvv;var clr=diffColor(ff.rd,ff.u,delta);
      var td=document.createElement('td');td.className='cmp-col num cmp-delta';
      td.style.cssText='font-weight:700;font-size:14px;color:'+clr+';background:#fffbeb;border-right:2px solid #f59e0b';
      td.textContent=(delta>=0?'+':'')+fmtVal(delta,ff.u);
      cells[origCells[k]].after(td);
    }
  });
  requestAnimationFrame(function(){requestAnimationFrame(function(){var t=document.querySelector('#branches-table table');if(t)fixStickyColumns(t);});});
}
function populateTrendIndicatorSelect(){
  var sel=document.getElementById('trendIndicator');if(!sel)return;
  var selected=sel.value;
  while(sel.options.length>1)sel.remove(1);
  var groups={},seen={};
  (App.FIELDS||[]).forEach(function(f){
    if(!f||!f.k||seen[f.k])return;seen[f.k]=1;
    var group=f.g||'其他';
    if(!groups[group]){
      groups[group]=document.createElement('optgroup');
      groups[group].label=group;
      sel.appendChild(groups[group]);
    }
    var o=document.createElement('option');
    o.value=f.k;
    o.textContent=(f.l||f.k)+(f.u?'（'+f.u+'）':'');
    groups[group].appendChild(o);
  });
  if(selected&&seen[selected])sel.value=selected;
  // Populate branch select
  var bs=document.getElementById('trendBranch');if(!bs||bs.options.length>1)return;
  if(App.DATA.branches){
    App.DATA.branches.forEach(function(b){
      var o=document.createElement('option');o.value=b.n;o.textContent=b.n;bs.appendChild(o);
    });
  }
}

var __trendChart=null;
function renderTrendChart(){
  var sel=document.getElementById('trendIndicator');if(!sel)return;
  var fk=sel.value;if(!fk)return;
  var bs=document.getElementById('trendBranch');if(!bs)return;
  var bn=bs.value;
  var compareSel=document.getElementById('trendCompareType');
  var compareType=compareSel?compareSel.value:'mom';
  var hint=document.getElementById('trendCompareHint');
  
  // Get field info
  var field=App.FIELDS.find(function(x){return x.k===fk;});
  if(!field)return;
  
  // Collect data across all months
  var acts=App.ALL_DATA.actuals||{};
  var months=Object.keys(acts).sort();
  if(months.length===0){toast('暂无历史数据，请先导入','info');return;}
  if(compareType==='yoy'){
    var currentMonth=(App.currentMonth||months[months.length-1]||'').split('-')[1];
    months=months.filter(function(month){return month.split('-')[1]===currentMonth;});
    if(hint)hint.textContent='按'+(parseInt(currentMonth,10)||currentMonth)+'月跨年度对比';
  }else if(hint){
    hint.textContent='按连续月份查看变化';
  }
  
  var labels=[];
  var values=[];
  var frm=field.rd&&field.rd.length>0?field.rd[0]:field.u||'';
  
  months.forEach(function(mk){
    var data=acts[mk];
    if(!data||!data.branches)return;
    var v=null;
    if(bn==='all'){
      // National aggregate
      var na=data.national;
      v=na&&na.hasOwnProperty(fk)&&na[fk]!==''&&na[fk]!=null?Number(na[fk]):null;
    }else{
      var b=data.branches.find(function(x){return x.n===bn;});
      v=b&&b.d&&b.d.hasOwnProperty(fk)&&b.d[fk]!==''&&b.d[fk]!=null?Number(b.d[fk]):null;
    }
    if(v==null||!isFinite(v))return;
    labels.push(mk);
    values.push({x:mk,y:v});
  });
  
  if(values.length===0){
    toast(compareType==='yoy'?'所选指标没有可用的同月跨年数据':'所选指标无历史数据','info');
    return;
  }
  
  // Destroy old chart
  if(__trendChart){__trendChart.destroy();__trendChart=null;}
  if(App.charts&&App.charts.trend){App.charts.trend.destroy();delete App.charts.trend;}
  
  var ctx=document.getElementById('trendChart');
  if(!ctx)return;
  
  var compareLabel=compareType==='yoy'?'同比':'环比';
  var title=(field.l||field.k)+' · '+(bn==='all'?'全部汇总':bn)+' · '+compareLabel;
  if(!App.charts)App.charts={};
  __trendChart=new Chart(ctx,{
    type:'line',
    data:{labels:labels,datasets:[{
      label:title,data:values.map(function(x){return x.y;}),
      borderColor:'#2563eb',backgroundColor:'rgba(37,99,235,.1)',
      borderWidth:2,pointRadius:4,pointBackgroundColor:'#2563eb',
      tension:.3,fill:true
    }]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:true,position:'top'},tooltip:{callbacks:{label:function(ctx){return title+': '+fmtVal(ctx.raw,frm);}}}},
      scales:{x:{title:{display:true,text:compareType==='yoy'?'同比月份（同月跨年）':'环比月份（逐月）'},ticks:{maxRotation:45}},y:{title:{display:true,text:frm},beginAtZero:false}}
    }
  });
}

// ── Data Management Tab ──
function renderDataTab(){
  var panel=document.getElementById('data-panel');
  if(!panel)return;
  var ad=App.ALL_DATA;
  var acts=ad.actuals||{};
  var plans=ad._plans||{};
  var impTimes=ad._importTimes||{};
  var h='';

  // 1. Month grid by year
  h+='<div class="data-section"><h4>📅 实际数据月份概览</h4>';
  var years={};
  Object.keys(acts).sort().forEach(function(k){
    var parts=k.split('-'),y=parts[0],m=parseInt(parts[1]);
    if(!years[y])years[y]={};
    years[y][m]=1;
  });
  var yearKeys=Object.keys(years).sort();
  if(yearKeys.length===0){
    h+='<p style="color:#999;font-size:12px;margin:12px 0">暂无导入的实际数据</p>';
  }else{
    yearKeys.forEach(function(y){
        h+='<div class="data-year"><h3>'+escapeHtml(y)+'年</h3><div class="month-grid">';
      for(var m=1;m<=12;m++){
        var has=years[y][m];
        var cls=has?'has-data':'no-data';
        var t=impTimes.actuals&&impTimes.actuals[y+'-'+String(m).padStart(2,'0')];
        var title='';
        if(t){try{var dt=new Date(t);title=' title="导入时间: '+dt.toLocaleString('zh-CN')+'"';}catch(e){}}
        h+='<div class="month-cell '+cls+'"'+title+'><span class="mon">'+m+'</span><span class="yr">月</span></div>';
      }
      h+='</div></div>';
    });
  }
  h+='</div>';

  // 2. Plan versions
  h+='<div class="data-section"><h4>📋 计划版本列表</h4>';
  var planKeys=Object.keys(plans).sort().reverse();
  if(planKeys.length===0){
    h+='<p style="color:#999;font-size:12px;margin:12px 0">暂无导入的计划数据</p>';
  }else{
    h+='<div class="plan-list">';
    planKeys.forEach(function(pk){
      var pdata=plans[pk];
      var bc=pdata&&pdata.branches?pdata.branches.length:0;
      var pt=impTimes.plans&&impTimes.plans[pk];
      var timeStr='';
      if(pt){try{var d2=new Date(pt);timeStr='<span class="import-time">导入: '+d2.toLocaleString('zh-CN')+'</span>';}catch(e){}}
      h+='<div class="plan-card"><span class="vers">'+escapeHtml(pk)+'</span><span class="info">'+bc+'家分公司</span>'+timeStr+'<div class="plan-actions"><button class="btn-sm danger" onclick="deletePlanVersion(\''+escapeJsString(pk)+'\')">删除</button></div></div>';
    });
    h+='</div>';
  }
  h+='</div>';

  // 3. Last import time
  h+='<div class="data-section"><h4>🕐 最后一次导入时间</h4>';
  var latest=null;
  function chk(t){if(!t)return;try{var d3=new Date(t);if(!latest||d3>latest)latest=d3;}catch(e){}}
  if(impTimes.actuals){Object.keys(impTimes.actuals).forEach(function(k){chk(impTimes.actuals[k]);});}
  if(impTimes.plans){Object.keys(impTimes.plans).forEach(function(k){chk(impTimes.plans[k]);});}
  if(latest){
    h+='<p style="font-size:13px;color:var(--text);margin:8px 0">'+latest.toLocaleString('zh-CN')+'</p>';
  }else{
    h+='<p style="color:#999;font-size:12px;margin:8px 0">暂无导入记录</p>';
  }
  h+='</div>';

  // 4. Actions
  h+='<div class="data-actions">';
  h+='<button class="btn-sm warn" onclick="confirmClearAll()">🗑️ 清空全部数据</button>';
  h+='<span style="font-size:10px;color:#999;margin-left:8px">清空前建议先导出备份</span>';
  h+='</div>';

  // 5. Alert config
  h += renderAlertConfig();
  panel.innerHTML=h;
}

// ── Empty state overlay ──
function renderEmptyState(reason){
  // Remove any existing overlay first
  var old=document.querySelector('.empty-overlay');if(old)old.remove();
  var msg='';
  if(reason==='currentMonth'){
    msg='<h3 style="font-size:20px;margin-bottom:12px">📭 该月份暂无数据</h3><p style="font-size:14px;color:#666">当前选择的月份（'+escapeHtml(App.currentMonth)+'）尚未导入实际数据。</p><p style="font-size:13px;color:#888">请切换到有数据的月份，或通过 Excel 导入功能导入该月份数据。</p>';
  }else{
    msg='<h3 style="font-size:20px;margin-bottom:12px">📭 暂无数据</h3><p style="font-size:14px;color:#666">请先通过 Excel 导入数据。</p>';
  }
  // Hide all tab content first, then show empty message in main area
  document.querySelectorAll('.tab').forEach(function(t){t.style.display='none';});
  var ov=document.createElement('div');
  ov.className='empty-overlay';
  ov.style.cssText='display:flex;align-items:center;justify-content:center;padding:80px 20px;min-height:300px;text-align:center';
  ov.innerHTML='<div>'+msg+'</div>';
  var main=document.querySelector('.main');
  if(main)main.appendChild(ov);
}

// ── Sort handler for branches table ──
var __allFields=false;
function toggleAllFields(){
  __allFields=!__allFields;
  if(__allFields)renderAllBranches();
  else renderBranches();
}

// 预警圆点渲染 — 全国 KPI 卡片，匹配 data-field，圆点跟在数值后面
function renderAlertDots() {
  if (App.isCompareMode) return;
  var results = (App._alertResults || []).filter(function(r) { return !r.branchName && !r.regionName; });
  // 同一指标可能有多条规则命中，取最严重级别
  var fieldSeverity = {};
  results.forEach(function(r) {
    var s = r.severity === 'error' ? 3 : (r.severity === 'warn' ? 2 : 1);
    if (!fieldSeverity[r.field] || s > fieldSeverity[r.field].s) {
      fieldSeverity[r.field] = { s: s, severity: r.severity, msg: r.msg };
    }
  });
  var cards = document.querySelectorAll('#overview-kpi .kpi-card');
  cards.forEach(function(card) {
    var fk = card.getAttribute('data-field');
    if (!fk) return;
    var info = fieldSeverity[fk];
    if (!info) return;
    var kv = card.querySelector('.kv');
    if (!kv) return;
    var dot = card.querySelector('.alert-dot');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'alert-dot';
      dot.style.cssText = 'display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:6px;vertical-align:middle;cursor:default';
      kv.appendChild(dot);
    }
    dot.style.background = info.severity === 'error' ? '#dc2626' : (info.severity === 'warn' ? '#d97706' : '#2563eb');
    dot.title = info.msg;
  });
}

// 分公司表格预警标记 — 在 renderBranches 之后调用
function renderBranchAlertMarks() {
  if (App.isCompareMode) return;
  var results = App._alertResults || [];
  if (results.length === 0) return;
  
  // (branch, field) => worst severity
  var map = {};
  var branchCounts = {};
  results.forEach(function(r) {
    if (!r.branchName) return;
    var k = r.branchName + '|' + r.field;
    var s = r.severity === 'error' ? 3 : (r.severity === 'warn' ? 2 : 1);
    if (!map[k] || s > map[k].s) map[k] = { s: s, severity: r.severity, msg: r.msg };
    if (!branchCounts[r.branchName]) branchCounts[r.branchName] = {};
    branchCounts[r.branchName][r.field] = true;
  });
  
  var rows = document.querySelectorAll('#branches-table tbody tr');
  rows.forEach(function(row) {
    // Get branch name from data-fname attribute
    var nameCell = row.querySelector('td[data-fname]');
    if (!nameCell) return;
    var bn = (nameCell.textContent || '').replace(/\*\*/g, '').trim();
    
    // Badge on branch name
    var count = branchCounts[bn] ? Object.keys(branchCounts[bn]).length : 0;
    if (count > 0) {
      var hasError = results.some(function(r) { return r.branchName === bn && r.severity === 'error'; });
      var hasWarn = results.some(function(r) { return r.branchName === bn && r.severity === 'warn'; });
      var bg = hasError ? '#dc2626' : (hasWarn ? '#d97706' : '#2563eb');
      var badge = document.createElement('span');
      badge.style.cssText = 'display:inline-block;background:' + bg + ';color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:6px;vertical-align:middle;cursor:default';
      badge.textContent = count;
      nameCell.appendChild(badge);
    }
    
    // Per-cell dots — match by data-field attribute
    var cells = row.querySelectorAll('td.num[data-field]');
    cells.forEach(function(cell) {
      var fk = cell.getAttribute('data-field');
      if (!fk) return;
      var info = map[bn + '|' + fk];
      if (!info) return;
      // Remove existing dot to avoid duplicates
      var exist = cell.querySelector('.alert-dot');
      if (exist) exist.remove();
      var dot = document.createElement('span');
      dot.className = 'alert-dot';
      dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:4px;vertical-align:middle;cursor:default;background:' + (info.severity === 'error' ? '#dc2626' : (info.severity === 'warn' ? '#d97706' : '#2563eb'));
      dot.title = info.msg;
      cell.appendChild(dot);
      var ac = App.ALERT_COLORS[info.severity] || App.ALERT_COLORS.info;
      cell.style.background = ac.bg;
    });
  });
}

// 责任区视图预警标记 — 在 renderRegions 之后调用
function renderRegionAlertMarks() {
  if (App.isCompareMode) return;
  var results = (App._alertResults || []).filter(function(r) { return r.regionName; });
  if (results.length === 0) return;
  
  // (region, fieldKey) => worst severity
  var map = {};
  var regionCounts = {};
  results.forEach(function(r) {
    var k = r.regionName + '|' + r.field;
    var s = r.severity === 'error' ? 3 : (r.severity === 'warn' ? 2 : 1);
    if (!map[k] || s > map[k].s) map[k] = { s: s, severity: r.severity, msg: r.msg };
    if (!regionCounts[r.regionName]) regionCounts[r.regionName] = {};
    regionCounts[r.regionName][r.field] = true;
  });
  
  // Helper: add badge to element
  function addBadge(el, rn) {
    var count = regionCounts[rn] ? Object.keys(regionCounts[rn]).length : 0;
    if (count === 0) return;
    var hasError = results.some(function(r) { return r.regionName === rn && r.severity === 'error'; });
    var hasWarn = results.some(function(r) { return r.regionName === rn && r.severity === 'warn'; });
    var bg = hasError ? '#dc2626' : (hasWarn ? '#d97706' : '#2563eb');
    var badge = document.createElement('span');
    badge.style.cssText = 'display:inline-block;background:' + bg + ';color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:6px;vertical-align:middle;cursor:default';
    badge.textContent = count;
    el.appendChild(badge);
  }
  
  // Helper: add dot after value element
  function addDot(valEl, rn, fk) {
    var info = map[rn + '|' + fk];
    if (!info) return;
    var exist = valEl.parentElement ? valEl.parentElement.querySelector('.alert-dot') : null;
    if (exist) exist.remove();
    var dot = document.createElement('span');
    dot.className = 'alert-dot';
    dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:4px;vertical-align:middle;cursor:default;background:' + (info.severity === 'error' ? '#dc2626' : (info.severity === 'warn' ? '#d97706' : '#2563eb'));
    dot.title = info.msg;
    valEl.appendChild(dot);
  }
  
  // 1. Region KPI cards — badge on header + dots on metric values
  var cards = document.querySelectorAll('#regions-kpi .region-card');
  cards.forEach(function(card) {
    var h4 = card.querySelector('h4');
    if (!h4) return;
    var rn = h4.textContent.trim();
    addBadge(h4, rn);
    var metrics = card.querySelectorAll('.metric');
    metrics.forEach(function(metric) {
      var fk = metric.getAttribute('data-field');
      if (!fk) return;
      var mv = metric.querySelector('.mv');
      if (mv) { addDot(mv, rn, fk); var info2 = map[rn + '|' + fk]; if (info2) { var ac = App.ALERT_COLORS[info2.severity] || App.ALERT_COLORS.info; metric.style.background = ac.bg; metric.style.borderLeft = '3px solid ' + (ac.border || ac.color); metric.style.borderRadius = '4px'; metric.style.paddingLeft = '6px'; } }
    });
  });
  
  // 2. Key metrics table — count badge in header + dots in cells
  var tables = document.querySelectorAll('#regions-key-table table');
  tables.forEach(function(table) {
    // Headers: add count badge
    var ths = table.querySelectorAll('thead th[data-rname]');
    ths.forEach(function(th) {
      var rn = th.getAttribute('data-rname');
      if (rn) addBadge(th, rn);
    });
    // Cells: add dots by data-field
    var rows = table.querySelectorAll('tbody tr');
    rows.forEach(function(row) {
      var cells = row.querySelectorAll('td.num[data-field]');
      cells.forEach(function(cell) {
        var fk = cell.getAttribute('data-field');
        if (!fk) return;
        // Find which region this cell belongs to (column index - 2 for label+unit)
        var colIdx = Array.prototype.indexOf.call(cell.parentElement.children, cell) - 2;
        var rn = App.REGIONS[colIdx];
        if (!rn) return;
        var info = map[rn + '|' + fk];
        if (!info) return;
        var exist = cell.querySelector('.alert-dot');
        if (exist) exist.remove();
        var dot = document.createElement('span');
        dot.className = 'alert-dot';
        dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:4px;vertical-align:middle;cursor:default;background:' + (info.severity === 'error' ? '#dc2626' : (info.severity === 'warn' ? '#d97706' : '#2563eb'));
        dot.title = info.msg;
        cell.appendChild(dot);
        var ac = App.ALERT_COLORS[info.severity] || App.ALERT_COLORS.info;
        cell.style.background = ac.bg;
      });
    });
  });
}


// Fix sticky column offsets based on actual measured widths
function fixStickyColumns(tbl){
  if(!tbl)return;
  tbl.style.tableLayout='';
  var rows=tbl.querySelectorAll('tr');
  if(rows.length<2)return;
  var s0=rows[0].querySelector('.s0');
  var s1=rows[0].querySelector('.s1');
  var s2=rows[0].querySelector('.s2');
  if(!s0||!s1)return;
  void s0.offsetHeight;
  var w0=s0.offsetWidth||30;
  var w1=s1.offsetWidth||60;
  var w2=s2?s2.offsetWidth||90:0;
  var left1=w0; var left2=w0+w1;
  rows.forEach(function(row){
    var c0=row.querySelector('.s0');
    var c1=row.querySelector('.s1');
    var c2=row.querySelector('.s2');
    if(c0){c0.style.position='sticky';c0.style.left='0';c0.style.background=(c0.tagName==='TH'?'#f0f4ff':'var(--card)');c0.style.zIndex=(c0.tagName==='TH'?'12':'8');if(c0.tagName==='TH')c0.style.top='0';}
    if(c1){c1.style.position='sticky';c1.style.left=left1+'px';c1.style.background=(c1.tagName==='TH'?'#f0f4ff':'var(--card)');c1.style.zIndex=(c1.tagName==='TH'?'11':'7');if(c1.tagName==='TH')c1.style.top='0';}
    if(c2){c2.style.position='sticky';c2.style.left=left2+'px';c2.style.background=(c2.tagName==='TH'?'#f0f4ff':'var(--card)');c2.style.zIndex=(c2.tagName==='TH'?'11':'7');if(c2.tagName==='TH')c2.style.top='0';}
    var lastFrozen=c2||c1;
    if(lastFrozen)lastFrozen.style.boxShadow='4px 0 8px rgba(0,0,0,.08)';
  });
}

function sortBranches(fk){
  var tbl=document.getElementById('branches-table');
  var cur=tbl.dataset.sortCol||'';
  var dir=tbl.dataset.sortDir||'';
  if(cur===fk){dir=dir==='asc'?'desc':'asc';}
  else{dir='desc';}
  tbl.dataset.sortCol=fk;
  tbl.dataset.sortDir=dir;
  if(__allFields)renderAllBranches();
  else renderBranches();
  if(App.isCompareMode&&typeof applyCompareMode==='function')applyCompareMode();
}
