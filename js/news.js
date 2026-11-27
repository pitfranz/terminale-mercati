import {$, ago, h, norm, put, safeUrl} from './util.js';
import {D} from './state.js';

export let nCat='Tutte',nQ='',nShow=15;
export function newsItem(n,compact){const u=safeUrl(n.link);
  return h('article',{class:'ni'},u?h('a',{class:'tt',href:u,target:'_blank',rel:'noopener noreferrer',text:n.title}):h('span',{class:'tt',style:'font-weight:600',text:n.title}),
    h('div',{class:'meta'},h('span',{text:n.source||''}),h('span',{text:ago(n.published)}),n.category?h('span',{class:'badge',text:n.category}):null,n.lang?h('span',{class:'badge',title:n.lang==='en'?'Articolo in inglese':'Articolo in italiano',text:String(n.lang).toUpperCase()}):null),
    !compact&&n.summary?h('p',{text:n.summary}):null)}
export function renderNews(){const box=$('#news');const all=(D.news||[]).slice().sort((a,b)=>new Date(b.published)-new Date(a.published));
  if(!all.length){box.replaceChildren(h('p',{class:'empty',text:'Nessuna notizia disponibile al momento.'}));return}
  const cats=['Tutte',...new Set(all.map(n=>n.category).filter(Boolean))];if(!cats.includes(nCat))nCat='Tutte';
  const q=norm(nQ);const list=all.filter(n=>(nCat==='Tutte'||n.category===nCat)&&(!q||norm(n.title+' '+(n.summary||'')+' '+(n.source||'')).includes(q)));
  const inp=h('input',{type:'search',placeholder:'Cerca nelle notizie…','aria-label':'Cerca nelle notizie',value:nQ,oninput:e=>{nQ=e.target.value;nShow=15;const pos=e.target.selectionStart;renderNews();const i=$('#news input');i.focus();try{i.setSelectionRange(pos,pos)}catch(x){}}});
  put(box,h('div',{class:'filters'},cats.map(c=>h('button',{class:'chip',type:'button','aria-pressed':c===nCat,text:c,onclick:()=>{nCat=c;nShow=15;renderNews()}})),inp),
    list.length?h('div',{class:'news'},list.slice(0,nShow).map(n=>newsItem(n))):h('p',{class:'empty',text:'Nessuna notizia corrisponde ai filtri.'}),
    list.length>nShow?h('button',{class:'more',type:'button',text:`Mostra altre notizie (${list.length-nShow})`,onclick:()=>{nShow+=15;renderNews()}}):null)}

export function setNewsFilter(q){nQ=q;nCat='Tutte';nShow=15;renderNews()}
