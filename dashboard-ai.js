// dashboard-ai.js v6 — 经营分析报告（规则优化版）
// 分析规则：风险等级矩阵 + 经营模式识别 + 分项归因 + 定向建议
// 零外部依赖，只读 App.* 数据

(function(){
'use strict';

// ══════════ 工具 ══════════
function _fi(k){return (App.FIELDS||[]).find(function(x){return x.k===k;})||{};}
function _fv(v,u){return typeof fmtVal==='function'?fmtVal(v,u):(v!=null?v.toFixed(2):'-');}
function _fdelta(v,u){if(u==='%')return (v*100).toFixed(0)+'pp';return _fv(v,u);}
function _pct(v){return v!=null?(v*100).toFixed(0)+'%':'-';}
function _eh(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v==null?'':v);}

var KM={
  premRate:   {k:'时间进度计划达成率',label:'保费达成率',u:'%',rd:'desc',th:{good:0.90,warn:0.70,bad:0.50}},
  profitRate: {k:'时间进度达成率',label:'利润达成率',u:'%',rd:'desc',th:{good:0.90,warn:0.70,bad:0.50}},
  cor:        {k:'综合成本率实际（整体利润口径）',label:'综合成本率',u:'%',rd:'asc',th:{good:0.96,warn:1.00,bad:1.05}},
  lossRate:   {k:'已赚赔付率实际',label:'赔付率',u:'%',rd:'asc',th:{good:0.62,warn:0.68,bad:0.73}},
  costRate:   {k:'已赚费用率实际',label:'费用率',u:'%',rd:'asc',th:{good:0.28,warn:0.32,bad:0.36}},
  premium:    {k:'保费实际合计',label:'保费收入',u:'万元',rd:'desc',th:{}},
  profit:     {k:'经营利润',label:'利润',u:'万元',rd:'desc',th:{}},
  profitPer:  {k:'整体人均利润实际',label:'人均利润',u:'万元/人',rd:'desc',th:{good:0.5,warn:0,bad:-1}},
  prodPer:   {k:'整体人均产能实际',label:'人均产能',u:'万元/人',rd:'desc',th:{good:15,warn:10,bad:6}},
  prodRate:  {k:'整体人人均产能计划达成率',label:'产能达成率',u:'%',rd:'desc',th:{good:0.90,warn:0.70,bad:0.50}},
  backProd:  {k:'后台人均产能实际',label:'后台产能',u:'万元/人',rd:'desc',th:{}},
  hrCostRate:{k:'整体人力成本保费率实际',label:'人力成本保费率',u:'%',rd:'asc',th:{good:0.06,warn:0.10,bad:0.15}}
};

function _bdata(n){var bs=App.DATA.branches||[],b=bs.find(function(x){return x.n===n;});return {d:b?b.d||b:{},r:b?b.r||'':''};}

function _yoyData(bn){
  var cm=App.currentMonth.split('-'),yk=(parseInt(cm[0])-1)+'-'+cm[1];
  var aa=App.ALL_DATA.actuals||{},pd=aa[yk];
  if(!pd||!pd.branches)return null;
  var b=pd.branches.find(function(x){return x.n===bn;});
  return b?b.d||null:null;
}

function _rank(f,bn,rd){
  var bs=App.DATA.branches||[],t=bs.length;
  if(!t)return null;
  var vs=[],sv=null;
  bs.forEach(function(b){var v=Number((b.d||b)[f])||0;vs.push(v);if(b.n===bn)sv=v;});
  vs.sort(function(a,b){return rd==='asc'?a-b:b-a;});
  var rk=vs.indexOf(sv)+1;
  return {rank:rk,total:t,self:sv,pct:Math.round(rk/t*100),best:vs[0],median:vs[Math.floor(t/2)],worst:vs[t-1]};
}

function _overall(f){
  // 读取分公司整体数据（加权合计后经 computeDerived 计算）
  var nat=App.DATA.national;
  if(!nat)return null;
  var v=Number(nat[f]);
  return !isNaN(v)?v:null;
}

// ── 快照 ──
function _snap(bn){
  var d=_bdata(bn).d,prev=_yoyData(bn),sn={},has=false;
  Object.keys(KM).forEach(function(key){
    var m=KM[key],cur=d[m.k]!=null?Number(d[m.k]):null;
    if(cur!=null&&!isNaN(cur))has=true;
    var pv=prev&&prev[m.k]!=null?Number(prev[m.k]):null;
    var delta=(cur!=null&&pv!=null&&isFinite(cur-pv))?cur-pv:null;
    sn[key]={cur:cur,prev:pv,delta:delta,u:m.u,label:m.label,rd:m.rd,th:m.th};
    if(cur!=null)sn[key].rank=_rank(m.k,bn,m.rd);
    if(cur!=null)sn[key].peer=_overall(m.k);
  });
  sn._ok=has;return sn;
}

function _yoyStr(delta,u){
  if(delta==null)return'—';
  if(Math.abs(delta)<0.001)return'持平';
  return (delta>0?'↑':'↓')+_fdelta(Math.abs(delta),u);
}
function _yoyFull(delta,u){
  if(delta==null)return'（无同比数据）';
  if(Math.abs(delta)<0.001)return'（同比持平）';
  return'（同比'+(delta>0?'上升':'下降')+_fdelta(Math.abs(delta),u)+'）';
}

// ══════════ 风险等级矩阵 ══════════
function _assessLevel(sn,alerts){
  var errorN=alerts.filter(function(r){return r.severity==='error';}).length;
  var warnN=alerts.filter(function(r){return r.severity==='warn';}).length;
  var alertFields=alerts.map(function(r){return r.field;});

  var score=0,reasons=[];

  // ── 一、预警触发指标（和预警阈值比较，触发才算问题）──
  var alertMetrics=['时间进度计划达成率','时间进度达成率','综合成本率实际（整体利润口径）','整体人力成本保费率实际','经营利润'];
  alertMetrics.forEach(function(fk){
    if(alertFields.indexOf(fk)>=0){
      var a=alerts.find(function(r){return r.field===fk;});
      if(a){
        if(a.severity==='error'){score+=15;reasons.push('预警:'+(_fi(fk).l||fk));}
        else if(a.severity==='warn'){score+=8;reasons.push('预警:'+(_fi(fk).l||fk));}
        else {score+=4;}
      }
    }
  });
  // 其他字段告警也计入（如车险实际、非车险实际等）
  var otherAlerts=alerts.filter(function(r){return alertMetrics.indexOf(r.field)<0;});
  otherAlerts.forEach(function(r){
    if(r.severity==='error')score+=12;
    else if(r.severity==='warn')score+=6;
    else score+=3;
  });

  // ── 二、对标指标（和分公司整体比较）──
  var lr=sn.lossRate, cr=sn.costRate, pp=sn.profitPer, prod=sn.prodPer, back=sn.backProd;
  var prodPeer=sn.prodPer.peer; // 分公司整体人均产能

  // 赔付率 vs 分公司整体
  if(lr.cur!=null&&lr.peer!=null&&lr.cur>lr.peer){
    var gap=lr.cur-lr.peer;
    if(gap>0.05){score+=8;reasons.push('赔付率高于分公司整体'+_fdelta(gap,'%'));}
    else{score+=4;reasons.push('赔付率高于分公司整体');}
  }
  // 费用率 vs 分公司整体
  if(cr.cur!=null&&cr.peer!=null&&cr.cur>cr.peer){
    var gap2=cr.cur-cr.peer;
    if(gap2>0.03){score+=6;reasons.push('费用率高于分公司整体'+_fdelta(gap2,'%'));}
    else{score+=3;reasons.push('费用率高于分公司整体');}
  }
  // 人均利润 vs 分公司整体
  if(pp.cur!=null&&pp.peer!=null&&pp.cur<pp.peer){
    var gap3=pp.peer-pp.cur;
    if(pp.peer>0&&gap3/pp.peer>0.5)score+=6;
    else score+=3;
    reasons.push('人均利润低于分公司整体');
  }
  // 人均产能 vs 分公司整体
  if(prod.cur!=null&&prodPeer!=null&&prod.cur<prodPeer){
    var gap4=prodPeer-prod.cur;
    if(prodPeer>0&&gap4/prodPeer>0.3)score+=5;
    else score+=2;
    reasons.push('人均产能与分公司整体水平存在差距');
  }
  // 后台产能 vs 整体人均产能均值
  if(back.cur!=null&&prodPeer!=null&&back.cur<prodPeer){
    score+=3;reasons.push('后台产能低于分公司整体');
  }
  // 产能达成率
  if(sn.prodRate.cur!=null&&sn.prodRate.cur<0.60){score+=3;reasons.push('产能达成率<60%');}

  // ── 三、趋势修正 ──
  if(sn.cor.delta!=null&&sn.cor.delta>0.03)score+=5;
  if(sn.cor.delta!=null&&sn.cor.delta<-0.03)score-=5;
  if(sn.lossRate.delta!=null&&sn.lossRate.delta>0.05)score+=4;
  if(sn.profitRate.delta!=null&&sn.profitRate.delta<-0.10)score+=4;
  if(sn.profitRate.delta!=null&&sn.profitRate.delta>0.05)score-=4;
  score=Math.max(0,score);

  // ── 等级判定 ──
  if(score>=40)return {level:'🔴 高风险',color:'#dc2626',
    desc:'多维指标严重偏离，存在系统性经营风险。触发因素：'+reasons.join('、')};
  if(score>=20)return {level:'🟠 中风险',color:'#d97706',
    desc:'多项指标偏离预警线，需持续关注。触发因素：'+reasons.join('、')};
  if(score>=8)return {level:'🔵 关注',color:'#2563eb',
    desc:'部分指标接近预警阈值。触发因素：'+reasons.join('、')};
  return {level:'🟢 正常',color:'#16a34a',desc:'核心经营指标处于健康区间，未触发重大预警'};
}

// ══════════ 经营模式识别 ══════════
function _patternAnalysis(sn){
  var patterns=[];
  var cor=sn.cor.cur,lr=sn.lossRate.cur,cr=sn.costRate.cur,pr=sn.profitRate.cur,prem=sn.premium,pcr=sn.premRate,pper=sn.profitPer,prod=sn.prodPer,prodR=sn.prodRate,back=sn.backProd,hrCR=sn.hrCostRate;

  // 模式1：三面夹击（保费↓ + 赔付↑ + 费用↑）
  if(prem.delta!=null&&prem.delta<0&&sn.lossRate.delta!=null&&sn.lossRate.delta>0.03&&sn.costRate.delta!=null&&sn.costRate.delta>0.01){
    patterns.push({name:'三面夹击',desc:'保费规模有所收缩，赔付率和费用率均有上升，三个方向同时承压，经营压力值得关注',
      action:'保费、赔付、费用三个方向均承压，建议综合评估各方向的改善空间与优先级'});
  }
  // 模式2：费用驱动型亏损（COR>100% 但 赔付率正常）
  else if(cor!=null&&cor>1.0&&lr!=null&&lr<=0.66&&cr!=null&&cr>0.30){
    patterns.push({name:'费用驱动型亏损',desc:'综合成本率偏高的主要贡献来自费用端（'+_fv(cr,'%')+'），赔付率相对处于正常区间',
      action:'费用结构值得关注，区分固定与变动费用有助于判断压降空间'});
  }
  // 模式3：赔付驱动型亏损
  else if(cor!=null&&cor>1.0&&lr!=null&&lr>0.68&&cr!=null&&cr<=0.32){
    patterns.push({name:'赔付驱动型亏损',desc:'综合成本率偏高的主要贡献来自赔付端（'+_fv(lr,'%')+'），费用率相对可控，或可通过业务质量改善来缓解',
      action:'核保筛选与业务结构可作为观察重点，大案跟踪与再保安排或可同步检视'});
  }
  // 模式4：增长陷阱（保费增长 BUT COR 恶化）
  else if(prem.delta!=null&&prem.delta>0.05&&cor!=null&&cor>0.98&&sn.cor.delta!=null&&sn.cor.delta>0.02){
    patterns.push({name:'增长陷阱',desc:'保费规模同比增长的同时综合成本率也有所上升，规模与质量之间的平衡关系值得关注',
      action:'新增业务的利润贡献值得关注，业务准入标准或可结合赔付表现做适当调整'});
  }
  // 模式5：健康收缩（保费下降 BUT COR 改善）
  else if(prem.delta!=null&&prem.delta<0&&sn.cor.delta!=null&&sn.cor.delta<-0.03){
    patterns.push({name:'健康收缩',desc:'保费规模收缩但综合成本率有所改善，不排除与业务结构主动调整有关',
      action:'规模变化若是策略性调整，可关注剩余业务的质量趋势是否方向一致'});
  }
  // 模式7：保费达成不佳（保费达成率低但COR尚可）
  if(pcr.cur!=null&&pcr.cur<0.75&&cor!=null&&cor<1.0&&(!sn.profitRate.cur||sn.profitRate.cur<0.80)){
    patterns.push({name:'保费达成不佳',desc:'保费达成率为'+_pct(pcr.cur)+'，与时间进度存在差距，综合成本率尚在可接受范围（'+_fv(cor,'%')+'），利润缺口可能更多来自收入端而非成本端',
      action:'保费缺口来源（分险种/分渠道）可供参考，优质业务获取与产品策略可同步关注'});
  }
  // 模式8：保费利润双低
  else if(pcr.cur!=null&&pcr.cur<0.70&&sn.profitRate.cur!=null&&sn.profitRate.cur<0.70){
    patterns.push({name:'保费利润双低',desc:'保费达成率（'+_pct(pcr.cur)+'）和利润达成率（'+_pct(sn.profitRate.cur)+'）均与时间进度存在较大差距，收入端和效益端可能同时承压',
      action:'业务结构梳理值得关注，高利润率业务的获取与低效业务的识别可同步推进'});
  }
  // 模式9：人力效能全面不足（产能<分公司整体 + 人均利润<分公司整体 + 后台产能<分公司整体）
  if(prod.peer!=null&&pper.peer!=null&&back.peer!=null&&
     prod.cur!=null&&prod.cur<prod.peer&&pper.cur!=null&&pper.cur<pper.peer&&back.cur!=null&&back.cur<back.peer){
    patterns.push({name:'人力效能全面不足',desc:'人均产能、后台产能、人均利润三项指标均低于分公司整体，人力投入产出效率或存在提升空间',
      action:'人员结构（前后台比例）、考核导向、编制合理性三个维度或可作为审视切入点'});
  }
  // 模式10：后台产能畸低
  else if(back.peer!=null&&back.cur!=null&&back.cur<back.peer&&prod.peer!=null&&prod.cur!=null&&prod.cur>=prod.peer){
    patterns.push({name:'后台产能偏低',desc:'整体人均产能接近分公司整体但后台产能（'+_fv(back.cur,'万元/人')+'）低于分公司整体（'+_fv(back.peer,'万元/人')+'），前后台结构配比或可进一步审视',
      action:'后台编制与前后台配比或有审视空间，职能整合与数字化提效可纳入考量'});
  }
  // 模式11：人力成本保费率相对偏高（仅预警触发时标注）
  else if(hrCR.cur!=null&&hrCR.cur>0.10&&pper.cur!=null&&pper.cur<0){
    patterns.push({name:'人力成本负担过重',desc:'人力成本保费率'+_pct(hrCR.cur)+'，处于较高水平，且人均利润为负，人力成本与利润的平衡关系值得关注',
      action:'人力成本预算执行情况值得关注，弹性成本与保费产出的匹配度或可提供优化线索'});
  }
  // 模式12：人均利润低于分公司整体（产能正常）
  else if(pper.peer!=null&&pper.cur!=null&&pper.cur<pper.peer&&prod.peer!=null&&prod.cur!=null&&prod.cur>=prod.peer){
    patterns.push({name:'利润转化效率低',desc:'人均产能接近分公司整体水平，但人均利润（'+_fv(pper.cur,'万元/人')+'）低于分公司整体（'+_fv(pper.peer,'万元/人')+'），保费产出向利润的转化效率或有改善空间',
      action:'综合成本率结构值得分析，赔付端与费用端的相对贡献可作为改善优先级参考'});
  }
  return patterns;
}

// ══════════ 归因分析 ══════════
function _causesAnalysis(sn,alerts){
  var cs=[],alertFs=alerts.map(function(r){return r.field;});
  var cor=sn.cor, lr=sn.lossRate, cr=sn.costRate, pr=sn.profitRate, prem=sn.premium, prof=sn.profit, pp=sn.profitPer, pcr=sn.premRate, prod=sn.prodPer, prodR=sn.prodRate, back=sn.backProd, hrCR=sn.hrCostRate;

  // 1. COR 归因分解
  if(cor.cur!=null&&cor.cur>0.98){
    if(lr.cur!=null&&cr.cur!=null){
      // 用分公司整体估算"合理"赔付率和费用率
      var refLR=lr.peer||0.65, refCR=cr.peer||0.30;
      var lrExcess=Math.max(0,lr.cur-refLR), crExcess=Math.max(0,cr.cur-refCR);
      var totalExcess=lrExcess+crExcess;
      if(totalExcess>0.005){
        var lrShare=Math.round(lrExcess/totalExcess*100), crShare=Math.round(crExcess/totalExcess*100);
        if(lrShare>=60)cs.push('COR高出分公司整体'+_fdelta(cor.cur-(cor.peer||0),'%')+
          '，其中赔付率贡献约'+lrShare+'%（高于均值'+_fdelta(lrExcess,'%')+'），费用率贡献约'+crShare+'%（高于均值'+_fdelta(crExcess,'%')+'）');
        else cs.push('COR高出分公司整体'+_fdelta(cor.cur-(cor.peer||0),'%')+
          '，费用率偏差（+'+_fdelta(crExcess,'%')+'）大于赔付率偏差（+'+_fdelta(lrExcess,'%')+'），费用端的偏差相对更明显');
      }
    }
  }

  // 2. 赔付率恶化归因
  if(lr.delta!=null&&lr.delta>0.02){
    var severity=lr.delta>0.06?'较明显':(lr.delta>0.03?'一定程度':'小幅');
    cs.push('赔付率同比'+severity+'上升'+_fdelta(lr.delta,'%')+
      (lr.cur!=null?'（当前'+_fv(lr.cur,'%')+'）':'')+'，可关注以下方面：①大额赔案是否集中发生 ②业务结构是否发生变化 ③准备金评估有无调整');
  }

  // 3. 费用率刚性
  if(cr.cur!=null&&cr.cur>0.32){
    cs.push('费用率'+_fv(cr.cur,'%')+'相对较高，'+
      (prem.delta!=null&&prem.delta<0?'若保费规模有所下降，固定费用率可能被动升高':'费用科目与预算的偏差情况值得关注'));
  }

  // 4. 利润下滑归因链
  if(prof.delta!=null&&prof.delta<0){
    var parts=[];
    if(prem.delta!=null&&prem.delta<0)parts.push('保费收入下降可能是利润下滑的'+_fdelta(Math.abs(prem.delta),prem.u)+'参考因素之一');
    if(lr.delta!=null&&lr.delta>0.01)parts.push('赔付率上升对承保利润空间可能有一定影响');
    if(cr.delta!=null&&cr.delta>0.005)parts.push('费用率上升或对利润有进一步影响');
    if(parts.length)cs.push('利润同比下降，可能的原因包括：'+parts.join('；')+'。');
  }

  // 5. 人力效能（基于同类对标）
  var ppPeer=pp.peer, prodPeer=prod.peer, backPeer=prod.peer; // 后台对标分公司整体
  if(pp.cur!=null&&ppPeer!=null&&pp.cur<ppPeer){
    cs.push('人均利润 '+_fv(pp.cur,'万元/人')+'，低于分公司整体 '+_fv(ppPeer,'万元/人')+'，'+
      (pp.cur<0?'人员投入产出偏低，':'产出效率与同业水平存在差异，')+'人力成本结构与保费产出的匹配关系值得关注');
  }else if(pp.cur!=null&&pp.cur<0){
    cs.push('人均利润为负（'+_fv(pp.cur,'万元/人')+'），产出效率或存在改善空间');
  }
  if(prod.cur!=null&&prodPeer!=null&&prod.cur<prodPeer){
    cs.push('人均产能 '+_fv(prod.cur,'万元/人')+'，低于分公司整体 '+_fv(prodPeer,'万元/人')+'（低'+Math.round((prodPeer-prod.cur)/prodPeer*100)+'%），人员产出效率有待提升');
  }
  if(back.cur!=null&&prodPeer!=null&&back.cur<prodPeer){
    cs.push('后台产能 '+_fv(back.cur,'万元/人')+'，低于分公司整体 '+_fv(prodPeer,'万元/人')+'，后台人员配比或可进一步审视');
  }
  if(hrCR.cur!=null&&hrCR.cur>0.10){
    cs.push('人力成本保费率 '+_pct(hrCR.cur)+'，超过10%参考线，人力成本占保费收入的比重相对较高');
  }

  // 6. 保费达成不足
  if(pcr.cur!=null&&pcr.cur<0.80){
    var gap=1-pcr.cur;
    cs.push('保费达成率为'+_pct(pcr.cur)+'，与时间进度有约'+Math.round(gap*100)+'个百分点，'+
      (prem.delta!=null&&prem.delta<0?'同比也有所回落，收入端或存在一定压力':'收入端增长势头或可加强'));
  }

  if(cs.length===0)cs.push('当前预警集中在个别指标上，建议对照业务日历排查是否有一次性事项影响');
  return cs;
}

// ══════════ 核查清单 ══════════
function _investigations(sn,alerts,patterns){
  var items=[];
  var cor=sn.cor, lr=sn.lossRate, cr=sn.costRate, prem=sn.premium, back=sn.backProd, hrCR=sn.hrCostRate;

  // 按紧急程度排列
  if(cor.cur!=null&&cor.cur>1.0)items.push('【优先】若综合成本率持续偏高，建议参考分险种COR明细，关注是否存在个别险种或环节的集中影响');
  if(lr.delta!=null&&lr.delta>0.03)items.push('【优先】可查阅大额赔案清单，观察是否存在偶发性大案或需要关注的赔付趋势变化');
  if(cr.cur!=null&&cr.cur>0.30)items.push('费用科目明细（分固定/变动），可与预算做参考对比，了解主要偏差来源');
  if(prem.delta!=null&&prem.delta<-0.05)items.push('保费同比有所下降，建议结合分渠道/分险种数据，了解哪些板块变化较为明显');
  if(back.cur!=null&&back.peer!=null&&back.cur<back.peer)items.push('后台人员编制与产能数据可作为参考，帮助判断前后台结构是否有优化空间');
  if(hrCR.cur!=null&&hrCR.cur>0.10)items.push('人力成本预算执行情况与分科目明细，或有助于判断成本变动的主要驱动因素');
  items.push('近3个月趋势变化可供观察，帮助区分短期波动与方向性变化');
  items.push('人员编制与产能的匹配情况（分前台/中后台），可作为效率判断的参考维度');
  if(patterns.length>0)items.push('同区域内表现较为稳健的分公司数据，或可作为经营改善的参照');

  // 去重截断
  return items.slice(0,7);
}

// ══════════ 管理建议 ══════════
function _suggestions(lv,pat,cor,lr,cr,pr,prem,pcr,prod,prodR,back,hrCR){
  var sg=[];

  // 短期（1-2周）
  if(lv.level.indexOf('高风险')>=0){
    sg.push({domain:'management',term:'短期（1-2周）',text:'可视情况组织专项经营分析会，逐项梳理指标变化，明确关注重点与分工'});
    sg.push({domain:'management',term:'短期（1-2周）',text:'可考虑梳理近期可落地的改善举措，设定阶段性观察目标'});
  }
  if(cor.cur!=null&&cor.cur>1.05){
    sg.push({domain:'business',term:'短期（1-2周）',text:'综合成本率较高，建议按险种、渠道和业务来源核查承保质量，识别高成本业务并调整业务获取策略'});
    sg.push({domain:'claims',term:'短期（1-2周）',text:'综合成本率较高，建议拆分大案、案均赔款和赔付频度，确认赔付端对成本偏离的主要贡献'});
  }
  if(lr.cur!=null&&lr.cur>0.73){
    sg.push({domain:'claims',term:'短期（1-2周）',text:'赔付率偏高，可考虑建立大案跟踪台账，对单笔金额较大的赔案保持关注'});
  }
  if(pcr.cur!=null&&pcr.cur<0.60){
    sg.push({domain:'business',term:'短期（1-2周）',text:'保费达成率与时间进度存在差距，建议分渠道、分险种了解保费缺口的主要分布'});
  }

  // 中期（1-3月）
  if(pcr.cur!=null&&pcr.cur<0.80){
    sg.push({domain:'business',term:'中期（1-3月）',text:'保费达成有提升空间，可探讨渠道拓展与产品优化的可能方向，关注达成率改善趋势'});
  }
  if(cr.cur!=null&&cr.cur>0.32){
    sg.push({domain:'management',term:'中期（1-3月）',text:'可审视费用结构，关注是否存在刚性支出以外的优化空间，参考费用率'+_pct(cr.cur-0.03)+'以下，按月跟踪进度'});
  }
  if(prem.delta!=null&&prem.delta<-0.05){
    sg.push({domain:'business',term:'中期（1-3月）',text:'保费有所回落，可探讨渠道策略是否需要微调，关注'+Math.abs(Math.round(prem.delta*100))+'%的缺口'});
  }
  if(cor.cur!=null&&cor.cur>1.0&&lr.cur!=null&&lr.cur>0.70){
    sg.push({domain:'claims',term:'中期（1-3月）',text:'业务结构或有优化空间，可关注不同险种的赔付表现，作为结构调整的参考'});
  }
  if(prod.cur!=null&&prod.peer!=null&&prod.cur<prod.peer&&prod.peer>0){
    var gapPct=Math.round((prod.peer-prod.cur)/prod.peer*100);
    sg.push({domain:'efficiency',term:'中期（1-3月）',text:'人均产能与分公司整体水平存在差距'+gapPct+'%，编制与前后台配比或可作为优化参考方向'});
  }
  if(back.cur!=null&&prod.peer!=null&&back.cur<prod.peer){
    sg.push({domain:'efficiency',term:'中期（1-3月）',text:'后台产能低于分公司整体，后台职能配置与数字化提效或存在优化空间'});
  }
  if(hrCR.cur!=null&&hrCR.cur>0.10){
    sg.push({domain:'efficiency',term:'中期（1-3月）',text:'人力成本保费率相对偏高（'+_pct(hrCR.cur)+'），人力成本增速与保费产出的匹配关系值得关注'});
  }

  // 长期（3-6月）
  sg.push({domain:'management',term:'长期（3-6月）',text:'可考虑建立关键指标定期回顾机制，便于及时发现问题并形成响应习惯'});
  if(pat.some(function(p){return p.name.indexOf('费用')>=0||p.name.indexOf('增长')>=0;})){
    sg.push({domain:'management',term:'长期（3-6月）',text:'业务策略与考核导向值得定期审视，关注规模与质量之间的平衡'});
  }

  var domainOrder=['business','claims','efficiency','management'];
  var domainLimit={business:2,claims:2,efficiency:2,management:1};
  var selected=[],seen={};
  domainOrder.forEach(function(domain){
    sg.filter(function(item){return item.domain===domain;}).forEach(function(item){
      if(selected.filter(function(x){return x.domain===domain;}).length>=domainLimit[domain])return;
      var key=domain+'|'+item.text;
      if(seen[key])return;
      seen[key]=true;selected.push(item);
    });
  });
  return selected.slice(0,7);
}

function _stableHash(value){
  var text=JSON.stringify(value),hash=2166136261;
  for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16);
}
function _riskName(level){
  if(level.indexOf('高风险')>=0)return'高风险';
  if(level.indexOf('中风险')>=0)return'中风险';
  if(level.indexOf('关注')>=0)return'关注';
  return'正常';
}
function _scoreFromLevel(level){
  var m=String(level.desc||'').match(/得分[：:]?\s*(\d+)/);
  if(m)return Number(m[1]);
  return _riskName(level.level)==='高风险'?40:(_riskName(level.level)==='中风险'?20:(_riskName(level.level)==='关注'?8:0));
}
function _buildDiagnosisModel(bn,alerts){
  alerts=alerts||[];
  var configurationErrors=(App.METRIC_CONFIG_ERRORS||[]).slice();
  alerts=alerts.filter(function(item){
    if(App.getMetricMeta(item.field))return true;
    configurationErrors.push({metric:item.field,missing:['metric_metadata'],source:'alert'});
    return false;
  });
  var sn=_snap(bn),branch=_bdata(bn),data=branch.d||{},evidence=[],facts=[],rankingConcerns=[];
  if(!sn._ok)return null;
  var lv=_assessLevel(sn,alerts),patterns=_patternAnalysis(sn);
  var causes=_causesAnalysis(sn,alerts),checks=_investigations(sn,alerts,patterns);
  var suggestions=_suggestions(lv,patterns,sn.cor,sn.lossRate,sn.costRate,sn.profitRate,sn.premium,sn.premRate,sn.prodPer,sn.prodRate,sn.backProd,sn.hrCostRate);
  Object.keys(App.METRIC_METADATA||{}).forEach(function(key){
    var meta=App.getMetricMeta(key),current=data[key];
    if(!meta||current==null||!isFinite(Number(current)))return;
    var benchmark=App.getMetricBenchmark(bn,key),rank=_rank(key,bn,meta.direction==='decrease'?'asc':'desc');
    var id='ev_'+_stableHash([bn,App.currentMonth,meta.metricId,data]);
    var alert=alerts.find(function(item){return item.field===key;});
    evidence.push({
      id:id,metric:key,metricId:meta.metricId,label:meta.label,currentValue:Number(current),
      benchmarkValue:benchmark.value,differenceValue:benchmark.value==null?null:Number(current)-benchmark.value,
      benchmarkType:benchmark.type,benchmarkLabel:benchmark.label,benchmarkStrategy:benchmark.strategy,
      direction:meta.direction,unit:meta.unit,source:'dashboard:'+App.currentMonth,
      ruleId:alert?alert.ruleId:null,calculationVersion:meta.calculationVersion,
      severity:alert?alert.severity:null,alertMessage:alert?alert.msg:null,
      alertThreshold:alert?alert.threshold:null,alertOperator:alert?alert.op:null,
      rank:rank,trend:App.classifyMetricTrend(bn,key)
    });
    var materiallyBehind=false;
    var comparisonEligible=['ratio','attainment','productivity'].indexOf(meta.category)>=0;
    if(comparisonEligible&&rank&&rank.total>=5&&rank.pct>=80)materiallyBehind=true;
    if(comparisonEligible&&benchmark.value!=null&&benchmark.value!==0){
      var relativeGap=(Number(current)-benchmark.value)/Math.abs(benchmark.value);
      if(meta.direction==='decrease'&&relativeGap>=0.10)materiallyBehind=true;
      if(meta.direction==='increase'&&relativeGap<=-0.10)materiallyBehind=true;
    }
    if(materiallyBehind)rankingConcerns.push({
      metric:key,metricId:meta.metricId,label:meta.label,evidenceId:id,rank:rank
    });
    if(alert||(App.KEY_SET&&App.KEY_SET.has(key))){
      var anomalyReason=null;
      if(alert){
        anomalyReason=(alert.msg||'触发预警规则')+'；规则条件：'+meta.label+' '+alert.op+' '+_fv(Number(alert.threshold),meta.unit);
      }else if(materiallyBehind&&rank){
        anomalyReason='排名偏后：当前 '+rank.rank+'/'+rank.total;
      }
      facts.push({
        text:meta.label+'为'+_fv(Number(current),meta.unit),evidenceId:id,currentValue:Number(current),
        metricId:meta.metricId,rank:rank,isRiskMetric:!!alert,isAttention:materiallyBehind,
        severity:alert?alert.severity:(materiallyBehind?'attention':null),
        anomalyReason:anomalyReason
      });
    }
  });
  if(!alerts.length&&rankingConcerns.length){
    lv={
      level:'关注',color:'#2563eb',
      desc:'未触发规则预警，但存在明显排名或对标偏离，需要管理关注。'
    };
    rankingConcerns.slice(0,3).forEach(function(item){
      var rankText=item.rank?('，当前排名 '+item.rank.rank+'/'+item.rank.total):'';
      checks.unshift(item.label+'存在明显对标偏离'+rankText+'，建议核查数据口径和业务驱动项。');
    });
  }
  var evidenceIds=evidence.slice(0,4).map(function(item){return item.id;});
  return {
    schemaVersion:'diagnosis-v2',orgId:App.getOrgId(bn,'branch'),orgName:bn,branch:bn,
    period:App.currentMonth,dataVersion:'data-'+_stableHash(data),
    ruleVersion:'rules-'+_stableHash(App.ALL_DATA._alertRules||[]),
    calculationVersion:'calc-v1',score:_scoreFromLevel(lv),riskLevel:_riskName(lv.level),
    summary:bn+'当前为'+_riskName(lv.level)+'，'+lv.desc,
    riskFactors:alerts.map(function(a){return {ruleId:a.ruleId,metricId:(App.getMetricMeta(a.field)||{}).metricId,severity:a.severity};}),
    attentionItems:rankingConcerns.map(function(item){return {type:'benchmark_or_rank',metricId:item.metricId,evidenceId:item.evidenceId};}),
    configurationErrors:configurationErrors,
    facts:facts,
    patterns:patterns.map(function(p){return {name:p.name,trigger:p.desc,businessMeaning:p.action};}),
    inferences:causes.map(function(text){return {text:text,confidence:'中',evidenceIds:evidenceIds};}),
    investigations:checks.map(function(text){return {text:text,priority:'中',ownerRole:'相关专业部门'};}),
    recommendations:suggestions.map(function(item,index){
      var ev=evidence[index%evidence.length];
      var domainTitle={business:'业务质量改善',claims:'理赔改善',efficiency:'人效改善',management:'管理机制改善'}[item.domain]||'经营改善';
      return {id:'rec_'+_stableHash([bn,item.term,item.text]),domain:item.domain||'management',title:domainTitle,action:item.text,period:item.term,ownerRole:'经营管理',metric:ev?ev.metric:null,metricId:ev?ev.metricId:null,direction:ev?ev.direction:'neutral',evidenceIds:ev?[ev.id]:[]};
    }),
    limitations:['现有汇总数据仅支持经营假设，确定性根因需结合业务明细核查。'],
    evidence:evidence
  };
}
window.buildDiagnosisModel=_buildDiagnosisModel;

// ══════════ 报告构建 ══════════
function _report(bn,alerts){
  var model=_buildDiagnosisModel(bn,alerts);
  var sn=_snap(bn);
  if(!sn._ok)return {sum:'该分公司无当前数据',body:''};
  var lv=_assessLevel(sn,alerts);
  var pat=_patternAnalysis(sn);
  var causes=_causesAnalysis(sn,alerts);
  var inv=_investigations(sn,alerts,pat);
  var sg=_suggestions(lv,pat,sn.cor,sn.lossRate,sn.costRate,sn.profitRate,sn.premium,sn.premRate,sn.prodPer,sn.prodRate,sn.backProd,sn.hrCostRate);

  // ── 风险表现（三层级，不重复）──
  var alertRisks=[],benchRisks=[],rankRisks=[];
  var cov={}; // 已覆盖字段key，避免重复
  var cor=sn.cor,lr=sn.lossRate,cr=sn.costRate,pr=sn.profitRate,prem=sn.premium,prof=sn.profit,pp=sn.profitPer,pcr=sn.premRate,prod=sn.prodPer,prodR=sn.prodRate,back=sn.backProd,hrCR=sn.hrCostRate;
  var alertFields=alerts.map(function(r){return r.field;});

  // ≡≡≡ 第一层：预警触发（字体颜色=预警颜色）≡≡≡
  var coreAlertKeys=['综合成本率实际（整体利润口径）','时间进度达成率','时间进度计划达成率','整体人力成本保费率实际','经营利润'];
  coreAlertKeys.forEach(function(fk){
    if(alertFields.indexOf(fk)>=0){
      var a=alerts.find(function(r){return r.field===fk;});
      if(a){
        var sev=a.severity==='error'?'error':(a.severity==='warn'?'warn':'info');
        var mi=_fi(fk),label=mi.l||fk,unit=mi.u||'';
        alertRisks.push({s:sev,t:label+' '+_fv(a.currentValue,unit)+' 触发预警',fk:fk});
        cov[fk]=true;
      }
    }
  });
  // 其他告警字段
  alerts.filter(function(r){return coreAlertKeys.indexOf(r.field)<0;})
    .forEach(function(r){
      var sev=r.severity==='error'?'error':(r.severity==='warn'?'warn':'info');
      alertRisks.push({s:sev,t:(r.fieldLabel||r.field)+' '+_fv(r.currentValue,_fi(r.field).u||'')+' 触发预警',fk:r.field});
      cov[r.field]=true;
    });

  // ≡≡≡ 第二层：劣于分公司整体（排除已覆盖字段）≡≡≡
  var benchDefs=[
    {k:'已赚赔付率实际',s:lr,t:'赔付率',u:'%',asc:true},
    {k:'已赚费用率实际',s:cr,t:'费用率',u:'%',asc:true},
    {k:'人均利润',s:pp,t:'人均利润',u:'万元/人',asc:false},
    {k:'整体人均产能实际',s:prod,t:'人均产能',u:'万元/人',asc:false},
    {k:'后台人均产能实际',s:back,t:'后台产能',u:'万元/人',asc:false}
  ];
  benchDefs.forEach(function(d){
    if(cov[d.k])return; // 已预警触发则跳过
    var v=d.s.cur, p=d.s.peer;
    if(v!=null&&p!=null){
      var worse=d.asc?(v>p):(v<p);
      if(worse){
        benchRisks.push({s:'warn',t:d.t+' '+_fv(v,d.u)+'，'+(d.asc?'高于':'低于')+'分公司整体 '+_fv(p,d.u)});
        cov[d.k]=true;
      }
    }
  });

  // ≡≡≡ 第三层：排名考核（后25%，排除已覆盖）≡≡≡
  var rankDefs=[
    {k:'综合成本率实际（整体利润口径）',s:cor,t:'综合成本率',u:'%',asc:true},
    {k:'已赚赔付率实际',s:lr,t:'赔付率',u:'%',asc:true},
    {k:'已赚费用率实际',s:cr,t:'费用率',u:'%',asc:true},
    {k:'时间进度计划达成率',s:pcr,t:'保费达成率',u:'%',asc:false},
    {k:'时间进度达成率',s:pr,t:'利润达成率',u:'%',asc:false},
    {k:'人均利润',s:pp,t:'人均利润',u:'万元/人',asc:false},
    {k:'整体人均产能实际',s:prod,t:'人均产能',u:'万元/人',asc:false},
    {k:'整体人人均产能计划达成率',s:prodR,t:'产能达成率',u:'%',asc:false}
  ];
  rankDefs.forEach(function(d){
    if(cov[d.k])return;
    var rk=d.s.rank;
    if(rk&&rk.pct>75){
      rankRisks.push({s:'info',t:d.t+' 排名第'+rk.rank+'/'+rk.total+'（后'+Math.round(rk.pct)+'%）'});
      cov[d.k]=true;
    }
  });
  // 同比补充（不计入层级去重）
  if(!cov['保费同比']&&prem.delta!=null&&prem.delta<-0.05){benchRisks.push({s:'error',t:'保费收入同比下降'+_fdelta(Math.abs(prem.delta),prem.u)});}
  if(!cov['利润同比']&&prof.delta!=null&&prof.delta<0){benchRisks.push({s:'warn',t:'利润同比下降'+_fdelta(Math.abs(prof.delta),prof.u)});}

  // YAML
  var h='';
  h+='<div style="font-size:13px;color:var(--text);line-height:1.5">';

  // 风险等级
  h+='<div style="margin-bottom:10px;padding:10px 14px;background:linear-gradient(135deg,'+
    (lv.level.indexOf('高风险')>=0?'#fef2f2,#fee2e2':'#f8fafc,#e2e8f0')+
    ');border-radius:8px;border-left:5px solid '+lv.color+'">';
  h+='<div style="font-size:18px;font-weight:800;margin-bottom:3px">'+_eh(lv.level)+'</div>';
  h+='<div style="font-size:12px;color:var(--muted)">'+_eh(lv.desc)+'</div></div>';

  // 关键指标表
  h+='<div style="margin-bottom:3px;font-weight:700">📊 关键指标</div>';
  h+='<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px">';
  h+='<tr style="background:#f8f9fa"><th style="padding:4px 7px;text-align:left;border:1px solid #e5e7eb">指标</th>'+
    '<th style="padding:4px 7px;text-align:right;border:1px solid #e5e7eb">当前值</th>'+
    '<th style="padding:4px 7px;text-align:right;border:1px solid #e5e7eb">分公司整体</th>'+
    '<th style="padding:4px 7px;text-align:right;border:1px solid #e5e7eb">排名</th>'+
    '<th style="padding:4px 7px;text-align:center;border:1px solid #e5e7eb">同比</th></tr>';
  ['premRate','profitRate','cor','lossRate','costRate','prodPer','prodRate','backProd','hrCostRate','profitPer'].forEach(function(k){
    var m=KM[k],s=sn[k];
    if(s.cur==null)return;
    var valColor=m.rd==='asc'?(s.cur>(m.th.bad||999)?'#dc2626':(s.cur>(m.th.warn||999)?'#d97706':'inherit'))
      :(s.cur<(m.th.bad|| -999)?'#dc2626':(s.cur<(m.th.warn|| -999)?'#d97706':'inherit'));
    // Fix: for profit-related with no thresholds, skip auto-coloring
    if(!m.th.warn)valColor='inherit';
    // special fix: override for profit rate and cor
    if(k==='profitRate'&&s.cur!=null)valColor=s.cur<0.60?'#dc2626':(s.cur<0.80?'#d97706':'inherit');
    if(k==='cor'&&s.cur!=null)valColor=s.cur>=1.05?'#dc2626':(s.cur>=1.00?'#d97706':(s.cur>=0.98?'#2563eb':'inherit'));
    if(k==='lossRate'&&s.cur!=null)valColor=s.cur>0.73?'#dc2626':(s.cur>0.68?'#d97706':(s.cur>0.65?'#2563eb':'inherit'));
    if(k==='costRate'&&s.cur!=null)valColor=s.cur>0.36?'#dc2626':(s.cur>0.32?'#d97706':(s.cur>0.30?'#2563eb':'inherit'));

    var rkStr='-';if(s.rank)rkStr='第'+s.rank.rank+'/'+s.rank.total+'名';
    var peerStr=s.peer!=null?_fv(s.peer,s.u):'-';
    h+='<tr><td style="padding:4px 7px;border:1px solid #e5e7eb;text-align:left">'+_eh(m.label)+'</td>'+
      '<td style="padding:4px 7px;text-align:right;border:1px solid #e5e7eb;font-weight:700;color:'+valColor+'">'+_eh(_fv(s.cur,s.u))+'</td>'+
      '<td style="padding:4px 7px;text-align:right;border:1px solid #e5e7eb;font-size:11px;color:var(--muted)">'+_eh(peerStr)+'</td>'+
      '<td style="padding:4px 7px;text-align:right;border:1px solid #e5e7eb">'+_eh(rkStr)+'</td>'+
      '<td style="padding:4px 7px;text-align:center;border:1px solid #e5e7eb;font-size:11px">'+_eh(_yoyStr(s.delta,s.u))+'</td></tr>';
  });
  h+='</table>';

  // 经营模式
  if(pat.length){
    h+='<div style="margin-bottom:3px;font-weight:700">🏷️ 经营模式识别</div>';
    pat.forEach(function(p){
      h+='<div style="margin-bottom:4px;padding:6px 10px;background:#fef7ed;border-left:3px solid #f59e0b;border-radius:4px;font-size:12px">';
      h+='<b>'+_eh(p.name)+'</b>：'+_eh(p.desc)+'<br><span style="color:#92400e">▶ '+_eh(p.action)+'</span></div>';
    });
  }

  // 主要风险表现
  h+='<div style="margin-bottom:3px;font-weight:700">⚠️ 主要风险表现</div>';
  var hasAny=alertRisks.length+benchRisks.length+rankRisks.length>0;
  if(!hasAny){h+='<div style="font-size:12px;color:var(--muted);margin-bottom:10px">核心指标处于健康区间</div>';}
  else{
    // 第一层：预警触发
    if(alertRisks.length){
      h+='<div style="margin-bottom:4px;font-size:11px;color:var(--muted)">▸ 触发预警</div>';
      alertRisks.forEach(function(r){
        var c=r.s==='error'?'#dc2626':'#d97706';
        h+='<div style="margin-bottom:2px;margin-left:4px;font-size:12px;color:'+c+'">● '+_eh(r.t)+'</div>';
      });
    }
    // 第二层：劣于分公司整体
    if(benchRisks.length){
      h+='<div style="margin-top:4px;margin-bottom:2px;font-size:11px;color:var(--muted)">▸ 劣于分公司整体</div>';
      benchRisks.forEach(function(r){
        h+='<div style="margin-bottom:2px;margin-left:4px;font-size:12px;color:#d97706">● '+_eh(r.t)+'</div>';
      });
    }
    // 第三层：排名考核
    if(rankRisks.length){
      h+='<div style="margin-top:4px;margin-bottom:2px;font-size:11px;color:var(--muted)">▸ 排名靠后（后25%）</div>';
      rankRisks.forEach(function(r){
        h+='<div style="margin-bottom:2px;margin-left:4px;font-size:12px;color:#2563eb">● '+_eh(r.t)+'</div>';
      });
    }
    h+='<div style="margin-bottom:10px"></div>';
  }

  // 可能原因
  h+='<div style="margin-bottom:3px;font-weight:700">🔍 可能原因</div>';
  h+='<ol style="margin:0 0 8px;padding-left:18px">';
  causes.forEach(function(c){h+='<li style="margin-bottom:2px;font-size:12px">'+_eh(c)+'</li>';});
  h+='</ol>';

  // 需要核查
  h+='<div style="margin-bottom:3px;font-weight:700">📝 需要进一步核查的数据</div>';
  h+='<ol style="margin:0 0 8px;padding-left:18px">';
  inv.forEach(function(c){h+='<li style="margin-bottom:2px;font-size:12px">'+_eh(c)+'</li>';});
  h+='</ol>';

  // 管理建议（分级）
  h+='<div style="margin-bottom:3px;font-weight:700">💡 管理建议</div>';
  var terms={};
  sg.forEach(function(s){
    if(!terms[s.term])terms[s.term]=[];
    terms[s.term].push(s.text);
  });
  Object.keys(terms).forEach(function(term){
    h+='<div style="margin-bottom:4px"><span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;background:#e5e7eb;margin-right:6px">'+_eh(term)+'</span></div>';
    h+='<ol style="margin:0 0 6px;padding-left:20px">';
    terms[term].forEach(function(t){h+='<li style="margin-bottom:2px;font-size:12px">'+_eh(t)+'</li>';});
    h+='</ol>';
  });

  h+='</div>';
  return {sum:(lv.level||'')+' '+bn,body:h,model:model};
}

// ══════════ 渲染 ══════════
window._renderRulesReport = function(){
  var ct=document.getElementById('ai-content');
  if(!ct)return;
  var results=App._alertResults||[];
  if(!results.length){
    ct.innerHTML='<div style="display:flex;align-items:center;justify-content:center;padding:80px 20px;min-height:300px;text-align:center"><div><div style="font-size:48px;margin-bottom:12px">✅</div><div style="font-size:16px;font-weight:600;color:var(--text)">当前无预警触发</div><div style="font-size:12px;color:var(--muted);margin-top:8px">在「数据管理」→ 「预警规则」中启用规则后，切换 Tab 即可自动分析</div></div></div>';
    return;
  }

  var errorN=0,warnN=0,infoN=0;
  results.forEach(function(r){if(r.severity==='error')errorN++;else if(r.severity==='warn')warnN++;else infoN++;});

  var branchMap={};
  results.filter(function(r){return r.branchName;}).forEach(function(r){
    if(!branchMap[r.branchName])branchMap[r.branchName]=[];
    branchMap[r.branchName].push(r);
  });
  var nonBranchAlerts=results.filter(function(r){return !r.branchName;});

  var bns=Object.keys(branchMap);
  // 筛选：至少1条error 或 至少3条warn，避免报告过于冗长
  bns=bns.filter(function(bn){
    var errs=branchMap[bn].filter(function(r){return r.severity==='error';}).length;
    var warns=branchMap[bn].filter(function(r){return r.severity==='warn';}).length;
    return errs>=1||warns>=3;
  });
  bns.sort(function(a,b){
    var ea=branchMap[a].filter(function(r){return r.severity==='error';}).length;
    var eb=branchMap[b].filter(function(r){return r.severity==='error';}).length;
    var wa=branchMap[a].filter(function(r){return r.severity==='warn';}).length;
    var wb=branchMap[b].filter(function(r){return r.severity==='warn';}).length;
    return (eb*2+wb)-(ea*2+wa);
  });

  var reps=[];
  bns.forEach(function(bn){reps.push(_report(bn,branchMap[bn]));});

  // 总体评估
  var highRisk=reps.filter(function(r){return r.sum.indexOf('高风险')>=0;}).length;
  var midRisk=reps.filter(function(r){return r.sum.indexOf('中风险')>=0;}).length;

  var h='';
  // 总览
  h+='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
  h+='<div style="flex:1;min-width:110px;padding:10px 8px;background:linear-gradient(135deg,#fef2f2,#fee2e2);border-radius:10px;text-align:center"><div style="font-size:28px;font-weight:800;color:#dc2626">'+
    highRisk+'</div><div style="font-size:11px;color:#991b1b;margin-top:2px">高风险</div></div>';
  h+='<div style="flex:1;min-width:110px;padding:10px 8px;background:linear-gradient(135deg,#fffbeb,#fef3c7);border-radius:10px;text-align:center"><div style="font-size:28px;font-weight:800;color:#d97706">'+
    midRisk+'</div><div style="font-size:11px;color:#92400e;margin-top:2px">中风险</div></div>';
  h+='<div style="flex:1;min-width:110px;padding:10px 8px;background:linear-gradient(135deg,#f8fafc,#e2e8f0);border-radius:10px;text-align:center"><div style="font-size:28px;font-weight:800;color:#475569">'+
    reps.length+'</div><div style="font-size:11px;color:#64748b;margin-top:2px">涉及分公司</div></div>';
  h+='<div style="flex:1;min-width:110px;padding:10px 8px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:10px;text-align:center"><div style="font-size:28px;font-weight:800;color:#16a34a">'+
    results.length+'</div><div style="font-size:11px;color:#166534;margin-top:2px">告警总数</div></div>';
  h+='<div style="flex:1;min-width:110px;padding:10px 8px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:10px;text-align:center"><div style="font-size:13px;font-weight:800;color:#2563eb">'+
    formatMonth(App.currentMonth)+'</div><div style="font-size:11px;color:#1e40af;margin-top:2px">报告周期</div></div>';
  h+='</div>';

  // 顶部总结语
  var overallText='';
  if(highRisk>0)overallText='⚠️ '+highRisk+'家分公司处于高风险状态，建议优先关注并组织专项分析。';
  if(midRisk>0)overallText+=' '+midRisk+'家处于中风险，需持续跟踪。';
  if(!overallText)overallText='当前各分公司经营指标总体平稳。';
  h+='<div style="margin-bottom:10px;padding:10px 16px;background:#f8f9fa;border-radius:6px;font-size:12px;color:var(--text)">📋 <b>总体评估：</b>'+overallText+'</div>';

  // 报告
  reps.forEach(function(rep){
    h+='<details open style="margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">';
    h+='<summary style="padding:10px 14px;cursor:pointer;background:#fafafa;font-weight:800;font-size:16px;user-select:none">'+
      _eh(rep.sum)+'</summary><div style="padding:0 12px 6px">'+rep.body+'</div></details>';
  });

  // 全国/责任区
  if(nonBranchAlerts.length){
    h+='<div style="margin-top:8px;padding:12px 18px;background:#f8f9fa;border-radius:8px">';
    h+='<div style="font-weight:700;font-size:13px;margin-bottom:8px">📊 全国/责任区级告警</div>';
    nonBranchAlerts.forEach(function(r){
      var u=_fi(r.field).u||'',sev=r.severity==='error'?'🔴':(r.severity==='warn'?'🟠':'🔵');
      h+='<div style="padding:2px 0;font-size:11px">'+_eh(sev)+' <b>'+_eh(r.regionName||'全国')+'</b> · '+
        _eh(r.fieldLabel||r.field)+'：'+_eh(_fv(r.currentValue,u))+'（阈值 '+_eh(_fv(r.threshold,u))+'）</div>';
    });
    h+='</div>';
  }

  h+='<div style="padding:12px 14px;background:#f8f9fa;border-radius:6px;font-size:10px;color:var(--muted);margin-top:12px">';
  h+='⚙️ 基于多维风险矩阵+经营模式识别+同业对标自动生成 · 周期：'+formatMonth(App.currentMonth)+' · 仅供管理参考</div>';

  // ── AI 深度解读区域 ──
  h += '<div id="ai-deep-reading" style="margin-top:16px;border-top:2px solid #e5e7eb;padding-top:16px">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  h += '<h3 style="font-size:15px;font-weight:700">🤖 AI 深度解读</h3>';
  h += '<button id="ai-deep-btn" onclick="generateDeepReading()" style="padding:6px 16px;border:1px solid #7c3aed;border-radius:6px;background:#f5f3ff;color:#7c3aed;cursor:pointer;font-size:12px;font-weight:600">生成 AI 深度解读</button>';
  h += '</div>';
  h += '<div id="ai-deep-content" style="min-height:60px;font-size:13px;line-height:1.7;color:var(--text)"></div>';
  h += '</div>';

  // ── 个性化分析区域 ──
  h += '<div id="ai-custom-analysis" style="margin-top:20px;border-top:2px solid #e5e7eb;padding-top:16px">';
  h += '<h3 style="font-size:15px;font-weight:700;margin-bottom:8px">💬 个性化分析</h3>';
  h += '<p style="font-size:12px;color:var(--muted);margin-bottom:10px">基于看板全量数据，输入你的分析需求。AI 会精准读取数据并生成分析报告。</p>';
  h += '<div id="ai-ca-msgs" style="min-height:60px;margin-bottom:12px;font-size:13px;line-height:1.7"></div>';
  var CA_QUICK = [
    {icon:'📊', title:'全国经营概览', q:'请分析2026年全国整体经营情况，包括保费达成、利润和COR表现'},
    {icon:'🏢', title:'责任区对比', q:'请对比四个责任区2026年的综合成本率、赔付率和费用率差异'},
    {icon:'📈', title:'趋势分析', q:'请分析全国综合成本率近两年的变化趋势'},
    {icon:'👥', title:'人效诊断', q:'请分析各责任区2026年人均产能和人均利润的差异'}
  ];
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
  CA_QUICK.forEach(function(q){
    h += '<button class="ai-qc" onclick="quickAnalyze(\''+q.q.replace(/'/g,'\\\'')+'\')" style="padding:5px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px">'+q.icon+' '+q.title+'</button>';
  });
  h += '</div>';
  h += '<div style="display:flex;gap:8px">';
  h += '<input id="ai-ca-input" placeholder="如：请分析河南分公司近三年综合成本率变化情况" style="flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();sendAnalyze();}" autocomplete="off">';
  h += '<button onclick="sendAnalyze()" style="padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px">发送</button>';
  h += '</div></div>';

  ct.innerHTML=h;
};

// ══════════ AI 深度解读 + 个性化分析 ══════════

function fmtAI(text){
  if(!text)return '';
  var html=text;
  // 代码块
  html=html.replace(/```([\s\S]*?)```/g,function(m,c){return '<pre style="background:#f5f5f5;padding:10px;border-radius:4px;overflow-x:auto;font-size:12px">'+c.replace(/</g,'&lt;')+'</pre>';});
  // 标题
  html=html.replace(/^### (.+)$/gm,'<h4 style="font-size:13px;font-weight:700;margin:10px 0 4px">$1</h4>');
  html=html.replace(/^## (.+)$/gm,'<h3 style="font-size:14px;font-weight:700;margin:12px 0 6px">$1</h3>');
  html=html.replace(/^# (.+)$/gm,'<h2 style="font-size:15px;font-weight:700;margin:14px 0 8px">$1</h2>');
  // 粗体
  html=html.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  // 列表
  html=html.replace(/^- (.+)$/gm,'<li style="margin-left:18px;list-style:disc">$1</li>');
  html=html.replace(/^\d+\. (.+)$/gm,'<li style="margin-left:18px;list-style:decimal">$1</li>');
  // 换行
  html=html.replace(/\n\n/g,'</p><p style="margin:6px 0">');
  html=html.replace(/\n/g,'<br>');
  // 清理多余空标签
  html=html.replace(/<br><\/p><p/g,'</p><p');
  return '<p style="margin:6px 0">'+html+'</p>';
}

window.generateDeepReading=function(){
  var btn=document.getElementById('ai-deep-btn');
  var ct=document.getElementById('ai-deep-content');
  if(!btn||!ct)return;
  btn.disabled=true;btn.textContent='生成中…';
  ct.innerHTML='<span style="color:var(--muted)">正在分析诊断数据...</span>';

  var results=App._alertResults||[];
  var branchMap={};
  results.filter(function(r){return r.branchName;}).forEach(function(r){
    if(!branchMap[r.branchName])branchMap[r.branchName]=[];
    branchMap[r.branchName].push(r);
  });
  var bns=Object.keys(branchMap).filter(function(bn){
    var errs=branchMap[bn].filter(function(r){return r.severity==='error';}).length;
    var warns=branchMap[bn].filter(function(r){return r.severity==='warn';}).length;
    return errs>=1||warns>=3;
  });
  var diagnoses=bns.map(function(bn){
    var model=(typeof _buildDiagnosisModel==='function')?_buildDiagnosisModel(bn,branchMap[bn]):null;
    if(!model)return null;
    return {
      branch:bn,riskLevel:model.riskLevel,summary:model.summary,
      facts:(model.facts||[]).slice(0,8),
      patterns:(model.patterns||[]).slice(0,5),
      inferences:(model.inferences||[]).slice(0,6),
      recommendations:(model.recommendations||[]).slice(0,5)
    };
  }).filter(Boolean);

  var context={
    period:App.currentMonth,
    totalBranches:(App.DATA.branches||[]).length,
    alertCount:results.length,
    highRiskCount:diagnoses.filter(function(d){return d.riskLevel==='高风险';}).length,
    midRiskCount:diagnoses.filter(function(d){return d.riskLevel==='中风险';}).length,
    diagnoses:diagnoses
  };

  var question='请基于以上诊断数据，生成深度的经营分析报告。要求：\n'+
    '1. 整体风险态势研判（高风险/中风险机构数量、主要风险类型分布）\n'+
    '2. 逐个分析高风险分公司：风险根因、关键指标偏离程度、经营模式诊断\n'+
    '3. 共性问题识别（多家分公司共同存在的结构性问题）\n'+
    '4. 改进建议（按优先级排序，每条建议需有具体行动方案）\n'+
    '5. 所有数据必须严格使用上下文中提供的数值，禁止编造或修改任何数字\n'+
    '6. 如果上下文数据不足以下结论，明确说明"数据不足以判断"';

  fetch('/ai/chat',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:question,context:context})
  }).then(function(response){
    if(!response.ok)throw new Error('请求失败('+response.status+')');
    var reader=response.body.getReader(),decoder=new TextDecoder(),buffer='',text='',started=false;
    ct.innerHTML='';
    function read(){
      return reader.read().then(function(res){
        if(res.done){btn.disabled=false;btn.textContent='重新生成';return;}
        buffer+=decoder.decode(res.value,{stream:true});
        var lines=buffer.split('\n');buffer=lines.pop();
        lines.forEach(function(line){
          if(line.indexOf('data: ')!==0)return;
          var dataStr=line.slice(6).trim();
          if(dataStr==='[DONE]')return;
          try{var data=JSON.parse(dataStr);
            if(data.error)throw new Error(data.error);
            if(data.content){if(!started){started=true;ct.innerHTML='';}text+=data.content;ct.innerHTML=fmtAI(text);}
          }catch(e){}
        });
        ct.scrollTop=ct.scrollHeight;return read();
      });
    }
    return read();
  }).catch(function(e){
    ct.innerHTML='<span style="color:#dc2626">生成失败：'+e.message+'</span>';
    btn.disabled=false;btn.textContent='生成 AI 深度解读';
  });
};

window.quickAnalyze=function(q){
  var input=document.getElementById('ai-ca-input');
  if(input)input.value=q;
  sendAnalyze();
};

window.sendAnalyze=function(){
  var input=document.getElementById('ai-ca-input');
  if(!input)return;
  var question=input.value.trim();
  if(!question)return;
  input.value='';
  var msgs=document.getElementById('ai-ca-msgs');
  if(!msgs)return;
  msgs.insertAdjacentHTML('beforeend',
    '<div style="text-align:right;margin-bottom:8px"><span style="display:inline-block;padding:8px 14px;background:#2563eb;color:#fff;border-radius:12px 12px 2px 12px;font-size:13px">'+question.replace(/</g,'&lt;')+'</span></div>');
  var aiId='ai-ca-'+Date.now();
  msgs.insertAdjacentHTML('beforeend',
    '<div id="'+aiId+'" style="margin-bottom:12px"><span style="color:var(--muted)">分析中...</span></div>');
  var el=document.getElementById(aiId);
  el.innerHTML='<span class="ai-dots">●●●</span>';

  fetch('/ai/analyze',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:question})
  }).then(function(response){
    if(!response.ok)throw new Error('请求失败('+response.status+')');
    var reader=response.body.getReader(),decoder=new TextDecoder(),buffer='',text='',started=false;
    function read(){
      return reader.read().then(function(res){
        if(res.done)return;
        buffer+=decoder.decode(res.value,{stream:true});
        var lines=buffer.split('\n');buffer=lines.pop();
        lines.forEach(function(line){
          if(line.indexOf('data: ')!==0)return;
          var dataStr=line.slice(6).trim();
          if(dataStr==='[DONE]')return;
          try{var data=JSON.parse(dataStr);
            if(data.error)throw new Error(data.error);
            if(data.content){if(!started){started=true;el.innerHTML='';}text+=data.content;el.innerHTML=fmtAI(text);}
          }catch(e){}
        });
        el.scrollTop=el.scrollHeight;return read();
      });
    }
    return read();
  }).catch(function(e){
    el.innerHTML='<span style="color:#dc2626">分析失败：'+e.message+'</span>';
  });
};

// ── 徽章 ──
var _orig=window.renderNavBadge;
window.renderNavBadge=function(results){
  if(_orig)_orig(results);
  var b=document.getElementById('ai-badge');
  if(b){var c=(results||App._alertResults||[]).length;b.textContent=c;b.style.display=c>0?'inline-block':'none';}
};

})();
