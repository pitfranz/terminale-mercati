import {$, ago, fmtPct, fmtPrice, goto, h, norm, ovStack} from './util.js';
import {DIR, EMAP, IDX, LITE, ensureDir} from './data.js';
import {BYSYM, D, M, db} from './state.js';
import {openDetail, openLite} from './detail.js';
import {openAddCard, openDirCard} from './requests.js';
import {mUnit, selectMacro} from './macro.js';
import {setNewsFilter} from './news.js';
import {GH} from './config.js';
import {showGroup} from './markets.js';

export function scoreE(e,q,qs){let s=0;
  if(e.nn===q)s=101;else if(qs&&e.ns===qs)s=100;else if(qs&&e.ns.startsWith(qs))s=82-Math.min(12,e.ns.length-qs.length);else if(e.nn.startsWith(q))s=75;
  else if(e.nn.split(/[\s.\-\/&(]+/).some(w=>w&&w.startsWith(q)))s=60;
  else if(e.na&&e.na.split(/\s+/).some(w=>w.startsWith(q)))s=55;
  else if(e.nn.includes(q))s=40;else if(e.na&&e.na.includes(q))s=36;else if(qs.length>=3&&e.ns.includes(qs))s=34;
  return s?s+(e.tier==='core'?3:e.tier==='lite'?1.5:0):0}
export function searchAll(raw,max=12){const q=norm(raw).trim();if(!q)return [];const qs=q.replace(/[^a-z0-9]/g,'');const out=[];
  for(const e of IDX){const s=scoreE(e,q,qs);if(s)out.push([s,e])}
  if(!out.length&&q.length>=3){M.forEach(m=>{const s=fuzzy(q,[m.name,m.symbol,ALIAS[m.symbol]||''].join(' '));if(s)out.push([s,EMAP.get(m.symbol)])})}
  out.sort((a,b)=>b[0]-a[0]||a[1].name.length-b[1].name.length);return out.slice(0,max).map(x=>x[1]).filter(Boolean)}
export function openEntry(e){if(e.tier==='core'&&BYSYM[e.sym])openDetail(e.sym);else if(e.tier==='lite')openLite(e.sym);else openDirCard(e)}
export async function openAny(sym,name){if(BYSYM[sym])return openDetail(sym);try{await ensureDir()}catch(e){}const e=EMAP.get(sym);if(e)return openEntry(e);openDirCard({sym,name:name||sym,type:'',exch:'',tier:'dir'})}
export const CMDS=[['GP','GP <simbolo>','Grafico di un titolo o indice, es. GP oro'],['<simbolo> BIAS','<simbolo> BIAS','Bias tecnico di un titolo, es. oro BIAS'],['TOP','TOP','Le ultime notizie'],['ECO','ECO','Calendario degli eventi della settimana'],['WEI','WEI','Indici di tutto il mondo'],
 ['CURVA','CURVA','Curva dei tassi USA'],['MACRO','MACRO','Dati economici'],['BIAS','BIAS','Tabella del bias tecnico'],['COT','COT','Posizionamento dei grandi speculatori'],['FORZA','FORZA','Forza delle valute'],['SETTORI','SETTORI','Mappa dei settori'],
 ['MOVERS','MOVERS','Titoli che si muovono di più'],['CORR','CORR','Correlazioni tra mercati'],['SESSIONI','SESSIONI','Orari delle Borse nel mondo'],['AIUTO','AIUTO','Mostra questo aiuto']];
export const ALIAS={'GC=F':'gold oro bene rifugio','SI=F':'silver argento','^GSPC':'sp500 s&p standard poors wall street america','^NDX':'nasdaq tecnologia tech','^DJI':'dow jones wall street','FTSEMIB.MI':'ftse mib piazza affari milano borsa italiana ftsemib',
 'BZ=F':'petrolio greggio brent oil benzina','CL=F':'petrolio greggio wti oil','^TNX':'btp bund rendimento titoli di stato treasury tassi','^FVX':'treasury titoli di stato tassi','EURUSD=X':'euro dollaro cambio eurusd','BTC-USD':'bitcoin btc cripto','ETH-USD':'ethereum eth cripto','^VIX':'vix paura volatilita','NG=F':'gas metano bolletta','^GDAXI':'dax germania','^N225':'nikkei giappone tokyo'};
export function fuzzy(q,hay,strict){q=norm(q).trim();if(!q)return 0;const H=norm(hay);const toks=q.split(/\s+/);let sc=0;
  for(const t of toks){const i=H.indexOf(t);if(i>=0){sc+=i===0||H[i-1]===' '?3:1.5;continue}
    if(!strict&&t.length>=3){let j=0;for(const ch of H){if(ch===t[j])j++;if(j===t.length)break}if(j===t.length){sc+=.4;continue}}return 0}return sc}
export function searchMarkets(q,max=8){return M.map(m=>({m,s:fuzzy(q,[m.name,m.symbol,m.group,ALIAS[m.symbol]||''].join(' '))*(norm(m.name).startsWith(norm(q))?2:1)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,max).map(x=>x.m)}
export const eItem=e=>{const m=e.tier==='core'?BYSYM[e.sym]:null,lr=e.tier==='lite'?LITE[e.sym]:null;
  return {type:e.type||'Titolo',label:e.name||e.sym,tk:e.sym,sub:m?fmtPrice(m,m.price)+'  '+fmtPct(m.changePct):lr?fmtPct(lr[4]):[e.exch,'solo ricerca'].filter(Boolean).join(' · '),run:()=>openEntry(e)}};
export function buildResults(raw){const q=raw.trim();const out=[];if(!q)return CMDS.filter(c=>c[0]!=='<simbolo> BIAS').map(c=>cmdItem(c));
  const toks=q.split(/\s+/);const [w,...rest]=toks;const W=w.toUpperCase();const rs=rest.join(' ');
  if(W==='GP'){if(rs){searchAll(rs,8).forEach(e=>out.push(eItem(e)));if(!out.length)out.push({type:'',label:'Nessun simbolo trovato per «'+rs+'»',none:true})}else out.push({type:'Comando',label:'GP <simbolo>',sub:'Scrivi il nome, es. GP oro',none:true});return out}
  if(toks.length>=2&&toks[toks.length-1].toUpperCase()==='BIAS'){const sq=toks.slice(0,-1).join(' ');searchAll(sq,6).forEach(e=>{const it=eItem(e);it.label=e.name+' · bias';out.push(it)});if(out.length)return out}
  if(!rs){CMDS.filter(c=>c[0]===W||(W.length>=2&&!c[0].startsWith('<')&&c[0].startsWith(W))).forEach(c=>out.push(cmdItem(c)))}
  searchAll(q,12).forEach(e=>out.push(eItem(e)));
  (D.macro||[]).map(x=>({x,s:fuzzy(q,x.name+' '+(x.country||''),1)})).filter(o=>o.s>0).sort((a,b)=>b.s-a.s).slice(0,3).forEach(({x})=>out.push({type:'Macro',label:x.name,sub:mUnit(x,x.latest&&x.latest.value),run:()=>{selectMacro(x.id);goto('macro')}}));
  (D.news||[]).map(n=>({n,s:fuzzy(q,n.title,1)})).filter(o=>o.s>0).sort((a,b)=>b.s-a.s).slice(0,3).forEach(({n})=>out.push({type:'Notizia',label:n.title,sub:ago(n.published),run:()=>{setNewsFilter(q);goto('notizie')}}));
  if(!out.some(i=>i.type!=='Comando')&&(db||GH)&&q.length>=2)out.push({type:'Nuovo',label:'Cerca e aggiungi «'+q+'»',sub:'Chiedi di aggiungerlo',run:()=>openAddCard(q)});
  if(!out.length)out.push({type:'',label:'Nessun risultato per «'+q+'». Prova con «oro», «nasdaq», «btp» o scrivi AIUTO.',none:true});return out}
export function cmdItem(c){const g=id=>()=>goto(id);const run={GP:()=>{const q=$('#q');q.value='GP ';q.focus();q.dispatchEvent(new Event('input'))},'<simbolo> BIAS':()=>{const q=$('#q');q.value='oro BIAS';q.focus();q.dispatchEvent(new Event('input'))},TOP:g('notizie'),ECO:g('calendario'),
  WEI:()=>{showGroup('Indici');goto('mercati')},CURVA:g('curva'),MACRO:g('macro'),BIAS:g('bias'),COT:g('cot'),FORZA:g('forza'),SETTORI:g('settori'),MOVERS:g('movers'),CORR:g('corr'),SESSIONI:g('sessioni'),AIUTO:()=>toggleHelp()}[c[0]];
  return {type:'Comando',label:c[1],sub:c[2],run,keep:c[0]==='GP'||c[0]==='<simbolo> BIAS'}}
export function toggleHelp(force){const b=$('#help');const show=force!=null?force:b.hidden;b.hidden=!show;if(show){b.replaceChildren(h('b',{text:'Comandi rapidi'}),h('span',{class:'mut',text:'  ·  premi / per cercare, frecce e Invio per scegliere'}),h('dl',{},CMDS.flatMap(c=>[h('dt',{text:c[1]}),h('dd',{text:c[2]})])),h('p',{class:'mut',style:'margin:8px 0 0',text:'Oppure scrivi cosa cerchi: un nome di azienda («palantir», «moncler»), una crypto («solana»), una materia prima («grano»), una valuta («usdjpy»). Cerchiamo tra migliaia di titoli.'}))}}
export function initSearch(){const q=$('#q'),res=$('#res');let items=[],act=-1,tm=null;
  const close=()=>{res.hidden=true;q.setAttribute('aria-expanded','false');act=-1};
  const paint=()=>{res.replaceChildren(...items.map((it,i)=>h('li',{role:'option','aria-selected':i===act,'data-i':i,class:it.none?'none':'',onmousedown:e=>{e.preventDefault();pick(i)}},h('span',{class:'t',text:it.type||''}),h('span',{class:'l'},it.label,it.tk?h('span',{class:'tk',text:it.tk}):null),h('span',{class:'s',text:it.sub||''}))));
    res.hidden=!items.length;q.setAttribute('aria-expanded',String(!res.hidden))};
  const pick=i=>{const it=items[i];if(!it||it.none)return;close();if(it.keep)return it.run();q.value='';q.blur();try{it.run()}catch(e){console.error(e)}};
  const update=()=>{tm=null;try{items=buildResults(q.value)}catch(e){console.error(e);items=[]}
    if(!DIR&&q.value.trim())items.push({type:'',label:'Carico l\'elenco completo dei titoli…',none:true});act=items.findIndex(i=>!i.none);paint()};
  q.addEventListener('input',()=>{clearTimeout(tm);tm=setTimeout(update,80)});
  q.addEventListener('focus',()=>{ensureDir().then(()=>{if(document.activeElement===q)update()});update()});q.addEventListener('blur',()=>setTimeout(close,150));
  q.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!items.length)return;act=(act+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;paint();const el=res.children[act];el&&el.scrollIntoView({block:'nearest'})}
    else if(e.key==='Enter'){e.preventDefault();if(tm){clearTimeout(tm);update()}if(act>=0)pick(act)}else if(e.key==='Escape'){close();q.blur()}});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')&&!ovStack.length){e.preventDefault();window.scrollTo({top:0});q.focus()}})}
