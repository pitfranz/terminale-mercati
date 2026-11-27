import {chgEl, fDate, fmtNum, fmtWith, h, isN, nf, put, spark} from './util.js';
import {D, M} from './state.js';
import {openDetail} from './detail.js';

export const bcls=s=>s>=15?'up':s<=-15?'down':'flat';
export const sgn=v=>(v>0?'+':v<0?'−':'')+Math.abs(Math.round(v));
export function biasPill(b,compact){if(!b||!isN(b.score))return h('span',{class:'mut',text:'—'});
  return h('span',{class:'bp '+bcls(b.score),title:b.label||''},h('span',{'aria-hidden':'true',text:b.score>=15?'▲':b.score<=-15?'▼':'■'}),compact?null:h('span',{class:'lbl',text:b.label||''}),h('b',{text:sgn(b.score)}))}
export const bOf=(m,p)=>m&&m.tech&&m.tech.bias&&m.tech.bias[p]||null;
export function biasGauge(b){const p=Math.max(0,Math.min(100,((b.score||0)+100)/2));return h('div',{class:'bg',role:'img','aria-label':'Bias '+(b.label||'')+', punteggio '+sgn(b.score)+' su 100'},h('i',{style:'left:calc('+p+'% - 2px)'}))}
export function biasCol(title,b){if(!b)return h('div',{class:'bcol'},h('h4',{text:title}),h('p',{class:'empty',text:'Non disponibile.'}));
  return h('div',{class:'bcol'},h('h4',{text:title}),h('div',{},biasPill(b)),biasGauge(b),h('div',{class:'mut gl'},h('span',{text:'Ribassista'}),h('span',{text:'Rialzista'})),
    h('ul',{class:'why'},(b.reasons||[]).slice(0,6).map(r=>h('li',{text:String(r)}))))}
export function levelsList(L){const out=[];if(!L)return out;const add=(p,t,c)=>{if(isN(p))out.push({price:p,title:t,color:c})};const pd=L.pivotD||{},pw=L.pivotW||{};
  add(pd.P,'Pivot G','acc');add(pd.R1,'R1 G','down');add(pd.S1,'S1 G','up');add(pw.P,'Pivot S','acc');add(L.prevDay&&L.prevDay.h,'Max ieri','mut');add(L.prevDay&&L.prevDay.l,'Min ieri','mut');
  (L.resistances||[]).slice(0,1).forEach(p=>add(p,'Resistenza','down'));(L.supports||[]).slice(-1).forEach(p=>add(p,'Supporto','up'));return out}
export function levelsTiles(t,m){const L=t.levels||{},t2=[];const fv=v=>fmtNum(m,v);const add=(k,v)=>{if(isN(v))t2.push([k,fv(v)])};const pd=L.pivotD||{},pw=L.pivotW||{};
  add('Pivot giornaliero',pd.P);add('Resistenza 1 (G)',pd.R1);add('Resistenza 2 (G)',pd.R2);add('Supporto 1 (G)',pd.S1);add('Supporto 2 (G)',pd.S2);
  add('Pivot settimanale',pw.P);add('Resistenza 1 (S)',pw.R1);add('Supporto 1 (S)',pw.S1);
  if(L.prevDay){add('Massimo di ieri',L.prevDay.h);add('Minimo di ieri',L.prevDay.l)}if(L.prevWeek){add('Massimo sett. prec.',L.prevWeek.h);add('Minimo sett. prec.',L.prevWeek.l)}
  if(Array.isArray(L.supports)&&L.supports.length)t2.push(['Supporti',L.supports.map(fv).join(' · ')]);if(Array.isArray(L.resistances)&&L.resistances.length)t2.push(['Resistenze',L.resistances.map(fv).join(' · ')]);
  if(t.expectedRange&&isN(t.expectedRange.low)&&isN(t.expectedRange.high))t2.push(['Range atteso (ATR)',fv(t.expectedRange.low)+' – '+fv(t.expectedRange.high)]);return t2}
export function biasCard(m){const t=m.tech;if(!t||!t.bias||(!t.bias.daily&&!t.bias.weekly))return null;const tiles=levelsTiles(t,m);
  return h('div',{class:'bcard'},h('h3',{text:'Bias tecnico'}),h('div',{class:'bcols'},biasCol('Giornaliero',t.bias.daily),biasCol('Settimanale',t.bias.weekly)),
    tiles.length?h('h4',{style:'margin:16px 0 0',text:'Livelli chiave'}):null,tiles.length?h('dl',{class:'stats'},tiles.map(([k,v])=>h('div',{},h('dt',{text:k}),h('dd',{text:v})))):null,
    h('p',{class:'mut fine',text:'Indicazione tecnica automatica, non è un consiglio d\'investimento.'}))}
export const cotFor=m=>(D.cot||[]).filter(c=>c&&Array.isArray(c.symbols)&&c.symbols.includes(m.symbol));
export const cotBar=v=>h('span',{class:'cotbar',title:'Indice COT '+v},h('i',{style:'width:'+Math.max(2,Math.min(100,v))+'%'}),h('b',{text:isN(v)?String(Math.round(v)):'—'}));
export function cotBlock(m){const l=cotFor(m);if(!l.length)return null;
  return h('div',{class:'bcard'},h('h3',{text:'Posizionamento dei grandi speculatori (COT)'}),l.map(c=>h('div',{},
    h('dl',{class:'stats'},[['Posizione netta',isN(c.netSpec)?nf(0).format(c.netSpec):'—'],['Variazione settimanale',isN(c.netSpecChg)?(c.netSpecChg>0?'+':c.netSpecChg<0?'−':'')+nf(0).format(Math.abs(c.netSpecChg)):'—'],['Data rilevazione',c.date?fmtWith(fDate,c.date):'—']].map(([k,v])=>h('div',{},h('dt',{text:k}),h('dd',{text:v})))),
    h('div',{style:'display:flex;gap:10px;align-items:center'},h('span',{class:'mut',style:'font-size:13px',text:'Indice COT (0-100)'}),cotBar(c.cotIndex3y)),
    Array.isArray(c.history)&&c.history.length>2?h('div',{style:'margin-top:8px'},spark(c.history.map(x=>x[1]),300,44)):null,c.note?h('p',{class:'note',text:c.note}):null)),
    h('p',{class:'mut fine',text:'Dati CFTC settimanali (futures). Indicazione informativa, non è un consiglio d\'investimento.'}))}
export let bGroup='Tutti',bDir='all',bSort={k:'d',dir:-1};
export const BCOLS=[['name','Nome','',m=>m.name],['d','Giorno','',m=>bOf(m,'daily')&&bOf(m,'daily').score],['w','Settimana','',m=>bOf(m,'weekly')&&bOf(m,'weekly').score],['rsi','RSI 14','ox',m=>m.tech&&m.tech.rsi14],
  ['dist','Dist. SMA200','ox',m=>m.tech&&m.tech.distSma200Pct],['atr','ATR %','ox',m=>m.tech&&m.tech.atrPct],['cot','Indice COT','ox',m=>{const c=cotFor(m)[0];return c&&c.cotIndex3y}]];
export const hasTech=()=>M.some(m=>m.tech&&m.tech.bias);
export function renderBias(box){if(!hasTech())return false;const groups=['Tutti',...new Set(M.filter(m=>m.tech&&m.tech.bias).map(m=>m.group))];if(!groups.includes(bGroup))bGroup='Tutti';
  let rows=M.filter(m=>m.tech&&m.tech.bias&&(bGroup==='Tutti'||m.group===bGroup));const d=m=>{const b=bOf(m,'daily');return b?b.score:0};
  if(bDir==='up')rows=rows.filter(m=>d(m)>=15);if(bDir==='down')rows=rows.filter(m=>d(m)<=-15);
  const acc=BCOLS.find(c=>c[0]===bSort.k)||BCOLS[1];rows=rows.slice().sort((a,b)=>{const x=acc[3](a),y=acc[3](b);if(acc[0]==='name')return -bSort.dir*String(x).localeCompare(String(y),'it');if(!isN(x))return 1;if(!isN(y))return -1;return bSort.dir*(x-y)});
  const th=BCOLS.map(([k,l,c])=>h('th',{class:c,'aria-sort':bSort.k===k?(bSort.dir>0?'ascending':'descending'):'none',style:k==='name'?'text-align:left':''},h('button',{type:'button',style:k==='name'?'text-align:left':'',text:l+(bSort.k===k?(bSort.dir>0?' ▲':' ▼'):''),onclick:()=>{if(bSort.k===k)bSort.dir*=-1;else{bSort.k=k;bSort.dir=k==='name'?-1:-1}renderBias(box)}})));
  const dist=v=>isN(v)?chgEl(v,1):'—';
  put(box,h('div',{class:'filters'},groups.map(g=>h('button',{class:'chip',type:'button','aria-pressed':g===bGroup,text:g,onclick:()=>{bGroup=g;renderBias(box)}}))),
    h('div',{class:'filters'},[['all','Tutti'],['up','Solo rialzisti'],['down','Solo ribassisti']].map(([k,l])=>h('button',{class:'chip',type:'button','aria-pressed':k===bDir,text:l,onclick:()=>{bDir=k;renderBias(box)}}))),
    rows.length?h('div',{class:'tablewrap'},h('table',{class:'mk bt'},h('thead',{},h('tr',{},th)),h('tbody',{},rows.map(m=>{const c=cotFor(m)[0];return h('tr',{tabindex:0,onclick:()=>openDetail(m.symbol),onkeydown:e=>{if(e.key==='Enter')openDetail(m.symbol)}},
      h('td',{style:'text-align:left'},h('span',{class:'nm',text:m.name}),h('span',{class:'sy',text:m.symbol})),h('td',{},biasPill(bOf(m,'daily'))),h('td',{},biasPill(bOf(m,'weekly'))),
      h('td',{class:'ox',text:m.tech.rsi14!=null&&isN(m.tech.rsi14)?nf(0).format(m.tech.rsi14):'—'}),h('td',{class:'ox'},dist(m.tech.distSma200Pct)),h('td',{class:'ox',text:isN(m.tech.atrPct)?nf(2).format(m.tech.atrPct)+'%':'—'}),h('td',{class:'ox'},c&&isN(c.cotIndex3y)?cotBar(c.cotIndex3y):'—'))})))):h('p',{class:'empty',text:'Nessuno strumento corrisponde ai filtri.'}),
    h('p',{class:'mut fine',text:'Il bias va da −100 (molto ribassista) a +100 (molto rialzista) ed è calcolato da medie mobili, RSI, MACD e momentum. Indicazione tecnica automatica, non è un consiglio d\'investimento.'}));return true}
