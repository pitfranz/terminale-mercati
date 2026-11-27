import {chgEl, fDT, fmtNum, fmtPct, fmtPrice, fmtWith, h, isN, nf, norm, openOverlay, put, themeCbs} from './util.js';
import {BYSYM, D, M} from './state.js';
import {LITE, liteData, loadHist} from './data.js';
import {histSeries, mountChart} from './charts.js';
import {biasCard, cotBlock, levelsList} from './bias.js';
import {starBtn} from './markets.js';
import {newsItem} from './news.js';
import {getCurDetail, setCurDetail} from './live.js';
import {yahooLink} from './requests.js';

export function relatedNews(m,max){const nm=norm(m.name);return (D.news||[]).filter(n=>(Array.isArray(n.symbols)&&n.symbols.includes(m.symbol))||(nm.length>2&&norm(n.title).includes(nm))).slice(0,max)}
export function openDetail(sym){const m=BYSYM[sym];if(!m)return;let range='1M',kind='candle',cmp='',ctrl=null,token=0,lvOn=true;
  const chartBox=h('div',{class:'chartbox'}),status=h('div',{class:'mut',style:'font-size:13px;margin:6px 0 0;min-height:18px'});
  const fv=v=>fmtNum(m,v);
  const stats=[['Max di oggi',fv(m.dayHigh)],['Min di oggi',fv(m.dayLow)],['Max 52 settimane',fv(m.high52)],['Min 52 settimane',fv(m.low52)],['Chiusura precedente',fv(m.prevClose)],
    ['1 settimana',fmtPct(m.chg1w)],['1 mese',fmtPct(m.chg1m)],['Da inizio anno',fmtPct(m.chgYtd)],['1 anno',fmtPct(m.chg1y)],['Mercato',m.exchange||'—'],['Valuta',m.group==='Tassi'?'% annuo':(m.currency||'—')],['Aggiornato',fmtWith(fDT,m.marketTime)],...(m.tech&&isN(m.tech.rsi14)?[['RSI 14',nf(0).format(m.tech.rsi14)]]:[]),...(m.tech&&isN(m.tech.distSma200Pct)?[['Distanza da media 200g',fmtPct(m.tech.distSma200Pct,1)]]:[]),...(m.tech&&isN(m.tech.atrPct)?[['Oscillazione media (ATR)',nf(2).format(m.tech.atrPct)+'%']]:[])];
  const sl=h('dl',{class:'stats'},stats.map(([k,v])=>h('div',{},h('dt',{text:k}),h('dd',{text:v}))));
  let rngEl=null;if(isN(m.low52)&&isN(m.high52)&&m.high52>m.low52&&isN(m.price)){const p=Math.min(100,Math.max(0,(m.price-m.low52)/(m.high52-m.low52)*100));
    rngEl=h('div',{},h('div',{class:'rng',role:'img','aria-label':'Posizione nell\'intervallo 52 settimane: '+Math.round(p)+'%'},h('i',{style:'left:calc('+p+'% - 1px)'})),h('div',{class:'mut',style:'font-size:12px;display:flex;justify-content:space-between'},h('span',{text:'Min 52 sett. '+fv(m.low52)}),h('span',{text:'Max '+fv(m.high52)})))}
  const rbtn=['1G','5G','1M','6M','1A','5A'].map(r=>h('button',{type:'button','aria-pressed':r===range,text:r,onclick:()=>{range=r;sync();draw()}}));
  const kbtn=[['candle','Candele'],['line','Linea']].map(([k,l])=>h('button',{type:'button','aria-pressed':k===kind,text:l,onclick:()=>{kind=k;sync();draw()}}));
  const sel=h('select',{class:'sel','aria-label':'Confronta con',onchange:e=>{cmp=e.target.value;sync();draw()}},h('option',{value:'',text:'Confronta con… (nessuno)'}),
    M.filter(x=>x.symbol!==sym).map(x=>h('option',{value:x.symbol,text:x.name})));
  function sync(){rbtn.forEach(b=>b.setAttribute('aria-pressed',b.textContent===range));kbtn.forEach((b,i)=>{b.setAttribute('aria-pressed',['candle','line'][i]===kind);b.disabled=!!cmp})}
  async function draw(){const my=++token;status.textContent='Carico il grafico…';
    try{const hist=await loadHist(m.file);const h2=cmp&&BYSYM[cmp]?await loadHist(BYSYM[cmp].file).catch(()=>null):null;if(my!==token)return;
      const a=histSeries(hist,range);if(a.length<2){if(ctrl)ctrl.destroy();ctrl=null;chartBox.replaceChildren(h('div',{class:'err',text:'Per questo periodo non ci sono abbastanza dati.'}));status.textContent='';return}
      const intraday=range==='1G'||range==='5G';let spec;
      if(cmp&&h2){const b=histSeries(h2,range);const to=(arr)=>{const c0=arr[0].close;return arr.map(p=>({time:p.time,value:(p.close/c0-1)*100}))};
        spec={intraday,pct:true,fmt:v=>fmtPct(v),series:[{name:m.name,kind:'line',color:'ink',data:to(a)},...(b.length>1?[{name:BYSYM[cmp].name,kind:'line',color:'acc',data:to(b)}]:[])]};
        status.textContent=b.length>1?'Performance in % dall\'inizio del periodo.':'Dati del confronto non disponibili per questo periodo.'}
      else{spec={intraday,fmt:fv,series:[kind==='candle'?{kind:'candle',data:a}:{kind:'line',color:'acc',data:a}]};status.textContent=''}
      if(ctrl)ctrl.destroy();ctrl=mountChart(chartBox,spec);if(lvOn&&!(cmp&&h2)&&ctrl.setLevels&&m.tech)ctrl.setLevels(levelsList(m.tech.levels));
    }catch(e){console.warn(e);if(my!==token)return;if(ctrl)ctrl.destroy();ctrl=null;chartBox.replaceChildren(h('div',{class:'err',text:'Il grafico di questo titolo non è disponibile al momento.'}));status.textContent=''}}
  const bigBox=h('div');const paintBig=()=>put(bigBox,h('div',{class:'big'},fmtPrice(m,m.price),' ',h('span',{style:'font-size:18px'},chgEl(m.changePct))),
    isN(m.change)?h('div',{class:'mut',style:'font-size:13px',text:'Variazione di oggi: '+(m.change>0?'+':m.change<0?'−':'')+fmtNum(m,Math.abs(m.change))}):null);paintBig();
  const rel=relatedNews(m,5);
  const content=h('div',{},
    h('div',{class:'dh'},starBtn(m),h('div',{},h('h2',{text:m.name}),h('div',{class:'sy mut',text:m.symbol+' · '+m.group}))),
    bigBox,
    m.desc?h('p',{text:m.desc}):null,sl,rngEl,
    h('div',{class:'ctl'},h('div',{class:'seg',role:'group','aria-label':'Periodo'},rbtn),h('div',{class:'seg',role:'group','aria-label':'Tipo di grafico'},kbtn),sel,levelsList(m.tech&&m.tech.levels).length?h('div',{class:'seg'},h('button',{type:'button','aria-pressed':'true',title:'Mostra o nascondi i livelli chiave sul grafico',text:'Livelli chiave',onclick:e=>{lvOn=!lvOn;e.currentTarget.setAttribute('aria-pressed',String(lvOn));draw()}})):null),
    chartBox,status,biasCard(m),cotBlock(m),
    h('h3',{style:'margin-top:20px',text:'Notizie collegate'}),
    rel.length?h('div',{class:'news'},rel.map(n=>newsItem(n,true))):h('p',{class:'empty',text:'Nessuna notizia collegata al momento.'}));
  const o=openOverlay(m.name,content);const cb=()=>draw();themeCbs.push(cb);
  const cd={sym:m.symbol,repaint(){paintBig();if(ctrl&&ctrl.updateLast&&!cmp)ctrl.updateLast(m.price)}};setCurDetail(cd);
  o.cleanup=()=>{token++;if(ctrl)ctrl.destroy();if(getCurDetail()===cd)setCurDetail(null);const i=themeCbs.indexOf(cb);if(i>=0)themeCbs.splice(i,1)};
  sync();draw()}
export async function openLite(sym){const prev=LITE[sym];const box=h('div',{},h('p',{class:'skel',text:'Carico i dati…'}));const o=openOverlay(sym,box);let ctrl=null,token=0;
  o.cleanup=()=>{token++;if(ctrl)ctrl.destroy()};let s=null;try{s=await liteData(sym)}catch(e){console.warn(e)}
  if(!s){put(box,h('h2',{text:(prev&&prev[1])||sym}),h('p',{class:'err',text:'I dati di questo titolo non sono ancora disponibili.'}),h('p',{},yahooLink(sym)));return}
  const m=Object.assign({},s,{symbol:sym,name:s.name||sym,group:s.group||'Azioni',tech:{bias:s.bias}});let range='6M';
  const closes=(Array.isArray(s.closes)?s.closes:[]).filter(r=>Array.isArray(r)&&isN(r[0])&&isN(r[1])).sort((a,b)=>a[0]-b[0]);const chartBox=h('div',{class:'chartbox'});
  const fv=v=>fmtNum(m,v);const stats=[['Max 52 settimane',fv(m.high52)],['Min 52 settimane',fv(m.low52)],['1 settimana',fmtPct(m.chg1w)],['1 mese',fmtPct(m.chg1m)],['Da inizio anno',fmtPct(m.chgYtd)],['1 anno',fmtPct(m.chg1y)],
    ['Volume',isN(m.volume)?nf(0).format(m.volume):'—'],['Volume medio',isN(m.avgVol)?nf(0).format(m.avgVol):'—'],['Mercato',m.exchange||'—'],['Settore',m.sector||'—']];
  const rb=['1M','6M','1A'].map(r=>h('button',{type:'button','aria-pressed':r===range,text:r,onclick:()=>{range=r;rb.forEach(b=>b.setAttribute('aria-pressed',b.textContent===range));draw()}}));
  function draw(){const last=closes.length?closes[closes.length-1][0]:0;const days={'1M':31,'6M':183,'1A':400}[range];const d=closes.filter(r=>r[0]>=last-days*86400).filter((r,i,a)=>!i||r[0]!==a[i-1][0]).map(r=>({time:r[0],value:r[1]}));
    if(ctrl)ctrl.destroy();ctrl=null;if(d.length<2){chartBox.replaceChildren(h('div',{class:'err',text:'Non ci sono abbastanza dati per il grafico.'}));return}ctrl=mountChart(chartBox,{fmt:fv,series:[{kind:'line',color:'acc',data:d}]})}
  const cb=()=>draw();themeCbs.push(cb);const oc=o.cleanup;o.cleanup=()=>{oc();const i=themeCbs.indexOf(cb);if(i>=0)themeCbs.splice(i,1)};
  put(box,h('h2',{text:m.name}),h('div',{class:'sy mut',text:[sym,m.group,'dati ritardati, solo chiusure giornaliere'].join(' · ')}),
    h('div',{class:'big'},fmtPrice(m,m.price),' ',h('span',{style:'font-size:18px'},chgEl(m.changePct))),
    h('dl',{class:'stats'},stats.map(([k,v])=>h('div',{},h('dt',{text:k}),h('dd',{text:v})))),
    h('div',{class:'ctl'},h('div',{class:'seg',role:'group','aria-label':'Periodo'},rb)),chartBox,biasCard(m),h('p',{},yahooLink(sym)));
  draw()}
