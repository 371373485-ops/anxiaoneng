var App={};App.charts={};

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
    {k:"前台人均利润计划", f:"经营利润年度计划 ÷ 前台人员计划", s:"自动", r:"人员计划变化时利润计划相应变化"},
    {k:"前台人均利润实际", f:"经营利润 ÷ (前台平均人数 × TP)", s:"自动", r:"平均人数未按月取平均会导致年化值偏差；经营利润为负时结果为负"},
    {k:"前台人均利润达成率", f:"人均利润实际 ÷ 人均利润计划", s:"自动", r:"利润计划=0时达成率为0"},
    {k:"后台人均利润计划", f:"经营利润年度计划 ÷ 后台人员计划", s:"自动", r:"同前台"},
    {k:"后台人均利润实际", f:"经营利润 ÷ (后台平均人数 × TP)", s:"自动", r:"同前台"},
    {k:"后台人均利润达成率", f:"人均利润实际 ÷ 人均利润计划", s:"自动", r:"同前台"},
    {k:"整体人均利润计划", f:"经营利润年度计划 ÷ 整体人员计划", s:"自动", r:"整体人员=前台+后台"},
    {k:"整体人均利润实际", f:"经营利润 ÷ (整体平均人数 × TP)", s:"自动", r:"同前台"},
    {k:"整体人均利润达成率", f:"人均利润实际 ÷ 人均利润计划", s:"自动", r:"同前台"},
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

App.DATA={get national(){var mk='_merged',cm=App.currentMonth;return (App.ALL_DATA&&App.ALL_DATA[mk]&&App.ALL_DATA[mk][cm])?App.ALL_DATA[mk][cm].national:{};},get regions(){var mk='_merged',cm=App.currentMonth;return (App.ALL_DATA&&App.ALL_DATA[mk]&&App.ALL_DATA[mk][cm])?App.ALL_DATA[mk][cm].regions:{};},get branches(){var mk='_merged',cm=App.currentMonth;return (App.ALL_DATA&&App.ALL_DATA[mk]&&App.ALL_DATA[mk][cm])?App.ALL_DATA[mk][cm].branches:[];}};

App.DEFAULT_DATA={"_plans":{},"actuals":{},"currentMonth":"2026-04","currentPlanKey":"auto"};
App.FIELDS=[{"g": "保费", "k": "车险计划", "l": "车险计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "车险实际", "l": "车险实际", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "车险时间进度计划达成率", "l": "车险达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "保费", "k": "财产险计划", "l": "财产险计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "财产险实际", "l": "财产险实际", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "财产险时间进度计划达成率", "l": "财产险达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "保费", "k": "人身险计划", "l": "人身险计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "人身险实际", "l": "人身险实际", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "人身险时间进度计划达成率", "l": "人身险达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "保费", "k": "保费实际合计", "l": "保费实际合计", "u": "万元", "rd": "desc", "c": 1, "m": 0}, {"g": "保费", "k": "保费年度计划", "l": "保费年度计划", "u": "万元", "rd": "desc", "m": 0}, {"g": "保费", "k": "已赚保费", "l": "已赚保费", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "已赚保费计划", "l": "已赚保费计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "保费", "k": "时间进度计划达成率", "l": "保费达成率", "u": "%", "rd": "desc", "c": 1, "m": 0}, {"g": "效益", "k": "经营利润", "l": "经营利润", "u": "万元", "rd": "desc", "c": 1, "m": 1}, {"g": "效益", "k": "当月经营利润", "l": "当月经营利润", "u": "万元", "rd": "desc", "m": 1}, {"g": "效益", "k": "经营利润年度计划", "l": "利润年度计划", "u": "万元", "rd": "desc", "m": 1}, {"g": "效益", "k": "时间进度达成率", "l": "利润达成率", "u": "%", "rd": "desc", "c": 1, "m": 0}, {"g": "效益", "k": "综合成本率实际（整体利润口径）", "l": "综合成本率", "u": "%", "rd": "asc", "c": 1, "m": 0}, {"g": "效益", "k": "综合成本率计划（整体利润口径）", "l": "综合成本率计划", "u": "%", "rd": "asc", "m": 1}, {"g": "效益", "k": "与本年计划比较", "l": "COR与计划差", "u": "%", "rd": "asc", "m": 0}, {"g": "效益", "k": "已赚赔付率实际", "l": "已赚赔付率", "u": "%", "rd": "asc", "c": 1, "m": 1}, {"g": "效益", "k": "已赚费用率实际", "l": "已赚费用率", "u": "%", "rd": "asc", "m": 1}, {"g": "效能", "k": "前台人均产能计划", "l": "前台产能(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人均产能实际", "l": "前台产能(实际)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人人均产能计划达成率", "l": "前台产能达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人均产能计划", "l": "后台产能(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人均产能实际", "l": "后台产能(实际)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人人均产能计划达成率", "l": "后台产能达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人均产能计划", "l": "整体产能(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人均产能实际", "l": "整体产能(实际)", "u": "万元/人", "rd": "desc", "c": 1, "m": 0}, {"g": "效能", "k": "整体人人均产能计划达成率", "l": "整体产能达成率", "u": "%", "rd": "desc", "c": 1, "m": 0}, {"g": "效能", "k": "前台人均利润计划", "l": "前台人均利润(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人均利润实际", "l": "前台人均利润(实际)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人均利润达成率", "l": "前台人均利润达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人均利润计划", "l": "后台人均利润(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人均利润实际", "l": "后台人均利润(实际)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人均利润达成率", "l": "后台人均利润达成率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人均利润计划", "l": "整体人均利润(计划)", "u": "万元/人", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人均利润实际", "l": "整体人均利润(实际)", "u": "万元/人", "rd": "desc", "c": 1, "m": 0}, {"g": "效能", "k": "整体人均利润达成率", "l": "整体人均利润达成率", "u": "%", "rd": "desc", "c": 1, "m": 0}, {"g": "效能", "k": "前台人力成本预算", "l": "前台成本(预算)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "前台人力成本实际", "l": "前台成本(实际)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "前台人力成本预算执行率", "l": "前台成本执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人力成本预算", "l": "后台成本(预算)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "后台人力成本实际", "l": "后台成本(实际)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "后台人力成本预算执行率", "l": "后台成本执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人力成本预算", "l": "整体成本(预算)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "整体人力成本实际", "l": "整体成本(实际)", "u": "万元", "rd": "desc", "m": 1}, {"g": "效能", "k": "整体人力成本预算执行率", "l": "整体成本执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人力成本保费率计划", "l": "前台保费率(计划)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "前台人力成本保费率实际", "l": "前台保费率(实际)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "前台人力成本保费率计划执行率", "l": "前台保费率执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人力成本保费率预算", "l": "后台保费率(计划)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "后台人力成本保费率实际", "l": "后台保费率(实际)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "后台人力成本保费率计划执行率", "l": "后台保费率执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人力成本保费率预算", "l": "整体保费率(计划)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "整体人力成本保费率实际", "l": "整体保费率(实际)", "u": "%", "rd": "asc", "m": 0}, {"g": "效能", "k": "整体人力成本保费率计划执行率", "l": "整体保费率执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人力成本利润值计划", "l": "前台利润值(计划)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "前台人力成本利润值实际", "l": "前台利润值(实际)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人力成本利润值预算", "l": "后台利润值(计划)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "后台人力成本利润值实际", "l": "后台利润值(实际)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人力成本利润值预算", "l": "整体利润值(计划)", "u": "万元", "rd": "desc", "m": 0}, {"g": "效能", "k": "整体人力成本利润值实际", "l": "整体利润值(实际)", "u": "万元", "rd": "desc", "m": 0}, {"g": "人员", "k": "前台人员计划", "l": "前台计划", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "前台人员实际", "l": "前台实际", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "前台平均人数", "l": "前台平均", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "前台人员计划执行率", "l": "前台执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "人员", "k": "后台人员计划", "l": "后台计划", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "后台人员实际", "l": "后台实际", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "后台平均人数", "l": "后台平均", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "后台人员计划执行率", "l": "后台执行率", "u": "%", "rd": "desc", "m": 0}, {"g": "人员", "k": "整体人员计划", "l": "整体计划", "u": "人", "rd": "desc", "m": 0}, {"g": "人员", "k": "整体人员实际", "l": "整体实际", "u": "人", "rd": "desc", "c": 1, "m": 0}, {"g": "人员", "k": "整体平均人数", "l": "整体平均", "u": "人", "rd": "desc", "m": 1}, {"g": "人员", "k": "整体人员计划执行率", "l": "整体执行率", "u": "%", "rd": "desc", "m": 0}];
App.CHART_GROUPS={"保费": [{"title": "车险保费（万元）", "keys": ["车险计划", "车险实际"]}, {"title": "财产险保费（万元）", "keys": ["财产险计划", "财产险实际"]}, {"title": "人身险保费（万元）", "keys": ["人身险计划", "人身险实际"]}, {"title": "保费年度计划 vs 实际（万元）", "keys": ["保费年度计划", "保费实际合计"]}], "效益": [{"title": "经营利润（万元）", "keys": ["经营利润", "当月经营利润"]}, {"title": "利润年度计划（万元）", "keys": ["经营利润年度计划"]}, {"title": "综合成本率（%）", "keys": ["综合成本率实际（整体利润口径）", "综合成本率计划（整体利润口径）"]}, {"title": "赔付率与费用率（%）", "keys": ["已赚赔付率实际", "已赚费用率实际"]}], "效能": [{"title": "人均产能（万元/人）", "keys": ["前台人均产能计划", "前台人均产能实际", "后台人均产能计划", "后台人均产能实际", "整体人均产能计划", "整体人均产能实际"]}, {"title": "人均利润（万元/人）", "keys": ["前台人均利润计划", "前台人均利润实际", "后台人均利润计划", "后台人均利润实际", "整体人均利润计划", "整体人均利润实际"]}, {"title": "保费率（%）", "keys": ["前台人力成本保费率计划", "前台人力成本保费率实际", "后台人力成本保费率预算", "后台人力成本保费率实际", "整体人力成本保费率预算", "整体人力成本保费率实际"]}, {"title": "利润值（万元）", "keys": ["前台人力成本利润值计划", "前台人力成本利润值实际", "后台人力成本利润值预算", "后台人力成本利润值实际", "整体人力成本利润值预算", "整体人力成本利润值实际"]}], "人员": [{"title": "前台人员（人）", "keys": ["前台人员计划", "前台人员实际", "前台平均人数"]}, {"title": "后台人员（人）", "keys": ["后台人员计划", "后台人员实际", "后台平均人数"]}, {"title": "整体人员（人）", "keys": ["整体人员计划", "整体人员实际", "整体平均人数"]}]};
App.REGIONS=['第一责任区','第二责任区','第三责任区','第四责任区'];
App.COLOR4=['rgba(59,130,246,.7)','rgba(16,185,129,.7)','rgba(239,68,68,.7)','rgba(139,92,246,.7)'];

App.STORAGE_KEY='anxiaoneng_v13';

App.currentYear='2026';

// --- Cross-period comparison ---
App.compareMonth=null;
App.isCompareMode=false;

function refreshCompareData(){
  if(!App.compareMonth||!App.isCompareMode)return;
  var mk='_merged';
  // Ensure _merged exists for comparison month
  if(!App.ALL_DATA[mk])App.ALL_DATA[mk]={};
  // If already merged, skip
  if(App.ALL_DATA[mk][App.compareMonth])return;
  // Need to merge: save current state, temporarily switch month, merge, restore
  var savedMonth=App.currentMonth;
  var savedPlan=App.currentPlanKey;
  App.currentMonth=App.compareMonth;
  App.currentPlanKey=resolvePlanKey();
  refreshMergedData();
  App.currentMonth=savedMonth;
  App.currentPlanKey=savedPlan;
}

// Get comparison data for a scope: 'national','regions','branches'
function getCompareData(scope){
  if(!App.compareMonth||!App.isCompareMode)return scope==='branches'?[]:{national:{},regions:{}};
  var mk='_merged';
  var d=(App.ALL_DATA&&App.ALL_DATA[mk]&&App.ALL_DATA[mk][App.compareMonth])?App.ALL_DATA[mk][App.compareMonth]:null;
  if(!d){
    // No comparison data - return empty structure (doesn't crash)
    if(App&&App.debug)console.log('No data for compare month:',App.compareMonth);
    return scope==='branches'?[]:{};
  }
  return scope==='branches'?d.branches:(scope==='regions'?d.regions:d.national);
}

// Compute diff between current and comparison values
function cmpVal(fk){
  if(!App.isCompareMode||!App.compareMonth)return 0;
  var cd=getCompareData('national');
  return cd&&cd[fk]!=null?Number(cd[fk])||0:0;
}

// Get diff color for display
function diffColor(rd,u,delta){
  if(!delta||Math.abs(delta)<0.0001)return'#888';
  if(u==='%'){
    if(rd==='asc')return delta<0?'#10b981':'#ef4444'; // lower is better
    return delta>0?'#10b981':'#ef4444';
  }
  if(u==='万元'||u==='万元/人'){
    return delta>=0?'#10b981':'#ef4444';
  }
  return delta>0?'#10b981':'#ef4444';
}

App.PLAN_KEYS=["车险计划", "财产险计划", "人身险计划", "经营利润年度计划", "已赚保费计划", "综合成本率计划（整体利润口径）", "前台人员计划", "后台人员计划", "前台人力成本预算", "后台人力成本预算", "整体人力成本预算"];

App.ACTUAL_KEYS=["车险实际", "财产险实际", "人身险实际", "已赚保费", "经营利润", "当月经营利润", "已赚赔付率实际", "已赚费用率实际", "前台人员实际", "前台平均人数", "后台人员实际", "后台平均人数", "整体平均人数", "前台人力成本实际", "后台人力成本实际", "整体人力成本实际"];

App.ALL_DATA=App.DEFAULT_DATA;

App.currentMonth=App.DEFAULT_DATA.currentMonth||'2026-04';

App.currentPlanKey=App.DEFAULT_DATA.currentPlanKey||'auto';


function initData(){
  var loaded=false;
  try{var s=localStorage.getItem(App.STORAGE_KEY);if(s){var p=JSON.parse(s);App.ALL_DATA=p;App.currentMonth=p.currentMonth||'2026-04';App.currentPlanKey=p.currentPlanKey||'auto';loaded=true;}}
  catch(e){}
  // 🔁 Fallback: restore from disk backup if localStorage is empty
  var isGithubPages=typeof location!=='undefined'&&/\.github\.io$/i.test(location.hostname||'');
  if((!loaded||!App.ALL_DATA||Object.keys(App.ALL_DATA.actuals||{}).length===0)&&!isGithubPages){
    try{
      var xhr=new XMLHttpRequest();
    xhr.open('GET','_data_backup.json?t='+Date.now(),false);
      xhr.send();
      if(xhr.status===200){
        var bp=JSON.parse(xhr.responseText);if(bp&&bp.actuals&&Object.keys(bp.actuals).length>0){
          App.ALL_DATA=bp;App.currentMonth=bp.currentMonth||'2026-04';App.currentPlanKey=bp.currentPlanKey||'auto';
          localStorage.setItem(App.STORAGE_KEY,JSON.stringify(bp));
          if(App&&App.debug)console.log('[AutoRestore] Data restored from disk backup ('+Object.keys(bp.actuals).length+' months)');
        }
      }
    }catch(e2){}
  }
  App.currentYear=App.currentMonth.split('-')[0];
  saveAllData();
  updateYearUI();
  updateMonthUI();
  updatePlanUI();
  refreshMergedData();
  switchTab('overview');
}

function cancelPendingSave(){
  if(App._saveTimer)clearTimeout(App._saveTimer);
  App._saveTimer=null;
}

function saveAllData(){
  try{
    var j=JSON.stringify(App.ALL_DATA);
    localStorage.setItem(App.STORAGE_KEY,j);
    cancelPendingSave();
    var hasData=App.ALL_DATA.actuals&&Object.keys(App.ALL_DATA.actuals).length>0;
    if(hasData){
      App._saveTimer=setTimeout(function(){
        App._saveTimer=null;
        fetch('/save-backup',{method:'POST',body:j}).catch(function(){});
      },2000);
    }
  }catch(e){}
}


// Find a branch in plan data by region and name
function findPlanBranch(plan,region,name){
  if(!plan||!plan.branches)return null;
  for(var i=0;i<plan.branches.length;i++){
    var b=plan.branches[i];
    if(b.r===region&&b.n===name)return b.d||{};
  }
  return null;
}

function aggregateEarnedPremiumRate(branches, key){
  var weightedSum=0,totalEarned=0,simpleSum=0,simpleCount=0;
  (branches||[]).forEach(function(b){
    var d=b.d||{};
    var rate=Number(d[key])||0;
    var earned=Number(d['已赚保费'])||0;
    simpleSum+=rate;simpleCount++;
    if(earned>0){weightedSum+=rate*earned;totalEarned+=earned;}
  });
  if(totalEarned>0)return weightedSum/totalEarned;
  return simpleCount>0?simpleSum/simpleCount:0;
}

function refreshMergedData(){
  var pk=resolvePlanKey();
  var mk='_merged';
  if(!App.ALL_DATA[mk])App.ALL_DATA[mk]={};
  var plan=App.ALL_DATA._plans&&App.ALL_DATA._plans[pk]?App.ALL_DATA._plans[pk]:null;
  var actual=App.ALL_DATA.actuals&&App.ALL_DATA.actuals[App.currentMonth]?App.ALL_DATA.actuals[App.currentMonth]:null;
  if(!actual)actual={branches:[],regions:{},national:{}};
  if(!plan){
    // No plan - use actual data only (plan fields will be 0)
    App.ALL_DATA[mk][App.currentMonth]=JSON.parse(JSON.stringify(actual));
    var empty={};
    for(var i=0;i<App.PLAN_KEYS.length;i++)empty[App.PLAN_KEYS[i]]=0;
    if(App.ALL_DATA[mk][App.currentMonth].national)Object.assign(App.ALL_DATA[mk][App.currentMonth].national,empty);
    for(var r in App.ALL_DATA[mk][App.currentMonth].regions)Object.assign(App.ALL_DATA[mk][App.currentMonth].regions[r],empty);
    // For branches: merge plan into each branch
    var ab=App.ALL_DATA[mk][App.currentMonth].branches||[];
    for(var bi=0;bi<ab.length;bi++){
      var pb=findPlanBranch(plan,ab[bi].r,ab[bi].n);
      for(var j=0;j<App.PLAN_KEYS.length;j++){var kk=App.PLAN_KEYS[j];if(pb&&pb[kk]!=null)ab[bi].d[kk]=pb[kk];else ab[bi].d[kk]=0;}
    }
  }else{
    // Merge plan + actual at branch level
    var merged=JSON.parse(JSON.stringify(actual));
    var ab2=merged.branches||[];
    for(var bi2=0;bi2<ab2.length;bi2++){
      var pb2=findPlanBranch(plan,ab2[bi2].r,ab2[bi2].n);
      for(var j2=0;j2<App.PLAN_KEYS.length;j2++){var kk2=App.PLAN_KEYS[j2];if(pb2&&pb2[kk2]!=null)ab2[bi2].d[kk2]=pb2[kk2];else ab2[bi2].d[kk2]=0;}
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
    App.ALL_DATA[mk][App.currentMonth]=merged;
  }
  // Compute COR计划 first, then computeDerived so 与本年计划比较 uses correct COR计划
  var mb=App.ALL_DATA[mk][App.currentMonth].branches||[];
  for(var mi=0;mi<mb.length;mi++){
    var bd=mb[mi].d;
    var totalPlan=(Number(bd['已赚保费计划'])||0);
    bd['综合成本率计划（整体利润口径）']=totalPlan>0?1-(Number(bd['经营利润年度计划'])||0)/totalPlan:0;
  }
  for(var mi2=0;mi2<mb.length;mi2++){computeDerived(mb[mi2].d);}
  // Re-aggregate regions
  var rm={};
  for(var ri=0;ri<mb.length;ri++){var rr=mb[ri].r;if(!rm[rr])rm[rr]=[];rm[rr].push(mb[ri]);}
  var na={};
  App.REGIONS.forEach(function(rn){
    var bl=rm[rn]||[];if(bl.length===0)return;
    var agg={};
    for(var fi=0;fi<App.FIELDS.length;fi++){var fk=App.FIELDS[fi].k;agg[fk]=0;}
    App.FIELDS.filter(function(f){return f.m;}).forEach(function(f){agg[f.k]=bl.reduce(function(s,b){return s+(Number(b.d[f.k])||0);},0);});
    ['已赚赔付率实际','已赚费用率实际'].forEach(function(k){agg[k]=aggregateEarnedPremiumRate(bl,k);});
    var rTotalPlan=(Number(agg['已赚保费计划'])||0);
    agg['综合成本率计划（整体利润口径）']=rTotalPlan>0?1-(Number(agg['经营利润年度计划'])||0)/rTotalPlan:0;
    computeDerived(agg);
    App.ALL_DATA[mk][App.currentMonth].regions[rn]=agg;
  });
  for(var fi2=0;fi2<App.FIELDS.length;fi2++){var fk2=App.FIELDS[fi2].k;na[fk2]=0;}
  App.FIELDS.filter(function(f){return f.m;}).forEach(function(f){na[f.k]=mb.reduce(function(s,b){return s+(Number(b.d[f.k])||0);},0);});
  ['已赚赔付率实际','已赚费用率实际'].forEach(function(k){na[k]=aggregateEarnedPremiumRate(mb,k);});
  // COR计划先算，再computeDerived，保证与本年计划比较正确
  var nTotalPlan=(Number(na['已赚保费计划'])||0);
  na['综合成本率计划（整体利润口径）']=nTotalPlan>0?1-(Number(na['经营利润年度计划'])||0)/nTotalPlan:0;
  computeDerived(na);
  App.ALL_DATA[mk][App.currentMonth].national=na;
}

// Pure function: compute merged data for any month (no side effects on App.DATA)
function computeMonthData(mk){
  var y=mk.split('-')[0];
  var plans=App.ALL_DATA._plans||{};
  var candidates=[];
  for(var k in plans){
    if(k==y)candidates.push({k:k,v:0});
    if(k.startsWith(y+'-v'))candidates.push({k:k,v:parseInt(k.split('-v')[1])||0});
  }
  var pk=candidates.length>0?candidates.sort(function(a,b){return b.v-a.v;})[0].k:null;
  var plan=pk&&App.ALL_DATA._plans[pk]?App.ALL_DATA._plans[pk]:null;
  var actual=App.ALL_DATA.actuals&&App.ALL_DATA.actuals[mk]?App.ALL_DATA.actuals[mk]:null;
  if(!actual)return null;

  // Save original month, set to mk for computeDerived
  var savedMonth=App.currentMonth;
  App.currentMonth=mk;

  // Clone actual + merge plan
  var merged=JSON.parse(JSON.stringify(actual));
  var ab=merged.branches||[];
  for(var bi=0;bi<ab.length;bi++){
    var pb=findPlanBranch(plan,ab[bi].r,ab[bi].n);
    for(var j=0;j<App.PLAN_KEYS.length;j++){var kk=App.PLAN_KEYS[j];if(pb&&pb[kk]!=null)ab[bi].d[kk]=pb[kk];else ab[bi].d[kk]=0;}
  }
  // If no actual branches, create from plan
  if(ab.length===0&&plan&&plan.branches&&plan.branches.length>0){
    for(var bpi=0;bpi<plan.branches.length;bpi++){
      var pb2=plan.branches[bpi];var nd={};
      for(var fp in pb2.d)nd[fp]=pb2.d[fp];
      var AK=['车险实际','财产险实际','人身险实际','已赚保费','经营利润','当月经营利润','已赚赔付率实际','已赚费用率实际','前台人员实际','后台人员实际','前台平均人数','后台平均人数','整体平均人数','前台人力成本实际','后台人力成本实际','整体人力成本实际'];
      for(var ai=0;ai<AK.length;ai++){if(!(AK[ai] in nd))nd[AK[ai]]=0;}
      ab.push({n:pb2.n,r:pb2.r,d:nd});
    }
  }

  // Compute COR计划 first, then computeDerived so 与本年计划比较 uses correct COR计划
  for(var mi=0;mi<ab.length;mi++){
    var bd=ab[mi].d;
    var tPlan=(Number(bd['已赚保费计划'])||0);
    bd['综合成本率计划（整体利润口径）']=tPlan>0?1-(Number(bd['经营利润年度计划'])||0)/tPlan:0;
  }
  for(var mi2=0;mi2<ab.length;mi2++){computeDerived(ab[mi2].d);}

  // Re-aggregate regions
  var rm={};
  for(var ri=0;ri<ab.length;ri++){var rr=ab[ri].r;if(!rm[rr])rm[rr]=[];rm[rr].push(ab[ri]);}
  var na={},ra={};
  App.REGIONS.forEach(function(rn){
    var bl=rm[rn]||[];if(bl.length===0)return;
    var agg={};
    for(var fi=0;fi<App.FIELDS.length;fi++){var fk=App.FIELDS[fi].k;agg[fk]=0;}
    App.FIELDS.filter(function(f){return f.m;}).forEach(function(f){agg[f.k]=bl.reduce(function(s,b){return s+(Number(b.d[f.k])||0);},0);});
    ['已赚赔付率实际','已赚费用率实际'].forEach(function(k){agg[k]=aggregateEarnedPremiumRate(bl,k);});
    var rtp=(Number(agg['已赚保费计划'])||0);
    agg['综合成本率计划（整体利润口径）']=rtp>0?1-(Number(agg['经营利润年度计划'])||0)/rtp:0;
    computeDerived(agg);
    ra[rn]=agg;
  });
  for(var fi2=0;fi2<App.FIELDS.length;fi2++){var fk2=App.FIELDS[fi2].k;na[fk2]=0;}
  App.FIELDS.filter(function(f){return f.m;}).forEach(function(f){na[f.k]=ab.reduce(function(s,b){return s+(Number(b.d[f.k])||0);},0);});
  ['已赚赔付率实际','已赚费用率实际'].forEach(function(k){na[k]=aggregateEarnedPremiumRate(ab,k);});
  var ntp=(Number(na['已赚保费计划'])||0);
  na['综合成本率计划（整体利润口径）']=ntp>0?1-(Number(na['经营利润年度计划'])||0)/ntp:0;
  computeDerived(na);

  App.currentMonth=savedMonth;
  return {branches:ab,regions:ra,national:na};
}

function resetAllData(){
  if(!confirm('确认还原为默认数据？所有导入的计划和实际数据将被清除。'))return;
  App.ALL_DATA={_plans:{},actuals:{},currentMonth:App.currentMonth||'2026-04',currentPlanKey:'auto'};
  App.currentMonth=App.ALL_DATA.currentMonth||'2026-04';
  App.currentPlanKey=App.ALL_DATA.currentPlanKey||'auto';
  localStorage.removeItem(App.STORAGE_KEY);
  saveAllData();updateMonthUI();updatePlanUI();
  refreshMergedData();destroyCharts();switchTab('overview');alert('导入完成！数据已加载。');
}
