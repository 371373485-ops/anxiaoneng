
var charts={};
var INDICATOR_DESC=[
  {g:"保费", items:[
    {k:"车险计划", f:"Excel导入", s:"手动", r:"依赖Excel模板数据准确性；修改计划需更新版本号"},
    {k:"车险实际", f:"Excel导入（月度实际数据）", s:"手动", r:"依赖业务系统数据准确性；累计值需与月度匹配"},
    {k:"车险时间进度计划达成率", f:"车险实际 ÷ (车险计划 × TP)", s:"自动", r:"TP=4/12为固定值，若月份变更需同步调整TP"},
    {k:"财产险计划", f:"Excel导入", s:"手动", r:"同车险计划"},
    {k:"财产险实际", f:"Excel导入（月度实际数据）", s:"手动", r:"同车险实际"},
    {k:"财产险时间进度计划达成率", f:"财产险实际 ÷ (财产险计划 × TP)", s:"自动", r:"同车险达成率"},
    {k:"人身险计划", f:"Excel导入", s:"手动", r:"同车险计划"},
    {k:"人身险实际", f:"Excel导入（月度实际数据）", s:"手动", r:"同车险实际"},
    {k:"人身险时间进度计划达成率", f:"人身险实际 ÷ (人身险计划 × TP)", s:"自动", r:"同车险达成率"},
    {k:"保费实际合计", f:"车险实际 + 财产险实际 + 人身险实际", s:"自动", r:"三个险种任一数据缺失都会导致合计偏小"},
    {k:"保费年度计划", f:"车险计划 + 财产险计划 + 人身险计划", s:"自动", r:"三个险种计划任一缺失导致合计偏小"},
    {k:"已赚保费", f:"Excel导入（月度实际数据）", s:"手动", r:"已赚保费计算口径因公司而异，需与财务口径对齐"},
    {k:"已赚保费计划", f:"Excel导入（年度计划）", s:"手动", r:"已赚保费计划需与保费计划保持合理比例关系，否则COR计划失真"},
    {k:"时间进度计划达成率", f:"保费实际合计 ÷ (保费年度计划 × TP)", s:"自动", r:"TP固定为4/12；若月份变更需调整"}
  ]},
  {g:"效益", items:[
    {k:"经营利润", f:"Excel导入（月度实际数据）", s:"手动", r:"利润数据需与财务系统对齐；负利润时衍生指标计算可能为0或异常"},
    {k:"当月经营利润", f:"Excel导入（当月数据）", s:"手动", r:"需确认是否为当月新增利润还是累计利润"},
    {k:"经营利润年度计划", f:"Excel导入（年度计划）", s:"手动", r:"利润计划修改后版本号需更新"},
    {k:"时间进度达成率", f:"经营利润÷(经营利润年度计划×TP)；负计划特殊处理", s:"自动", r:"利润为负值时达成率无意义；正计划负利润时达成率为0"},
    {k:"综合成本率实际（整体利润口径）", f:"1 - 经营利润÷已赚保费（已赚保费>0时）", s:"自动", r:"已赚保费=0时COR=0（无意义）；需确保已赚保费已导入"},
    {k:"综合成本率计划（整体利润口径）", f:"1 - 经营利润年度计划÷已赚保费计划（>0时）", s:"自动（覆盖Excel）", r:"已赚保费计划=0时COR计划=0；区域/全国先求和计划数据再算COR"},
    {k:"与本年计划比较", f:"综合成本率实际 - 综合成本率计划", s:"自动", r:"正值=劣化，负值=改善；两指标误差会累积"},
    {k:"已赚赔付率实际", f:"Excel导入", s:"手动", r:"赔付率口径需统一（已赚口径）"},
    {k:"已赚费用率实际", f:"Excel导入", s:"手动", r:"费用率口径需统一"}
  ]},
  {g:"效能", items:[
    {k:"前台人均产能计划", f:"保费年度计划 ÷ 前台人员计划", s:"自动", r:"人员计划变化时产能计划相应变化"},
    {k:"前台人均产能实际", f:"保费实际合计 ÷ (前台平均人数 × TP)", s:"自动", r:"平均人数未按月取平均会导致年化值偏差"},
    {k:"前台人人均产能计划达成率", f:"人均产能实际 ÷ 人均产能计划", s:"自动", r:"产能计划=0时达成率为0"},
    {k:"后台人均产能计划", f:"保费年度计划 ÷ 后台人员计划", s:"自动", r:"同前台"},
    {k:"后台人均产能实际", f:"保费实际合计 ÷ (后台平均人数 × TP)", s:"自动", r:"同前台"},
    {k:"后台人人均产能计划达成率", f:"人均产能实际 ÷ 人均产能计划", s:"自动", r:"同前台"},
    {k:"整体人均产能计划", f:"保费年度计划 ÷ 整体人员计划", s:"自动", r:"整体人员=前台+后台"},
    {k:"整体人均产能实际", f:"保费实际合计 ÷ (整体平均人数 × TP)", s:"自动", r:"同前台"},
    {k:"整体人人均产能计划达成率", f:"人均产能实际 ÷ 人均产能计划", s:"自动", r:"同前台"},
    {k:"前台人力成本保费率计划", f:"前台人力成本预算 ÷ 保费年度计划", s:"自动", r:"保费年度计划=0时比率为0"},
    {k:"后台人力成本保费率预算", f:"后台人力成本预算 ÷ 保费年度计划", s:"自动", r:"同前台"},
    {k:"整体人力成本保费率预算", f:"整体人力成本预算 ÷ 保费年度计划", s:"自动", r:"同前台"},
    {k:"前台人力成本保费率实际", f:"前台人力成本实际 ÷ 保费实际合计", s:"自动", r:"保费实际合计=0时比率为0"},
    {k:"后台人力成本保费率实际", f:"后台人力成本实际 ÷ 保费实际合计", s:"自动", r:"同前台"},
    {k:"整体人力成本保费率实际", f:"整体人力成本实际 ÷ 保费实际合计", s:"自动", r:"同前台"},
    {k:"前台人力成本保费率计划执行率", f:"保费率实际 ÷ 保费率计划", s:"自动", r:"计划=0时执行率为0"},
    {k:"后台人力成本保费率计划执行率", f:"保费率实际 ÷ 保费率计划", s:"自动", r:"同前台"},
    {k:"整体人力成本保费率计划执行率", f:"保费率实际 ÷ 保费率计划", s:"自动", r:"同前台"},
    {k:"前台人力成本利润值计划", f:"经营利润年度计划 ÷ 前台人力成本预算", s:"自动", r:"成本预算=0时利润值为0"},
    {k:"后台人力成本利润值预算", f:"经营利润年度计划 ÷ 后台人力成本预算", s:"自动", r:"同前台"},
    {k:"整体人力成本利润值预算", f:"经营利润年度计划 ÷ 整体人力成本预算", s:"自动", r:"同前台"},
    {k:"前台人力成本利润值实际", f:"经营利润 ÷ 前台人力成本实际", s:"自动", r:"成本实际=0或利润为负时结果异常"},
    {k:"后台人力成本利润值实际", f:"经营利润 ÷ 后台人力成本实际", s:"自动", r:"同前台"},
    {k:"整体人力成本利润值实际", f:"经营利润 ÷ 整体人力成本实际", s:"自动", r:"同前台"}
  ]},
  {g:"人员", items:[
    {k:"前台人员计划", f:"Excel导入（年度计划）", s:"手动", r:"人员计划变更需更新计划版本"},
    {k:"前台人员实际", f:"Excel导入（月度实际数据）", s:"手动", r:"实际人数口径需统一（全职/兼职/借调）"},
    {k:"前台人员计划执行率", f:"前台人员实际 ÷ 前台人员计划", s:"自动", r:"计划=0时执行率为0"},
    {k:"前台平均人数", f:"Excel导入", s:"手动", r:"需确认平均人数方法（月初+月末/2 或 日均）"},
    {k:"后台人员计划", f:"Excel导入（年度计划）", s:"手动", r:"同前台"},
    {k:"后台人员实际", f:"Excel导入（月度实际数据）", s:"手动", r:"同前台"},
    {k:"后台人员计划执行率", f:"后台人员实际 ÷ 后台人员计划", s:"自动", r:"同前台"},
    {k:"后台平均人数", f:"Excel导入", s:"手动", r:"同前台"},
    {k:"整体人员计划", f:"前台人员计划 + 后台人员计划", s:"自动", r:"两数据任一缺失导致合计偏小"},
    {k:"整体人员实际", f:"前台人员实际 + 后台人员实际", s:"自动", r:"同整体人员计划"},
    {k:"整体平均人数", f:"Excel导入", s:"手动", r:"同前台"},
    {k:"整体人员计划执行率", f:"整体人员实际 ÷ 整体人员计划", s:"自动", r:"同前台"},
    {k:"前台人力成本预算", f:"Excel导入（年度计划）", s:"手动", r:"成本预算需与财务口径对齐"},
    {k:"前台人力成本实际", f:"Excel导入（月度实际数据）", s:"手动", r:"实际成本需与人力成本核算口径一致"},
    {k:"前台人力成本预算执行率", f:"前台人力成本实际 ÷ (前台人力成本预算×TP)", s:"自动", r:"TP固定；预算=0时执行率为0"},
    {k:"后台人力成本预算", f:"Excel导入（年度计划）", s:"手动", r:"同前台成本预算"},
    {k:"后台人力成本实际", f:"Excel导入（月度实际数据）", s:"手动", r:"同前台成本实际"},
    {k:"后台人力成本预算执行率", f:"后台人力成本实际 ÷ (后台人力成本预算×TP)", s:"自动", r:"同前台成本执行率"},
    {k:"整体人力成本预算", f:"前台+后台人力成本预算", s:"自动", r:"系统根据前后台预算自动求和"},
    {k:"整体人力成本实际", f:"前台+后台人力成本实际", s:"自动", r:"系统根据前后台实际自动求和"},
    {k:"整体人力成本预算执行率", f:"整体人力成本实际 ÷ (整体人力成本预算×TP)", s:"自动", r:"同前台成本执行率"}
  ]}
];



// 全局柱状图数值标注插件
if(typeof Chart!=='undefined'){Chart.register({id:'barVals',afterDatasetsDraw:function(chart){var ctx=chart.ctx;ctx.save();var u=chart.options._unit||'';chart.data.datasets.forEach(function(ds,i){var meta=chart.getDatasetMeta(i);if(meta.hidden)return;meta.data.forEach(function(bar,j){var v=ds.data[j];if(v==null||isNaN(v))return;var txt;if(u==='%')txt=v.toFixed(1)+'%';else if(u==='万元')txt=Math.abs(v)>=100?v.toFixed(0):v.toFixed(2);else if(u==='万元/人')txt=v.toFixed(1);else if(u==='人')txt=v.toFixed(0);else txt=Math.abs(v)>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0);ctx.fillStyle='#1e3a5f';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,bar.x,bar.y-3);});});ctx.restore();}});}
var DATA={get national(){var mk='_merged',cm=currentMonth;return ALL_DATA[mk]&&ALL_DATA[mk][cm]?ALL_DATA[mk][cm].national:{};},get regions(){var mk='_merged',cm=currentMonth;return ALL_DATA[mk]&&ALL_DATA[mk][cm]?ALL_DATA[mk][cm].regions:{};},get branches(){var mk='_merged',cm=currentMonth;return ALL_DATA[mk]&&ALL_DATA[mk][cm]?ALL_DATA[mk][cm].branches:[];}};
var KEY_KEYS=['保费实际合计','时间进度计划达成率','经营利润','当月经营利润','时间进度达成率','综合成本率实际（整体利润口径）','已赚赔付率实际','已赚费用率实际','整体人均产能实际','整体人力成本保费率实际'];
var KEY_SET=new Set(KEY_KEYS);
var RANK_ASC={'综合成本率实际（整体利润口径）':1,'已赚赔付率实际':1,'已赚费用率实际':1,'前台人力成本保费率实际':1,'后台人力成本保费率实际':1,'整体人力成本保费率实际':1};
var CORE_KEYS={保费:['车险实际','财产险实际','人身险实际','保费实际合计'],效益:['经营利润','当月经营利润','综合成本率实际（整体利润口径）','已赚赔付率实际','已赚费用率实际'],效能:['整体人均产能实际','整体人力成本保费率实际','整体人力成本利润值实际','后台人均产能实际','后台人力成本保费率实际','后台人力成本利润值实际'],人员:['整体人员实际','整体平均人数','前台人员实际','后台人员实际']};

// 使用全国数据对比的指标（其余用分公司均值对比）
var NAT_CMP=new Set(['综合成本率实际（整体利润口径）','前台人均产能实际','后台人均产能实际','整体人均产能实际','前台人力成本保费率实际','后台人力成本保费率实际','整体人力成本保费率实际','前台人力成本利润值实际','后台人力成本利润值实际','整体人力成本利润值实际']);


window.onerror=function(msg,src,line,col,err){
  var p=document.getElementById('errPanel');
  if(p){
    p.style.display='block';


    p.textContent='[Page Error] '+msg+'\n  at '+src+':'+line+':'+col+'\n'+(err&&err.stack?err.stack:'');
  }
};
var DEFAULT_DATA={"_plans":{},"actuals":{},"currentMonth":"2026-04","currentPlanKey":"auto"},FIELDS=[{"g": "保费", "k": "车险计划", "l": "车险计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "车险实际", "l": "车险实际", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "车险时间进度计划达成率", "l": "车险达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "保费", "k": "财产险计划", "l": "财产险计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "财产险实际", "l": "财产险实际", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "财产险时间进度计划达成率", "l": "财产险达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "保费", "k": "人身险计划", "l": "人身险计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "人身险实际", "l": "人身险实际", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "人身险时间进度计划达成率", "l": "人身险达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "保费", "k": "保费实际合计", "l": "保费实际合计", "u": "万元", "rd": "desc", "c": 1, "m": 0}, {"g": "保费", "k": "保费年度计划", "l": "保费年度计划", "u": "万元", "rd": "desc", "m": 0}, {"g": "保费", "k": "已赚保费", "l": "已赚保费", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "已赚保费计划", "l": "已赚保费计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "时间进度计划达成率", "l": "保费达成率", "u": "%", "rd": "desc", "c": 1, "m": 0}, {"g": "效益", "k": "经营利润", "l": "经营利润", "u": "万元", "rd": "desc", "c": 1, "m": 1}, {"g": "效益", "k": "当月经营利润", "l": "当月经营利润", "u": "万元", "rd": "desc", "m": 1}, {"g": "效益", "k": "经营利润年度计划", "l": "利润年度计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "效益", "k": "时间进度达成率", "l": "利润达成率", "u": "%", "rd": "desc", "c": 1, "m": 0}, {"g": "效益", "k": "综合成本率实际（整体利润口径）", "l": "综合成本率", "u": "%", "rd": "asc", "c": 1, "m": 0}, {"g": "效益", "k": "综合成本率计划（整体利润口径）", "l": "综合成本率计划", "u": "%", "rd": "asc", "m": 1}, {"g": "效益", "k": "与本年计划比较", "l": "COR与计划差", "u": "%", "rd": "asc", "m": 0}, {"g": "效益", "k": "已赚赔付率实际", "l": "已赚赔付率", "u": "%", "rd": "asc", "c": 1, "m": 1}, {"g": "效益", "k": "已赚费用率实际", "l": "已赚费用率", "u": "%", "rd": "asc", "m": 1}, {"g": "效能", "k": "前台人均产能计划", "l": "前台产能(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人均产能实际", "l": "前台产能(实际)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人人均产能计划达成率", "l": "前台产能达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人均产能计划", "l": "后台产能(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人均产能实际", "l": "后台产能(实际)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人人均产能计划达成率", "l": "后台产能达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人均产能计划", "l": "整体产能(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人均产能实际", "l": "整体产能(实际)", "u": "万元/人", "rd": "desc", "c": 1, "m": 0}, {"g": "效能", "k": "整体人人均产能计划达成率", "l": "整体产能达成率", "u": "%", "rd": "desc", "c": 1, "m": 0}, {"g": "效能", "k": "前台人力成本预算", "l": "前台成本(预算)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "前台人力成本实际", "l": "前台成本(实际)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "前台人力成本预算执行率", "l": "前台成本执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人力成本预算", "l": "后台成本(预算)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "后台人力成本实际", "l": "后台成本(实际)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "后台人力成本预算执行率", "l": "后台成本执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人力成本预算", "l": "整体成本(预算)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "整体人力成本实际", "l": "整体成本(实际)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "整体人力成本预算执行率", "l": "整体成本执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人力成本保费率计划", "l": "前台保费率(计划)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "前台人力成本保费率实际", "l": "前台保费率(实际)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "前台人力成本保费率计划执行率", "l": "前台保费率执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人力成本保费率预算", "l": "后台保费率(计划)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "后台人力成本保费率实际", "l": "后台保费率(实际)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "后台人力成本保费率计划执行率", "l": "后台保费率执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人力成本保费率预算", "l": "整体保费率(计划)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "整体人力成本保费率实际", "l": "整体保费率(实际)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "整体人力成本保费率计划执行率", "l": "整体保费率执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人力成本利润值计划", "l": "前台利润值(计划)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人力成本利润值实际", "l": "前台利润值(实际)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人力成本利润值预算", "l": "后台利润值(计划)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人力成本利润值实际", "l": "后台利润值(实际)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人力成本利润值预算", "l": "整体利润值(计划)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人力成本利润值实际", "l": "整体利润值(实际)", "u": "万元", "rd": "desc", "m": 0}, {"g": "人员", "k": "前台人员计划", "l": "前台计划", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "前台人员实际", "l": "前台实际", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "前台平均人数", "l": "前台平均", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "前台人员计划执行率", "l": "前台执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "人员", "k": "后台人员计划", "l": "后台计划", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "后台人员实际", "l": "后台实际", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "后台平均人数", "l": "后台平均", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "后台人员计划执行率", "l": "后台执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "人员", "k": "整体人员计划", "l": "整体计划", "u": "人", "rd": "desc", "m": 0}, {"g": "人员", "k": "整体人员实际", "l": "整体实际", "u": "人", "rd": "desc", "c": 1, "m": 0}, {"g": "人员", "k": "整体平均人数", "l": "整体平均", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "整体人员计划执行率", "l": "整体执行率", "u": "%", "rd": "desc", "m": 0}],CHART_GROUPS={"保费": [{"title": "车险保费（万元）", "keys": ["车险计划", "车险实际"]}, {"title": "财产险保费（万元）", "keys": ["财产险计划", "财产险实际"]}, {"title": "人身险保费（万元）", "keys": ["人身险计划", "人身险实际"]}, {"title": "保费汇总（万元）", "keys": ["保费实际合计", "已赚保费"]}, {"title": "保费年度计划（万元）", "keys": ["保费年度计划"]}], "效益": [{"title": "经营利润（万元）", "keys": ["经营利润", "当月经营利润"]}, {"title": "利润年度计划（万元）", "keys": ["经营利润年度计划"]}, {"title": "综合成本率（%）", "keys": ["综合成本率实际（整体利润口径）", "综合成本率计划（整体利润口径）"]}, {"title": "赔付率与费用率（%）", "keys": ["已赚赔付率实际", "已赚费用率实际"]}], "效能": [{"title": "人均产能额度（万元/人）", "keys": ["前台人均产能计划", "前台人均产能实际", "后台人均产能计划", "后台人均产能实际", "整体人均产能计划", "整体人均产能实际"]}, {"title": "人力成本额度（万元）", "keys": ["前台人力成本预算", "前台人力成本实际", "后台人力成本预算", "后台人力成本实际", "整体人力成本预算", "整体人力成本实际"]}, {"title": "人力成本保费率（%）", "keys": ["前台人力成本保费率计划", "前台人力成本保费率实际", "后台人力成本保费率预算", "后台人力成本保费率实际", "整体人力成本保费率预算", "整体人力成本保费率实际"]}, {"title": "人力成本利润值（万元）", "keys": ["前台人力成本利润值计划", "前台人力成本利润值实际", "后台人力成本利润值预算", "后台人力成本利润值实际", "整体人力成本利润值预算", "整体人力成本利润值实际"]}], "人员": [{"title": "前台人员（人）", "keys": ["前台人员计划", "前台人员实际", "前台平均人数"]}, {"title": "后台人员（人）", "keys": ["后台人员计划", "后台人员实际", "后台平均人数"]}, {"title": "整体人员（人）", "keys": ["整体人员计划", "整体人员实际", "整体平均人数"]}]},REGIONS=['第一责任区','第二责任区','第三责任区','第四责任区'],TP=4/12,COLOR4=['rgba(59,130,246,.7)','rgba(16,185,129,.7)','rgba(239,68,68,.7)','rgba(139,92,246,.7)'];
var STORAGE_KEY='anxiaoneng_v13';
var PLAN_KEYS=["车险计划", "财产险计划", "人身险计划", "经营利润年度计划", "已赚保费计划", "综合成本率计划（整体利润口径）", "前台人员计划", "后台人员计划", "前台人力成本预算", "后台人力成本预算", "整体人力成本预算"];
var ACTUAL_KEYS=["车险实际", "财产险实际", "人身险实际", "已赚保费", "经营利润", "当月经营利润", "已赚赔付率实际", "已赚费用率实际", "前台人员实际", "前台平均人数", "后台人员实际", "后台平均人数", "整体平均人数", "前台人力成本实际", "后台人力成本实际", "整体人力成本实际"];
var ALL_DATA=DEFAULT_DATA;
var currentMonth=DEFAULT_DATA.currentMonth||'2026-04';
var currentPlanKey=DEFAULT_DATA.currentPlanKey||'auto';
(function initData(){
  try{var s=localStorage.getItem(STORAGE_KEY);if(s){var p=JSON.parse(s);ALL_DATA=p;currentMonth=p.currentMonth||'2026-04';currentPlanKey=p.currentPlanKey||'auto';}}
  catch(e){}
  saveAllData();
  updateMonthUI();
  updatePlanUI();
  refreshMergedData();
  switchTab('overview');
})();
Object.defineProperty(window,'DATA',{get:function(){if(ALL_DATA._merged&&ALL_DATA._merged[currentMonth])return ALL_DATA._merged[currentMonth];return {national:{},regions:{},branches:[]};}});

function saveAllData(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(ALL_DATA));}catch(e){}}
function refreshMergedData(){
  var pk=resolvePlanKey();
  var mk='_merged';
  if(!ALL_DATA[mk])ALL_DATA[mk]={};
  var plan=ALL_DATA._plans&&ALL_DATA._plans[pk]?ALL_DATA._plans[pk]:null;
  var actual=ALL_DATA.actuals&&ALL_DATA.actuals[currentMonth]?ALL_DATA.actuals[currentMonth]:null;
  if(!actual)actual={branches:[],regions:{},national:{}};
  if(!plan){
    // No plan - use actual data only (plan fields will be 0)
    ALL_DATA[mk][currentMonth]=JSON.parse(JSON.stringify(actual));
    var empty={};
    for(var i=0;i<PLAN_KEYS.length;i++)empty[PLAN_KEYS[i]]=0;
    if(ALL_DATA[mk][currentMonth].national)Object.assign(ALL_DATA[mk][currentMonth].national,empty);
    for(var r in ALL_DATA[mk][currentMonth].regions)Object.assign(ALL_DATA[mk][currentMonth].regions[r],empty);
    // For branches: merge plan into each branch
    var ab=ALL_DATA[mk][currentMonth].branches||[];
    for(var bi=0;bi<ab.length;bi++){
      var pb=findPlanBranch(plan,ab[bi].r,ab[bi].n);
      for(var j=0;j<PLAN_KEYS.length;j++){var kk=PLAN_KEYS[j];if(pb&&pb[kk]!=null)ab[bi].d[kk]=pb[kk];else ab[bi].d[kk]=0;}
    }
  }else{
    // Merge plan + actual at branch level
    var merged=JSON.parse(JSON.stringify(actual));
    var ab2=merged.branches||[];
    for(var bi2=0;bi2<ab2.length;bi2++){
      var pb2=findPlanBranch(plan,ab2[bi2].r,ab2[bi2].n);
      for(var j2=0;j2<PLAN_KEYS.length;j2++){var kk2=PLAN_KEYS[j2];if(pb2&&pb2[kk2]!=null)ab2[bi2].d[kk2]=pb2[kk2];else ab2[bi2].d[kk2]=0;}
    }
    // If no actual branches, create merged branches from plan data
    if(ab2.length===0&&plan.branches&&plan.branches.length>0){
      for(var bpi=0;bpi<plan.branches.length;bpi++){
        var pb=plan.branches[bpi];var nd={};
        for(var fk in pb.d)nd[fk]=pb.d[fk];
        // Fill common actual keys with 0 so rendering doesn't break
        var AK=['车险实际','财产险实际','人身险实际','已赚保费','经营利润','当月经营利润','已赚赔付率实际','已赚费用率实际','前台人员实际','后台人员实际','前台平均人数','后台平均人数','整体平均人数','前台人力成本实际','后台人力成本实际','整体人力成本实际'];
        for(var ai=0;ai<AK.length;ai++){if(!(AK[ai] in nd))nd[AK[ai]]=0;}
        ab2.push({n:pb.n,r:pb.r,d:nd});
      }
    }
    ALL_DATA[mk][currentMonth]=merged;
  }
  // Now computeDerived on merged branches, then re-aggregate
  var mb=ALL_DATA[mk][currentMonth].branches||[];
  for(var mi=0;mi<mb.length;mi++){computeDerived(mb[mi].d);}
  // Compute COR计划 as derived: 1 - 经营利润年度计划 / total plan premium
  for(var bi3=0;bi3<mb.length;bi3++){
    var bd=mb[bi3].d;
    var totalPlan=(Number(bd['已赚保费计划'])||0);
    bd['综合成本率计划（整体利润口径）']=totalPlan>0?1-(Number(bd['经营利润年度计划'])||0)/totalPlan:0;
  }
  // Re-aggregate regions
  var rm={};
  for(var ri=0;ri<mb.length;ri++){var rr=mb[ri].r;if(!rm[rr])rm[rr]=[];rm[rr].push(mb[ri]);}
  var na={};
  REGIONS.forEach(function(rn){
    var bl=rm[rn]||[];if(bl.length===0)return;
    var agg={};
    for(var fi=0;fi<FIELDS.length;fi++){var fk=FIELDS[fi].k;agg[fk]=0;}
    FIELDS.filter(function(f){return f.m;}).forEach(function(f){agg[f.k]=bl.reduce(function(s,b){return s+(Number(b.d[f.k])||0);},0);});
    ['已赚赔付率实际','已赚费用率实际','综合成本率计划（整体利润口径）'].forEach(function(k){agg[k]=bl.reduce(function(s,b){return s+(Number(b.d[k])||0);},0)/bl.length;});
    computeDerived(agg);
    // COR计划 = 1 - 经营利润年度计划 / (车险计划+财产险计划+人身险计划)
    var rTotalPlan=(Number(agg['已赚保费计划'])||0);
    agg['综合成本率计划（整体利润口径）']=rTotalPlan>0?1-(Number(agg['经营利润年度计划'])||0)/rTotalPlan:0;
    ALL_DATA[mk][currentMonth].regions[rn]=agg;
  });
  for(var fi2=0;fi2<FIELDS.length;fi2++){var fk2=FIELDS[fi2].k;na[fk2]=0;}
  FIELDS.filter(function(f){return f.m;}).forEach(function(f){na[f.k]=mb.reduce(function(s,b){return s+(Number(b.d[f.k])||0);},0);});
  ['已赚赔付率实际','已赚费用率实际','综合成本率计划（整体利润口径）'].forEach(function(k){na[k]=mb.reduce(function(s,b){return s+(Number(b.d[k])||0);},0)/mb.length;});
  computeDerived(na);
  // COR计划 = 1 - 经营利润年度计划 / (车险计划+财产险计划+人身险计划)
  var nTotalPlan=(Number(na['已赚保费计划'])||0);
  na['综合成本率计划（整体利润口径）']=nTotalPlan>0?1-(Number(na['经营利润年度计划'])||0)/nTotalPlan:0;
  ALL_DATA[mk][currentMonth].national=na;
}
function findPlanBranch(planData,r,n){
  if(!planData||!planData.branches)return null;
  for(var i=0;i<planData.branches.length;i++){
    if(planData.branches[i].r===r&&planData.branches[i].n===n)return planData.branches[i].d;
  }
  return null;
}
function resolvePlanKey(){
  if(currentPlanKey!=='auto')return currentPlanKey;
  // Find the latest version for the current year
  var y=currentMonth.split('-')[0];
  var ks=ALL_DATA._plans?Object.keys(ALL_DATA._plans):[];
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
function switchMonth(m){currentMonth=m;ALL_DATA.currentMonth=m;refreshMergedData();saveAllData();updateMonthUI();updatePlanUI();destroyCharts();switchTab('overview');alert('导入完成！数据已加载。');}
function switchPlan(pk){currentPlanKey=pk;ALL_DATA.currentPlanKey=pk;refreshMergedData();saveAllData();updatePlanUI();destroyCharts();switchTab('overview');alert('导入完成！数据已加载。');}
function updateMonthUI(){
  document.getElementById('monthLabel').textContent=formatMonth(currentMonth);
  var sel=document.getElementById('monthSelect');
  sel.innerHTML='';
  var months=[];
  if(ALL_DATA.actuals)Object.keys(ALL_DATA.actuals).forEach(function(k){months.push(k);});
  months.sort().reverse();
  months.forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=formatMonth(k);if(k===currentMonth)o.selected=true;sel.appendChild(o);});
}
function updatePlanUI(){
  var sel=document.getElementById('planSelect');
  if(!sel)return;
  sel.innerHTML='';
  // Auto option
  var ao=document.createElement('option');ao.value='auto';ao.textContent='自动匹配（同年度最新版本）';if(currentPlanKey==='auto')ao.selected=true;sel.appendChild(ao);
  if(ALL_DATA._plans){
    var plans=Object.keys(ALL_DATA._plans).sort().reverse();
    plans.forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=k;if(k===currentPlanKey)o.selected=true;sel.appendChild(o);});
  }
}
function formatMonth(k){var p=k.split('-');return p[0]+'年'+parseInt(p[1])+'月';}
function resetAllData(){
  if(!confirm('确认还原为默认数据？所有导入的计划和实际数据将被清除。'))return;
  ALL_DATA={_plans:{},actuals:{},currentMonth:currentMonth||'2026-04',currentPlanKey:'auto'};
  currentMonth=ALL_DATA.currentMonth||'2026-04';
  currentPlanKey=ALL_DATA.currentPlanKey||'auto';
  localStorage.removeItem(STORAGE_KEY);
  saveAllData();updateMonthUI();updatePlanUI();
  refreshMergedData();destroyCharts();switchTab('overview');alert('导入完成！数据已加载。');
}


function destroyCharts(){if(charts){Object.values(charts).forEach(c=>c&&c.destroy());charts={};}}
function setDataMonth(m){
  currentMonth='2026-'+String(m).padStart(2,'0');
  // DATA getters automatically read from ALL_DATA._merged[currentMonth], no manual merge needed
  // If no data exists for this month, show empty state
  if(!DATA.branches||!DATA.branches.length){alert('该月份暂无导入数据，请先导入数据');return;}
  // recompute derived data for the selected month's data
  if(DATA.branches) DATA.branches.forEach(function(b){if(b&&b.d)computeDerived(b.d);});
  if(DATA.national&&DATA.national.d) computeDerived(DATA.national.d);
  // re-render current tab
  var at=document.querySelector('.nav button.active');
  if(at) switchTab(at.dataset.tab||'overview');
  else switchTab('overview');
}

function switchTab(t){document.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));document.querySelectorAll('.nav button').forEach(e=>e.classList.remove('active'));var tel=document.getElementById('tab-'+t);if(tel)tel.classList.add('active');var btn=document.querySelector('.nav button[onclick*="'+t+'"]');if(btn)btn.classList.add('active');try{destroyCharts();}catch(e){}if(t==='overview')renderOverview();if(t==='regions')renderRegions();if(t==='branches'){hideBranchDetail();renderBranches();}if(t==='guide')renderGuideTab();}
function fmtVal(v,u){if(v==null||isNaN(v))return'-';if(u==='万元'){let a=Math.abs(v);if(a<100&&a>0)return v.toFixed(2);return Math.round(v).toLocaleString();}if(u==='人')return Math.round(v).toLocaleString();if(u==='%')return (v*100).toFixed(2)+'%';if(u==='万元/人')return v.toFixed(2);return v.toFixed(2);}
function getColor(u,rd,v){if(u==='%'){if(rd==='desc')return v>=1?'hi-green':'hi-red';if(rd==='asc')return v<=0.98?'hi-green':'hi-red';}if(u==='万元'){if(rd==='desc')return v>0?'hi-green':(v<0?'hi-red':'');}return'';}



var TP_NOTE="* TP = 当前月份/12（根据数据月份动态计算），用于将年度计划值折算为截至当前月份的累计目标值";

function renderIndicatorGuide(){
  var gh=`<div class="section"><div class="sec-header" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')"><span class="arrow">▶</span><h3>📋 指标说明</h3><span class="badge">68项</span></div><div class="sec-body open">`;
  gh+='<p style="color:#666;font-size:12px;margin:8px 0">'+TP_NOTE+'<br><span style=color:#888>本模块与看板指标同步更新。若发现描述与实际计算不一致，请反馈核实。</span></p>';
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

function computeDerived(d){
    var TP=(parseInt((currentMonth||'2026-04').split('-')[1])||4)/12;
    for(let line of ['车险','财产险','人身险']){d[line+'时间进度计划达成率']=d[line+'计划']?d[line+'实际']/(d[line+'计划']*TP):0;}
    d['保费实际合计']=(d['车险实际']||0)+(d['财产险实际']||0)+(d['人身险实际']||0);d['保费年度计划']=(d['车险计划']||0)+(d['财产险计划']||0)+(d['人身险计划']||0);
    d['时间进度计划达成率']=d['保费年度计划']?d['保费实际合计']/(d['保费年度计划']*TP):0;
    let ptp=(d['经营利润年度计划']||0)*TP;d['时间进度达成率']=ptp>0?((d['经营利润']||0)<0?0:(d['经营利润']||0)/ptp):(ptp<0?Math.max(0,1+((d['经营利润']||0)-ptp)/Math.abs(ptp)):0);
    d['综合成本率实际（整体利润口径）']=d['已赚保费']?1-(d['经营利润']||0)/d['已赚保费']:0;d['与本年计划比较']=(d['综合成本率实际（整体利润口径）']||0)-(d['综合成本率计划（整体利润口径）']||0);
    d['整体人员计划']=(d['前台人员计划']||0)+(d['后台人员计划']||0);d['整体人员实际']=(d['前台人员实际']||0)+(d['后台人员实际']||0);
    for(let role of ['前台','后台','整体']){
        d[role+'人员计划执行率']=d[role+'人员计划']?d[role+'人员实际']/d[role+'人员计划']:0;d[role+'人均产能计划']=d[role+'人员计划']?d['保费年度计划']/d[role+'人员计划']:0;
        let ap=d[role+'平均人数']||d[role+'人员实际']||0;d[role+'人均产能实际']=ap?d['保费实际合计']/(ap*TP):0;
        d[role+'人人均产能计划达成率']=d[role+'人均产能计划']?d[role+'人均产能实际']/d[role+'人均产能计划']:0;
        d[role+'人力成本预算执行率']=d[role+'人力成本预算']?d[role+'人力成本实际']/(d[role+'人力成本预算']*TP):0;
        d['前台人力成本保费率计划']=d['保费年度计划']?d['前台人力成本预算']/d['保费年度计划']:0;d['后台人力成本保费率预算']=d['保费年度计划']?d['后台人力成本预算']/d['保费年度计划']:0;d['整体人力成本保费率预算']=d['保费年度计划']?d['整体人力成本预算']/d['保费年度计划']:0;d['前台人力成本保费率实际']=d['保费实际合计']?d['前台人力成本实际']/d['保费实际合计']:0;d['后台人力成本保费率实际']=d['保费实际合计']?d['后台人力成本实际']/d['保费实际合计']:0;d['整体人力成本保费率实际']=d['保费实际合计']?d['整体人力成本实际']/d['保费实际合计']:0;
        d['前台人力成本保费率计划执行率']=d['前台人力成本保费率计划']?d['前台人力成本保费率实际']/d['前台人力成本保费率计划']:0;d['后台人力成本保费率计划执行率']=d['后台人力成本保费率预算']?d['后台人力成本保费率实际']/d['后台人力成本保费率预算']:0;d['整体人力成本保费率计划执行率']=d['整体人力成本保费率预算']?d['整体人力成本保费率实际']/d['整体人力成本保费率预算']:0;
    }
    for(let role of ['前台','后台','整体']){d['前台人力成本利润值计划']=d['前台人力成本预算']?(d['经营利润年度计划']||0)/d['前台人力成本预算']:0;d['后台人力成本利润值预算']=d['后台人力成本预算']?(d['经营利润年度计划']||0)/d['后台人力成本预算']:0;d['整体人力成本利润值预算']=d['整体人力成本预算']?(d['经营利润年度计划']||0)/d['整体人力成本预算']:0;d['前台人力成本利润值实际']=d['前台人力成本实际']?(d['经营利润']||0)/d['前台人力成本实际']:0;d['后台人力成本利润值实际']=d['后台人力成本实际']?(d['经营利润']||0)/d['后台人力成本实际']:0;d['整体人力成本利润值实际']=d['整体人力成本实际']?(d['经营利润']||0)/d['整体人力成本实际']:0;}
    for(let k in d){if(typeof d[k]==='number')d[k]=Math.round(d[k]*1e6)/1e6;}
}

function renderOverview(){
    var nat=DATA.national;
    document.getElementById('overview-kpi').innerHTML=FIELDS.filter(f=>f.c).map(f=>{let v=nat[f.k]||0,cls=f.u==='万元'?(v>=0?'c-green':'c-red'):(f.u==='%'?((f.rd==='desc'&&v>=1)||(f.rd==='asc'&&v<=0.98)?'c-green':'c-red'):'c-blue');return'<div class="kpi-card '+cls+'"><div class="kl">'+f.l+'</div><div class="kv">'+fmtVal(v,f.u)+'</div></div>';}).join('');
    let sh='';['保费','效益','效能','人员'].forEach(g=>{var gf=FIELDS.filter(f=>f.g===g);sh+='<div class="section"><div class="sec-header" onclick="this.classList.toggle(\'open\');this.nextElementSibling.classList.toggle(\'open\')"><span class="arrow">▶</span><h3>'+g+'明细</h3><span class="badge">'+gf.length+'项</span></div><div class="sec-body"><div class="tbl-wrap"><table><thead><tr><th>指标</th><th class="num">数值</th><th>单位</th><th>来源</th></tr></thead><tbody>';gf.forEach(f=>{sh+='<tr><td>'+f.l+'</td><td class="num"><b>'+fmtVal(nat[f.k]||0,f.u)+'</b></td><td>'+f.u+'</td><td class="computed">'+(f.m?'手动填写':'自动计算')+'</td></tr>';});sh+='</tbody></table></div></div></div>';});document.getElementById('overview-sections').innerHTML=sh;
}

function renderRegions(){
    // Top KPI cards
    let kh='';REGIONS.forEach(r=>{var d=DATA.regions[r]||{};kh+='<div class="region-card"><h4>'+r+'</h4>';FIELDS.filter(f=>f.c).slice(0,6).forEach(f=>{kh+='<div class="metric"><span>'+f.l+'</span><span class="mv">'+fmtVal(d[f.k]||0,f.u)+'</span></div>';});kh+='</div>';});document.getElementById('regions-kpi').innerHTML=kh;

    // Key metrics table (always visible, concise)
    var kfs=FIELDS.filter(f=>KEY_SET.has(f.k));
    let kt='<div class="tbl-wrap"><table><thead><tr><th>核心指标</th><th>单位</th>';
    REGIONS.forEach(r=>kt+='<th class="num">'+r+'</th>');kt+='</tr></thead><tbody>';
    kfs.forEach(f=>{kt+='<tr><td><b>'+f.l+'</b></td><td class="computed">'+f.u+'</td>';REGIONS.forEach(r=>{let v=(DATA.regions[r]||{})[f.k]||0;kt+='<td class="num '+getColor(f.u,f.rd,v)+'">'+fmtVal(v,f.u)+'</td>';});kt+='</tr>';});
    kt+='</tbody></table></div>';
    document.getElementById('regions-key-table').innerHTML=kt;

    // Charts (collapsible by group)
    let chartsHtml='';
    ['保费','效益','效能','人员'].forEach(g=>{
        var gf=FIELDS.filter(f=>f.g===g),cg=CHART_GROUPS[g]||[];
        chartsHtml+='<div class="section"><div class="sec-header open" onclick="this.classList.toggle(\'open\');this.nextElementSibling.classList.toggle(\'open\');setTimeout(renderRegionsCharts,150)"><span class="arrow">▶</span><h3>'+g+'对比</h3><span class="badge">'+cg.length+'张图</span></div><div class="sec-body open"><div class="chart-grid">';
        cg.forEach((c,i)=>chartsHtml+='<div class="chart-card"><h4>'+c.title+'</h4><div class="chart-wrap"><canvas id="rc-'+g+'-'+i+'"></canvas></div></div>');
        chartsHtml+='</div></div></div>';
    });
    document.getElementById('regions-charts').innerHTML=chartsHtml;

    // Full detail toggle (collapsed by default)
    let dt='<div class="more-toggle" onclick="var t=this;t.classList.toggle(\'open\');document.getElementById(\'regions-full-detail\').classList.toggle(\'open\')"><span class="mt-arrow">▶</span> 查看全部67项指标明细</div>';
    dt+='<div class="more-body" id="regions-full-detail">';
    ['保费','效益','效能','人员'].forEach(g=>{
        var gf=FIELDS.filter(f=>f.g===g);
        dt+='<div class="tbl-wrap"><table><thead><tr><th>'+g+'</th>';
        REGIONS.forEach(r=>dt+='<th class="num">'+r+'</th>');dt+='</tr></thead><tbody>';
        gf.forEach(f=>{dt+='<tr><td>'+f.l+'</td>';REGIONS.forEach(r=>{let v=(DATA.regions[r]||{})[f.k]||0;dt+='<td class="num '+getColor(f.u,f.rd,v)+'">'+fmtVal(v,f.u)+'</td>';});dt+='</tr>';});
        dt+='</tbody></table></div>';
    });
    dt+='</div>';
    document.getElementById('regions-detail').innerHTML=dt;

    renderRegionsCharts();
}

function renderRegionsCharts(){
    ['保费','效益','效能','人员'].forEach(g=>{var cg=CHART_GROUPS[g]||[];cg.forEach((c,i)=>{var canvas=document.getElementById('rc-'+g+'-'+i);if(!canvas)return;var ks=new Set(c.keys),cfs=FIELDS.filter(f=>ks.has(f.k)),lm={};cfs.forEach(f=>lm[f.k]=f.l);var isPct=cfs[0]?.u==='%';var ds=REGIONS.map((r,j)=>({label:r,data:c.keys.map(k=>{let v=(DATA.regions[r]||{})[k]||0;return isPct?v*100:v;}),backgroundColor:COLOR4[j],borderRadius:4}));charts['rc-'+g+'-'+i]=typeof Chart!=='undefined'?new Chart(canvas,{type:'bar',data:{labels:c.keys.map(k=>lm[k]||k),datasets:ds},options:{_unit:isPct?'%':(cfs[0]?.u||''),indexAxis:'x',responsive:true,maintainAspectRatio:false,scales:isPct?{y:{ticks:{callback:v=>v+'%'}}}:{},plugins:{tooltip:{callbacks:{label:ctx=>{let raw=ctx.raw,u=cfs[0]?.u||'';return ctx.dataset.label+': '+(isPct?raw.toFixed(2)+'%':u==='万元'?(Math.abs(raw)<100&&Math.abs(raw)>0?raw.toFixed(2):Math.round(raw).toLocaleString()):u==='万元/人'?raw.toFixed(2):raw.toLocaleString());}}}}}}):null;});});
}

function renderBranches(){
  var s=(document.getElementById('branchSearch').value||'').toLowerCase();
  var g=document.getElementById('branchGroup').value;
  var br=DATA.branches.slice();if(s)br=br.filter(function(b){return b.n.toLowerCase().includes(s);});
  var df=g==='all'?FIELDS.filter(function(f){return KEY_SET.has(f.k);}):FIELDS.filter(function(f){return f.g===g&&KEY_SET.has(f.k);});
  var ro={'第一责任区':0,'第二责任区':1,'第三责任区':2,'第四责任区':3};
  
  // Sort state (stored on branches-table element)
  var tbl=document.getElementById('branches-table');
  var sortCol=tbl.dataset.sortCol||'';
  var sortDir=tbl.dataset.sortDir||'';
  if(sortCol&&sortDir){
    var sf=FIELDS.find(function(f){return f.k===sortCol;});
    if(sf){
      br.sort(function(a,b){
        var va=Number((a.d||{})[sortCol])||0,vb=Number((b.d||{})[sortCol])||0;
        var asc=RANK_ASC[sortCol];
        if(sortDir==='asc')return asc?va-vb:vb-va;
        return asc?vb-va:va-vb;
      });
    }
  }else{
    br.sort(function(a,b){return (ro[a.r]||9)-(ro[b.r]||9);});
  }
  
  var h='<table><thead><tr onclick="event.stopPropagation()"><th>#</th><th>责任区</th><th>分公司</th>';
  df.forEach(function(f){
    var dirIcon='';
    if(sortCol===f.k)dirIcon=sortDir==='asc'?' ▲':' ▼';
    h+='<th class="num sortable" onclick="sortBranches(\''+f.k.replace(/'/g,'\\\'')+'\')" title="点击排序">'+f.l+dirIcon+'</th>';
  });
  h+='</tr></thead><tbody>';
  br.forEach(function(b,bi){
    h+='<tr class="clickable-row" onclick="showBranchDetail(\''+b.n.replace(/\\/g,'\\\\').replace(/'/g,'\\\'')+'\',\''+b.r.replace(/\\/g,'\\\\').replace(/'/g,'\\\'')+'\')"><td style="color:var(--text2);font-size:11px">'+(bi+1)+'</td><td>'+b.r+'</td><td><b>'+b.n+'</b></td>';
    df.forEach(function(f){
      var v=Number((b.d||{})[f.k])||0;
      h+='<td class="num '+getColor(f.u,f.rd,v)+'">'+fmtVal(v,f.u)+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  if(g==='all'){
    h+='<div style="margin-top:8px;font-size:11px;color:var(--text2)">显示核心指标，<a style="color:var(--primary);cursor:pointer" onclick="toggleAllFields()">查看全部 '+FIELDS.length+'项指标</a></div>';
  }
  document.getElementById('branches-table').innerHTML=h;
}

function importExcel(input){
console.log("importExcel called");
var file=input.files[0];if(!file)return;
var reader=new FileReader();
reader.onload=function(e){
  try{
    var wb=XLSX.read(e.target.result,{type:'array'});
    var ws=wb.Sheets[wb.SheetNames[0]];
    var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
    var hr=-1;
    for(var i=0;i<Math.min(rows.length,10);i++){if(rows[i]&&rows[i][0]==='年度'){hr=i;break;}}
    if(hr<0){alert('未找到表头行（第1列需为"年度"），请用下载的模板格式');return;}
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
      for(var ai=0;ai<ACTUAL_KEYS.length;ai++){var ak=ACTUAL_KEYS[ai];ad[ak]=bd[ak]!=null?bd[ak]:0;}
      nb.push({n:bn,r:row[3]||'',d:ad});
    }
    if(nb.length===0){alert('未找到分公司数据行');return;}
    var mNum=impMonth.replace(/[^0-9]/g,'');
    if(!mNum)mNum='4';
    var mk=impYear+'-'+mNum.padStart(2,'0');
    if(!impYear){alert('未检测到年度信息');return;}
    var yn=impYear+'年'+impMonth;
    if(!ALL_DATA.actuals)ALL_DATA.actuals={};
    if(ALL_DATA.actuals[mk]&&!confirm(yn+'的实际数据已存在，是否覆盖？'))return;
    // Aggregate
    var rm={};
    nb.forEach(function(b){if(!rm[b.r])rm[b.r]=[];rm[b.r].push(b);});
    var rm2={};
    REGIONS.forEach(function(rn){
      var bl=rm[rn]||[];if(bl.length===0)return;
      var agg={};
      ACTUAL_KEYS.forEach(function(fk){agg[fk]=bl.reduce(function(s,b){return s+(Number(b.d[fk])||0);},0);});
      ['已赚赔付率实际','已赚费用率实际'].forEach(function(k){agg[k]=bl.reduce(function(s,b){return s+(Number(b.d[k])||0);},0)/bl.length;});
      rm2[rn]=agg;
    });
    var na={};
    ACTUAL_KEYS.forEach(function(fk){na[fk]=nb.reduce(function(s,b){return s+(Number(b.d[fk])||0);},0);});
    ['已赚赔付率实际','已赚费用率实际'].forEach(function(k){na[k]=nb.reduce(function(s,b){return s+(Number(b.d[k])||0);},0)/nb.length;});
    ALL_DATA.actuals[mk]={branches:nb,regions:rm2,national:na};
    currentMonth=mk;ALL_DATA.currentMonth=mk;
    refreshMergedData();saveAllData();
    updateMonthUI();updatePlanUI();
    alert('已导入 '+yn+' 实际数据：'+nb.length+' 家分公司');
    destroyCharts();switchTab('overview');alert('导入完成！数据已加载。');
  }catch(err){
var ep=document.getElementById('errPanel');
if(ep){ep.style.display='block';ep.textContent='[Import Error] '+err.message+'\nStack: '+(err.stack||'');}
alert('解析失败: '+err.message);
}
};
reader.readAsArrayBuffer(file);
}

function importPlanExcel(input){
console.log("importPlanExcel START, files="+(input.files?input.files.length:0));
var file=input.files[0];if(!file){console.log("importPlanExcel: no file selected");return;}
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
    if(hr<0){alert('表头未找到（第1列需为年度），请用下载的模板格式');return;}
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
      for(var pi=0;pi<PLAN_KEYS.length;pi++){
        var pk=PLAN_KEYS[pi];
        pd[pk]=bd[pk]!=null?bd[pk]:0;
      }
      nb.push({n:bn,r:row[1]||'',d:pd});
    }
    if(nb.length===0){alert('未找到分公司数据行');return;}
    var y2=impYear.replace(/[^0-9]/g,'');
    if(!y2){alert('未检测到年度信息');return;}
    if(!y2)y2='2026';
    var maxV=0;
    if(ALL_DATA._plans){
      Object.keys(ALL_DATA._plans).forEach(function(k){
        if(k.startsWith(y2+'-v')){
          var v=parseInt(k.split('-v')[1]);
          if(v>maxV)maxV=v;
        }
      });
    }
    var pk2=y2+'-v'+(maxV+1);
    var yn=y2+'年 (版本'+(maxV+1)+')';
    if(!ALL_DATA._plans)ALL_DATA._plans={};
    if(ALL_DATA._plans[pk2]&&!confirm(yn+'的计划数据已存在，是否覆盖？'))return;
    var rm2={},na={};
    var rm={};
    nb.forEach(function(b){
      if(!rm[b.r])rm[b.r]=[];
      rm[b.r].push(b);
    });
    REGIONS.forEach(function(rn){
      var bl=rm[rn]||[];
      if(bl.length===0)return;
      var agg={};
      for(var fi=0;fi<PLAN_KEYS.length;fi++){
        var fk=PLAN_KEYS[fi];
        agg[fk]=bl.reduce(function(s,b){return s+(Number(b.d[fk])||0);},0);
      }
      rm2[rn]=agg;
    });
    for(var fi=0;fi<PLAN_KEYS.length;fi++){
      var fk=PLAN_KEYS[fi];
      na[fk]=nb.reduce(function(s,b){return s+(Number(b.d[fk])||0);},0);
    }
    ALL_DATA._plans[pk2]={branches:nb,regions:rm2,national:na};
    currentPlanKey=pk2;ALL_DATA.currentPlanKey=pk2;
    refreshMergedData();saveAllData();
    updatePlanUI();
    alert('已导入 '+yn+' 计划数据，'+nb.length+' 家分公司');
    destroyCharts();switchTab('overview');alert('导入完成！数据已加载。');
  }catch(err){alert('解析失败[计划]: '+err.message+'\\n\\nStack: '+(err.stack||''));console.error('Plan import error:',err);}
};
reader.readAsArrayBuffer(file);
}

// === Phase 2: Branch Detail Sub-tabs ===

// Ranking rules: which indicators have 'asc' (lower is better)


var branchRanks=null;  // computed once, cached per render

function rankAllBranches(){if(!RANK_ASC)RANK_ASC={};
  var branches=DATA.branches;if(!branches||!branches.length)return{};
  var result={};
  branches.forEach(function(b){result[b.n]={};});
  FIELDS.forEach(function(f){
    var asc=RANK_ASC[f.k];
    var vals=branches.map(function(b){var bd=b.d||{};return{name:b.n,v:Number(bd[f.k])||0};});
    if(asc){vals.sort(function(a,b){return a.v-b.v;});}
    else{vals.sort(function(a,b){return b.v-a.v;});}
    var rank=1,prev=null;
    vals.forEach(function(v,i){
      if(prev!==null&&v.v!==prev)rank=i+1;
      result[v.name][f.k]=rank;
      prev=v.v;
    });
  });
  return result;
}

function showBranchDetail(name,region){
  document.getElementById('branches-list-view').style.display='none';
  document.getElementById('branch-detail-view').style.display='block';
  branchRanks=rankAllBranches();
  renderBranchDetail(name,region);
}


function sortBranches(col){
  var tbl=document.getElementById('branches-table');
  var cur=tbl.dataset.sortCol;
  var dir=tbl.dataset.sortDir;
  if(cur===col){
    if(dir==='asc'){tbl.dataset.sortDir='desc';}
    else if(dir==='desc'){tbl.dataset.sortCol='';tbl.dataset.sortDir='';}
  }else{
    tbl.dataset.sortCol=col;
    tbl.dataset.sortDir='asc';
  }
  renderBranches();
}

var showingAllFields=false;
function toggleAllFields(){
  showingAllFields=!showingAllFields;
  var g=document.getElementById('branchGroup');
  if(showingAllFields){
    g.value='all';
    renderAllBranches();
  }else{
    renderBranches();
  }
}

function renderAllBranches(){
  var s=(document.getElementById('branchSearch').value||'').toLowerCase();
  var br=DATA.branches.slice();if(s)br=br.filter(function(b){return b.n.toLowerCase().includes(s);});
  var df=FIELDS;
  var ro={'第一责任区':0,'第二责任区':1,'第三责任区':2,'第四责任区':3};
  
  var tbl=document.getElementById('branches-table');
  var sortCol=tbl.dataset.sortCol||'';
  var sortDir=tbl.dataset.sortDir||'';
  if(sortCol&&sortDir){
    var sf=FIELDS.find(function(f){return f.k===sortCol;});
    if(sf){
      br.sort(function(a,b){
        var va=Number((a.d||{})[sortCol])||0,vb=Number((b.d||{})[sortCol])||0;
        var asc=RANK_ASC[sortCol];
        if(sortDir==='asc')return asc?va-vb:vb-va;
        return asc?vb-va:va-vb;
      });
    }
  }else{
    br.sort(function(a,b){return (ro[a.r]||9)-(ro[b.r]||9);});
  }
  
  var h='<table><thead><tr><th>#</th><th>责任区</th><th>分公司</th>';
  df.forEach(function(f){
    var dirIcon='';
    if(sortCol===f.k)dirIcon=sortDir==='asc'?' ▲':' ▼';
    h+='<th class="num sortable" onclick="sortBranches(\''+f.k.replace(/'/g,'\\\'')+'\')">'+f.l+dirIcon+'</th>';
  });
  h+='</tr></thead><tbody>';
  br.forEach(function(b,bi){
    h+='<tr class="clickable-row" onclick="showBranchDetail(\''+b.n.replace(/\\/g,'\\\\').replace(/'/g,'\\\'')+'\',\''+b.r.replace(/\\/g,'\\\\').replace(/'/g,'\\\'')+'\')"><td style="color:var(--text2);font-size:11px">'+(bi+1)+'</td><td>'+b.r+'</td><td><b>'+b.n+'</b></td>';
    df.forEach(function(f){
      var v=Number((b.d||{})[f.k])||0;
      h+='<td class="num '+getColor(f.u,f.rd,v)+'">'+fmtVal(v,f.u)+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  h+='<div style="margin-top:8px;font-size:11px;color:var(--text2)"><a style="color:var(--primary);cursor:pointer" onclick="toggleAllFields()">收起，只显示核心指标</a></div>';
  document.getElementById('branches-table').innerHTML=h;
}

function hideBranchDetail(){
  document.getElementById('branches-list-view').style.display='block';
  document.getElementById('branch-detail-view').style.display='none';
  branchRanks=null;
}

function renderBranchDetail(name,region){
  var branches=DATA.branches;
  var bd=null;
  for(var i=0;i<branches.length;i++){
    if(branches[i].n===name){bd=branches[i];break;}
  }
  if(!bd){document.getElementById('branch-detail-content').innerHTML='<p>未找到分公司数据</p>';return;}
  var d=bd.d,ranks=branchRanks[name]||{},total=branches.length;

  // Compute overall averages
  var nat=DATA.national;
  var avg={};
  FIELDS.forEach(function(f){
    var sum=0,c=0;
    branches.forEach(function(b){
      var v=Number((b.d||{})[f.k]);
      if(!isNaN(v)){sum+=v;c++;}
    });
    avg[f.k]=c>0?sum/c:0;
  });
  // 特定指标使用全国数据覆盖均值
  function cmpVal(fk){return NAT_CMP.has(fk)?(Number(nat[fk])||0):(avg[fk]||0);}

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
  html+='<div class="breadcrumb"><a onclick="hideBranchDetail()">各分公司明细</a> &gt; '+name+'</div>';
  html+='<div class="branch-header"><h2>'+name+'</h2><span style="color:var(--text2);font-size:13px">'+region+'</span><span style="color:var(--text2);font-size:11px">共'+total+'家分公司</span></div>';

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
    {k:'整体人均产能实际',l:'人均产能'},
    {k:'整体人力成本保费率实际',l:'人力成本保费率'}
  ];
  html+='<div class="kpi-cards">';
  kpiKeys.forEach(function(kp){
    var f=FIELDS.find(function(x){return x.k===kp.k;});
    if(!f)return;
    var v=Number(d[kp.k])||0,av=cmpVal(kp.k)||0,rk=ranks[kp.k]||'-';
    html+='<div class="kpi-card">';
    html+='<h4>'+kp.l+'</h4>';
    html+='<div class="val">'+fmtVal(v,f.u)+'</div>';
    html+='<div class="avg">'+(NAT_CMP.has(f.k)?'分公司整体':'整体均值')+' '+fmtVal(av,f.u)+'</div>';
    html+='<div class="diff">'+diffFmt(v,av,f.u)+'</div>';
    html+='<div class="rank">排名 <span class="badge-rank '+rankBadge(rk,total)+'">'+rk+'/'+total+'</span></div>';
    html+='</div>';
  });
  html+='</div>';

  // Full indicator detail tables by group (collapsible sections)
  // Phase 1/4预留: comparison columns structure
  var groups=['保费','效益','效能','人员'];
  groups.forEach(function(g){
    var gf=FIELDS.filter(function(f){return f.g===g;});
    var ck=CORE_KEYS[g]||[];
    var cfs=gf.filter(function(f){return ck.indexOf(f.k)>=0;});
    var rest=gf.filter(function(f){return ck.indexOf(f.k)<0;});
    
    // Chart section for core indicators
    html+='<div class="section"><div class="sec-header open" onclick="this.classList.toggle(\'open\');this.nextElementSibling.classList.toggle(\'open\');var cv=document.getElementById(\'br-chart-'+g+'\');if(cv&&this.classList.contains(\'open\')){renderBranchChart(\''+g+'\',\''+name+'\');}"><span class="arrow">▶</span><h3>'+g+'类指标 ('+gf.length+'项)</h3></div><div class="sec-body open">';
    
    // Bar chart: branch vs average for core indicators (only if same unit, else just table)
    html+='<div id="br-charts-'+g+'" class="branch-charts"></div>';
    
    // Core indicators table
    html+='<div class="tbl-wrap"><table><thead><tr><th>指标</th><th>单位</th><th class="num">当前值</th><th class="num">对比值</th><th class="num">差值</th><th class="col-rank">排名</th></tr></thead><tbody>';
    cfs.forEach(function(f){
      var v=Number((d||{})[f.k])||0,av=cmpVal(f.k)||0,rk=ranks[f.k]||'-';
      html+='<tr><td>'+f.l+'</td><td class="computed">'+f.u+'</td>';
      html+='<td class="num '+getColor(f.u,f.rd,v)+'">'+fmtVal(v,f.u)+'</td>';
      html+='<td class="num">'+fmtVal(av,f.u)+'</td>';
      html+='<td class="num">'+diffFmt(v,av,f.u)+'</td>';
      html+='<td class="col-rank"><span class="badge-rank '+rankBadge(rk,total)+'">'+rk+'/'+total+'</span></td>';
      html+='</tr>';
    });
    html+='</tbody></table></div>';
    
    // Remaining indicators (collapsible)
    if(rest.length>0){
      html+='<div class="more-toggle" onclick="var t=this;t.classList.toggle(\'open\');t.nextElementSibling.classList.toggle(\'open\')"><span class="mt-arrow">▶</span> 查看其余 '+rest.length+'项指标</div>';
      html+='<div class="more-body"><div class="tbl-wrap"><table><thead><tr><th>指标</th><th>单位</th><th class="num">当前值</th><th class="num">对比值</th><th class="num">差值</th><th class="col-rank">排名</th></tr></thead><tbody>';
      rest.forEach(function(f){
        var v=Number((d||{})[f.k])||0,av=cmpVal(f.k)||0,rk=ranks[f.k]||'-';
        html+='<tr><td>'+f.l+'</td><td class="computed">'+f.u+'</td>';
        html+='<td class="num '+getColor(f.u,f.rd,v)+'">'+fmtVal(v,f.u)+'</td>';
        html+='<td class="num">'+fmtVal(av,f.u)+'</td>';
        html+='<td class="num">'+diffFmt(v,av,f.u)+'</td>';
        html+='<td class="col-rank"><span class="badge-rank '+rankBadge(rk,total)+'">'+rk+'/'+total+'</span></td>';
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
  var branches=DATA.branches;
  var bd=null;for(var i=0;i<branches.length;i++){if(branches[i].n===name){bd=branches[i];break;}}
  if(!bd)return;
  var d=bd.d||{},ck=CORE_KEYS[group]||[];
  if(!ck.length)return;
  var cfs=FIELDS.filter(function(f){return ck.indexOf(f.k)>=0;});
  var byUnit={};
  cfs.forEach(function(f){
    if(f.u==='万元'){
      byUnit[f.k]=[f];
    }else{
      if(!byUnit[f.u])byUnit[f.u]=[];
      byUnit[f.u].push(f);
    }
  });
  var unitNames={'万元':'金额（万元）','%':'比率（%）','万元/人':'人均（万元/人）','人':'人数'};
  Object.keys(byUnit).forEach(function(u,ui){
    var ufs=byUnit[u];
    var unitLabel=unitNames[u]||(ufs[0].u==='万元'?'金额（万元）':u);
    var canvasId='br-chart-'+group+'-'+ui;
    var avg={};
    var nat=DATA.national;
    ufs.forEach(function(f){
      var s=0,c2=0;
      branches.forEach(function(b){var v=Number((b.d||{})[f.k]);if(!isNaN(v)){s+=v;c2++;}});
      avg[f.k]=c2>0?s/c2:0;
    });
    // 特定指标使用全国数据覆盖均值
    function cmpVal(fk){return NAT_CMP.has(fk)?(Number(nat[fk])||0):(avg[fk]||0);}
    var isPct=u==='%';
    var labels=ufs.map(function(f){return f.l;});
    var branchData=ufs.map(function(f){var v=Number(d[f.k])||0;return isPct?v*100:v;});
    var avgData=ufs.map(function(f){var v=cmpVal(f.k);return isPct?v*100:v;});
    var barH=200;
    var cmpLabel=ufs.some(function(f){return NAT_CMP.has(f.k);})?'分公司整体':'整体均值';
    container.insertAdjacentHTML('beforeend','<div class="chart-card"><h4>'+name+' vs '+cmpLabel+' — '+unitLabel+'</h4><div class="chart-wrap" style="height:'+barH+'px"><canvas id="'+canvasId+'"></canvas></div></div>');
    var canvas=document.getElementById(canvasId);
    if(!canvas)return;
    if(charts[canvasId])charts[canvasId].destroy();
    try{
      charts[canvasId]=new Chart(canvas,{
        type:'bar',
        data:{labels:labels,datasets:[
          {label:name,data:branchData,backgroundColor:'#3b82f6',hoverBackgroundColor:'#2563eb',borderRadius:4},
          {label:cmpLabel,data:avgData,backgroundColor:'#94a3b8',hoverBackgroundColor:'#64748b',borderRadius:4}
        ]},
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
  if(ms){var m=parseInt((currentMonth||'2026-04').split('-')[1])||4;ms.value=m;}

}

