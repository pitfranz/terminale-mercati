import {$, fDate, fmtWith, h, openOverlay, put, safe} from './util.js';
import {BYSYM, D, db} from './state.js';
import {LITE} from './data.js';
import {blk} from './analysis.js';
import {CADENCE, GH, issueUrl} from './config.js';

export const yahooUrl=s=>'https://finance.yahoo.com/quote/'+encodeURIComponent(s);
export const yahooLink=s=>h('a',{href:yahooUrl(s),target:'_blank',rel:'noopener noreferrer',text:'Vedi su Yahoo Finance'});
/* richieste (db) */
export let REQS=null,reqErr=false,reqSub=false,wq=Promise.resolve(),reqMsg='';
export const reqId=(sym,q)=>String(sym||q||'').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64)||'richiesta';
export function addRequest(o){const id=reqId(o.symbol,o.q);const doc={q:String(o.q||'').slice(0,100),symbol:o.symbol||null,name:o.name||null,at:new Date().toISOString()};
  const p=wq.then(()=>db.collection('richieste').doc(id).set(doc));wq=p.catch(()=>{});return p}
export function snapRows(s){const a=[];const push=d=>{if(!d)return;const v=typeof d.data==='function'?d.data():d;if(v&&typeof v==='object')a.push({id:d.id||reqId(v.symbol,v.q),q:String(v.q||''),symbol:v.symbol||null,name:v.name||null,at:v.at||''})};
  if(Array.isArray(s))s.forEach(push);else if(s&&Array.isArray(s.docs))s.docs.forEach(push);else if(s&&typeof s.forEach==='function')s.forEach(push);return a}
export function subReqs(){if(!db||reqSub)return;reqSub=true;let got=false;const t=setTimeout(()=>{if(!got){reqErr=true;safe($('#richieste .abody'),renderReqs)}},10000);
  try{db.collection('richieste').onSnapshot(snap=>{got=true;clearTimeout(t);reqErr=false;REQS=snapRows(snap);safe($('#richieste .abody'),renderReqs)},()=>{got=true;clearTimeout(t);reqErr=true;safe($('#richieste .abody'),renderReqs)})}catch(e){clearTimeout(t);reqErr=true}}
export const inTerminal=r=>(r.symbol&&(BYSYM[r.symbol]||LITE[r.symbol]))||(D.extra||[]).some(x=>x&&(x.symbol===r.symbol&&r.symbol||(x.q&&x.q===r.q)));
export function resFor(r){const rr=Array.isArray(D.requestsResult)?D.requestsResult:[];return rr.find(x=>x&&((x.symbol&&x.symbol===r.symbol)||(x.q&&x.q===r.q)))}
export const notFound=x=>x&&(x.ok===false||/non trovat|not.?found/i.test(String(x.status||'')));
export function renderReqs(){const box=$('#richieste .abody');const blk=$('#richieste');
  if(!db){if(!GH){blk.hidden=true;return false}blk.hidden=false;$('h3',blk).textContent='Titoli richiesti';
    const ex=(Array.isArray(D.extra)?D.extra:[]).filter(x=>x&&x.symbol),nfd=(Array.isArray(D.requestsResult)?D.requestsResult:[]).filter(notFound);
    const row=(t,sub)=>h('div',{class:'r'},h('div',{style:'flex:1;padding:8px 0'},h('b',{text:t}),h('div',{class:'mut',style:'font-size:13px',text:sub})));
    put(box,h('p',{class:'sub',text:'Vuoi un titolo che non c\'è? Cercalo in alto e scegli «Aggiungi al terminale»: si apre GitHub, premi «Submit new issue» (serve un account gratuito). Arriverà con il prossimo aggiornamento (ogni '+CADENCE+').'}),
      ex.length?[h('h4',{text:'Aggiunti su richiesta'}),h('div',{class:'wl'},ex.map(x=>row((x.name||x.symbol)+'  '+x.symbol,x.addedAt?'Aggiunto il '+fmtWith(fDate,x.addedAt):'')))]:null,
      nfd.length?[h('h4',{style:'margin-top:14px',text:'Richieste non trovate'}),h('div',{class:'wl'},nfd.map(x=>row(x.q||x.symbol||'—','Non siamo riusciti a trovare questo titolo.')))]:null,
      h('p',{class:'fine'},h('a',{href:`https://github.com/${GH.owner}/${GH.repo}/issues?q=is%3Aissue+is%3Aopen+Aggiungi`,target:'_blank',rel:'noopener noreferrer',text:'Vedi le richieste aperte su GitHub'})));return true}
  blk.hidden=false;
  const kids=[h('p',{class:'sub',text:'I titoli che chiedi di aggiungere arriveranno con il prossimo aggiornamento (ogni '+CADENCE+').'})];
  if(reqErr&&REQS==null)kids.push(h('p',{class:'empty',text:'Non riesco a caricare le richieste in questo momento.'}));
  else if(REQS==null)kids.push(h('p',{class:'skel',text:'Carico le richieste…'}));
  else{const pend=REQS.filter(r=>!inTerminal(r));
    kids.push(pend.length?h('div',{class:'wl'},pend.map(r=>{const nf_=notFound(resFor(r));return h('div',{class:'r'},h('div',{style:'flex:1;padding:8px 0'},h('b',{text:r.name||r.symbol||r.q}),r.symbol?h('span',{class:'mut',text:'  '+r.symbol}):null,h('div',{class:'mut',style:'font-size:13px',text:nf_?'Non trovato: non siamo riusciti a trovare questo titolo.':'In attesa del prossimo aggiornamento'})),
      nf_?h('button',{class:'btn sec',type:'button',text:'Rimuovi',onclick:e=>{const b=e.target;b.disabled=true;wq=wq.then(()=>db.collection('richieste').doc(r.id).delete()).catch(()=>{b.disabled=false;b.textContent='Non riesco a rimuovere'})}}):null)})):h('p',{class:'empty',text:'Nessuna richiesta in attesa.'}))}
  put(box,kids);return true}
export function reqCard(e,q){const sym=e?e.sym:null,name=e?e.name:null;const key=reqId(sym,q);
  const msg=h('p',{class:'mut',style:'min-height:20px;margin:8px 0',role:'status'});const done=REQS&&REQS.some(r=>r.id===key);
  const btn=h('button',{class:'btn',type:'button',text:done?'Già richiesto':'Aggiungi al terminale',disabled:done||null,onclick:async()=>{btn.disabled=true;msg.textContent='Salvo la richiesta…';
    try{await addRequest({q:q||name||sym,symbol:sym,name});msg.textContent='Richiesta salvata. Il titolo arriverà con il prossimo aggiornamento (ogni '+CADENCE+').';btn.textContent='Richiesto'}catch(err){console.warn(err);btn.disabled=false;msg.textContent='Non sono riuscito a salvare la richiesta. Riprova tra poco.'}}});
  const ghl=GH?h('a',{class:'btn',href:issueUrl(sym,name,q),target:'_blank',rel:'noopener noreferrer',style:'display:inline-flex;align-items:center;text-decoration:none'},'Aggiungi al terminale'):null;
  return h('div',{},db?[btn,msg]:GH?[ghl,h('p',{class:'mut fine',text:'Si apre GitHub (serve un account gratuito): premi «Submit new issue». Il titolo arriverà con il prossimo aggiornamento (ogni '+CADENCE+').'})]:h('p',{class:'mut fine',text:'Da qui non è possibile aggiungere nuovi titoli.'}),sym?h('p',{},yahooLink(sym)):null)}
export function openDirCard(e){openOverlay(e.name,h('div',{},h('h2',{text:e.name}),h('div',{class:'sy mut',text:[e.sym,e.type,e.exch].filter(Boolean).join(' · ')}),
  h('p',{style:'font-weight:600',text:'Non ancora nel terminale'}),h('p',{class:'mut',text:'Per questo titolo abbiamo solo il nome nell\'elenco. Se vuoi vederne prezzi, grafico e bias, puoi chiedere di aggiungerlo: arriverà con il prossimo aggiornamento.'}),reqCard(e,e.name)),true)}
export function openAddCard(q){openOverlay('Aggiungi',h('div',{},h('h2',{text:'Cerca e aggiungi «'+q+'»'}),h('p',{class:'mut',text:'Non troviamo questo nome nell\'elenco. Possiamo provare a cercarlo al prossimo aggiornamento (ogni '+CADENCE+') e aggiungerlo al terminale.'}),reqCard(null,q)),true)}
