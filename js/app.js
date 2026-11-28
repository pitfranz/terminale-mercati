import {BYSYM, D, M, db, setD, setDb, setM, setSample} from './state.js';
import {$, fDT, fHM, fKey, fShort, fmtWith, h, openOverlay, safe, toD} from './util.js';
import {GH} from './config.js';
import {renderMarkets, renderPunto, renderWatch} from './markets.js';
import {renderNews} from './news.js';
import {renderCal} from './calendar.js';
import {renderCurve, renderMacro} from './macro.js';
import {buildIdx} from './data.js';
import {blk, renderCorr, renderCot, renderEarn, renderForza, renderGaugesToday, renderMovers, renderSessioni, renderSettori, renderTermometro} from './analysis.js';
import {renderBias} from './bias.js';
import {renderReqs, subReqs} from './requests.js';
import {initSearch} from './search.js';
import {startLive} from './live.js';
import {showAskPanel} from './ask.js';

export function openFonti(){const src=D&&D.sources?Object.entries(D.sources):[];
  const rows=src.map(([n,s])=>{s=s||{};const st=s.ok===false?['Errore','var(--down)']:s.stale?['Non aggiornata','var(--flat)']:['OK','var(--up)'];
    return h('div',{class:'r'},h('b',{text:n}),h('span',{class:'pill',style:'color:'+st[1],text:st[0]}),h('span',{class:'mut',style:'font-size:13px',text:s.at?'agg. '+fmtWith(fDT,s.at):''}),s.error?h('span',{class:'mut',style:'font-size:13px',text:'Dettaglio: '+String(s.error).slice(0,200)}):null)});
  openOverlay('Fonti dei dati',h('div',{},h('h2',{text:'Da dove arrivano i dati'}),h('p',{class:'sub',text:'Ogni numero di questa pagina viene dalle fonti qui sotto. “Non aggiornata” significa che è stato usato l\'ultimo dato disponibile. I prezzi possono avere qualche minuto di ritardo.'}),
    rows.length?h('div',{class:'src'},rows):h('p',{class:'empty',text:'Elenco fonti non disponibile.'})),true)}
export function renderHeader(){const g=toD(D.generatedAt);const same=g&&fKey.format(g)===fKey.format(new Date());
  $('#upd').textContent=g?`Dati aggiornati alle ${fmtWith(fHM,g)}${same?'':' del '+fmtWith(fShort,g)}`:'Data di aggiornamento non disponibile';
  const st=$('#stale');st.replaceChildren();if(g&&Date.now()-g>3*3600e3)st.append(h('p',{class:'warn',role:'status',text:`Attenzione: questi dati hanno più di ${Math.floor((Date.now()-g)/3600e3)} ore e potrebbero non essere gli ultimi disponibili.`+(GH?' I prezzi si aggiornano ogni 5 minuti e il resto ogni ora nei giorni feriali (nel fine settimana meno spesso).':'')}))}
export async function boot(){
  try{const r=await fetch('data/data.json');if(!r.ok)throw new Error('HTTP '+r.status);setD(await r.json())}
  catch(e){console.error(e);$('#punto').replaceChildren(h('div',{class:'err'},'Non riesco a caricare i dati in questo momento. ',h('button',{class:'linkbtn',type:'button',text:'Riprova',onclick:()=>location.reload()})));$('#upd').textContent='Dati non disponibili';return}
  setM((Array.isArray(D.markets)?D.markets:[]).filter(m=>m&&m.symbol&&m.name));M.forEach(m=>{m.group=m.group||'Altro';m.file=m.file||String(m.symbol).replace(/[^A-Za-z0-9]/g,'_');BYSYM[m.symbol]=m});
  safe($('#upd'),()=>renderHeader());
  safe($('#punto'),renderPunto);safe($('#watch'),renderWatch);safe($('#mk'),renderMarkets);safe($('#news'),renderNews);safe($('#cal'),renderCal);safe($('#macroG'),renderMacro);safe($('#curva'),renderCurve);
  try{buildIdx()}catch(e){console.error(e)}
  safe($('#gauges'),renderGaugesToday);
  blk('bias',renderBias);blk('termometro',renderTermometro);blk('forza',renderForza);blk('settori',renderSettori);blk('movers',renderMovers);blk('cot',renderCot);blk('corr',renderCorr);blk('sessioni',renderSessioni);blk('trimestrali',renderEarn);blk('richieste',renderReqs);
  if(db)subReqs();
  $('#navBias').hidden=$('#bias').hidden;
  const vis=[...document.querySelectorAll('#analisi .ablk')].filter(x=>!x.hidden);$('#analisi').hidden=!vis.length;$('#navAn').hidden=!vis.length;
  $('#anav').replaceChildren(...vis.filter(x=>x.id!=='richieste').map(x=>h('a',{class:'chip',style:'display:inline-flex;align-items:center;text-decoration:none;color:var(--ink)',href:'#'+x.id,text:$('h3',x).textContent})));
  try{initSearch()}catch(e){console.error(e)}
  startLive();
  if(location.hash){const e=document.getElementById(location.hash.slice(1));if(e&&e.tagName==='SECTION'&&!e.hidden)setTimeout(()=>e.scrollIntoView(),50)}
}
$('#btnFonti').addEventListener('click',()=>D&&openFonti());
$('#btnFonti2').addEventListener('click',()=>D&&openFonti());
boot();
try{window.claude?.use&&window.claude.use('sample').then(s=>{setSample(s);if(s)showAskPanel()}).catch(()=>{})}catch(e){}
try{window.claude?.use&&window.claude.use('db').then(d=>{setDb(d||null);if(D&&db){subReqs();blk('richieste',renderReqs);const vis=[...document.querySelectorAll('#analisi .ablk')].filter(x=>!x.hidden);$('#analisi').hidden=!vis.length;$('#navAn').hidden=!vis.length}}).catch(()=>{})}catch(e){}
