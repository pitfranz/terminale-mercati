import {D} from './state.js';
import {$, countdown, fDay, fHM, fKey, fmtWith, h, put, toD} from './util.js';

export function nextEvent(){const now=Date.now();return (D.calendar||[]).filter(e=>e&&(e.impact==='High'||e.impact==='Medium')&&toD(e.date)&&toD(e.date)>now).sort((a,b)=>new Date(a.date)-new Date(b.date))[0]}
export let cImp='all',cdTimer=null;
export const IMP={High:['Alto',3],Medium:['Medio',2],Low:['Basso',1],Holiday:['Festivo',0]};
export function renderCal(){const box=$('#cal');if(cdTimer){clearInterval(cdTimer);cdTimer=null}
  const ev=(D.calendar||[]).filter(e=>e&&toD(e.date)).sort((a,b)=>new Date(a.date)-new Date(b.date));
  if(!ev.length){box.replaceChildren(h('p',{class:'empty',text:'Il calendario degli eventi non è disponibile al momento.'}));return}
  const ok=e=>cImp==='all'||(cImp==='high'?e.impact==='High':(e.impact==='High'||e.impact==='Medium'));
  const ne=nextEvent();const cd=h('span');const upd=()=>{if(ne)cd.textContent='tra '+countdown(new Date(ne.date)-Date.now())};upd();
  const days=[];const map={};ev.filter(ok).forEach(e=>{const k=fKey.format(new Date(e.date));if(!map[k]){map[k]={k,d:new Date(e.date),items:[]};days.push(map[k])}map[k].items.push(e)});
  const today=fKey.format(new Date());
  const row=e=>{const[lab,n]=IMP[e.impact]||['—',0];const past=new Date(e.date)<Date.now();
    return h('div',{class:'ev'+(past?' past':'')+(e===ne?' next':'')},h('span',{class:'tm',text:fmtWith(fHM,e.date)}),h('span',{class:'cc badge',text:e.country||''}),h('span',{class:'ti',text:e.title||''}),
      h('span',{class:'imp',title:'Impatto: '+lab},[1,2,3].map(i=>h('span',{class:'dot'+(i<=n?' on':''),'aria-hidden':'true'})),h('span',{text:lab})),
      e.impact==='Holiday'?null:h('span',{class:'vals'},h('span',{},'Att. ',h('b',{text:e.actual||'—'})),h('span',{text:'Prev. '+(e.forecast||'—')}),h('span',{text:'Prec. '+(e.previous||'—')})))};
  put(box,
    ne?h('div',{class:'nextev'},h('b',{text:'Prossimo evento importante: '}),`${ne.title} (${ne.country}) · ${new Date(ne.date)-Date.now()>864e5?fmtWith(fDay,ne.date)+' ':''}${fmtWith(fHM,ne.date)} · `,cd):null,
    h('div',{class:'filters'},[['all','Tutti'],['med','Medio e alto'],['high','Solo alto']].map(([k,l])=>h('button',{class:'chip',type:'button','aria-pressed':cImp===k,text:l,onclick:()=>{cImp=k;renderCal()}}))),
    days.length?days.map(g=>h('div',{},h('div',{class:'day',text:(g.k===today?'Oggi · ':'')+fmtWith(fDay,g.d)}),g.items.map(row))):h('p',{class:'empty',text:'Nessun evento con questo livello di impatto.'}));
  if(ne)cdTimer=setInterval(upd,30000)}
