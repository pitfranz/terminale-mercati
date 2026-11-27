import {$, chgEl, cls, fDay, fHM, fKey, fmtNum, fmtPct, fmtPrice, fmtWith, h, isN, lsGet, lsSet, nf, put, safe, spark, toD} from './util.js';
import {BYSYM, D, M} from './state.js';
import {openDetail} from './detail.js';
import {hasSent} from './analysis.js';
import {nextEvent} from './calendar.js';
import {flashCls} from './live.js';
import {bOf, biasPill, hasTech} from './bias.js';

export let watch=[];
try{watch=JSON.parse(lsGet('terminale.watch')||'[]').filter(x=>typeof x==='string')}catch(e){}
export function starBtn(m){const on=watch.includes(m.symbol);return h('button',{class:'star',type:'button','data-star':m.symbol,'aria-pressed':on,'aria-label':(on?'Rimuovi dai preferiti: ':'Aggiungi ai preferiti: ')+m.name,title:on?'Rimuovi dai preferiti':'Aggiungi ai preferiti',text:on?'★':'☆',
  onclick:e=>{e.stopPropagation();toggleWatch(m.symbol)}})}
export function toggleWatch(sym){watch=watch.includes(sym)?watch.filter(s=>s!==sym):[...watch,sym];lsSet('terminale.watch',JSON.stringify(watch));
  document.querySelectorAll('[data-star]').forEach(b=>{const m=BYSYM[b.dataset.star];if(!m)return;const on=watch.includes(m.symbol);b.setAttribute('aria-pressed',on);b.textContent=on?'★':'☆';b.setAttribute('aria-label',(on?'Rimuovi dai preferiti: ':'Aggiungi ai preferiti: ')+m.name)});
  safe($('#watch'),renderWatch)}
export function renderWatch(){const box=$('#watch');box.replaceChildren(h('h3',{text:'I miei preferiti'}));
  const ms=watch.map(s=>BYSYM[s]).filter(Boolean);
  if(!ms.length){box.append(h('p',{class:'empty',text:'Non hai ancora preferiti. Tocca la stella (☆) accanto a un titolo o nel dettaglio per seguirlo qui.'}));return}
  box.append(h('div',{class:'wl'},ms.map(m=>h('div',{class:'r'},starBtn(m),
    h('button',{class:'go',type:'button',onclick:()=>openDetail(m.symbol)},h('span',{class:'nm',text:m.name}),h('span',{text:fmtPrice(m,m.price)}),chgEl(m.changePct))))))}
export function buildPunto(){const by=s=>BYSYM[s];const get=l=>l.map(by).filter(m=>m&&isN(m.changePct));const out=[];
  const mood=(a,l)=>l&&l.some(m=>m.changePct>0.15)&&l.some(m=>m.changePct<-0.15)&&Math.abs(a)<0.5?'contrastate':a>=0.15?'in rialzo':a<=-0.15?'in calo':'sostanzialmente stabili';
  const grp=(label,syms,max)=>{const l=get(syms).slice(0,max);if(!l.length)return;const a=l.reduce((s,m)=>s+m.changePct,0)/l.length;
    out.push({t:`${label} ${mood(a,l)}: `+l.map(m=>`${m.name} ${fmtPct(m.changePct,1)}`).join(', ')+'.',c:a>=0.15?'up':a<=-0.15?'down':'flat'})};
  grp('Borse USA',['^GSPC','^NDX','^DJI'],3);grp('Borse europee',['FTSEMIB.MI','^STOXX50E','^GDAXI','^FCHI','^FTSE'],3);grp('Borse asiatiche',['^N225','^HSI'],2);
  const px=(s,txt)=>{const m=by(s);if(m&&isN(m.price))out.push({t:txt(m),c:cls(m.changePct)})};
  px('GC=F',m=>`Oro a ${fmtPrice(m,m.price)} (${fmtPct(m.changePct,1)}).`);
  px('BZ=F',m=>`Petrolio Brent a ${fmtPrice(m,m.price)} (${fmtPct(m.changePct,1)}).`);
  px('EURUSD=X',m=>`L'euro vale ${fmtNum(m,m.price)} dollari (${fmtPct(m.changePct,1)}).`);
  px('BTC-USD',m=>`Bitcoin a ${fmtPrice(m,m.price)} (${fmtPct(m.changePct,1)}).`);
  px('^TNX',m=>`Il rendimento dei titoli di Stato USA a 10 anni è al ${fmtNum(m,m.price)}%`+(isN(m.change)?` (${m.change>0?'+':m.change<0?'−':''}${nf(2).format(Math.abs(m.change))} punti).`:'.'));
  px('^VIX',m=>{const v=m.price;return `Il VIX, l'indice della paura, è a ${fmtNum(m,v)}: tensione ${v<15?'molto bassa':v<20?'nella norma':v<30?'elevata':'alta'} sui mercati USA.`});
  if(hasSent())out.push({t:`Termometro paura/euforia: ${Math.round(+D.sentiment.score)} su 100 (${D.sentiment.label||'—'}).`,c:'flat'});
  const ne=nextEvent();if(ne){const d=toD(ne.date),same=fKey.format(d)===fKey.format(new Date());
    out.push({t:`Prossimo evento importante: ${ne.title} (${ne.country}), ${same?'oggi':fmtWith(fDay,d)} alle ${fmtWith(fHM,d)}.`,c:'flat'})}
  return out}
export function renderPunto(){const box=$('#punto');box.className='';const p=buildPunto();
  box.replaceChildren(h('div',{class:'punto'},p.length?h('ul',{},p.map(x=>h('li',{},h('span',{class:'chg '+x.c,'aria-hidden':'true',text:x.c==='up'?'▲ ':x.c==='down'?'▼ ':'● '}),x.t))):h('p',{class:'empty',text:'Riepilogo non disponibile: mancano i dati di mercato.'}),
    h('p',{class:'foot',text:'Riepilogo generato in automatico dai numeri qui sotto; non è un consiglio finanziario.'})));
  const keys=['^GSPC','^NDX','FTSEMIB.MI','GC=F','BZ=F','EURUSD=X','BTC-USD','^TNX'];
  $('#tiles').replaceChildren(h('div',{class:'tiles'},keys.map(k=>BYSYM[k]).filter(Boolean).map(m=>h('button',{class:'tile'+flashCls(m),type:'button',onclick:()=>openDetail(m.symbol)},
    h('span',{class:'n',text:m.name}),h('span',{class:'p',text:fmtPrice(m,m.price)}),chgEl(m.changePct),bOf(m,'daily')?h('span',{style:'margin-top:2px'},biasPill(bOf(m,'daily'))):null,spark(m.spark)))))}
export let tab=lsGet('terminale.tab'),sortK=null,sortDir=-1;
export let biasP='daily';
export const COLS=[['name','Nome',''],['price','Prezzo',''],['changePct','Var. %',''],['bias','Bias','ob'],['chg1w','1 sett.','o1w'],['chg1m','1 mese','o1m'],['chgYtd','Da inizio anno','oytd'],['chg1y','1 anno','o1y']];
export const mval=(m,k)=>k==='bias'?(bOf(m,biasP)?bOf(m,biasP).score:null):m[k];
export function renderMarkets(){const groups=[...new Set(M.map(m=>m.group))];if(!groups.includes(tab))tab=groups[0];const ht=hasTech();
  $('#tabs').replaceChildren(...groups.map(g=>h('button',{type:'button',role:'tab','aria-selected':g===tab,text:g,onclick:()=>{tab=g;lsSet('terminale.tab',g);renderMarkets()}})));
  let rows=M.filter(m=>m.group===tab);const cols=COLS.filter(c=>ht||c[0]!=='bias');
  if(sortK){rows=[...rows].sort((a,b)=>{const x=mval(a,sortK),y=mval(b,sortK);if(sortK==='name')return sortDir*-1*String(x).localeCompare(String(y),'it');if(!isN(x))return 1;if(!isN(y))return -1;return sortDir*(x-y)})}
  const th=cols.map(([k,l,c])=>h('th',{class:c,'aria-sort':sortK===k?(sortDir>0?'ascending':'descending'):'none'},h('button',{type:'button',onclick:()=>{if(sortK===k)sortDir*=-1;else{sortK=k;sortDir=-1}renderMarkets()},text:l+(sortK===k?(sortDir>0?' ▲':' ▼'):'')})));
  th.unshift(h('th',{class:'st'},h('span',{class:'sr',text:'Preferito'})));th.push(h('th',{class:'sp'},h('span',{class:'sr',text:'Andamento'})));
  const tr=m=>h('tr',{tabindex:0,onclick:()=>openDetail(m.symbol),onkeydown:e=>{if(e.key==='Enter')openDetail(m.symbol)}},
    h('td',{class:'st'},starBtn(m)),h('td',{},h('span',{class:'nm',text:m.name}),h('span',{class:'sy',text:m.symbol})),h('td',{class:flashCls(m).trim(),text:fmtPrice(m,m.price)}),h('td',{class:flashCls(m).trim()},chgEl(m.changePct)),ht?h('td',{class:'ob'},biasPill(bOf(m,biasP))):null,
    h('td',{class:'o1w'},chgEl(m.chg1w,1)),h('td',{class:'o1m'},chgEl(m.chg1m,1)),h('td',{class:'oytd'},chgEl(m.chgYtd,1)),h('td',{class:'o1y'},chgEl(m.chg1y,1)),h('td',{class:'sp'},spark(m.spark)));
  put($('#mk'),ht?h('div',{class:'ctl',style:'margin:0 0 8px'},h('span',{class:'mut',style:'font-size:13px',text:'Bias tecnico:'}),h('div',{class:'seg',role:'group','aria-label':'Periodo del bias'},[['daily','Giornaliero'],['weekly','Settimanale']].map(([k,l])=>h('button',{type:'button','aria-pressed':k===biasP,text:l,onclick:()=>{biasP=k;renderMarkets()}})))):null,
    h('table',{class:'mk'},h('thead',{},h('tr',{},th)),h('tbody',{},rows.map(tr))))}

export function showGroup(g){tab=(M.find(m=>m.group===g)||{}).group||tab;renderMarkets()}
