function fmtVal(v,u){if(v==null||isNaN(v))return'-';if(u==='万元'){let a=Math.abs(v);if(a<100&&a>0)return v.toFixed(2);return Math.round(v).toLocaleString();}if(u==='人')return Math.round(v).toLocaleString();if(u==='%')return (v*100).toFixed(2)+'%';if(u==='万元/人')return v.toFixed(2);return v.toFixed(2);}

function getColor(u,rd,v){if(u==='%'){if(rd==='desc')return v>=1?'hi-green':'hi-red';if(rd==='asc')return v<=0.98?'hi-green':'hi-red';}if(u==='万元'){if(rd==='desc')return v>0?'hi-green':(v<0?'hi-red':'');}return'';}

function computeDerived(d){
    var TP=(parseInt((App.currentMonth||'2026-04').split('-')[1])||4)/12;
    for(let line of ['车险','财产险','人身险']){d[line+'时间进度计划达成率']=d[line+'计划']?d[line+'实际']/(d[line+'计划']*TP):NaN;}
    d['保费实际合计']=(d['车险实际']||0)+(d['财产险实际']||0)+(d['人身险实际']||0);d['保费年度计划']=(d['车险计划']||0)+(d['财产险计划']||0)+(d['人身险计划']||0);
    d['时间进度计划达成率']=d['保费年度计划']?d['保费实际合计']/(d['保费年度计划']*TP):NaN;
    let ptp=(d['经营利润年度计划']||0)*TP;d['时间进度达成率']=ptp>0?((d['经营利润']||0)<0?0:(d['经营利润']||0)/ptp):(ptp<0?Math.max(0,1+((d['经营利润']||0)-ptp)/Math.abs(ptp)):NaN);
    d['综合成本率实际（整体利润口径）']=d['已赚保费']?1-(d['经营利润']||0)/d['已赚保费']:NaN;d['与本年计划比较']=(d['综合成本率实际（整体利润口径）']||0)-(d['综合成本率计划（整体利润口径）']||0);
    d['整体人员计划']=(d['前台人员计划']||0)+(d['后台人员计划']||0);d['整体人员实际']=(d['前台人员实际']||0)+(d['后台人员实际']||0);
    for(let role of ['前台','后台','整体']){
        d[role+'人员计划执行率']=d[role+'人员计划']?d[role+'人员实际']/d[role+'人员计划']:0;
        d[role+'人均产能计划']=d[role+'人员计划']?d['保费年度计划']/d[role+'人员计划']:0;
        let ap=d[role+'平均人数']||d[role+'人员实际']||0;d[role+'人均产能实际']=ap?d['保费实际合计']/(ap*TP):0;
        d[role+'人人均产能计划达成率']=d[role+'人均产能计划']?d[role+'人均产能实际']/d[role+'人均产能计划']:0;
        d[role+'人均利润计划']=d[role+'人员计划']?d['经营利润年度计划']/d[role+'人员计划']:0;
        d[role+'人均利润实际']=ap?d['经营利润']/(ap*TP):0;
        d[role+'人均利润达成率']=d[role+'人均利润计划']?d[role+'人均利润实际']/d[role+'人均利润计划']:0;
        d[role+'人力成本预算执行率']=d[role+'人力成本预算']?d[role+'人力成本实际']/(d[role+'人力成本预算']*TP):0;
    }
    // Fixed computations (not per-role)
    d['前台人力成本保费率计划']=d['保费年度计划']?d['前台人力成本预算']/d['保费年度计划']:0;
    d['后台人力成本保费率预算']=d['保费年度计划']?d['后台人力成本预算']/d['保费年度计划']:0;
    d['整体人力成本保费率预算']=d['保费年度计划']?d['整体人力成本预算']/d['保费年度计划']:0;
    d['前台人力成本保费率实际']=d['保费实际合计']?d['前台人力成本实际']/d['保费实际合计']:0;
    d['后台人力成本保费率实际']=d['保费实际合计']?d['后台人力成本实际']/d['保费实际合计']:0;
    d['整体人力成本保费率实际']=d['保费实际合计']?d['整体人力成本实际']/d['保费实际合计']:0;
    d['前台人力成本保费率计划执行率']=d['前台人力成本保费率计划']?d['前台人力成本保费率实际']/d['前台人力成本保费率计划']:0;
    d['后台人力成本保费率计划执行率']=d['后台人力成本保费率预算']?d['后台人力成本保费率实际']/d['后台人力成本保费率预算']:0;
    d['整体人力成本保费率计划执行率']=d['整体人力成本保费率预算']?d['整体人力成本保费率实际']/d['整体人力成本保费率预算']:0;
    d['前台人力成本利润值计划']=d['前台人力成本预算']?(d['经营利润年度计划']||0)/d['前台人力成本预算']:0;
    d['后台人力成本利润值预算']=d['后台人力成本预算']?(d['经营利润年度计划']||0)/d['后台人力成本预算']:0;
    d['整体人力成本利润值预算']=d['整体人力成本预算']?(d['经营利润年度计划']||0)/d['整体人力成本预算']:0;
    d['前台人力成本利润值实际']=d['前台人力成本实际']?(d['经营利润']||0)/d['前台人力成本实际']:0;
    d['后台人力成本利润值实际']=d['后台人力成本实际']?(d['经营利润']||0)/d['后台人力成本实际']:0;
    d['整体人力成本利润值实际']=d['整体人力成本实际']?(d['经营利润']||0)/d['整体人力成本实际']:0;
    for(let k in d){if(typeof d[k]==='number'&&!isNaN(d[k]))d[k]=Math.round(d[k]*1e6)/1e6;}
}

App.branchRanks=null;

function rankAllBranches(){if(!App.RANK_ASC)App.RANK_ASC={};
  var branches=App.DATA.branches;if(!branches||!branches.length)return{};
  var result={};
  branches.forEach(function(b){result[b.n]={};});
  App.FIELDS.forEach(function(f){
    var asc=App.RANK_ASC[f.k];
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

App.showingAllFields=false;
