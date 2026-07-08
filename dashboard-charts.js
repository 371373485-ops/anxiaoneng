if(typeof Chart!=='undefined'){Chart.register({id:'barVals',afterDatasetsDraw:function(chart){if(window.innerWidth<=768)return;if(chart.config.type!=='bar')return;var ctx=chart.ctx;ctx.save();var u=chart.options._unit||'';var isCmp=App&&App.isCompareMode;var visibleDs=0;chart.data.datasets.forEach(function(ds,i){if(!chart.getDatasetMeta(i).hidden)visibleDs++;});if(isCmp&&visibleDs>4){ctx.restore();return;}chart.data.datasets.forEach(function(ds,i){var meta=chart.getDatasetMeta(i);if(meta.hidden)return;meta.data.forEach(function(bar,j){var v=ds.data[j];if(v==null||isNaN(v))return;var txt;if(u==='%')txt=v.toFixed(1)+'%';else if(u==='万元')txt=Math.abs(v)>=100?v.toFixed(0):v.toFixed(2);else if(u==='万元/人')txt=v.toFixed(1);else if(u==='人')txt=v.toFixed(0);else txt=Math.abs(v)>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0);ctx.fillStyle='#1e3a5f';var fSize=isCmp?'bold 7px sans-serif':'bold 11px sans-serif';ctx.font=fSize;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,bar.x,bar.y-3);});});ctx.restore();}});}

function destroyCharts(){if(App.charts){Object.values(App.charts).forEach(c=>c&&c.destroy());App.charts={};} if(typeof __trendChart!=='undefined'&&__trendChart){__trendChart.destroy();__trendChart=null;}}

function renderRegionsCharts(){
  try{
    if(!App||!App.REGIONS||!App.DATA||!App.DATA.regions||!App.FIELDS||!App.CHART_GROUPS||!App.COLOR4){
      showError('图表依赖缺失: REGIONS='+!!(App&&App.REGIONS)+' DATA_N='+!!(App&&App.DATA&&App.DATA.national)+' DATA_R='+!!(App&&App.DATA&&App.DATA.regions)+' FIELDS='+!!(App&&App.FIELDS)+' CG='+!!(App&&App.CHART_GROUPS)+' C4='+!!(App&&App.COLOR4));
      return;
    }
    var cmpRegions=App.isCompareMode?(getCompareData('regions')||{}):null;
    ['保费','效益','效能','人员'].forEach(g=>{
      var cg=App.CHART_GROUPS[g]||[];
      cg.forEach((c,i)=>{
        var canvas=document.getElementById('rc-'+g+'-'+i);if(!canvas)return;
        var cks=c.keys||c.key||[];if(!Array.isArray(cks))cks=[];
        var ks=new Set(cks),cfs=App.FIELDS.filter(function(f){return ks.has(f.k);}),lm={};
        cfs.forEach(function(f){lm[f.k]=f.l;});
        var isPct=cfs[0]?cfs[0].u==='%':false;
        var regions=(App.REGIONS||[]);
        var ds=[];
        regions.forEach(function(r,j){
          var rd2=App.DATA.regions[r]||{};
          var drow=[];
          cks.forEach(function(k){var v2=Number(rd2[k])||0;drow.push(isPct?v2*100:v2);});
          ds.push({label:r,data:drow,backgroundColor:(App.COLOR4||[])[j]||'rgba(100,100,255,.5)',borderRadius:4});
          if(cmpRegions&&typeof cmpRegions==='object'){
            var rd3=cmpRegions[r]||{};
            var c2=(App.COLOR4||[])[j]||'rgba(100,100,255,.5)';
            var cdrow=[];
            cks.forEach(function(k){var cv2=Number(rd3[k])||0;cdrow.push(isPct?cv2*100:cv2);});
            ds.push({label:r+'对比',data:cdrow,backgroundColor:c2.replace('0.7','0.3'),borderRadius:4,borderColor:c2,borderWidth:1});
          }
        });
        var labels=cks.map(function(k){return lm[k]||k;});
        var oldChart=App.charts['rc-'+g+'-'+i];if(oldChart){oldChart.destroy();delete App.charts['rc-'+g+'-'+i];}
        App.charts['rc-'+g+'-'+i]=typeof Chart!=='undefined'?new Chart(canvas,{type:'bar',data:{labels:labels,datasets:ds},options:{_unit:isPct?'%':(cfs[0]?cfs[0].u||'':''),indexAxis:'x',responsive:true,maintainAspectRatio:false,scales:isPct?{y:{ticks:{callback:function(v){return v+'%';}}}}:{},plugins:{tooltip:{callbacks:{label:function(ctx){var raw=ctx.raw,u2=cfs[0]?cfs[0].u||'':'';return ctx.dataset.label+': '+(isPct?raw.toFixed(2)+'%':u2==='万元'?(Math.abs(raw)<100&&Math.abs(raw)>0?raw.toFixed(2):Math.round(raw).toLocaleString()):u2==='万元/人'?raw.toFixed(2):raw.toLocaleString());}}}}}}):null;
      });
    });
  }catch(e){showError('图表渲染失败: '+e.message);}
}
