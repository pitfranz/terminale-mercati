import {$, arrow, fDate, fmtWith, h, isN, nf, put, safeUrl, sv, safe} from './util.js';
import {D} from './state.js';
import {mountChart} from './charts.js';

export let macroSel=null,macroCtrl=null;
export const mUnit=(m,v)=>isN(v)?nf(Math.abs(v)>=1000?0:2).format(v)+(m.unit==='%'?'%':m.unit?' '+m.unit:''):'—';
export function renderMacro(){const ms=D.macro||[];const g=$('#macroG');
  if(!ms.length){g.replaceChildren(h('p',{class:'empty',text:'Dati macroeconomici non disponibili al momento.'}));$('#macroD').replaceChildren();return}
  if(!macroSel||!ms.find(x=>x.id===macroSel))macroSel=ms[0].id;
  g.replaceChildren(h('div',{class:'mgrid'},ms.map(m=>{const L=m.latest||{},P=m.previous||{},d=isN(L.value)&&isN(P.value)?L.value-P.value:null;
    return h('button',{class:'mc',type:'button','aria-pressed':m.id===macroSel,onclick:()=>{macroSel=m.id;renderMacro()}},
      h('span',{class:'n mut',style:'font-size:13px',text:(m.country||'')+(m.frequency?' · '+m.frequency:'')}),h('b',{text:m.name}),h('span',{class:'v',text:mUnit(m,L.value)}),
      h('span',{class:'d',text:d==null?'Variazione non disponibile':`${arrow(d)} ${d>0?'+':d<0?'−':''}${nf(2).format(Math.abs(d))} rispetto a ${P.date?fmtWith(fDate,P.date):'prima'} (${mUnit(m,P.value)})`}),
      h('span',{class:'d',text:'Aggiornato al '+(L.date?fmtWith(fDate,L.date):'—')}))})));
  const m=ms.find(x=>x.id===macroSel);const box=h('div',{class:'chartbox'});const su=safeUrl(m.sourceUrl);
  put($('#macroD'),h('div',{class:'macrodetail'},h('h3',{text:m.name}),m.desc?h('p',{text:m.desc}):null,box,
    h('p',{class:'mut',style:'font-size:13px'},'Fonte: ',su?h('a',{href:su,target:'_blank',rel:'noopener noreferrer',text:m.source||su}):(m.source||'—'))));
  const pts=(m.points||[]).filter(p=>Array.isArray(p)&&isN(p[1])&&typeof p[0]==='string').sort((a,b)=>a[0]<b[0]?-1:1).filter((p,i,a)=>!i||p[0]!==a[i-1][0]).map(p=>({time:p[0].slice(0,10),value:p[1]}));
  if(macroCtrl)macroCtrl.destroy();macroCtrl=pts.length<2?(box.replaceChildren(h('div',{class:'err',text:'Serie storica non disponibile.'})),null):mountChart(box,{time:false,fmt:v=>mUnit(m,v),series:[{kind:'line',color:'acc',data:pts}]})}
export function renderCurve(){const box=$('#curva');const c=D.curve;if(!c||!Array.isArray(c.points)||c.points.length<2){box.replaceChildren(h('h3',{text:'Curva dei tassi USA'}),h('p',{class:'empty',text:'Curva dei tassi non disponibile al momento.'}));return}
  const sets=[{label:'Oggi'+(c.date?' ('+fmtWith(fDate,c.date)+')':''),pts:c.points,st:'var(--acc)',w:3,dash:''},...(c.compare||[]).slice(0,2).map((x,i)=>({label:x.label,pts:x.points||[],st:'var(--ink)',w:2,dash:i?'2 4':'6 4'}))];
  const tenors=[];sets.forEach(s=>s.pts.forEach(p=>{if(p&&isN(p.value)&&!tenors.find(t=>t.tenor===p.tenor))tenors.push({tenor:String(p.tenor),years:p.years})}));tenors.sort((a,b)=>a.years-b.years);
  const val=(s,t)=>{const p=s.pts.find(p=>p.tenor===t);return p&&isN(p.value)?p.value:null};
  const wrap=h('div');const legend=h('div',{class:'legend'},sets.map(s=>h('span',{},h('i',{style:`border-top-color:${s.st};border-top-style:${s.dash?'dashed':'solid'}`}),s.label)));
  const today=sets[0],v2=val(today,'2A'),v10=val(today,'10A');let note;
  if(isN(v2)&&isN(v10)){const sp=v10-v2;note=sp<0?`La curva è invertita: oggi i titoli a 2 anni rendono il ${nf(2).format(v2)}%, più dei titoli a 10 anni (${nf(2).format(v10)}%). In passato è stato spesso un segnale che i mercati temono un rallentamento dell'economia, ma non è una previsione certa.`
    :`La curva ha una forma normale: i titoli a 10 anni rendono il ${nf(2).format(v10)}%, ${nf(2).format(sp)} punti in più di quelli a 2 anni (${nf(2).format(v2)}%). Chi presta per più tempo chiede in genere un rendimento maggiore.`}
  else note='Per leggerla: sull\'asse orizzontale c\'è la durata del titolo di Stato, su quello verticale quanto rende all\'anno.';
  const draw=()=>{const w=Math.max(260,wrap.clientWidth||320),hh=w<500?240:300,L=44,R=12,T=12,B=26;const all=sets.flatMap(s=>tenors.map(t=>val(s,t.tenor)).filter(isN));
    const mn=Math.floor(Math.min(...all)*2)/2-.25,mx=Math.ceil(Math.max(...all)*2)/2+.25;const X=i=>L+(tenors.length>1?i/(tenors.length-1):0)*(w-L-R),Y=v=>T+(1-(v-mn)/(mx-mn))*(hh-T-B);
    const s=sv('svg',{width:w,height:hh,viewBox:`0 0 ${w} ${hh}`,role:'img','aria-label':'Curva dei tassi USA: oggi a confronto con il passato'});
    const ts=(mx-mn)>3?1:.5;for(let v=Math.ceil(mn/ts)*ts;v<=mx+1e-9;v+=ts)s.append(sv('line',{x1:L,x2:w-R,y1:Y(v),y2:Y(v),stroke:'var(--line)'}),sv('text',{x:L-6,y:Y(v)+4,'text-anchor':'end','font-size':11,fill:'var(--mut)'},nf(ts<1?1:0).format(v)+'%'));
    const step=w<500?2:1;tenors.forEach((t,i)=>{if(i%step===0||i===tenors.length-1)s.append(sv('text',{x:X(i),y:hh-8,'text-anchor':'middle','font-size':11,fill:'var(--mut)'},t.tenor))});
    sets.slice().reverse().forEach(st=>{const pts=tenors.map((t,i)=>[i,val(st,t.tenor)]).filter(p=>isN(p[1]));if(pts.length<2)return;
      s.append(sv('polyline',{points:pts.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' '),fill:'none',stroke:st.st,'stroke-width':st.w,'stroke-dasharray':st.dash,'stroke-linejoin':'round'}));
      if(st===sets[0])pts.forEach(p=>s.append(sv('circle',{cx:X(p[0]),cy:Y(p[1]),r:3.5,fill:'var(--acc)'},sv('title',{},`${tenors[p[0]].tenor}: ${nf(2).format(p[1])}%`))))});
    wrap.replaceChildren(s)};
  put(box,h('h3',{text:'Curva dei tassi USA'}),h('p',{class:'sub',text:'Quanto rendono i titoli di Stato americani a seconda della durata. Fonte: '+(c.source||'US Treasury')+'.'}),legend,wrap,h('div',{class:'note',text:note}));
  draw();const ro=new ResizeObserver(()=>{if(wrap.clientWidth)draw()});ro.observe(wrap)}

export function selectMacro(id){macroSel=id;safe($('#macroG'),renderMacro)}
