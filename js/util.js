export const $=(s,r=document)=>r.querySelector(s);
export const isN=v=>typeof v==='number'&&isFinite(v);
export function h(tag,props,...kids){const e=document.createElement(tag);if(props)for(const k in props){const v=props[k];if(v==null||v===false)continue;
  if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v===true?'':String(v));}
  for(const c of kids.flat()){if(c==null||c===false)continue;e.append(c.nodeType?c:document.createTextNode(String(c)));}return e;}
export const NS='http://www.w3.org/2000/svg';
export function sv(tag,attrs,...kids){const e=document.createElementNS(NS,tag);for(const k in attrs||{})e.setAttribute(k,String(attrs[k]));for(const c of kids)if(c!=null)e.append(c.nodeType?c:document.createTextNode(String(c)));return e;}
export const NFc={};
export const nf=d=>NFc[d]||(NFc[d]=new Intl.NumberFormat('it-IT',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:'always'}));
export const put=(box,...k)=>box.replaceChildren(...k.flat(2).filter(c=>c!=null&&c!==false));
export const safeUrl=u=>typeof u==='string'&&/^https:\/\//i.test(u)?u:null;
export const norm=s=>String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
export const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
export const lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
export const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
export const TZ='Europe/Rome';
export const mkF=o=>new Intl.DateTimeFormat('it-IT',Object.assign({timeZone:TZ},o));
export const fHM=mkF({hour:'2-digit',minute:'2-digit'}),fDay=mkF({weekday:'long',day:'numeric',month:'long'}),fDate=mkF({day:'numeric',month:'short',year:'numeric'}),
  fShort=mkF({day:'numeric',month:'short'}),fDT=mkF({day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),fKey=new Intl.DateTimeFormat('en-CA',{timeZone:TZ});
export const toD=x=>{const d=x instanceof Date?x:new Date(x);return isNaN(d)?null:d};
export const fmtWith=(f,x)=>{const d=toD(x);return d?f.format(d):'—'};
export const CUR={USD:'$',EUR:'€',JPY:'¥',GBP:'£'};
export function decs(m,v){if(m.group==='Tassi')return 2;if(m.group==='Valute')return Math.abs(v)>=50?2:4;return Math.abs(v)>=1?2:4}
export function fmtNum(m,v){return isN(v)?nf(decs(m,v)).format(v):'—'}
export function fmtPrice(m,v){if(!isN(v))return '—';const s=fmtNum(m,v);if(m.group==='Tassi')return s+'%';if(m.group==='Valute'||m.group==='Indici')return s;return s+' '+(CUR[m.currency]||m.currency||'')}
export function fmtPct(v,d=2){if(!isN(v))return '—';return (v>0?'+':v<0?'−':'')+nf(d).format(Math.abs(v))+'%'}
export const cls=v=>!isN(v)||Math.abs(v)<0.005?'flat':v>0?'up':'down';
export const arrow=v=>!isN(v)||Math.abs(v)<0.005?'■':v>0?'▲':'▼';
export function chgEl(v,d=2){return h('span',{class:'chg '+cls(v),text:isN(v)?arrow(v)+' '+fmtPct(v,d):'—'})}
export function ago(x){const d=toD(x);if(!d)return '';const m=Math.round((Date.now()-d)/60000);if(m<1)return 'adesso';if(m<60)return m+' min fa';const hh=Math.floor(m/60);
  if(hh<24)return hh+(hh===1?' ora fa':' ore fa');const dd=Math.floor(hh/24);if(dd<7)return dd+(dd===1?' giorno fa':' giorni fa');return fmtWith(fDate,d)}
export function countdown(ms){const m=Math.max(0,Math.round(ms/60000));const d=Math.floor(m/1440),hh=Math.floor(m%1440/60),mm=m%60;
  return d>0?`${d} g ${hh} h`:hh>0?`${hh} h ${mm} min`:`${mm} min`}
export function cssColor(v){const p=h('span',{style:'color:var('+v+');display:none'});document.body.append(p);const c=getComputedStyle(p).color;p.remove();return c}
export function safe(box,fn){try{fn()}catch(e){console.error(e);box.replaceChildren(h('div',{class:'err',text:'Non riesco a mostrare questa sezione in questo momento. Riprova più tardi.'}))}}
export function goto(id){const e=document.getElementById(id);if(!e||e.hidden)return;e.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});try{history.replaceState(null,'','#'+id)}catch(e){}}
export const themeCbs=[];
export const onTheme=()=>themeCbs.forEach(f=>{try{f()}catch(e){}});
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',onTheme);new MutationObserver(onTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']})}catch(e){}
export function spark(arr,w=100,hh=30){arr=(arr||[]).filter(isN);const s=sv('svg',{class:'spark',viewBox:`0 0 ${w} ${hh}`,preserveAspectRatio:'none','aria-hidden':'true'});
  if(arr.length<2)return s;const mn=Math.min(...arr),mx=Math.max(...arr),r=mx-mn||1;
  const pts=arr.map((v,i)=>`${(i/(arr.length-1)*w).toFixed(1)},${(hh-2-(v-mn)/r*(hh-4)).toFixed(1)}`).join(' ');
  s.append(sv('polyline',{points:pts,style:`stroke:var(--${arr[arr.length-1]>=arr[0]?'up':'down'})`}));return s}
export let ovStack=[];
export function openOverlay(title,content,narrow){const prev=document.activeElement;
  const x=h('button',{class:'x',type:'button','aria-label':'Chiudi',text:'×'});
  const panel=h('div',{class:'panel'+(narrow?' narrow':''),role:'dialog','aria-modal':'true','aria-label':title},x,content);
  const ov=h('div',{class:'ov'},panel);const o={ov,cleanup:null};
  const close=()=>{if(o.cleanup)o.cleanup();ov.remove();ovStack=ovStack.filter(z=>z!==o);if(!ovStack.length)document.body.style.overflow='';try{prev&&prev.focus&&prev.focus()}catch(e){}};
  x.addEventListener('click',close);ov.addEventListener('mousedown',e=>{if(e.target===ov)close()});o.close=close;
  ovStack.push(o);document.body.style.overflow='hidden';document.body.append(ov);x.focus();return o}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&ovStack.length)ovStack[ovStack.length-1].close()});
