(function(){
'use strict';

var THEMES=[
  {key:'productivity',label:'人力效能',aliases:['人力效能','人效','人均','人员产出','人员效率','产能','人力成本','人员投入产出','员工产出','劳动效率','人效行不行','人效好不好','人效咋样','人效怎么样'],patterns:[/整体人均产能实际|整体产能\(实际\)/,/整体人均利润实际|整体人均利润\(实际\)/,/整体人力成本保费率实际|整体保费率\(实际\)/,/整体人员实际|整体实际/,/前台人均产能实际|前台产能\(实际\)/,/后台人均产能实际|后台产能\(实际\)/,/前台人均利润实际|前台人均利润\(实际\)/,/后台人均利润实际|后台人均利润\(实际\)/]},
  {key:'profitability',label:'盈利能力',aliases:['盈利','盈利能力','利润','利润质量','亏损','经营结果','盈利水平','利润表现','赚钱能力','赔钱','亏得厉害','亏损严重','利润下滑','利润掉了'],patterns:[/^经营利润$|经营利润(?!年度计划)/,/当月经营利润/,/利润达成率|时间进度达成率/,/综合成本率实际|综合成本率/,/已赚赔付率实际|赔付率/,/已赚费用率实际|费用率/]},
  {key:'cost_quality',label:'成本质量',aliases:['成本质量','成本','成本率','综合成本','赔付','赔付率','费用率','承保质量','成本压力','成本表现','赔付情况','费用情况','成本咋样','成本怎么样','成本好不好','成本行不行','成本高不高','赔付不太好','赔付好不好'],patterns:[/综合成本率实际|综合成本率/,/已赚赔付率实际|赔付率/,/已赚费用率实际|费用率/,/^经营利润$|经营利润(?!年度计划)/]},
  {key:'target',label:'目标达成',aliases:['目标','达成','进度','计划完成','没达标','不达标','未达成','达成不好','达成不足','完成不好','完成得不好'],patterns:[/时间进度计划达成率|保费达成率/,/时间进度达成率|利润达成率/,/保费实际合计/,/^经营利润$|经营利润(?!年度计划)/,/保费年度计划/,/经营利润年度计划/]},
  {key:'premium',label:'保费规模',aliases:['保费','规模','业务规模','收入','业务量'],patterns:[/保费实际合计/,/已赚保费$/,/(车险|财产险|人身险).*实际/,/时间进度计划达成率|保费达成率/,/保费年度计划/]},
  {key:'risk',label:'风险预警',aliases:['风险','预警','异常','告警','诊断'],patterns:[/综合成本率实际|综合成本率/,/已赚赔付率实际|赔付率/,/已赚费用率实际|费用率/,/^经营利润$|经营利润(?!年度计划)/,/时间进度计划达成率|保费达成率/]}
];

var PRIORITY_ALIASES=[
  {aliases:['经营利润','利润','盈利','亏损','赔钱','亏得厉害','亏损严重','利润下滑','利润掉了'],patterns:[/^经营利润$|经营利润(?!年度计划)/]},
  {aliases:['当月利润','当月经营利润'],patterns:[/当月经营利润/]},
  {aliases:['保费','保费规模','保费收入','业务规模','保费掉了','保费下滑','保费下降'],patterns:[/保费实际合计/]},
  {aliases:['已赚保费'],patterns:[/已赚保费$/]},
  {aliases:['保费达成','保费达成率','时间进度','时间进度计划达成率','目标达成','达成率','计划达成','完成率','完成不好','完成得不好'],patterns:[/时间进度计划达成率|保费达成率/]},
  {aliases:['利润达成','利润达成率'],patterns:[/时间进度达成率|利润达成率/]},
  {aliases:['综合成本率','成本率','综合成本','成本咋样','成本高不高','成本好不好','成本行不行'],patterns:[/综合成本率实际|综合成本率/]},
  {aliases:['赔付率','赔付','已赚赔付率','赔付不太好','赔付好不好'],patterns:[/已赚赔付率实际|赔付率/]},
  {aliases:['费用率','费用','已赚费用率'],patterns:[/已赚费用率实际|费用率/]},
  {aliases:['人均产能','整体人均产能','产能','人员产出','人效','人效行不行','人效好不好','人效咋样','人效怎么样'],patterns:[/整体人均产能实际|整体产能\(实际\)/]},
  {aliases:['人均利润','整体人均利润','人均盈利'],patterns:[/整体人均利润实际|整体人均利润\(实际\)/]},
  {aliases:['人力成本','人力成本保费率'],patterns:[/整体人力成本保费率实际|整体保费率\(实际\)/]},
  {aliases:['人员','人数','整体人员'],patterns:[/整体人员实际|整体实际/]}
];

var CONDITION_ALIASES=[
  {key:'target_low',label:'保费达成不足',aliases:['保费达成不好','保费没达标','没达标','不达标','未达成','达成不好','达成不足','完成不好','完成得不好','目标没完成','目标未完成'],metricAlias:'保费达成率',operator:'<',value:1},
  {key:'profit_negative',label:'经营利润为负',aliases:['亏损','利润为负','盈利为负','利润低于0','利润小于0','亏得厉害','赔钱','亏损严重'],metricAlias:'经营利润',operator:'<',value:0},
  {key:'loss_high',label:'赔付率高于100%',aliases:['赔付率高','赔付高','赔付率偏高','赔付不太好','赔付不好'],metricAlias:'赔付率',operator:'>',value:1},
  {key:'cost_high',label:'综合成本率高于100%',aliases:['成本率高','综合成本率高','成本高','成本高不高'],metricAlias:'综合成本率',operator:'>',value:1}
];

function asArray(value){return Array.isArray(value)?value:(value==null?[]:[value]);}
function uniq(list){return Array.from(new Set(asArray(list).map(function(x){return String(x||'').trim();}).filter(Boolean)));}
function textOf(metric){return String((metric&&metric.metric)||metric&&metric.key||'')+' '+String((metric&&metric.label)||'');}
function includesAny(text,items){return asArray(items).some(function(item){return String(text||'').indexOf(item)>=0;});}
function isRegex(value){return Object.prototype.toString.call(value)==='[object RegExp]'||value&&typeof value.test==='function'&&typeof value.source==='string';}
function cleanAlias(value){
  return String(value||'')
    .replace(/[（(](.*?)[）)]/g,'$1')
    .replace(/\s+/g,'')
    .trim();
}
function withoutQualifiers(value){
  return cleanAlias(value).replace(/计划|预算|实际|达成率|执行率|年度|时间进度|平均人数|平均/g,'');
}
function unitOf(metric){return metric&&((metric.unit!=null?metric.unit:metric.u)||'')||'';}
function directionOf(metric){return metric&&((metric.direction!=null?metric.direction:metric.rd)||'')||'';}

function themeKeysForField(field){
  var text=(field.k||'')+' '+(field.l||'')+' '+(field.g||'');
  var keys=[];
  THEMES.forEach(function(theme){
    if(theme.patterns.some(function(pattern){pattern.lastIndex=0;return pattern.test(text);})){
      keys.push(theme.key);
    }
  });
  if(field.g==='保费'&&keys.indexOf('premium')<0)keys.push('premium');
  if(field.g==='效益'&&keys.indexOf('profitability')<0)keys.push('profitability');
  if(field.g==='效能'&&keys.indexOf('productivity')<0)keys.push('productivity');
  if(field.g==='人员'&&keys.indexOf('productivity')<0)keys.push('productivity');
  return uniq(keys);
}

function generatedAliases(field){
  var key=String(field.k||''), label=String(field.l||field.k||''), aliases=[key,label,cleanAlias(key),cleanAlias(label),withoutQualifiers(key),withoutQualifiers(label)];
  ['前台','后台','整体','车险','财产险','人身险'].forEach(function(scope){
    if(key.indexOf(scope)>=0||label.indexOf(scope)>=0){
      ['计划','预算','实际','达成率','执行率','平均','平均人数'].forEach(function(kind){
        if(key.indexOf(kind)>=0||label.indexOf(kind)>=0)aliases.push(scope+withoutQualifiers(key)+kind,scope+withoutQualifiers(label)+kind);
      });
    }
  });
  return uniq(aliases).filter(function(alias){return alias.length>=2;});
}

function buildMetricRegistry(fields){
  return asArray(fields).map(function(field){
    return {
      key:field.k,
      metric:field.k,
      label:field.l||field.k,
      group:field.g||'',
      unit:field.u||'',
      direction:field.rd||'',
      isCore:!!field.c,
      core:!!field.c,
      aggregate:!!field.m,
      aliases:generatedAliases(field),
      themeKeys:themeKeysForField(field),
      raw:field
    };
  }).filter(function(item){return item.metric;});
}

function normalizeMetrics(metrics){
  metrics=asArray(metrics);
  var appFields=window.App&&App.FIELDS||[];
  var registry=buildMetricRegistry(appFields);
  if(!metrics.length)return registry;
  var byKey={};
  registry.forEach(function(item){byKey[item.metric]=item;});
  return metrics.map(function(metric){
    var key=metric.metric||metric.key;
    var reg=byKey[key]||{};
    return Object.assign({},reg,metric,{
      key:key,
      metric:key,
      label:metric.label||reg.label||key,
      group:metric.group||reg.group||'',
      unit:metric.unit||reg.unit||'',
      direction:metric.direction||reg.direction||'',
      isCore:metric.isCore!=null?metric.isCore:!!(metric.core||reg.core),
      core:!!(metric.core||reg.core),
      aliases:uniq([].concat(reg.aliases||[],metric.aliases||[])),
      themeKeys:uniq([].concat(reg.themeKeys||[],metric.themeKeys||[]))
    });
  });
}

function scoreCandidate(metric,query,source){
  var q=cleanAlias(query), text=cleanAlias(textOf(metric)), aliases=asArray(metric.aliases).map(cleanAlias);
  var score=0;
  if(source==='priority')score+=1000;
  if(metric.core||metric.isCore)score+=80;
  if(metric.metric===query||metric.label===query)score+=500;
  if(cleanAlias(metric.metric)===q||cleanAlias(metric.label)===q)score+=400;
  if(aliases.indexOf(q)>=0)score+=300;
  if(text.indexOf(q)>=0)score+=120;
  if(q.indexOf(cleanAlias(metric.label))>=0||q.indexOf(cleanAlias(metric.metric))>=0)score+=90;
  ['实际','计划','预算','达成率','执行率','前台','后台','整体','车险','财产险','人身险'].forEach(function(token){
    if(q.indexOf(token)>=0&&(text.indexOf(token)>=0||aliases.some(function(a){return a.indexOf(token)>=0;})))score+=25;
    if(q.indexOf(token)>=0&&text.indexOf(token)<0&&!aliases.some(function(a){return a.indexOf(token)>=0;}))score-=80;
  });
  return score;
}

function patternMatches(metric,pattern){
  var text=textOf(metric)+' '+asArray(metric.aliases).join(' ');
  if(isRegex(pattern)){pattern.lastIndex=0;return pattern.test(text);}
  return text.indexOf(String(pattern))>=0;
}

function resolveMetricCandidates(metrics,aliasOrPattern,limit){
  metrics=normalizeMetrics(metrics);
  if(!aliasOrPattern)return [];
  var found=[];
  if(isRegex(aliasOrPattern)){
    found=metrics.filter(function(m){return patternMatches(m,aliasOrPattern);}).map(function(m){return {metric:m,score:scoreCandidate(m,String(aliasOrPattern),'pattern')};});
  }else{
    var alias=String(aliasOrPattern);
    var priorityMatched=false;
    PRIORITY_ALIASES.forEach(function(rule){
      if(rule.aliases.indexOf(alias)>=0||includesAny(alias,rule.aliases)){
        priorityMatched=true;
        rule.patterns.forEach(function(pattern){
          metrics.filter(function(m){return patternMatches(m,pattern);}).forEach(function(m){found.push({metric:m,score:scoreCandidate(m,alias,'priority')});});
        });
      }
    });
    if(!priorityMatched){
      metrics.forEach(function(m){
        var score=scoreCandidate(m,alias,'auto');
        if(score>=120)found.push({metric:m,score:score});
      });
    }
  }
  var best={};
  found.forEach(function(item){
    var key=item.metric.metric;
    if(!best[key]||item.score>best[key].score)best[key]=item;
  });
  return Object.keys(best).map(function(key){return best[key];}).sort(function(a,b){
    if(b.score!==a.score)return b.score-a.score;
    if(!!b.metric.core!==!!a.metric.core)return b.metric.core?1:-1;
    return textOf(a.metric).length-textOf(b.metric).length;
  }).slice(0,limit||8).map(function(item){return item.metric;});
}

function resolveMetric(metrics,aliasOrPattern){
  return resolveMetricCandidates(metrics,aliasOrPattern,1)[0]||null;
}

function metricsForTheme(metrics,themeKey){
  metrics=normalizeMetrics(metrics);
  var theme=THEMES.find(function(item){return item.key===themeKey||item.label===themeKey;});
  if(!theme)return [];
  var result=[];
  theme.patterns.forEach(function(pattern){
    var found=resolveMetric(metrics,pattern);
    if(found&&!result.some(function(item){return item.metric===found.metric;}))result.push(found);
  });
  if(!result.length){
    result=metrics.filter(function(metric){return asArray(metric.themeKeys).indexOf(theme.key)>=0;}).slice(0,8);
  }
  return result;
}

function detectTheme(question){
  var text=String(question||'');
  return THEMES.find(function(theme){return theme.aliases.some(function(alias){return text.indexOf(alias)>=0;});})||null;
}

function detectConditions(question,metrics){
  var text=String(question||'');
  return CONDITION_ALIASES.filter(function(rule){
    return rule.aliases.some(function(alias){return text.indexOf(alias)>=0;});
  }).map(function(rule){
    var metric=resolveMetric(metrics,rule.metricAlias);
    return {key:rule.key,label:rule.label,metric:metric&&metric.metric||'',metricLabel:metric&&metric.label||rule.metricAlias,operator:rule.operator,value:rule.value};
  });
}

function betterDirection(metric){
  var direction=directionOf(metric);
  if(direction==='asc')return '低值更优';
  if(direction==='desc')return '高值更优';
  return '';
}

window.DashboardMetricDictionary={
  version:'search-dictionary-v2',
  themes:THEMES,
  aliases:PRIORITY_ALIASES,
  priorityAliases:PRIORITY_ALIASES,
  conditionAliases:CONDITION_ALIASES,
  buildMetricRegistry:buildMetricRegistry,
  normalizeMetrics:normalizeMetrics,
  resolveMetric:resolveMetric,
  resolveMetricCandidates:resolveMetricCandidates,
  metricsForTheme:metricsForTheme,
  detectTheme:detectTheme,
  detectConditions:detectConditions,
  unitOf:unitOf,
  betterDirection:betterDirection
};
})();
