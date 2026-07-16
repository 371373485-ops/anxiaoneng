// 统一指标元数据、机构编码、对标和趋势策略。
(function(){
'use strict';

function slug(text){
  var hash=2166136261,s=String(text||'');
  for(var i=0;i<s.length;i++){hash^=s.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(36).toUpperCase();
}
function classify(field){
  var key=field.k,unit=field.u||'';
  if(/达成率|执行率/.test(key))return'attainment';
  if(unit==='%')return'ratio';
  if(unit==='人')return'count';
  if(/人均|利润值/.test(key))return'productivity';
  return'amount';
}
function direction(field,category){
  if(field.rd==='asc')return'decrease';
  if(/计划执行率/.test(field.k)&&/成本|人员/.test(field.k))return'target';
  if(category==='count')return'neutral';
  return'increase';
}
function benchmark(field,category){
  if(category==='ratio')return'weightedOverall';
  if(category==='attainment')return'plan';
  if(category==='productivity')return'median';
  if(category==='amount')return'plan';
  return'none';
}
function planField(field){
  var k=field.k;
  var pairs={
    '保费实际合计':'保费年度计划','经营利润':'经营利润年度计划',
    '整体人均产能实际':'整体人均产能计划','整体人均利润实际':'整体人均利润计划',
    '前台人均产能实际':'前台人均产能计划','后台人均产能实际':'后台人均产能计划',
    '前台人均利润实际':'前台人均利润计划','后台人均利润实际':'后台人均利润计划',
    '前台人员实际':'前台人员计划','后台人员实际':'后台人员计划','整体人员实际':'整体人员计划',
    '前台人力成本实际':'前台人力成本预算','后台人力成本实际':'后台人力成本预算','整体人力成本实际':'整体人力成本预算'
  };
  return pairs[k]||null;
}
function build(){
  var result={};
  (App.FIELDS||[]).forEach(function(field){
    var category=classify(field),dir=direction(field,category);
    var inferred={
      metricId:'M_'+slug(field.k),key:field.k,label:field.l||field.k,unit:field.u||'',
      category:category,direction:dir,benchmarkStrategy:benchmark(field,category),
      planField:planField(field),trendThreshold:category==='ratio'||category==='attainment'?0.02:0.05,
      evidencePrecision:field.u==='%'?1:2,calculationVersion:'calc-v1'
    };
    var catalog=(App.METRIC_CATALOG&&App.METRIC_CATALOG[field.k])||null;
    result[field.k]=Object.assign({},inferred,catalog||{},{
      key:field.k,
      label:(catalog&&catalog.label)||field.l||field.k,
      unit:(catalog&&catalog.unit!=null)?catalog.unit:(field.u||'')
    });
  });
  return result;
}
function orgId(name,type){
  return (type==='region'?'REG_':'BR_')+slug(String(name||'').replace(/\s+/g,'').toUpperCase());
}
function branchRecord(name){
  return (App.DATA.branches||[]).find(function(item){return item.n===name;})||null;
}
function median(values){
  values=values.filter(function(v){return v!=null&&isFinite(v);}).sort(function(a,b){return a-b;});
  if(!values.length)return null;
  var m=Math.floor(values.length/2);return values.length%2?values[m]:(values[m-1]+values[m])/2;
}
function benchmarkFor(name,metricKey){
  var meta=App.METRIC_METADATA[metricKey];if(!meta)return null;
  var branch=branchRecord(name),data=branch&&(branch.d||branch)||{},value=null,label='',type=meta.benchmarkStrategy;
  if(type==='weightedOverall'){
    value=App.DATA.national&&Number(App.DATA.national[metricKey]);
    label='全国加权值';
  }else if(type==='target'&&meta.targetValue!=null){
    value=Number(meta.targetValue);label='目标值';
  }else if(type==='plan'&&meta.planField&&data[meta.planField]!=null){
    value=Number(data[meta.planField]);label='自身年度计划';
  }else if(type==='median'){
    var region=branch&&branch.r;
    var peers=(App.DATA.branches||[]).filter(function(item){return !region||item.r===region;});
    value=median(peers.map(function(item){var v=(item.d||item)[metricKey];return v==null?null:Number(v);}));
    label=region?region+'机构中位数':'机构中位数';type=region?'regionalMedian':'median';
  }else if(type==='prior'){
    value=null;label='上期值';
  }else{
    type='none';label='暂不提供对标';value=null;
  }
  if(value==null||!isFinite(value)){value=null;if(type!=='none'){type='none';label='暂不提供对标';}}
  return {value:value,type:type,label:label,strategy:meta.benchmarkStrategy};
}
function classifyTrend(name,metricKey){
  var meta=App.METRIC_METADATA[metricKey];if(!meta)return {status:'配置缺失',values:[]};
  var months=Object.keys(App.ALL_DATA.actuals||{}).sort().filter(function(m){return m<=App.currentMonth;});
  var values=[];
  months.slice(-6).forEach(function(month){
    var p=App.ALL_DATA.actuals[month],b=p&&p.branches&&p.branches.find(function(x){return x.n===name;}),v=b&&(b.d||b)[metricKey];
    if(v!=null&&isFinite(Number(v)))values.push({period:month,value:Number(v),calculationVersion:meta.calculationVersion});
  });
  if(values.length<3)return {status:'数据不足',values:values};
  var last=values.slice(-3),d1=last[1].value-last[0].value,d2=last[2].value-last[1].value,t=meta.trendThreshold;
  function improvement(delta){
    if(meta.direction==='decrease')return-delta;
    if(meta.direction==='target')return null;
    if(meta.direction==='neutral')return 0;
    return delta;
  }
  var i1=improvement(d1),i2=improvement(d2);
  if(i1!=null&&i1>t&&i2>t)return {status:'持续改善',values:values};
  if(i1!=null&&i1<-t&&i2<-t)return {status:'持续恶化',values:values};
  var current=last[2].value,alert=(App._alertResults||[]).some(function(a){return a.branchName===name&&a.field===metricKey;});
  if(Math.abs(d2)>Math.max(Math.abs(current)*t,t))return {status:alert?'高位波动':'单月异常',values:values};
  return {status:alert?'高位波动':'低位波动',values:values};
}

App.METRIC_METADATA=build();
App.METRIC_CONFIG_ERRORS=[];
(App.FIELDS||[]).forEach(function(field){
  var meta=App.METRIC_METADATA[field.k];
  var missing=[];
  ['metricId','category','unit','direction','benchmarkStrategy','trendThreshold','evidencePrecision','calculationVersion'].forEach(function(key){
    if(!meta||meta[key]===undefined||meta[key]===null)missing.push(key);
  });
  if(missing.length)App.METRIC_CONFIG_ERRORS.push({metric:field.k,missing:missing});
});
if(App.METRIC_CONFIG_ERRORS.length&&window.console&&console.error){
  console.error('Metric metadata configuration errors',App.METRIC_CONFIG_ERRORS);
}
App.getMetricMeta=function(key){return App.METRIC_METADATA[key]||null;};
App.getOrgId=orgId;
App.getMetricBenchmark=benchmarkFor;
App.classifyMetricTrend=classifyTrend;
})();
