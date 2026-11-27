import {cssColor, fDT, fDate, fHM, fKey, fShort, fmtWith, h, isN, mkF, nf, sv} from './util.js';

export const lw=()=>window.LightweightCharts;
export function fallbackLine(box,pts){box.replaceChildren();const w=Math.max(200,box.clientWidth),hh=box.clientHeight||260;
  pts=pts.filter(p=>isN(p.value));if(pts.length<2){box.append(h('div',{class:'err',text:'Nessun dato da mostrare.'}));return}
  const mn=Math.min(...pts.map(p=>p.value)),mx=Math.max(...pts.map(p=>p.value)),r=mx-mn||1,pd=8;
  const s=sv('svg',{width:w,height:hh,viewBox:`0 0 ${w} ${hh}`,role:'img','aria-label':'Grafico semplificato'});
  s.append(sv('polyline',{fill:'none',stroke:'var(--acc)','stroke-width':2,points:pts.map((p,i)=>`${(pd+i/(pts.length-1)*(w-2*pd)).toFixed(1)},${(hh-pd-(p.value-mn)/r*(hh-2*pd)).toFixed(1)}`).join(' ')}));
  box.append(s,h('div',{class:'mut',style:'font-size:12px',text:`Grafico semplificato · min ${nf(2).format(mn)} · max ${nf(2).format(mx)}`}))}
export function tsFmt(intraday){return (t,type)=>{const d=new Date(typeof t==='number'?t*1000:Date.UTC(t.year,t.month-1,t.day));
  if(intraday&&type>=3)return fmtWith(fHM,d);if(type===0)return mkF({year:'numeric'}).format(d);if(type===1)return mkF({month:'short'}).format(d);return fmtWith(fShort,d)}}
/* spec: {series:[{name,kind:'line'|'candle',data:[],color}],intraday,pct,fmt(v)} -> ctrl */
export function mountChart(box,spec){box.replaceChildren();
  if(!lw()){fallbackLine(box,spec.series[0].data.map(p=>({value:isN(p.value)?p.value:p.close})));return {destroy(){}}}
  const ink=cssColor('--ink'),mut=cssColor('--mut'),line=cssColor('--line'),up=cssColor('--up'),down=cssColor('--down');
  const hh=box.clientHeight||300;
  const chart=lw().createChart(box,{width:box.clientWidth||300,height:hh,layout:{background:{type:'solid',color:'rgba(0,0,0,0)'},textColor:mut,fontFamily:'Inter,system-ui,sans-serif',fontSize:12},
    grid:{vertLines:{color:line},horzLines:{color:line}},rightPriceScale:{borderColor:line},
    timeScale:{borderColor:line,timeVisible:!!spec.intraday,secondsVisible:false,tickMarkFormatter:spec.time===false?undefined:tsFmt(spec.intraday)},
    localization:{locale:'it-IT',timeFormatter:spec.time===false?undefined:(t=>typeof t==='number'?fmtWith(spec.intraday?fDT:fDate,t*1000):'')},
    crosshair:{mode:0},handleScale:{mouseWheel:false},handleScroll:{mouseWheel:false}});
  const lg=h('div',{class:'lg'});box.append(lg);const ss=[];
  spec.series.forEach((s,i)=>{const col=s.color==='ink'?ink:s.color==='acc'?cssColor('--acc'):s.color;let x;
    if(s.kind==='candle')x=chart.addCandlestickSeries({upColor:up,downColor:down,borderVisible:false,wickUpColor:up,wickDownColor:down,priceFormat:{type:'custom',minMove:.0001,formatter:spec.fmt}});
    else x=chart.addLineSeries({color:col,lineWidth:2,priceLineVisible:false,lastValueVisible:!spec.pct,priceFormat:{type:'custom',minMove:.0001,formatter:spec.fmt}});
    x.setData(s.data);ss.push({x,s,col});});
  chart.timeScale().fitContent();
  const show=(param)=>{lg.replaceChildren();let t=param&&param.time;const parts=[];
    ss.forEach(({x,s,col})=>{let d=param&&param.seriesData?param.seriesData.get(x):null;if(!d){const last=s.data[s.data.length-1];d=t?null:last}if(!d)return;
      if(s.kind==='candle')parts.push(h('span',{},`A ${spec.fmt(d.open)}  Max ${spec.fmt(d.high)}  Min ${spec.fmt(d.low)}  `,h('b',{text:'C '+spec.fmt(d.close)})));
      else parts.push(h('span',{style:'margin-right:10px'},s.name?h('span',{style:'color:'+col,text:s.name+' '}):'',h('b',{text:spec.fmt(d.value)})))});
    if(!t&&ss[0]&&ss[0].s.data.length)t=ss[0].s.data[ss[0].s.data.length-1].time;
    const tl=typeof t==='number'?fmtWith(spec.intraday?fDT:fDate,t*1000):(typeof t==='string'?t.split('-').reverse().join('/'):'');
    lg.append(h('span',{class:'mut',text:tl+'  '}),...parts)};
  chart.subscribeCrosshairMove(show);show(null);
  const ro=new ResizeObserver(()=>{const w=box.clientWidth;if(w>0)chart.applyOptions({width:w,height:box.clientHeight||hh})});ro.observe(box);
  let pls=[];const lc={acc:cssColor('--acc'),up,down,mut};
  return {destroy(){try{ro.disconnect();chart.remove()}catch(e){}},updateLast(p){try{const s0=ss[0];if(!s0||spec.pct||!isN(p))return;const d=s0.s.data;if(!d.length)return;const l=d[d.length-1];const nb=s0.s.kind==='candle'?{time:l.time,open:l.open,high:Math.max(l.high,p),low:Math.min(l.low,p),close:p}:{time:l.time,value:p};s0.x.update(nb);d[d.length-1]=Object.assign({},l,nb,{value:p,close:p})}catch(e){}},setLevels(list){try{pls.forEach(p=>ss[0].x.removePriceLine(p));pls=(list||[]).map(l=>ss[0].x.createPriceLine({price:l.price,color:lc[l.color]||mut,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:l.title}))}catch(e){}}}}
export function histSeries(hist,range){const intra=range==='1G'||range==='5G';let rows=(intra?hist.intraday:hist.daily)||[];
  rows=rows.filter(r=>Array.isArray(r)&&isN(r[0])&&isN(r[4])).sort((a,b)=>a[0]-b[0]);
  if(range==='1G'&&rows.length){const k=fKey.format(new Date(rows[rows.length-1][0]*1000));let r2=rows.filter(r=>fKey.format(new Date(r[0]*1000))===k);if(r2.length<3)r2=rows.slice(-20);rows=r2}
  else if(!intra){const days={'1M':31,'6M':183,'1A':366,'5A':1900}[range]||31;const from=(rows.length?rows[rows.length-1][0]:0)-days*86400;rows=rows.filter(r=>r[0]>=from)}
  const out=[];let last=-1;for(const r of rows){if(r[0]===last)continue;last=r[0];out.push({time:r[0],open:isN(r[1])?r[1]:r[4],high:isN(r[2])?r[2]:r[4],low:isN(r[3])?r[3]:r[4],close:r[4],value:r[4]})}
  return out}
