(function(){
'use strict';

var CALC_VERSION='browser-ai-query-v1';

function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function hash(value){
  var text=JSON.stringify(value), h=2166136261;
  for(var i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16);
}

function app(){return window.App||{};}
function allData(){return app().ALL_DATA||{};}
function fields(){return app().FIELDS||[];}
function currentMonth(){return app().currentMonth||allData().currentMonth||'';}
function isShare(){return !!app().shareMode;}

function monthSort(list){
  return Array.from(new Set((list||[]).filter(Boolean))).sort();
}

function periods(){
  var data=allData(), keys=[];
  ['actuals','_merged'].forEach(function(bucket){
    Object.keys(data[bucket]||{}).forEach(function(k){keys.push(k);});
  });
  return monthSort(keys);
}

function normalizeMetric(f){
  if(!f)return null;
  return {metric:f.k,label:f.l||f.k,group:f.g||'',unit:f.u||'',direction:f.rd||'',core:!!f.c};
}

function metricMeta(metric){
  if(!metric)return null;
  var found=fields().find(function(f){return f.k===metric||f.l===metric;})||
    fields().find(function(f){
      var q=String(metric), k=String(f.k||''), l=String(f.l||'');
      return (k&&(q.indexOf(k)>=0||k.indexOf(q)>=0))||(l&&(q.indexOf(l)>=0||l.indexOf(q)>=0));
    });
  return normalizeMetric(found);
}

function allMetrics(){
  return fields().map(normalizeMetric).filter(Boolean);
}

function metricInText(text,m){
  text=String(text||'');
  var isPlanAsk=/计划|预算/.test(text), mk=String(m.metric||''), ml=String(m.label||'');
  return text.indexOf(m.metric)>=0||text.indexOf(m.label)>=0||
    mk.indexOf(text)>=0||ml.indexOf(text)>=0||
    (isPlanAsk&&isAnnualPlanMetric(m)&&text.indexOf('保费')>=0&&(mk.indexOf('保费年度计划')>=0||ml.indexOf('保费年度计划')>=0))||
    (isPlanAsk&&isAnnualPlanMetric(m)&&text.indexOf('经营利润')>=0&&(mk.indexOf('经营利润年度计划')>=0||ml.indexOf('利润年度计划')>=0))||
    (m.label.indexOf('综合成本率')>=0&&text.indexOf('综合成本率')>=0)||
    (m.label.indexOf('赔付率')>=0&&text.indexOf('赔付率')>=0)||
    (m.label.indexOf('费用率')>=0&&text.indexOf('费用率')>=0);
}

function isAnnualPlanMetric(meta){
  var name=(meta&&((meta.metric||'')+' '+(meta.label||'')))||'';
  return /计划|预算|年度计划/.test(name)&&!/达成率|执行率|与本年计划比较|差/.test(name);
}

function preferredMetrics(){
  var names=[
    '保费实际合计','时间进度计划达成率','经营利润','当月经营利润','时间进度达成率',
    '综合成本率实际（整体利润口径）','已赚赔付率实际','已赚费用率实际',
    '整体人均产能实际','整体人均利润实际','整体人力成本保费率实际',
    '前台人均产能实际','后台人均产能实际','整体人员实际'
  ];
  var result=[];
  names.forEach(function(name){
    var m=metricMeta(name);
    if(m&&!result.some(function(x){return x.metric===m.metric;}))result.push(m);
  });
  allMetrics().filter(function(m){return m.core;}).forEach(function(m){
    if(!result.some(function(x){return x.metric===m.metric;}))result.push(m);
  });
  return result;
}

function monthData(period){
  var data=allData(), merged=data._merged&&data._merged[period];
  if(merged)return merged;
  if(typeof window.computeMonthData==='function'){
    try{return window.computeMonthData(period)||null;}catch(e){}
  }
  return data.actuals&&data.actuals[period]||null;
}

function orgsForPeriod(period){
  var md=monthData(period)||{}, result=[];
  if(!isShare()&&md.national&&Object.keys(md.national).length){
    result.push({id:'national',name:'全国',level:'national',period:period});
  }
  if(!isShare()){
    Object.keys(md.regions||{}).forEach(function(name){
      result.push({id:'region:'+name,name:name,level:'region',period:period});
    });
  }
  (md.branches||[]).forEach(function(b){
    result.push({id:b.orgId||b.n,name:b.n,orgId:b.orgId||'',region:b.r||'',level:'branch',period:period});
  });
  return result;
}

function allOrganizations(){
  var map={};
  periods().forEach(function(p){
    orgsForPeriod(p).forEach(function(o){
      map[o.level+'|'+o.name]=Object.assign({},map[o.level+'|'+o.name]||{},o,{period:null});
    });
  });
  return Object.keys(map).sort().map(function(k){return map[k];});
}

function findOrg(name, period){
  var orgs=orgsForPeriod(period||currentMonth());
  if(!name)return orgs.find(function(o){return o.level==='national';})||orgs[0]||null;
  return orgs.find(function(o){return o.name===name||o.id===name||o.orgId===name;})||
    orgs.find(function(o){return o.name&&String(name).indexOf(o.name)>=0;})||null;
}

function recordFor(org, period){
  var md=monthData(period)||{};
  if(!org)return null;
  if(org.level==='national')return md.national||null;
  if(org.level==='region')return (md.regions||{})[org.name]||null;
  var branch=(md.branches||[]).find(function(b){return b.n===org.name||b.orgId===org.orgId;});
  return branch&&(branch.d||branch)||null;
}

function numberValue(v){
  var n=Number(v);
  return isFinite(n)?n:null;
}

function formatValue(v, unit){
  var n=numberValue(v);
  if(n==null)return '无数据';
  if(unit==='%')return (n*100).toFixed(2)+'%';
  if(unit==='人')return n.toFixed(0)+'人';
  if(unit==='万元/人')return n.toFixed(2)+'万元/人';
  if(unit)return n.toFixed(2)+unit;
  return n.toFixed(2);
}

function evidenceId(parts){return 'ev_'+hash(parts);}

function evidence(org, period, meta, value, source){
  return {
    id:evidenceId([org&&org.name,period,meta&&meta.metric,value,source]),
    org:org&&org.name||'',
    orgId:org&&org.orgId||org&&org.id||'',
    orgLevel:org&&org.level||'',
    period:period,
    metric:meta&&meta.metric||'',
    label:meta&&meta.label||meta&&meta.metric||'',
    value:value,
    formattedValue:formatValue(value,meta&&meta.unit||''),
    unit:meta&&meta.unit||'',
    direction:meta&&meta.direction||'',
    source:source||'dashboard',
    basis:isAnnualPlanMetric(meta)?'annual_plan':'period_metric',
    basisLabel:isAnnualPlanMetric(meta)?'年度计划口径，年内各月一致':'按所选月份数据口径',
    calculationVersion:CALC_VERSION
  };
}

function getMetricSnapshot(args){
  args=args||{};
  var period=args.period||currentMonth(), org=findOrg(args.org||args.orgName||args.orgId,period);
  var meta=metricMeta(args.metric||args.metricId||args.metricName);
  if(!org||!meta)return {tool:'getMetricSnapshot',ok:false,limitations:['机构或指标不存在：'+(args.org||args.orgName||args.orgId||'未指定')+' / '+(args.metric||args.metricId||args.metricName||'未指定')],evidence:[]};
  var rec=recordFor(org,period), value=rec?rec[meta.metric]:null;
  if(numberValue(value)==null)return {tool:'getMetricSnapshot',ok:false,period:period,org:org,metric:meta,limitations:[(org.name||args.org||'该机构')+' '+period+' '+meta.label+'没有有效数据'],evidence:[]};
  var ev=evidence(org,period,meta,value,'metric_snapshot');
  return {tool:'getMetricSnapshot',ok:true,period:period,org:org,metric:meta,value:value,formattedValue:ev.formattedValue,basis:ev.basis,basisLabel:ev.basisLabel,evidence:[ev],limitations:[]};
}

function getTrendSeries(args){
  args=args||{};
  var meta=metricMeta(args.metric||args.metricId||args.metricName);
  var ps=args.periods&&args.periods.length?args.periods:periods();
  var rows=[], evs=[];
  ps.forEach(function(p){
    var org=findOrg(args.org||args.orgName||args.orgId,p);
    if(!org||!meta)return;
    var rec=recordFor(org,p), value=rec?rec[meta.metric]:null;
    if(numberValue(value)!=null){
      var ev=evidence(org,p,meta,value,'trend_series');
      rows.push({period:p,value:value,formattedValue:ev.formattedValue,evidenceId:ev.id});
      evs.push(ev);
    }
  });
  return {tool:'getTrendSeries',ok:rows.length>0,org:args.org||args.orgName||'',metric:meta,series:rows,evidence:evs,limitations:rows.length?[]:['没有可用趋势数据']};
}

function previousMonthSameYear(period){
  var m=String(period||'').match(/^(\d{4})-(\d{2})$/);if(!m)return null;
  var month=Number(m[2]);if(month<=1)return null;
  return m[1]+'-'+String(month-1).padStart(2,'0');
}

function previousYearSameMonth(period){
  var m=String(period||'').match(/^(\d{4})-(\d{2})$/);if(!m)return null;
  return (Number(m[1])-1)+'-'+m[2];
}

function compare(kind,args){
  args=args||{};
  var period=args.period||currentMonth();
  var other=kind==='mom'?previousMonthSameYear(period):previousYearSameMonth(period);
  var cur=getMetricSnapshot(args), prev=other?getMetricSnapshot(Object.assign({},args,{period:other})):null;
  var limitations=[];
  if(!other)limitations.push(kind==='mom'?'环比只比较同一年相邻月份，当前月份没有同年上月。':'同比需要去年同月数据。');
  if(!cur.ok)limitations=limitations.concat(cur.limitations||[]);
  if(!prev||!prev.ok)limitations.push('对比期没有有效数据。');
  var diff=(cur&&cur.ok&&prev&&prev.ok)?cur.value-prev.value:null;
  return {tool:kind==='mom'?'compareMoM':'compareYoY',ok:diff!=null,current:cur,previous:prev,difference:diff,evidence:[].concat(cur&&cur.evidence||[],prev&&prev.evidence||[]),limitations:limitations};
}

function rankBranches(args){
  args=args||{};
  var period=args.period||currentMonth(), meta=metricMeta(args.metric||args.metricId||args.metricName);
  if(!meta)return {tool:'rankBranches',ok:false,limitations:['指标不存在'],evidence:[]};
  var md=monthData(period)||{}, rows=[], evs=[];
  (md.branches||[]).forEach(function(b){
    var value=numberValue((b.d||b)[meta.metric]);
    if(value==null)return;
    var org={id:b.orgId||b.n,orgId:b.orgId||'',name:b.n,region:b.r||'',level:'branch'};
    var ev=evidence(org,period,meta,value,'branch_ranking');
    rows.push({org:b.n,orgId:b.orgId||'',region:b.r||'',value:value,formattedValue:ev.formattedValue,evidenceId:ev.id});
    evs.push(ev);
  });
  rows.sort(function(a,b){return meta.direction==='asc'?a.value-b.value:b.value-a.value;});
  rows.forEach(function(r,i){r.rank=i+1;r.total=rows.length;});
  return {tool:'rankBranches',ok:rows.length>0,period:period,metric:meta,rows:rows,top:rows.slice(0,args.limit||5),bottom:rows.slice(-(args.limit||5)),evidence:evs,limitations:rows.length?[]:['没有可排名的分公司数据']};
}

function getEvidence(args){
  args=args||{};
  var evs=[];
  (args.metrics||[]).forEach(function(metric){
    var s=getMetricSnapshot({org:args.org,period:args.period,metric:metric});
    evs=evs.concat(s.evidence||[]);
  });
  return {tool:'getEvidence',ok:evs.length>0,evidence:evs,limitations:evs.length?[]:['没有匹配证据']};
}

function hasDiagnosisIndex(){
  return !!(window.DiagnosisIndex&&typeof window.DiagnosisIndex.build==='function');
}

function ensureDiagnosisIndex(period){
  if(!hasDiagnosisIndex())return false;
  try{
    window.DiagnosisIndex.build();
    if(period&&typeof window.DiagnosisIndex.list==='function')window.DiagnosisIndex.list(period);
    return true;
  }catch(e){
    return false;
  }
}

function normalizeDiagnosisEvidence(item, source){
  item=item||{};
  return {
    id:item.id||evidenceId([item.orgName,item.period,item.metricKey,item.currentValue,item.ruleId,source||'diagnosis']),
    org:item.orgName||item.org||'',
    orgId:item.orgId||'',
    orgLevel:'branch',
    period:item.period||'',
    metric:item.metricKey||item.metric||item.metricId||'',
    metricId:item.metricId||item.metricKey||'',
    label:item.metricLabel||item.label||item.metricKey||item.metricId||'',
    value:item.currentValue!=null?item.currentValue:item.value,
    formattedValue:item.formattedValue||formatValue(item.currentValue!=null?item.currentValue:item.value,item.unit||''),
    benchmarkValue:item.benchmarkValue==null?null:item.benchmarkValue,
    differenceValue:item.differenceValue==null?null:item.differenceValue,
    unit:item.unit||'',
    severity:item.severity||null,
    ruleId:item.ruleId||null,
    source:item.source||source||'local_diagnosis',
    basis:'diagnosis_index',
    basisLabel:'本地智能经营诊断索引',
    calculationVersion:CALC_VERSION
  };
}

function diagnosisContextRecord(context){
  if(!context)return null;
  var orgName=context.orgName||context.branch||context.org||context.org_name||'';
  var period=context.period||currentMonth();
  var evidenceMetrics=(context.evidenceMetrics||context.evidence||[]).map(function(item){
    return {
      id:item.id,
      orgName:orgName,
      period:period,
      metricKey:item.metricKey||item.metric||item.field||item.metricId||item.metric_id||'',
      metricId:item.metricId||item.metric_id||item.metricKey||item.metric||item.field||'',
      metricLabel:item.metricLabel||item.label||item.fieldLabel||item.metric||item.metricId||item.metric_id||'',
      currentValue:item.currentValue!=null?item.currentValue:item.current_value,
      formattedValue:item.formattedValue||item.formatted_value,
      benchmarkValue:item.benchmarkValue!=null?item.benchmarkValue:item.benchmark_value,
      differenceValue:item.differenceValue!=null?item.differenceValue:item.difference_value,
      unit:item.unit||'',
      severity:item.severity||null,
      ruleId:item.ruleId||item.rule_id||null,
      source:item.source||'diagnosis_context'
    };
  });
  var triggeredMetrics=(context.triggeredMetrics||[]).slice();
  if(!triggeredMetrics.length){
    (context.riskFactors||[]).forEach(function(item){
      var metric=item.metric||item.metricKey||item.metricId;
      if(metric&&triggeredMetrics.indexOf(metric)<0)triggeredMetrics.push(metric);
    });
    (context.facts||[]).forEach(function(item){
      var metric=item.metric||item.metricKey||item.metricId;
      if((item.isRiskMetric||item.isAttention)&&metric&&triggeredMetrics.indexOf(metric)<0)triggeredMetrics.push(metric);
    });
  }
  var triggeredAlerts=(context.triggeredAlerts||[]).slice();
  if(!triggeredAlerts.length){
    triggeredAlerts=(context.riskFactors||[]).map(function(item){
      return {
        ruleId:item.ruleId||item.rule_id||null,
        severity:item.severity||null,
        field:item.metric||item.metricKey||item.metricId||'',
        fieldLabel:item.metricLabel||item.label||item.metric||item.metricKey||item.metricId||'',
        msg:item.message||item.text||'诊断风险因子'
      };
    });
  }
  return {
    orgName:orgName,
    orgId:context.orgId||context.org_id||'',
    orgType:context.orgType||'branch',
    region:context.region||null,
    period:period,
    riskLevel:context.riskLevel||'',
    riskScore:context.riskScore!=null?context.riskScore:context.score,
    summary:context.summary||'',
    triggeredAlerts:triggeredAlerts,
    triggeredMetrics:triggeredMetrics,
    facts:(context.facts||[]).slice(),
    patterns:(context.patterns||[]).slice(),
    inferences:(context.inferences||[]).slice(),
    recommendations:(context.recommendations||[]).slice(),
    evidenceMetrics:evidenceMetrics,
    source:'diagnosis_context',
    calculationVersion:context.calculationVersion||CALC_VERSION
  };
}

function diagnosisRecord(args){
  args=args||{};
  var period=args.period||currentMonth();
  var org=args.org||args.orgName||args.orgId;
  var contextRecord=diagnosisContextRecord(args.diagnosisContext);
  if(contextRecord){
    var contextOrg=contextRecord.orgName||contextRecord.orgId;
    var orgMatches=!org||org===contextOrg||org===contextRecord.orgName||org===contextRecord.orgId;
    var periodMatches=!period||!contextRecord.period||period===contextRecord.period;
    if(orgMatches&&periodMatches)return contextRecord;
  }
  if(!ensureDiagnosisIndex(period))return null;
  if(!org)return null;
  try{
    if(typeof window.DiagnosisIndex.get==='function')return window.DiagnosisIndex.get(org,period);
  }catch(e){}
  return null;
}

function getDiagnosisSummary(args){
  args=args||{};
  var period=args.period||currentMonth(), org=args.org||args.orgName||args.orgId||'';
  var record=diagnosisRecord(args);
  if(!record)return {tool:'getDiagnosisSummary',ok:false,org:org,period:period,limitations:[hasDiagnosisIndex()?'未找到该机构诊断索引记录':'DiagnosisIndex 未加载'],evidence:[]};
  var evs=(record.evidenceMetrics||[]).slice(0,8).map(function(item){return normalizeDiagnosisEvidence(item,'diagnosis_summary');});
  return {
    tool:'getDiagnosisSummary',
    ok:true,
    org:record.orgName||org,
    orgId:record.orgId||'',
    period:record.period||period,
    riskLevel:record.riskLevel||'',
    riskScore:record.riskScore,
    summary:record.summary||'',
    triggeredMetrics:(record.triggeredMetrics||[]).slice(),
    recommendations:(record.recommendations||[]).slice(0,5),
    facts:(record.facts||[]).slice(0,8),
    patterns:(record.patterns||[]).slice(0,6),
    inferences:(record.inferences||[]).slice(0,6),
    evidence:evs,
    limitations:[]
  };
}

function getDiagnosisEvidence(args){
  args=args||{};
  var period=args.period||currentMonth(), org=args.org||args.orgName||args.orgId||'';
  var record=diagnosisRecord(args);
  if(record){
    var recordEvs=(record.evidenceMetrics||[]).map(function(item){return normalizeDiagnosisEvidence(item,'diagnosis_evidence');});
    return {tool:'getDiagnosisEvidence',ok:recordEvs.length>0,org:record.orgName||org,period:record.period||period,evidence:recordEvs,limitations:recordEvs.length?[]:['没有匹配的诊断证据']};
  }
  if(!ensureDiagnosisIndex(period))return {tool:'getDiagnosisEvidence',ok:false,org:org,period:period,limitations:['DiagnosisIndex 未加载'],evidence:[]};
  var items=[];
  try{
    items=typeof window.DiagnosisIndex.getEvidence==='function'?window.DiagnosisIndex.getEvidence(org,period):[];
  }catch(e){items=[];}
  var evs=(items||[]).map(function(item){return normalizeDiagnosisEvidence(item,'diagnosis_evidence');});
  return {tool:'getDiagnosisEvidence',ok:evs.length>0,org:org,period:period,evidence:evs,limitations:evs.length?[]:['没有匹配的诊断证据']};
}

function getTriggeredAlerts(args){
  args=args||{};
  var period=args.period||currentMonth(), org=args.org||args.orgName||args.orgId||'';
  var record=diagnosisRecord(args);
  if(!record)return {tool:'getTriggeredAlerts',ok:false,org:org,period:period,triggeredAlerts:[],evidence:[],limitations:[hasDiagnosisIndex()?'未找到该机构预警记录':'DiagnosisIndex 未加载']};
  var alerts=(record.triggeredAlerts||[]).slice();
  var evs=(record.evidenceMetrics||[]).filter(function(item){return item.ruleId;}).map(function(item){return normalizeDiagnosisEvidence(item,'diagnosis_alert');});
  return {tool:'getTriggeredAlerts',ok:true,org:record.orgName||org,period:record.period||period,riskLevel:record.riskLevel,triggeredAlerts:alerts,triggeredMetrics:(record.triggeredMetrics||[]).slice(),evidence:evs,limitations:[]};
}

function getRecommendations(args){
  args=args||{};
  var period=args.period||currentMonth(), org=args.org||args.orgName||args.orgId||'';
  var record=diagnosisRecord(args);
  if(!record)return {tool:'getRecommendations',ok:false,org:org,period:period,recommendations:[],evidence:[],limitations:[hasDiagnosisIndex()?'未找到该机构建议记录':'DiagnosisIndex 未加载']};
  var evs=(record.evidenceMetrics||[]).slice(0,8).map(function(item){return normalizeDiagnosisEvidence(item,'diagnosis_recommendation');});
  return {tool:'getRecommendations',ok:true,org:record.orgName||org,period:record.period||period,riskLevel:record.riskLevel,recommendations:(record.recommendations||[]).slice(),evidence:evs,limitations:[]};
}

function shouldUseDiagnosis(goal,options){
  options=options||{};
  if(!hasDiagnosisIndex())return false;
  if(options.useDiagnosis===true)return true;
  if(options.mode==='deep')return true;
  return /诊断|风险|预警|异常|原因|为什么|建议|整改|依据|diagnosis|risk|alert|why|recommend/i.test(String(goal&&goal.question||''));
}

function parseGoal(question){
  question=String(question||'');
  var ps=question.match(/20\d{2}-\d{2}/g)||[];
  question.replace(/(20\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*(?:月|月份)/g,function(_,year,month){
    var p=year+'-'+String(Number(month)).padStart(2,'0');
    if(ps.indexOf(p)<0)ps.push(p);
    return _;
  });
  var years=(question.match(/20\d{2}(?=\s*年)/g)||[]).filter(function(y){return !ps.some(function(p){return p.indexOf(y+'-')===0;});});
  if(!ps.length&&years.length){
    var yearPeriods=periods().filter(function(p){return p.indexOf(years[0]+'-')===0;});
    ps=yearPeriods.length?yearPeriods:[years[0]+'-12'];
  }
  var orgMatches=allOrganizations().filter(function(o){return o.name&&question.indexOf(o.name)>=0;});
  var metricMatches=allMetrics().filter(function(m){return metricInText(question,m);});
  if(/计划|预算/.test(question)){
    var planMatches=metricMatches.filter(isAnnualPlanMetric);
    if(planMatches.length)metricMatches=planMatches;
  }
  if(!metricMatches.length)metricMatches=allMetrics().filter(function(m){return m.core;}).slice(0,6);
  var task='snapshot';
  if(/趋势|变化|走势|连续/.test(question))task='trend';
  if(/排名|最高|最低|top|bottom|前|名/i.test(question))task='rank';
  if(/环比/.test(question))task='mom';
  if(/同比/.test(question))task='yoy';
  if(/建议|原因|为什么|诊断|风险|异常|分析/.test(question))task='diagnosis';
  return {
    question:question,
    years:years,
    yearOnly:years.length>0&&!(question.match(/20\d{2}-\d{2}/g)||[]).length,
    periods:monthSort(ps.length?ps:[currentMonth()]).filter(Boolean),
    orgs:orgMatches.length?orgMatches:[],
    metrics:metricMatches,
    taskType:task
  };
}

function diagnoseOrg(args){
  args=args||{};
  var period=args.period||currentMonth(), org=args.org||args.orgName;
  var facts=[], risks=[], recommendations=[], evs=[], limitations=[];
  var metrics=(args.metrics&&args.metrics.length?args.metrics:allMetrics().filter(function(m){return m.core;}).slice(0,8));
  metrics.forEach(function(m){
    var s=getMetricSnapshot({org:org,period:period,metric:m.metric});
    if(!s.ok){limitations=limitations.concat(s.limitations||[]);return;}
    evs=evs.concat(s.evidence);
    facts.push({text:(s.org.name||org)+' '+period+' '+m.label+'为'+s.formattedValue,evidenceIds:s.evidence.map(function(e){return e.id;})});
    if((m.direction==='asc'&&s.value>1)||(m.direction==='desc'&&s.value<0)){
      risks.push({text:m.label+'存在需要关注的异常信号。',evidenceIds:s.evidence.map(function(e){return e.id;})});
    }
  });
  if(facts.length){
    recommendations.push({text:'优先核查已触发预警或排名靠后的指标，明确责任角色、整改周期和目标值。',evidenceIds:evs.slice(0,3).map(function(e){return e.id;})});
  }
  return {tool:'diagnoseOrg',ok:facts.length>0,period:period,org:org,facts:facts,risks:risks,recommendations:recommendations,evidence:evs,limitations:Array.from(new Set(limitations))};
}

function buildEvidencePack(question,options){
  options=options||{};
  var goal=parseGoal(question||options.question||''), steps=[], evidence=[], limitations=[];
  var deep=options.mode==='deep'||/深度|诊断|分析|风险|建议/.test(goal.question||'');
  var useDiagnosis=shouldUseDiagnosis(goal,options);
  var orgNames=goal.orgs.map(function(o){return o.name;});
  if(options.org&&!orgNames.length)orgNames=[options.org];
  if(!orgNames.length&&!isShare())orgNames=['全国'];
  if(!orgNames.length)orgNames=allOrganizations().filter(function(o){return o.level==='branch';}).slice(0,1).map(function(o){return o.name;});
  var metrics=deep?preferredMetrics():goal.metrics.slice(0,6);
  var metricKeys=metrics.map(function(m){return m.metric;});
  var selectedPeriods=options.period?[options.period]:(goal.periods&&goal.periods.length?goal.periods:[currentMonth()]);
  var period=goal.yearOnly?selectedPeriods[selectedPeriods.length-1]:selectedPeriods[0];
  var queryPeriodLabel=goal.yearOnly?(goal.years[0]+'年（按该年最新可用月份 '+period+' 回答）'):period;
  if(goal.yearOnly&&selectedPeriods.length===1&&selectedPeriods[0]===goal.years[0]+'-12'&&!periods().some(function(p){return p.indexOf(goal.years[0]+'-')===0;})){
    limitations.push('看板中没有加载 '+goal.years[0]+' 年的任何月份数据。');
  }
  if(goal.taskType==='rank'||!orgNames.length){
    metricKeys.slice(0,3).forEach(function(m){steps.push(rankBranches({period:period,metric:m,limit:5}));});
  }else{
    orgNames.slice(0,3).forEach(function(org){
      if(useDiagnosis){
        steps.push(getDiagnosisSummary({org:org,period:period,diagnosisContext:options.diagnosisContext}));
        steps.push(getTriggeredAlerts({org:org,period:period,diagnosisContext:options.diagnosisContext}));
        steps.push(getRecommendations({org:org,period:period,diagnosisContext:options.diagnosisContext}));
        steps.push(getDiagnosisEvidence({org:org,period:period,diagnosisContext:options.diagnosisContext}));
      }
      metricKeys.slice(0,deep?12:4).forEach(function(metric){steps.push(getMetricSnapshot({org:org,period:period,metric:metric}));});
      if(deep||['trend','diagnosis'].indexOf(goal.taskType)>=0)metricKeys.slice(0,deep?5:2).forEach(function(metric){steps.push(getTrendSeries({org:org,metric:metric}));});
      if(goal.taskType==='mom')metricKeys.slice(0,2).forEach(function(metric){steps.push(compare('mom',{org:org,period:period,metric:metric}));});
      if(goal.taskType==='yoy')metricKeys.slice(0,2).forEach(function(metric){steps.push(compare('yoy',{org:org,period:period,metric:metric}));});
      if(deep||goal.taskType==='diagnosis')steps.push(diagnoseOrg({org:org,period:period,metrics:metrics.slice(0,12)}));
      if(deep)metricKeys.slice(0,3).forEach(function(metric){steps.push(rankBranches({period:period,metric:metric,limit:5}));});
    });
  }
  steps=steps.slice(0,deep?24:6);
  steps.forEach(function(step){
    evidence=evidence.concat(step.evidence||[]);
    limitations=limitations.concat(step.limitations||[]);
  });
  var evMap={};
  evidence.forEach(function(ev){evMap[ev.id]=ev;});
  evidence=Object.keys(evMap).map(function(k){return evMap[k];});
  return {
    schemaVersion:'browser-ai-evidence-v1',
    question:question,
    parsedGoal:goal,
    mode:deep?'deep':'normal',
    queryPeriod:period,
    queryPeriodLabel:queryPeriodLabel,
    useDiagnosis:useDiagnosis,
    dataScope:{periods:periods(),currentPeriod:period,organizations:allOrganizations(),metrics:allMetrics()},
    steps:steps,
    evidence:evidence,
    limitations:Array.from(new Set(limitations)).filter(Boolean)
  };
}

function answerFromPack(pack){
  if(pack.mode==='deep')return deepAnswerFromPack(pack);
  var facts=[], analysis=[], recs=[], triggeredAlerts=[], diagnosisSummary=null, diagnosisRiskLevel=null;
  pack.steps.forEach(function(step){
    if(step.tool==='getMetricSnapshot'&&step.ok){
      var basis=step.basis==='annual_plan'?'（年度计划口径，年内各月一致）':'';
      facts.push(step.org.name+' '+step.period+' '+step.metric.label+'为'+step.formattedValue+basis+'。');
    }
    if(step.tool==='getTrendSeries'&&step.ok){
      var s=step.series;
      if(s.length>=2){
        var first=s[0], last=s[s.length-1], dir=last.value>first.value?'上升':(last.value<first.value?'下降':'基本持平');
        analysis.push((step.org||'该机构')+' '+step.metric.label+' 从'+first.period+'的'+first.formattedValue+'到'+last.period+'的'+last.formattedValue+'，整体'+dir+'。');
      }
    }
    if(step.tool==='rankBranches'&&step.ok){
      facts.push(step.period+' '+step.metric.label+'排名前列：'+step.top.map(function(r){return r.rank+'. '+r.org+' '+r.formattedValue;}).join('；')+'。');
    }
    if(step.tool==='diagnoseOrg'&&step.ok){
      analysis=analysis.concat((step.risks||[]).map(function(r){return r.text;}));
      recs=recs.concat((step.recommendations||[]).map(function(r){return r.text;}));
    }
    if(step.tool==='getDiagnosisSummary'&&step.ok){
      diagnosisRiskLevel=step.riskLevel||diagnosisRiskLevel;
      diagnosisSummary=step.org+' '+step.period+' 诊断结果：'+(step.riskLevel||'未分级')+'。'+(step.summary||'');
      facts.push(diagnosisSummary);
      if(step.triggeredMetrics&&step.triggeredMetrics.length)analysis.push('触发指标：'+step.triggeredMetrics.join('、')+'。');
      recs=recs.concat((step.recommendations||[]).map(function(item){return typeof item==='string'?item:(item.action||item.text||item.title||JSON.stringify(item));}));
    }
    if(step.tool==='getTriggeredAlerts'&&step.ok){
      triggeredAlerts=triggeredAlerts.concat(step.triggeredAlerts||[]);
      var alerts=(step.triggeredAlerts||[]).map(function(item){
        return (item.fieldLabel||item.field||'指标')+'：'+(item.msg||item.severity||'触发预警');
      });
      if(alerts.length)analysis.push(step.org+' 触发预警：'+alerts.slice(0,5).join('；')+'。');
      else analysis.push(step.org+' 当前没有触发预警。');
    }
    if(step.tool==='getRecommendations'&&step.ok){
      recs=recs.concat((step.recommendations||[]).map(function(item){return typeof item==='string'?item:(item.action||item.text||item.title||JSON.stringify(item));}));
    }
  });
  if(!facts.length)facts.push('当前问题没有匹配到足够的确定性数据。');
  if(!analysis.length)analysis.push('以上结论仅基于本次可查询到的看板数据，未使用外部业务资料。');
  if(!recs.length)recs.push('建议先补齐缺失月份或指标，再做进一步经营判断。');
  return {
    summary:diagnosisSummary||facts[0],
    facts:facts.slice(0,8),
    analysis:analysis.slice(0,8),
    recommendations:recs.slice(0,6),
    triggeredAlerts:triggeredAlerts.slice(0,20),
    riskLevel:diagnosisRiskLevel||undefined,
    limitations:pack.limitations,
    usedEvidence:pack.evidence.slice(0,12).map(function(e){return e.id;}),
    validation:{passed:true,unverifiedNumbers:[],mode:isShare()?'local-share':'local-fallback'}
  };
}

function stepSnapshots(pack){
  return (pack.steps||[]).filter(function(step){return step.tool==='getMetricSnapshot'&&step.ok;});
}

function snapshotByLabel(snaps, label){
  return snaps.find(function(s){return s.metric&&(s.metric.label===label||s.metric.metric===label);})||null;
}

function rateLevel(value, lowerBetter){
  if(value==null)return '无法判断';
  var pct=Math.abs(value)<=2?value*100:value;
  if(lowerBetter){
    if(pct>=100)return '压力较高';
    if(pct>=90)return '需重点关注';
    if(pct>=80)return '中等偏高';
    return '相对可控';
  }
  if(pct>=100)return '达成较好';
  if(pct>=80)return '接近目标';
  if(pct>=60)return '存在缺口';
  return '缺口较大';
}

function trendText(step){
  var s=step.series||[];
  if(s.length<2)return null;
  var first=s[0], last=s[s.length-1];
  var diff=last.value-first.value;
  var dir=diff>0?'上升':(diff<0?'下降':'基本持平');
  return step.metric.label+'从'+first.period+'的'+first.formattedValue+'到'+last.period+'的'+last.formattedValue+'，整体'+dir+'。';
}

function rankText(pack, metricLabel, orgName){
  var rank=(pack.steps||[]).find(function(step){return step.tool==='rankBranches'&&step.ok&&step.metric&&step.metric.label===metricLabel;});
  if(!rank)return null;
  var row=(rank.rows||[]).find(function(r){return r.org===orgName;});
  if(!row)return null;
  return metricLabel+'在分公司中排名第'+row.rank+'/'+row.total+'，数值为'+row.formattedValue+'。';
}

function deepAnswerFromPack(pack){
  var snaps=stepSnapshots(pack);
  var org=(snaps[0]&&snaps[0].org&&snaps[0].org.name)||((pack.parsedGoal&&pack.parsedGoal.orgs&&pack.parsedGoal.orgs[0]&&pack.parsedGoal.orgs[0].name)||'该机构');
  var period=(snaps[0]&&snaps[0].period)||((pack.parsedGoal&&pack.parsedGoal.periods&&pack.parsedGoal.periods[0])||currentMonth());
  var premium=snapshotByLabel(snaps,'保费实际合计');
  var premiumRate=snapshotByLabel(snaps,'时间进度计划达成率');
  var profit=snapshotByLabel(snaps,'经营利润');
  var profitRate=snapshotByLabel(snaps,'时间进度达成率');
  var cor=snapshotByLabel(snaps,'综合成本率实际（整体利润口径）');
  var loss=snapshotByLabel(snaps,'已赚赔付率实际');
  var expense=snapshotByLabel(snaps,'已赚费用率实际');
  var productivity=snapshotByLabel(snaps,'整体人均产能实际');
  var profitPerCapita=snapshotByLabel(snaps,'整体人均利润实际');
  var facts=[], analysis=[], recs=[], limitations=[];
  var diagnosisSummaries=(pack.steps||[]).filter(function(step){return step.tool==='getDiagnosisSummary'&&step.ok;});
  var diagnosisAlerts=(pack.steps||[]).filter(function(step){return step.tool==='getTriggeredAlerts'&&step.ok;});
  var diagnosisRecommendations=(pack.steps||[]).filter(function(step){return step.tool==='getRecommendations'&&step.ok;});
  var diagnosisRiskLevel=diagnosisSummaries[0]&&diagnosisSummaries[0].riskLevel;
  var diagnosisSummaryText=diagnosisSummaries[0]?(diagnosisSummaries[0].org+' '+diagnosisSummaries[0].period+' 诊断结果：'+(diagnosisSummaries[0].riskLevel||'未分级')+'。'+(diagnosisSummaries[0].summary||'')):null;
  diagnosisSummaries.forEach(function(step){
    facts.push(step.org+' '+step.period+' 诊断风险等级为'+(step.riskLevel||'未分级')+'，风险分为'+(step.riskScore==null?'未计算':step.riskScore)+'。');
    if(step.summary)analysis.push('诊断摘要：'+step.summary);
    if(step.triggeredMetrics&&step.triggeredMetrics.length)analysis.push('诊断触发指标：'+step.triggeredMetrics.join('、')+'。');
    (step.inferences||[]).slice(0,3).forEach(function(item){analysis.push(typeof item==='string'?item:(item.text||item.businessMeaning||JSON.stringify(item)));});
    (step.recommendations||[]).slice(0,3).forEach(function(item){recs.push(typeof item==='string'?item:(item.action||item.text||item.title||JSON.stringify(item)));});
  });
  diagnosisAlerts.forEach(function(step){
    var alerts=(step.triggeredAlerts||[]).map(function(item){
      return (item.fieldLabel||item.field||'指标')+'：'+(item.msg||item.severity||'触发预警');
    });
    if(alerts.length)analysis.push('预警明细：'+alerts.slice(0,6).join('；')+'。');
    else analysis.push((step.org||org)+' 当前未触发规则预警。');
  });
  diagnosisRecommendations.forEach(function(step){
    (step.recommendations||[]).slice(0,5).forEach(function(item){recs.push(typeof item==='string'?item:(item.action||item.text||item.title||JSON.stringify(item)));});
  });
  [premium,premiumRate,profit,profitRate,cor,loss,expense,productivity,profitPerCapita].filter(Boolean).forEach(function(s){
    var basis=s.basis==='annual_plan'?'（年度计划口径，年内各月一致）':'';
    facts.push(org+' '+period+' '+s.metric.label+'为'+s.formattedValue+basis+'。');
  });
  if(premiumRate)analysis.push('保费进度判断：'+rateLevel(premiumRate.value,false)+'，当前达成率为'+premiumRate.formattedValue+'。');
  if(profit)analysis.push('利润表现判断：经营利润为'+profit.formattedValue+'，'+(profit.value>=0?'当前仍为正贡献。':'当前为亏损，需要优先核查承保质量、赔付和费用结构。'));
  if(profitRate)analysis.push('利润进度判断：'+rateLevel(profitRate.value,false)+'，当前利润进度为'+profitRate.formattedValue+'。');
  if(cor)analysis.push('成本率判断：综合成本率为'+cor.formattedValue+'，'+rateLevel(cor.value,true)+'。');
  if(loss||expense)analysis.push('结构拆解：'+(loss?'赔付率为'+loss.formattedValue+'；':'赔付率缺少有效数据；')+(expense?'费用率为'+expense.formattedValue+'。':'费用率缺少有效数据。'));
  (pack.steps||[]).filter(function(step){return step.tool==='getTrendSeries'&&step.ok;}).slice(0,5).forEach(function(step){
    var text=trendText(step);if(text)analysis.push('趋势判断：'+text);
  });
  ['保费实际合计','经营利润','综合成本率实际（整体利润口径）'].forEach(function(label){
    var text=rankText(pack,label,org);if(text)analysis.push('横向位置：'+text);
  });
  if(cor&&numberValue(cor.value)!=null&&((Math.abs(cor.value)<=2?cor.value*100:cor.value)>=90)){
    recs.push('优先拆解综合成本率，分别核查赔付率、费用率和高赔付业务来源，避免只看保费规模。');
  }
  if(premiumRate&&numberValue(premiumRate.value)!=null&&((Math.abs(premiumRate.value)<=2?premiumRate.value*100:premiumRate.value)<90)){
    recs.push('保费进度仍有缺口，建议按渠道、险种和重点客户拆分缺口，确认可追赶空间。');
  }
  if(profit&&profit.value<0)recs.push('经营利润为负，建议将赔付异常、费用投入和低质量保费列为短期核查重点。');
  if(productivity||profitPerCapita)recs.push('结合人均产能和人均利润判断人员配置效率，区分规模不足、利润不足和人力成本压力。');
  if(!recs.length)recs.push('建议继续跟踪保费进度、利润进度、综合成本率和人效指标，重点关注趋势拐点和排名变化。');
  var missing=(pack.steps||[]).filter(function(step){return step.tool==='getMetricSnapshot'&&!step.ok;}).map(function(step){
    return step.limitations&&step.limitations[0];
  }).filter(Boolean);
  limitations=Array.from(new Set((pack.limitations||[]).concat(missing))).filter(Boolean).slice(0,8);
  var readCount=(pack.steps||[]).filter(function(step){return step.tool==='getMetricSnapshot';}).length;
  limitations.unshift('本次深度解读读取'+readCount+'个指标快照，其中'+snaps.length+'个有有效数据、'+Math.max(0,readCount-snaps.length)+'个缺少有效数据。');
  if(snaps.some(function(s){return s.basis==='annual_plan';}))limitations.unshift('计划/预算类指标采用年度计划口径，同一年度内任意月份查询均应返回同一计划值。');
  return {
    summary:diagnosisSummaryText||(org+' '+period+'深度解读：'+(profit?('经营利润'+profit.formattedValue+'，'):'')+(premium?('保费实际合计'+premium.formattedValue+'，'):'')+(cor?('综合成本率'+cor.formattedValue+'。'):'需先补齐关键指标。')),
    facts:facts.slice(0,12),
    analysis:analysis.slice(0,12),
    recommendations:recs.slice(0,8),
    triggeredAlerts:diagnosisAlerts.reduce(function(list,step){return list.concat(step.triggeredAlerts||[]);},[]).slice(0,20),
    riskLevel:diagnosisRiskLevel||undefined,
    limitations:limitations,
    usedEvidence:pack.evidence.slice(0,18).map(function(e){return e.id;}),
    validation:{passed:true,unverifiedNumbers:[],mode:isShare()?'local-share-deep':'local-deep'}
  };
}

function extractNumbers(text){
  return String(text||'').match(/[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?/g)||[];
}

function validateAnswer(answer,pack){
  var text=JSON.stringify(answer).replace(/ev_[a-z0-9]+/gi,''), allowed={};
  pack.evidence.forEach(function(e){
    [e.formattedValue,String(e.value),Number(e.value).toFixed(2),e.period,e.org,e.label,e.metric].forEach(function(v){
      if(v!=null&&v!=='')allowed[String(v).replace(/,/g,'')]=true;
    });
  });
  var unverified=extractNumbers(text).filter(function(n){
    var clean=n.replace(/,/g,'');
    return !allowed[clean]&&!allowed[clean.replace('%','')]&&!/^\d{4}$/.test(clean)&&!/^0$|^1$|^2$|^3$|^5$|^6$|^10$|^12$|^100$/.test(clean);
  });
  answer.validation=answer.validation||{};
  answer.validation.unverifiedNumbers=Array.from(new Set(unverified));
  answer.validation.passed=answer.validation.unverifiedNumbers.length===0;
  return answer;
}

function parseModelJson(content){
  try{return JSON.parse(content);}catch(e){}
  var m=String(content||'').match(/\{[\s\S]*\}/);
  if(m){try{return JSON.parse(m[0]);}catch(e2){}}
  return {__unstructured:true,summary:String(content||''),facts:[],analysis:[],recommendations:[],limitations:['模型未返回结构化 JSON。'],usedEvidence:[]};
}

function asArray(value){
  if(value==null)return [];
  if(Array.isArray(value))return value;
  if(typeof value==='string')return value.trim()?[value]:[];
  if(typeof value==='object')return [value];
  return [String(value)];
}

function ask(question,options){
  options=options||{};
  var pack=buildEvidencePack(question,options);
  var factOnly=/多少|是多少|几|有没有|是什么|为多少/.test(String(question||''))&&pack.mode!=='deep';
  var diagnosisLocalOnly=pack.useDiagnosis&&options.mode!=='deep'&&/诊断|风险|预警|异常|原因|为什么|建议|整改|依据|触发/.test(String(question||''));
  if(factOnly||diagnosisLocalOnly||isShare()||!window.AICLIENT||typeof window.AICLIENT.chat!=='function'){
    return Promise.resolve({pack:pack,answer:answerFromPack(pack),local:true});
  }
  var prompt=[
    '你是基于证据的数据看板 AI 智能体。只能依据 evidencePack 中的工具结果回答。',
    '不要自行计算或编造数字；所有数字、机构、月份、指标必须来自 evidencePack。',
    '必须返回 JSON，字段为 summary, facts, analysis, recommendations, limitations, usedEvidence。',
    'facts 和 recommendations 中尽量引用 evidence id。'
  ].join('\n');
  return window.AICLIENT.chat([
    {role:'system',content:prompt},
    {role:'user',content:JSON.stringify({question:question,evidencePack:pack},null,2)}
  ]).then(function(content){
    var answer=parseModelJson(content);
    if(answer.__unstructured){
      answer=answerFromPack(pack);
      answer.limitations=(answer.limitations||[]).concat(['模型未返回结构化 JSON，已改用本地确定性证据回答。']);
      return {pack:pack,answer:answer,local:true,raw:content};
    }
    answer=validateAnswer(answer,pack);
    if(!answer.validation.passed){
      var verified=answerFromPack(pack);
      verified.limitations=(verified.limitations||[]).concat(['模型回答包含证据外数字，已拦截模型正文并改用本地确定性证据报告。']);
      verified.validation={passed:true,unverifiedNumbers:[],mode:'blocked-model-fallback',blockedNumbers:answer.validation.unverifiedNumbers};
      return {pack:pack,answer:verified,local:true,raw:content,blocked:true};
    }
    return {pack:pack,answer:answer,local:false,raw:content};
  }).catch(function(error){
    var fallback=answerFromPack(pack);
    fallback.limitations=(fallback.limitations||[]).concat(['模型调用失败，已返回本地确定性分析：'+error.message]);
    return {pack:pack,answer:fallback,local:true,error:error};
  });
}

function renderAnswer(result){
  var answer=result.answer||{}, pack=result.pack||{};
  var invalid=answer.validation&&answer.validation.unverifiedNumbers&&answer.validation.unverifiedNumbers.length;
  var html='<div class="ai-evidence-answer" style="padding:12px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;line-height:1.7">';
  html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;font-size:11px;color:#475569">';
  html+='<span style="padding:2px 8px;border-radius:999px;background:#eff6ff;color:#1d4ed8">'+(result.local?'本地确定性分析':'AI 深度分析')+'</span>';
  html+='<span>数据周期：'+esc(pack.queryPeriodLabel||(pack.dataScope&&pack.dataScope.currentPeriod)||currentMonth()||'--')+'</span>';
  html+='<span>证据：'+esc((pack.evidence||[]).length)+' 条</span>';
  html+='</div>';
  if(invalid)html+='<div style="padding:8px 10px;background:#fff7ed;color:#9a3412;border-radius:6px;margin-bottom:8px">回答包含未验证数字：'+esc(answer.validation.unverifiedNumbers.join('、'))+'</div>';
  html+='<h4 style="margin:0 0 6px;font-size:14px">'+esc(answer.summary||'分析结果')+'</h4>';
  [['数据事实','facts'],['分析判断','analysis'],['建议','recommendations'],['限制','limitations']].forEach(function(pair){
    var arr=asArray(answer[pair[1]]);if(!arr.length)return;
    html+='<div style="margin-top:8px"><b>'+pair[0]+'</b><ul style="margin:4px 0 0 18px">';
    arr.forEach(function(item){html+='<li>'+esc(typeof item==='string'?item:(item.text||JSON.stringify(item)))+'</li>';});
    html+='</ul></div>';
  });
  var usedEvidence=asArray(answer.usedEvidence);
  if(usedEvidence.length){
    html+='<div style="margin-top:8px;font-size:11px;color:#64748b">使用证据：'+esc(usedEvidence.join('、'))+'</div>';
  }
  html+='</div>';
  return html;
}

window.AnxiaonengAIEngine={
  version:CALC_VERSION,
  esc:esc,
  listPeriods:periods,
  listOrganizations:allOrganizations,
  listMetrics:allMetrics,
  parseGoal:parseGoal,
  buildEvidencePack:buildEvidencePack,
  localAnswer:function(question,options){var pack=buildEvidencePack(question,options);return {pack:pack,answer:answerFromPack(pack),local:true};},
  ask:ask,
  renderAnswer:renderAnswer,
  tools:{
    getMetricSnapshot:getMetricSnapshot,
    getTrendSeries:getTrendSeries,
    compareMoM:function(args){return compare('mom',args);},
    compareYoY:function(args){return compare('yoy',args);},
    rankBranches:rankBranches,
    diagnoseOrg:diagnoseOrg,
    getEvidence:getEvidence,
    getDiagnosisSummary:getDiagnosisSummary,
    getDiagnosisEvidence:getDiagnosisEvidence,
    getTriggeredAlerts:getTriggeredAlerts,
    getRecommendations:getRecommendations
  }
};
window.AIEngine=window.AnxiaonengAIEngine;
})();
