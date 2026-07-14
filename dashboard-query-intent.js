(function(){
'use strict';

var SUPPORTED_TASKS=['snapshot','filter','rank','theme','trend','compare'];
var STANDARD_QUESTIONS=[
  '北京分公司2026-05经营利润是多少？',
  '哪些分公司保费达成不好且亏损？',
  '综合成本率最高的前5家是谁？',
  '广西分公司人力效能情况。',
  '广东分公司近6个月保费趋势怎么样？',
  '北京和上海哪个利润更好？'
];

function engine(){return window.AIEngine||window.AnxiaonengAIEngine;}
function dict(){return window.DashboardMetricDictionary;}
function asArray(value){return Array.isArray(value)?value:(value==null?[]:[value]);}
function unique(list){return Array.from(new Set(asArray(list).filter(Boolean)));}
function currentPeriod(){return window.App&&App.currentMonth||engine()&&engine().listPeriods&&engine().listPeriods().slice(-1)[0]||'';}
function periods(){return engine()&&engine().listPeriods?engine().listPeriods():[];}
function metrics(){
  var base=engine()&&engine().listMetrics?engine().listMetrics():[];
  return dict()&&dict().normalizeMetrics?dict().normalizeMetrics(base):base;
}
function orgs(){return engine()&&engine().listOrganizations?engine().listOrganizations():[];}
function numberValue(value){var n=Number(value);return Number.isFinite(n)?n:null;}
function formatValue(value,unit){var n=numberValue(value);if(n==null)return '无数据';if(unit==='%')return (n*100).toFixed(2)+'%';if(unit==='人')return n.toFixed(0)+'人';if(unit)return n.toFixed(2)+unit;return n.toFixed(2);}
function hashId(prefix,parts){return prefix+'_'+Math.abs(String(parts.join('|')).split('').reduce(function(a,c){return ((a<<5)-a)+c.charCodeAt(0)|0;},0)).toString(16);}
function isOpenEnded(text){return /为什么|原因|诊断|风险|异常|建议|改善|改进|下一步|怎么做|怎么办|整体怎么样|整体如何|分析一下|帮我分析/.test(String(text||''));}
function isListQuestion(text){return /哪些|有哪些|哪几|列出|筛选|找出|谁/.test(String(text||''));}
function asksSnapshot(text){return /多少|是多少|为多少|几|数值|是多少\?|是多少？/.test(String(text||''));}
function asksCompare(text){return /对比|比较|哪个|谁更|哪家更|和.*比|与.*比/.test(String(text||''));}
function asksTrend(text){return /趋势|走势|变化|下降|下滑|掉了没|掉没掉|掉了|近\s*\d+\s*个?月|近\s*(?:一|二|两|\d+)\s*年|最近\s*(?:一|二|两|\d+)\s*年|过去\s*\d+\s*个?月|今年以来|年度累计|上半年|下半年|近\s*几\s*个?月|最近\s*几\s*个?月|连续|波动|最近/.test(String(text||''));}
function asksRank(text){return /排名|最高|最低|最差|最好|top|bottom|前\s*\d+|后\s*\d+/i.test(String(text||''));}
function isAmbiguousBadQuestion(text){return /哪家最差|谁不好|哪些公司不好|问题最大|最有问题/.test(String(text||''));}
function isVagueOrgQuestion(text){return /怎么样|咋样|好不好|行不行|如何|情况/.test(String(text||''));}

function hasOralTrendExpression(question){
  return /下降|下滑|掉了没|掉没掉|掉了|回落/.test(String(question||''));
}

function cnNumber(value){
  var map={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
  if(/^\d+$/.test(String(value||'')))return Number(value);
  return map[value]||null;
}

function hasRangeExpression(question){
  var text=String(question||'');
  return /近\s*(?:\d+|一|二|两)\s*年|最近\s*(?:\d+|一|二|两)\s*年|过去\s*(?:12|24)\s*个?月|近\s*\d+\s*个?月|最近\s*\d+\s*个?月|近\s*几\s*个?月|最近\s*几\s*个?月|今年以来|年度累计|上半年|下半年/.test(text);
}

function rangeWindowMonths(end,count){
  var ps=periods(), source=ps, index=ps.indexOf(end);
  if(index>=0)source=ps.slice(0,index+1);
  if(!end)return source.slice(Math.max(0,source.length-count));
  var y=Number(String(end).slice(0,4)), m=Number(String(end).slice(5,7));
  if(!Number.isFinite(y)||!Number.isFinite(m))return source.slice(Math.max(0,source.length-count));
  var startIndex=(y*12+(m-1))-(count-1);
  return source.filter(function(p){
    var py=Number(String(p).slice(0,4)), pm=Number(String(p).slice(5,7));
    if(!Number.isFinite(py)||!Number.isFinite(pm))return false;
    var value=py*12+(pm-1);
    return value>=startIndex&&p<=end;
  });
}

function branchesForPeriod(period){
  var data=window.App&&App.ALL_DATA||{};
  var month=(data.actuals&&data.actuals[period])||(data._merged&&data._merged[period])||{};
  var branches=asArray(month.branches).map(function(b){return {name:b.n||b.name,region:b.r||b.region||'',orgId:b.orgId||b.id||b.n,record:b.d||b};}).filter(function(b){return b.name;});
  if(branches.length)return branches;
  return orgs().filter(function(o){return o.level==='branch';}).map(function(o){return {name:o.name,region:o.region||'',orgId:o.orgId||o.id||o.name,record:null};});
}

function recordValue(record,metricMeta){
  if(!record||!metricMeta)return null;
  if(numberValue(record[metricMeta.metric])!=null)return record[metricMeta.metric];
  var label=String(metricMeta.label||''), key=String(metricMeta.metric||'');
  var found=Object.keys(record).find(function(k){return (label&&k.indexOf(label)>=0)||(key&&k.indexOf(key)>=0)||(label&&label.indexOf(k)>=0);});
  return found?record[found]:null;
}

function findOrgToken(question){
  var text=String(question||'');
  var sorted=orgs().filter(function(o){return o&&o.name&&o.level!=='country';}).sort(function(a,b){return b.name.length-a.name.length;});
  var exact=sorted.filter(function(o){return text.indexOf(o.name)>=0;});
  if(exact.length)return exact;
  var partial=[];
  sorted.forEach(function(o){
    var name=o.name||'', short=name.replace(/分公司|责任区|全国/g,'');
    if(short&&short.length>=2&&text.indexOf(short)>=0&&!partial.some(function(x){return x.name===name;}))partial.push(o);
  });
  return partial;
}

function findPeriod(question){
  var text=String(question||''), exact=text.match(/20\d{2}-\d{2}/);
  if(exact)return exact[0];
  var cn=text.match(/(20\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*(?:月|月份)?/);
  if(cn)return cn[1]+'-'+String(Number(cn[2])).padStart(2,'0');
  return currentPeriod();
}

function findRangeInfo(question,period){
  var text=String(question||''), ps=periods(), end=period||currentPeriod();
  var year=text.match(/(?:近|最近)\s*(\d+|一|二|两)\s*年/);
  if(year){
    var years=cnNumber(year[1])||1, months=years*12;
    return {range:rangeWindowMonths(end,months),requestedMonths:months,label:'近'+months+'个月',kind:'rolling_months'};
  }
  var past=text.match(/过去\s*(12|24)\s*个?月/);
  if(past){
    var pastMonths=Number(past[1]);
    return {range:rangeWindowMonths(end,pastMonths),requestedMonths:pastMonths,label:'近'+pastMonths+'个月',kind:'rolling_months'};
  }
  var vague=text.match(/(?:近|最近)\s*几\s*个?月/);
  if(vague){
    return {range:rangeWindowMonths(end,6),requestedMonths:6,label:'近6个月（按“几个月”默认）',kind:'rolling_months_default'};
  }
  var m=text.match(/(?:近|最近)\s*(\d+)\s*个?月/);
  if(m){
    var count=Number(m[1]);
    return {range:rangeWindowMonths(end,count),requestedMonths:count,label:'近'+count+'个月',kind:'rolling_months'};
  }
  if(/今年以来|年度累计/.test(text)){
    var year=String(end||'').slice(0,4);
    return {range:ps.filter(function(p){return p.indexOf(year+'-')===0&&p<=end;}),requestedMonths:Number(String(end||'').slice(5,7))||12,label:'今年以来',kind:'year_to_date'};
  }
  if(/上半年/.test(text)){
    var hy=String(end||'').slice(0,4);
    return {range:ps.filter(function(p){return p.indexOf(hy+'-')===0&&p>=(hy+'-01')&&p<=(hy+'-06')&&p<=end;}),requestedMonths:6,label:'上半年',kind:'half_year'};
  }
  if(/下半年/.test(text)){
    var ly=String(end||'').slice(0,4);
    return {range:ps.filter(function(p){return p.indexOf(ly+'-')===0&&p>=(ly+'-07')&&p<=end;}),requestedMonths:Math.max(0,(Number(String(end||'').slice(5,7))||12)-6),label:'下半年',kind:'half_year'};
  }
  if(/年度|全年|年内|累计/.test(text)){
    var fy=String(end||'').slice(0,4);
    return {range:ps.filter(function(p){return p.indexOf(fy+'-')===0&&p<=end;}),requestedMonths:Number(String(end||'').slice(5,7))||12,label:'年内累计',kind:'year_to_date'};
  }
  return {range:end?[end]:[],requestedMonths:1,label:end||'',kind:'single_period'};
}

function findRange(question,period){
  return findRangeInfo(question,period).range;
}

function explicitMetricResolution(question){
  var text=String(question||''), all=metrics(), result=[], candidates=[];
  all.forEach(function(m){
    if(text.indexOf(m.metric)>=0||text.indexOf(m.label)>=0)result.push(m);
  });
  (dict()&&dict().aliases||[]).forEach(function(rule){
    if(rule.aliases.some(function(alias){return text.indexOf(alias)>=0;})){
      rule.patterns.forEach(function(pattern){
        var found=dict().resolveMetric(all,pattern);
        if(found&&!result.some(function(item){return item.metric===found.metric;}))result.push(found);
      });
    }
  });
  if(!result.length&&dict()&&dict().resolveMetricCandidates){
    candidates=dict().resolveMetricCandidates(all,text,6);
    if(candidates.length===1)result=candidates.slice();
  }
  if(!result.length&&dict()&&dict().resolveMetric){
    var found=dict().resolveMetric(all,text);
    if(found)result=[found];
  }
  result=unique(result.map(function(item){return item.metric;})).map(function(key){return all.find(function(m){return m.metric===key;});}).filter(Boolean);
  candidates=unique(candidates.concat(result).map(function(item){return item.metric;})).map(function(key){return all.find(function(m){return m.metric===key;});}).filter(Boolean);
  return {metrics:result,candidates:candidates};
}

function explicitMetrics(question){
  return explicitMetricResolution(question).metrics;
}

function parseLimit(question){
  var text=String(question||''), m=text.match(/(?:前|后|top|bottom)\s*(\d+)/i)||text.match(/(\d+)\s*家/);
  return m?Math.max(1,Number(m[1])):5;
}

function sortLabel(metric,question){
  var text=String(question||''), wantsLow=/最低|最差|后|bottom/i.test(text);
  var wantsHigh=/最高|最好|前|top/i.test(text);
  var better=dict()&&dict().betterDirection(metric)||'';
  if(wantsLow)return '低到高';
  if(wantsHigh)return '高到低';
  if(metric&&metric.direction==='asc')return '低到高';
  return '高到低';
}

function makeUnsupportedIntent(base,reason){
  base.unsupported=true;
  base.unsupportedReason=reason||'当前全局搜索仅支持查数、筛选、排名、主题、趋势和对比。';
  base.clarificationReason=base.clarificationReason||base.unsupportedReason;
  base.suggestions=STANDARD_QUESTIONS.slice();
  base.clarificationOptions=base.clarificationOptions||base.suggestions.slice();
  base.limitations=unique([].concat(base.limitations||[],base.unsupportedReason));
  return base;
}

function ambiguousBadOptions(){
  return [
    '综合成本率最高的前5家是谁？',
    '经营利润最低的前5家是谁？',
    '保费达成率最低的前5家是谁？',
    '赔付率最高的前5家是谁？',
    '人均产能最低的前5家是谁？'
  ];
}

function orgClarificationOptions(org){
  var name=org||'深圳分公司';
  return [
    name+'盈利能力怎么样？',
    name+'成本质量怎么样？',
    name+'人力效能怎么样？',
    name+'近6个月保费趋势怎么样？'
  ];
}

function normalizeQuestion(intent){
  if(!intent)return '';
  if(intent.task==='clarification'){
    if(intent.org)return intent.org+'需要选择标准分析口径后查询';
    return '需要选择评价口径后查询';
  }
  var org=intent.org||asArray(intent.orgs)[0]||'全部机构';
  var metric=intent.metricLabel||intent.metric||'指标';
  var themeLabel=intent.themeLabel||intent.theme||'主题';
  var rangeLabel=intent.rangeMeta&&intent.rangeMeta.label||((asArray(intent.range).length>1)?(asArray(intent.range)[0]+'至'+asArray(intent.range).slice(-1)[0]):(intent.period||'当前月'));
  if(intent.task==='trend')return org+rangeLabel+metric+'趋势查询';
  if(intent.task==='theme')return org+(intent.period?'当前月':'')+themeLabel+'主题分析';
  if(intent.task==='snapshot')return org+(intent.period||'当前月')+metric+'精确查数';
  if(intent.task==='rank')return (intent.period||'当前月')+metric+(intent.sortDirection?intent.sortDirection:'')+'排名查询';
  if(intent.task==='filter'){
    var cond=asArray(intent.conditions).map(function(c){return c.label||c.metricLabel||c.metric;}).join('、')||'指定条件';
    return (intent.period||'当前月')+cond+'条件筛选';
  }
  if(intent.task==='compare')return asArray(intent.orgs).join('与')+(intent.period||'当前月')+metric+'对比查询';
  return intent.question||'';
}

function makeClarificationIntent(base,reason,options){
  base.task='clarification';
  base.intent='clarification';
  base.unsupported=true;
  base.unsupportedReason=reason;
  base.clarificationReason=reason;
  base.clarificationOptions=options.slice();
  base.suggestions=options.slice();
  base.confidence=Math.min(base.confidence||0.4,0.35);
  base.limitations=unique([].concat(base.limitations||[],reason));
  base.normalizedQuestion=normalizeQuestion(base);
  return base;
}

function parseQueryIntent(question,options){
  options=options||{};
  var text=String(question||'').trim(), allMetrics=metrics(), foundOrgs=findOrgToken(text), period=options.period||findPeriod(text), rangeInfo=findRangeInfo(text,period), range=rangeInfo.range;
  var metricResolution=explicitMetricResolution(text), theme=dict()&&dict().detectTheme(text), conditions=dict()&&dict().detectConditions(text,allMetrics)||[], metricsFound=metricResolution.metrics;
  var task='snapshot', limitations=[], confidence=0.7;

  if(hasRangeExpression(text)&&foundOrgs.length===1&&metricsFound.length){task='trend';confidence=0.91;}
  else if(conditions.length&&isListQuestion(text)){task='filter';confidence=0.94;}
  else if(asksRank(text)){task='rank';confidence=0.9;}
  else if(asksTrend(text)){task='trend';confidence=0.88;}
  else if(foundOrgs.length===1&&metricsFound.length&&asksSnapshot(text)){task='snapshot';confidence=0.92;}
  else if(foundOrgs.length>=2||asksCompare(text)){task='compare';confidence=0.86;}
  else if(foundOrgs.length&&metricsFound.length&&asksSnapshot(text)){task='snapshot';confidence=0.9;}
  else if(theme){task='theme';confidence=0.84;}

  if(task==='trend'&&!hasRangeExpression(text)&&hasOralTrendExpression(text)){
    rangeInfo={range:rangeWindowMonths(period,6),requestedMonths:6,label:'近6个月（口语趋势默认）',kind:'rolling_months_default'};
    range=rangeInfo.range;
  }

  if(task==='theme'&&theme)metricsFound=dict().metricsForTheme(allMetrics,theme.key);
  if(task==='filter')metricsFound=unique(conditions.map(function(c){return c.metric;})).map(function(k){return allMetrics.find(function(m){return m.metric===k;});}).filter(Boolean);
  if(!metricsFound.length&&theme)metricsFound=dict().metricsForTheme(allMetrics,theme.key);

  var metricMeta=metricsFound[0]||null;
  var intent={
    schemaVersion:'dashboard-query-intent-v3',
    question:text,
    task:task,
    intent:task,
    orgs:foundOrgs.map(function(o){return o.name;}),
    org:foundOrgs[0]&&foundOrgs[0].name||'',
    orgLevel:foundOrgs[0]&&foundOrgs[0].level||'',
    period:period,
    range:range,
    rangeMeta:rangeInfo,
    theme:theme&&theme.key||'',
    themeLabel:theme&&theme.label||'',
    metrics:metricsFound.map(function(m){return m.metric;}),
    metricLabels:metricsFound.map(function(m){return m.label;}),
    metric:metricMeta&&metricMeta.metric||'',
    metricLabel:metricMeta&&metricMeta.label||'',
    metricUnit:metricMeta&&(dict()&&dict().unitOf?dict().unitOf(metricMeta):metricMeta.unit)||'',
    metricCandidates:metricResolution.candidates.map(function(m){return {metric:m.metric,label:m.label,unit:m.unit||'',direction:m.direction||''};}),
    sortDirection:task==='rank'?sortLabel(metricMeta,text):'',
    conditions:conditions,
    limit:parseLimit(text),
    confidence:confidence,
    limitations:limitations
  };
  intent.normalizedQuestion=normalizeQuestion(intent);

  if(isAmbiguousBadQuestion(text)&&!metricsFound.length&&!theme)return makeClarificationIntent(intent,'问题里的“最差/不好/问题最大”缺少明确评价口径，请选择一个标准指标口径后再查询。',ambiguousBadOptions());
  if(foundOrgs.length===1&&!metricsFound.length&&!theme&&!conditions.length&&isVagueOrgQuestion(text))return makeClarificationIntent(intent,'已识别到机构，但缺少要分析的主题或指标，请选择一个标准分析口径。',orgClarificationOptions(foundOrgs[0].name));
  if(isOpenEnded(text)){
    intent.normalizedQuestion='需要改写为标准查询口径后查询';
    return makeUnsupportedIntent(intent,'这个问题属于开放式诊断/建议，当前全局搜索先不直接回答。请改成查数、筛选、排名、主题、趋势或对比类问题。');
  }
  if(!intent.metrics.length&&intent.metricCandidates.length>1){
    intent.unsupported=true;
    intent.unsupportedReason='识别到多个可能指标，请补充更准确的指标名称。';
    intent.suggestions=intent.metricCandidates.slice(0,6).map(function(m){return (intent.org||'北京分公司')+' '+intent.period+' '+m.label+'是多少？';});
    intent.limitations.push(intent.unsupportedReason);
    return intent;
  }
  if(!intent.metrics.length&&['snapshot','rank','trend','compare'].indexOf(task)>=0)intent.limitations.push('未能匹配到明确指标。');
  if(!intent.metrics.length&&task==='theme')intent.limitations.push('未能匹配到该主题下的有效指标。');
  if(!intent.orgs.length&&['snapshot','theme','trend','compare'].indexOf(task)>=0&&!/全国|全部|所有/.test(text))intent.limitations.push('未能匹配到明确机构。');
  if(task==='compare'&&intent.orgs.length<2)intent.limitations.push('机构对比至少需要两个机构。');
  if(task==='filter'&&!intent.conditions.length)intent.limitations.push('条件筛选至少需要一个明确筛选条件。');
  if(conditions.some(function(c){return !c.metric;}))intent.limitations.push('部分筛选条件缺少对应指标。');
  return intent;
}

function evidenceFromSteps(steps){
  var map={};
  asArray(steps).forEach(function(step){asArray(step&&step.evidence).forEach(function(ev){map[ev.id]=ev;});});
  return Object.keys(map).map(function(k){return map[k];});
}

function result(intent,type,summary,cards,steps,limitations,extra){
  var evidence=evidenceFromSteps(steps), merged=unique([].concat(intent.limitations||[],limitations||[]));
  return Object.assign({schemaVersion:'dashboard-search-result-v3',intent:intent,question:intent.question,type:type||intent.task,summary:summary,cards:cards||[],evidence:evidence,limitations:merged,validation:{passed:true,unverifiedNumbers:[],mode:'local-standard-query-v3'}},extra||{});
}

function clarification(intent){
  var tips=intent.clarificationOptions||intent.suggestions||STANDARD_QUESTIONS;
  var reason=intent.clarificationReason||intent.unsupportedReason||intent.limitations[0]||'问题缺少关键信息。';
  return result(intent,'clarification','当前无法按标准查询准确回答：'+reason,tips.map(function(q){return {text:'可以这样问：'+q,question:q,clarification:true};}),[],[],{answerable:false,clarificationReason:reason,clarificationOptions:tips.slice()});
}

function guarded(intent,required){
  if(intent.unsupported)return clarification(intent);
  var missing=[];
  if(required.org&&!intent.orgs.length)missing.push('机构');
  if(required.metric&&!intent.metrics.length)missing.push('指标');
  if(required.twoOrgs&&intent.orgs.length<2)missing.push('两个机构');
  if(required.condition&&!intent.conditions.length)missing.push('筛选条件');
  if(missing.length){
    intent.limitations=unique([].concat(intent.limitations||[],'缺少'+missing.join('、')+'，无法生成准确结果。'));
    return clarification(intent);
  }
  return null;
}

function snapshot(intent){
  var blocked=guarded(intent,{org:true,metric:true}); if(blocked)return blocked;
  var step=engine().tools.getMetricSnapshot({org:intent.orgs[0],period:intent.period,metric:intent.metrics[0]});
  if(!step.ok){
    var metricMeta=metrics().find(function(m){return m.metric===intent.metrics[0];})||{metric:intent.metrics[0],label:intent.metrics[0],unit:'',direction:''};
    var branch=branchesForPeriod(intent.period).find(function(org){return org.name===intent.orgs[0];});
    var value=recordValue(branch&&branch.record,metricMeta);
    if(numberValue(value)!=null){
      var formatted=formatValue(value,metricMeta.unit||'');
      var ev={id:hashId('ev_snapshot',[intent.orgs[0],intent.period,metricMeta.metric,value]),org:intent.orgs[0],orgId:branch&&branch.orgId||'',orgLevel:'branch',period:intent.period,metric:metricMeta.metric,label:metricMeta.label,value:value,formattedValue:formatted,unit:metricMeta.unit||'',direction:metricMeta.direction||'',source:'metric_snapshot_direct',basis:'period_metric',basisLabel:'按所选月份数据口径'};
      step={tool:'getMetricSnapshotDirect',ok:true,org:{name:intent.orgs[0],level:'branch'},period:intent.period,metric:metricMeta,value:numberValue(value),formattedValue:formatted,evidence:[ev],limitations:[]};
    }
  }
  if(!step.ok)return result(intent,'snapshot','未找到 '+intent.orgs[0]+' '+intent.period+' '+(intent.metricLabel||intent.metrics[0])+' 的有效数据。',[],[step],step.limitations);
  var text=step.org.name+' '+step.period+' '+step.metric.label+'为'+step.formattedValue+'。';
  return result(intent,'snapshot',text,[{org:step.org.name,period:step.period,metric:step.metric.label,value:step.formattedValue,text:text,evidenceIds:step.evidence.map(function(ev){return ev.id;})}],[step],[]);
}

function theme(intent){
  var blocked=guarded(intent,{org:true}); if(blocked)return blocked;
  if(!intent.metrics.length)return clarification(Object.assign(intent,{limitations:unique([].concat(intent.limitations||[],'未找到“'+(intent.themeLabel||'该主题')+'”相关指标。'))}));
  var steps=intent.metrics.map(function(metric){return engine().tools.getMetricSnapshot({org:intent.orgs[0],period:intent.period,metric:metric});});
  var ok=steps.filter(function(s){return s.ok;});
  var cards=ok.map(function(s){return {org:s.org.name,period:s.period,metric:s.metric.label,value:s.formattedValue,text:s.metric.label+'：'+s.formattedValue,evidenceIds:s.evidence.map(function(ev){return ev.id;})};});
  if(!cards.length)return result(intent,'theme',intent.orgs[0]+' '+intent.period+' 暂未找到可用于回答“'+(intent.themeLabel||'主题分析')+'”的有效数据。',[],steps,[]);
  var lead=cards.length>=2?'已读取 '+cards.length+' 个主题指标':'当前只找到 1 个主题指标，主题分析证据不足';
  return result(intent,'theme',intent.orgs[0]+' '+intent.period+' '+(intent.themeLabel||'主题')+'情况：'+lead+'；'+cards.map(function(c){return c.text;}).join('；')+'。',cards,steps,[]);
}

function filter(intent){
  var blocked=guarded(intent,{condition:true}); if(blocked)return blocked;
  var branchOrgs=branchesForPeriod(intent.period), steps=[], cards=[];
  branchOrgs.forEach(function(org){
    var details=[], orgSteps=[], passed=true;
    intent.conditions.forEach(function(cond){
      if(!cond.metric){passed=false;return;}
      var metricMeta=metrics().find(function(m){return m.metric===cond.metric;})||{metric:cond.metric,label:cond.metric,unit:''};
      var directValue=recordValue(org.record,metricMeta), step;
      if(numberValue(directValue)!=null){
        var formatted=formatValue(directValue,metricMeta.unit||'');
        var ev={id:hashId('ev_filter',[org.name,intent.period,cond.metric,directValue]),org:org.name,orgId:org.orgId||'',orgLevel:'branch',period:intent.period,metric:metricMeta.metric,label:metricMeta.label,value:directValue,formattedValue:formatted,unit:metricMeta.unit||'',direction:metricMeta.direction||'',source:'branch_filter',basis:'period_metric',basisLabel:'按所选月份数据口径'};
        step={tool:'branchFilterDirect',ok:true,org:{name:org.name,region:org.region||'',level:'branch'},period:intent.period,metric:metricMeta,value:directValue,formattedValue:formatted,evidence:[ev],limitations:[]};
      }else{
        step=engine().tools.getMetricSnapshot({org:org.name,period:intent.period,metric:cond.metric});
      }
      orgSteps.push(step);
      if(!step.ok){passed=false;return;}
      var v=numberValue(step.value), threshold=Number(cond.value);
      if(cond.operator==='<'&&!(v<threshold))passed=false;
      if(cond.operator==='>'&&!(v>threshold))passed=false;
      if(cond.operator==='>='&&!(v>=threshold))passed=false;
      if(cond.operator==='<='&&!(v<=threshold))passed=false;
      details.push(step.metric.label+' '+step.formattedValue);
    });
    if(passed&&intent.conditions.length){
      steps=steps.concat(orgSteps);
      cards.push({org:org.name,region:org.region||'',period:intent.period,text:org.name+'：'+details.join('；'),evidenceIds:evidenceFromSteps(orgSteps).map(function(ev){return ev.id;})});
    }
  });
  var conditionText=intent.conditions.map(function(c){return c.label;}).join('且')||'指定条件';
  var summary=cards.length?intent.period+' 符合“'+conditionText+'”的分公司共 '+cards.length+' 家：'+cards.map(function(c){return c.org;}).join('、')+'。':intent.period+' 未找到符合“'+conditionText+'”的分公司。';
  return result(intent,'filter',summary,cards.slice(0,50),steps,[]);
}

function rank(intent){
  var blocked=guarded(intent,{metric:true}); if(blocked)return blocked;
  var metric=intent.metrics[0], step=engine().tools.rankBranches({period:intent.period,metric:metric,limit:intent.limit||5});
  if(!step.ok||!step.rows||!step.rows.length){
    var metricMeta=metrics().find(function(m){return m.metric===metric;})||{metric:metric,label:metric,unit:'',direction:''};
    var rows=[], evs=[];
    branchesForPeriod(intent.period).forEach(function(org){
      var value=recordValue(org.record,metricMeta);
      if(numberValue(value)==null)return;
      var formatted=formatValue(value,metricMeta.unit||'');
      var ev={id:hashId('ev_rank',[org.name,intent.period,metric,value]),org:org.name,orgId:org.orgId||'',orgLevel:'branch',period:intent.period,metric:metricMeta.metric,label:metricMeta.label,value:value,formattedValue:formatted,unit:metricMeta.unit||'',direction:metricMeta.direction||'',source:'branch_ranking_direct',basis:'period_metric',basisLabel:'按所选月份数据口径'};
      evs.push(ev);
      rows.push({org:org.name,region:org.region||'',value:numberValue(value),formattedValue:formatted,evidenceId:ev.id});
    });
    rows.sort(function(a,b){return metricMeta.direction==='asc'?a.value-b.value:b.value-a.value;});
    rows.forEach(function(row,index){row.rank=index+1;row.total=rows.length;});
    step={tool:'rankBranchesDirect',ok:rows.length>0,period:intent.period,metric:metricMeta,rows:rows,top:rows.slice(0,intent.limit||5),bottom:rows.slice(-(intent.limit||5)),evidence:evs,limitations:rows.length?[]:['没有可排名的分公司数据']};
  }
  if(!step.ok)return result(intent,'rank','无法排名：没有可用分公司数据。',[],[step],step.limitations);
  var wantsLow=/最低|最差|后|bottom/i.test(intent.question), rows;
  if(wantsLow)rows=step.metric.direction==='asc'?step.top:step.bottom.slice().reverse();
  else rows=step.top;
  var direction=dict()&&dict().betterDirection(step.metric)||'';
  intent.sortDirection=wantsLow?'低到高':'高到低';
  var cards=rows.map(function(row){return {org:row.org,region:row.region||'',period:intent.period,metric:step.metric.label,rank:row.rank,total:row.total,value:row.formattedValue,text:'第 '+row.rank+'/'+row.total+' 名：'+row.org+'，'+step.metric.label+' '+row.formattedValue,evidenceIds:[row.evidenceId]};});
  return result(intent,'rank',intent.period+' '+step.metric.label+'排名如下（排序：'+intent.sortDirection+'；'+direction+'）：'+cards.map(function(c){return c.org+'第'+c.rank+'名';}).join('、')+'。',cards,[step],[]);
}

function trend(intent){
  var blocked=guarded(intent,{org:true,metric:true}); if(blocked)return blocked;
  var step=engine().tools.getTrendSeries({org:intent.orgs[0],metric:intent.metrics[0],periods:intent.range});
  if(!step.ok||!step.series.length){
    var metricMeta=metrics().find(function(m){return m.metric===intent.metrics[0];})||{metric:intent.metrics[0],label:intent.metricLabel||intent.metrics[0],unit:'',direction:''};
    var rows=[], evs=[];
    asArray(intent.range).forEach(function(period){
      var branch=branchesForPeriod(period).find(function(org){return org.name===intent.orgs[0];});
      var value=recordValue(branch&&branch.record,metricMeta);
      if(numberValue(value)==null)return;
      var formatted=formatValue(value,metricMeta.unit||'');
      var ev={id:hashId('ev_trend',[intent.orgs[0],period,metricMeta.metric,value]),org:intent.orgs[0],orgId:branch&&branch.orgId||'',orgLevel:'branch',period:period,metric:metricMeta.metric,label:metricMeta.label,value:value,formattedValue:formatted,unit:metricMeta.unit||'',direction:metricMeta.direction||'',source:'trend_series_direct',basis:'period_metric',basisLabel:'按所选月份数据口径'};
      evs.push(ev);
      rows.push({period:period,value:numberValue(value),formattedValue:formatted,evidenceId:ev.id});
    });
    step={tool:'getTrendSeriesDirect',ok:rows.length>0,org:intent.orgs[0],metric:metricMeta,series:rows,evidence:evs,limitations:rows.length?[]:['没有可用趋势数据']};
  }
  if(!step.ok||!step.series.length)return result(intent,'trend','未找到 '+intent.orgs[0]+' '+(intent.metricLabel||intent.metrics[0])+' 的趋势数据。',[],[step],step.limitations);
  var cards=step.series.map(function(row){return {org:intent.orgs[0],period:row.period,metric:step.metric.label,value:row.formattedValue,text:row.period+'：'+row.formattedValue,evidenceIds:[row.evidenceId]};});
  var first=step.series[0], last=step.series[step.series.length-1], delta=numberValue(last.value)-numberValue(first.value);
  var max=step.series.slice().sort(function(a,b){return b.value-a.value;})[0], min=step.series.slice().sort(function(a,b){return a.value-b.value;})[0];
  var trendText=delta>0?'整体上升':(delta<0?'整体下降':'整体持平');
  var limits=[];
  if(intent.rangeMeta&&intent.rangeMeta.requestedMonths>1&&step.series.length<intent.rangeMeta.requestedMonths){
    limits.push('当前看板仅有 '+step.series.length+' 个月可用数据，未覆盖完整'+(intent.rangeMeta.label||('近'+intent.rangeMeta.requestedMonths+'个月'))+'。');
  }
  return result(intent,'trend',intent.orgs[0]+' '+step.metric.label+'趋势：'+cards.map(function(c){return c.text;}).join('，')+'；首末变化为'+formatValue(delta,step.metric.unit||'')+'，'+trendText+'；最高点 '+max.period+'，最低点 '+min.period+'。',cards,[step],limits);
}

function compare(intent){
  var blocked=guarded(intent,{twoOrgs:true,metric:true}); if(blocked)return blocked;
  var metricMeta=metrics().find(function(m){return m.metric===intent.metrics[0];})||null;
  var steps=intent.orgs.slice(0,4).map(function(org){return engine().tools.getMetricSnapshot({org:org,period:intent.period,metric:intent.metrics[0]});});
  var ok=steps.filter(function(s){return s.ok;});
  if(ok.length<intent.orgs.slice(0,4).length){
    var branchMap={};
    branchesForPeriod(intent.period).forEach(function(org){branchMap[org.name]=org;});
    steps=intent.orgs.slice(0,4).map(function(orgName){
      var org=branchMap[orgName], value=recordValue(org&&org.record,metricMeta);
      if(numberValue(value)==null)return {tool:'compareDirect',ok:false,org:{name:orgName},metric:metricMeta,evidence:[],limitations:[orgName+' 缺少 '+(metricMeta&&metricMeta.label||intent.metricLabel)+' 数据']};
      var formatted=formatValue(value,metricMeta.unit||'');
      var ev={id:hashId('ev_compare',[orgName,intent.period,metricMeta.metric,value]),org:orgName,orgId:org&&org.orgId||'',orgLevel:'branch',period:intent.period,metric:metricMeta.metric,label:metricMeta.label,value:value,formattedValue:formatted,unit:metricMeta.unit||'',direction:metricMeta.direction||'',source:'branch_compare_direct',basis:'period_metric',basisLabel:'按所选月份数据口径'};
      return {tool:'compareDirect',ok:true,org:{name:orgName,level:'branch'},period:intent.period,metric:metricMeta,value:numberValue(value),formattedValue:formatted,evidence:[ev],limitations:[]};
    });
    ok=steps.filter(function(s){return s.ok;});
  }
  var cards=ok.map(function(s){return {org:s.org.name,period:s.period,metric:s.metric.label,value:s.formattedValue,text:s.org.name+'：'+s.formattedValue,evidenceIds:s.evidence.map(function(ev){return ev.id;})};});
  if(cards.length<2)return result(intent,'compare','未找到足够数据用于机构对比。',cards,steps,[]);
  var metric=ok[0].metric, sorted=ok.slice().sort(function(a,b){return metric.direction==='asc'?a.value-b.value:b.value-a.value;});
  var diff=Math.abs(numberValue(sorted[0].value)-numberValue(sorted[1].value));
  return result(intent,'compare',intent.period+' '+metric.label+'对比：'+cards.map(function(c){return c.text;}).join('；')+'。按'+(dict()&&dict().betterDirection(metric)||'指标方向')+'口径，表现更好的是'+sorted[0].org.name+'，与'+sorted[1].org.name+'差异为'+formatValue(diff,metric.unit||'')+'。',cards,steps,[]);
}

function execute(intent){
  if(intent.unsupported)return clarification(intent);
  if(intent.task==='filter')return filter(intent);
  if(intent.task==='rank')return rank(intent);
  if(intent.task==='trend')return trend(intent);
  if(intent.task==='compare')return compare(intent);
  if(intent.task==='theme')return theme(intent);
  return snapshot(intent);
}

function install(){
  var ai=engine();
  if(!ai)return;
  ai.__semanticSearchV2OriginalParse=ai.__semanticSearchV2OriginalParse||ai.parseSearchIntent;
  ai.__semanticSearchV2OriginalRun=ai.__semanticSearchV2OriginalRun||ai.runSearch;
  ai.parseSearchIntent=function(question,options){
    try{return parseQueryIntent(question,options);}catch(error){return {schemaVersion:'dashboard-query-intent-v3',question:String(question||''),task:'snapshot',intent:'snapshot',orgs:[],period:currentPeriod(),range:[currentPeriod()].filter(Boolean),theme:'',metrics:[],conditions:[],confidence:0,limitations:['结构化解析失败：'+error.message]};}
  };
  ai.runSearch=function(input,options){
    try{
      var intent=typeof input==='string'?parseQueryIntent(input,options):input;
      return execute(intent);
    }catch(error){
      return {schemaVersion:'dashboard-search-result-v3',intent:null,question:String(input||''),type:'error',summary:'搜索失败：'+error.message,cards:[],evidence:[],limitations:[error.message],validation:{passed:false,unverifiedNumbers:[],mode:'local-standard-query-v3-error'}};
    }
  };
  ai.parseStructuredSearchIntent=parseQueryIntent;
  ai.hasRangeExpression=hasRangeExpression;
  ai.__semanticSearchV2Installed=true;
}

window.DashboardQueryIntent={version:'search-intent-v3',supportedTasks:SUPPORTED_TASKS,parse:parseQueryIntent,execute:execute,install:install,hasRangeExpression:hasRangeExpression};
install();
})();
