import {$, TZ, arrow, chgEl, cls, fDate, fDay, fmtPct, fmtWith, h, isN, nf, put, spark, sv} from './util.js';
import {BYSYM, D, M} from './state.js';
import {openDetail} from './detail.js';
import {openAny} from './search.js';
import {cotBar} from './bias.js';
import {mountChart} from './charts.js';

export function gaugeSvg(score,size,label){const w=size,cy=size/2,cx=w/2,r=size/2-12,sw=Math.max(10,size/14);score=Math.max(0,Math.min(100,+score||0));
  const pt=(sc,rr)=>{const a=Math.PI*(1-sc/100);return [cx+rr*Math.cos(a),cy-rr*Math.sin(a)]};
  const s=sv('svg',{viewBox:`0 0 ${w} ${cy+size/6+10}`,width:'100%',style:`max-width:${w}px`,role:'img','aria-label':`${label||'Indicatore'}: ${Math.round(score)} su 100`});
  for(let i=0;i<5;i++){const a=pt(i*20+.8,r),b=pt(i*20+19.2,r);s.append(sv('path',{d:`M${a[0].toFixed(1)},${a[1].toFixed(1)} A${r},${r} 0 0 1 ${b[0].toFixed(1)},${b[1].toFixed(1)}`,fill:'none',style:`stroke:color-mix(in srgb,var(--down) ${100-i*25}%,var(--up));stroke-width:${sw}`}))}
  const n=pt(score,r-sw);s.append(sv('line',{x1:cx,y1:cy,x2:n[0].toFixed(1),y2:n[1].toFixed(1),stroke:'var(--ink)','stroke-width':3,'stroke-linecap':'round'}),sv('circle',{cx,cy,r:6,fill:'var(--ink)'}),
    sv('text',{x:cx,y:cy+size/6+4,'text-anchor':'middle','font-size':size/6,'font-weight':700,fill:'var(--ink)'},String(Math.round(score))),
    sv('text',{x:2,y:cy+14,'text-anchor':'start','font-size':11,fill:'var(--mut)'},'Paura'),sv('text',{x:w-2,y:cy+14,'text-anchor':'end','font-size':11,fill:'var(--mut)'},'Euforia'));return s}
export function blk(id,fn){const el=document.getElementById(id);if(!el)return;const box=$('.abody',el);try{const ok=fn(box);el.hidden=!ok}catch(e){console.error(e);el.hidden=false;box.replaceChildren(h('div',{class:'err',text:'Non riesco a mostrare questo riquadro in questo momento.'}))}}
export const hasSent=()=>D.sentiment&&isN(+D.sentiment.score);
export function renderGaugesToday(){const box=$('#gauges');const out=[];
  if(hasSent())out.push(h('a',{class:'tile gcard',href:'#termometro'},h('span',{class:'n',text:'Termometro Paura / Euforia'}),gaugeSvg(+D.sentiment.score,200,'Termometro paura euforia'),h('span',{class:'p',style:'text-align:center',text:D.sentiment.label||''})));
  if(D.cryptoFng&&isN(+D.cryptoFng.value))out.push(h('a',{class:'tile gcard',href:'#termometro'},h('span',{class:'n',text:'Paura/Euforia crypto'}),gaugeSvg(+D.cryptoFng.value,200,'Indice paura e avidità crypto'),h('span',{class:'p',style:'text-align:center',text:D.cryptoFng.label||''})));
  box.replaceChildren(...(out.length?[h('div',{class:'tiles gt'},out)]:[]))}
export function renderTermometro(box){if(!hasSent()&&!D.cryptoFng)return false;const S=D.sentiment,C=D.cryptoFng,kids=[];
  if(hasSent())kids.push(h('div',{class:'termo'},h('div',{},gaugeSvg(+S.score,300,'Termometro paura euforia'),h('div',{style:'text-align:center;font-size:20px;font-weight:700',text:S.label||''})),
    h('div',{},h('p',{class:'sub',text:'Sintesi di sei misure del mercato USA. Sotto 25 domina la paura, sopra 75 l\'euforia: sono estremi, non previsioni.'}),
      h('div',{class:'comp'},(S.components||[]).map(c=>h('div',{class:'cp'},h('div',{style:'display:flex;justify-content:space-between;gap:8px'},h('b',{text:c.name||''}),h('span',{class:'mut',text:String(c.value==null?'':c.value)})),
        h('div',{class:'rng'},h('i',{style:'left:calc('+Math.max(0,Math.min(100,+c.score||0))+'% - 1px)'})),h('div',{class:'mut',style:'font-size:12.5px',text:(isN(c.score)?c.score+'/100 · ':'')+(c.desc||'')})))))));
  if(hasSent()&&Array.isArray(S.history)&&S.history.length>2)kids.push(h('p',{class:'mut',style:'margin:14px 0 2px;font-size:13px',text:'Ultimo anno'}),h('div',{class:'hs'},spark(S.history.map(x=>x[1]),300,60)));
  if(C&&isN(+C.value))kids.push(h('h4',{style:'margin:20px 0 4px',text:'Crypto: indice Paura e avidità'}),h('div',{class:'termo'},h('div',{},gaugeSvg(+C.value,200,'Indice paura e avidità crypto'),h('div',{style:'text-align:center;font-weight:700',text:C.label||''})),
    Array.isArray(C.history)&&C.history.length>2?h('div',{class:'hs'},h('p',{class:'mut',style:'font-size:13px;margin:0',text:'Ultimi 90 giorni'}),spark(C.history.map(x=>x[1]),300,60)):h('div')));
  put(box,kids);return true}
export let fP='d1';
export function renderForza(box){const cs=Array.isArray(D.currencyStrength)?D.currencyStrength.filter(c=>c&&c.ccy):[];if(!cs.length)return false;
  const rows=cs.filter(c=>isN(c[fP])).sort((a,b)=>b[fP]-a[fP]);const mx=Math.max(.01,...rows.map(c=>Math.abs(c[fP])));
  put(box,h('p',{class:'sub',text:'Quanto ogni valuta è salita o scesa contro le altre sette (media delle coppie). In alto le più forti.'}),
    h('div',{class:'seg',role:'group','aria-label':'Periodo',style:'display:inline-flex;margin-bottom:10px'},[['d1','1 giorno'],['w1','1 settimana'],['m1','1 mese']].map(([k,l])=>h('button',{type:'button','aria-pressed':k===fP,text:l,onclick:()=>{fP=k;renderForza(box)}}))),
    rows.map(c=>{const v=c[fP],w=Math.abs(v)/mx*50;return h('div',{class:'fz'},h('b',{text:c.ccy}),h('div',{class:'fzb',role:'img','aria-label':c.ccy+' '+fmtPct(v)},h('i',{style:`background:var(--${v>=0?'up':'down'});${v>=0?'left:50%':'right:50%'};width:${w}%`}),h('u',{})),chgEl(v)) }));return true}
export const SECPER=[['d1','1 giorno'],['w1','1 settimana'],['m1','1 mese'],['ytd','Da inizio anno']];
export let sP='d1';
export function secList(){if(Array.isArray(D.sectors)&&D.sectors.length)return D.sectors.map(s=>({symbol:s.symbol,name:s.name||s.symbol,d1:s.d1??s.changePct,w1:s.w1??s.chg1w,m1:s.m1??s.chg1m,ytd:s.ytd??s.chgYtd}));
  return M.filter(m=>m.group==='Settori').map(m=>({symbol:m.symbol,name:m.name,d1:m.changePct,w1:m.chg1w,m1:m.chg1m,ytd:m.chgYtd}))}
export function renderSettori(box){const l=secList().filter(s=>s&&s.name);if(!l.length)return false;const mx=Math.max(1,...l.map(s=>isN(s[sP])?Math.abs(s[sP]):0));
  put(box,h('p',{class:'sub',text:'ETF dei settori dell\'S&P 500: più il colore è intenso, più il movimento è forte. Verde sale, rosso scende.'}),
    h('div',{class:'seg',role:'group','aria-label':'Periodo',style:'display:inline-flex;margin-bottom:10px;max-width:100%;overflow-x:auto'},SECPER.map(([k,lb])=>h('button',{type:'button','aria-pressed':k===sP,text:lb,onclick:()=>{sP=k;renderSettori(box)}}))),
    h('div',{class:'heat'},l.slice().sort((a,b)=>(b[sP]??-1e9)-(a[sP]??-1e9)).map(s=>{const v=s[sP],pc=isN(v)?Math.round(Math.min(1,Math.abs(v)/mx)*62+8):0;
      return h(BYSYM[s.symbol]?'button':'div',{class:'ht',type:BYSYM[s.symbol]?'button':null,style:isN(v)?`background:color-mix(in srgb,var(--${v>=0?'up':'down'}) ${pc}%,var(--bg))`:'',onclick:BYSYM[s.symbol]?()=>openDetail(s.symbol):null},h('span',{style:'font-size:13px;font-weight:600',text:s.name}),chgEl(v))})));return true}
export let mReg='us',mKind='gainers';
export function trendItems(){const t=Array.isArray(D.trending)&&D.trending.length?D.trending:D.movers&&D.movers.trending;return (Array.isArray(t)?t:[]).map(x=>typeof x==='string'?{sym:x,name:x}:Array.isArray(x)?{sym:String(x[0]),name:String(x[1]||x[0]),pct:x[3]}:x&&x.symbol?{sym:String(x.symbol),name:String(x.name||x.symbol)}:null).filter(Boolean)}
export function renderMovers(box){const mv=D.movers;if(!mv||(!mv.us&&!mv.eu))return false;const regs=[['us','Usa'],['eu','Europa']].filter(r=>mv[r[0]]);if(!mv[mReg])mReg=regs[0][0];
  const list=(mv[mReg][mKind]||[]).filter(Array.isArray);const tr=trendItems();
  put(box,h('div',{class:'tabs'},regs.map(([k,l])=>h('button',{type:'button',class:'chip','aria-pressed':k===mReg,text:l,onclick:()=>{mReg=k;renderMovers(box)}})),[['gainers','Migliori'],['losers','Peggiori'],['active','Più scambiati']].map(([k,l])=>h('button',{type:'button',class:'chip','aria-pressed':k===mKind,text:l,onclick:()=>{mKind=k;renderMovers(box)}}))),
    list.length?h('div',{class:'wl'},list.map(r=>h('div',{class:'r'},h('button',{class:'go',type:'button',onclick:()=>openAny(String(r[0]),r[1])},h('span',{class:'nm'},r[1]||r[0],h('span',{class:'sy',text:r[0]})),h('span',{text:isN(r[2])?nf(2).format(r[2]):'—'}),chgEl(r[3]))))):h('p',{class:'empty',text:'Nessun dato per questa classifica.'}),
    tr.length?h('div',{style:'margin-top:14px'},h('b',{style:'font-size:14px',text:'In tendenza su Yahoo Finance'}),h('div',{class:'chips',style:'margin-top:8px'},tr.map(t=>h('button',{class:'chip',type:'button',text:(t.name===t.sym?t.sym:t.name+' ('+t.sym+')')+(isN(t.pct)?'  '+fmtPct(t.pct,1):''),onclick:()=>openAny(t.sym,t.name)})))):null);return true}
export let cotSel=null,cotCtrl=null;
export function renderCot(box){const cs=Array.isArray(D.cot)?D.cot.filter(c=>c&&c.market):[];if(!cs.length)return false;if(cotCtrl){cotCtrl.destroy();cotCtrl=null}
  if(cotSel==null||!cs.find(c=>c.market===cotSel))cotSel=cs[0].market;const c=cs.find(x=>x.market===cotSel);const cb=h('div',{class:'chartbox',style:'height:240px'});
  const hist=(c.history||[]).filter(p=>Array.isArray(p)&&isN(p[1])&&typeof p[0]==='string').map(p=>({time:p[0].slice(0,10),value:p[1]}));
  put(box,h('p',{class:'sub',text:'Cosa fanno i grandi speculatori (fondi) sui future, secondo i dati settimanali CFTC. L\'indice COT va da 0 (posizioni nette al minimo di 3 anni) a 100 (al massimo): gli estremi a volte precedono inversioni, ma non sono una previsione.'}),
    h('div',{class:'tablewrap'},h('table',{class:'mk bt'},h('thead',{},h('tr',{},['Mercato','Posizione netta','Var. sett.','Indice COT'].map((t,i)=>h('th',{style:i?'':'text-align:left'},h('span',{style:'display:block;padding:10px 8px',text:t}))))),
      h('tbody',{},cs.map(x=>h('tr',{tabindex:0,'aria-selected':x.market===cotSel,style:x.market===cotSel?'background:var(--accbg)':'',onclick:()=>{cotSel=x.market;renderCot(box)},onkeydown:e=>{if(e.key==='Enter'){cotSel=x.market;renderCot(box)}}},
        h('td',{style:'text-align:left;font-weight:600',text:x.market}),h('td',{text:isN(x.netSpec)?nf(0).format(x.netSpec):'—'}),h('td',{},isN(x.netSpecChg)?h('span',{class:'chg '+cls(x.netSpecChg),text:arrow(x.netSpecChg)+' '+(x.netSpecChg>0?'+':x.netSpecChg<0?'−':'')+nf(0).format(Math.abs(x.netSpecChg))}):'—'),h('td',{},cotBar(x.cotIndex3y))))))),
    h('div',{class:'macrodetail'},h('h3',{text:c.market+' · posizione netta dei grandi speculatori'}),cb,c.note?h('p',{class:'note',text:c.note}):null,h('p',{class:'mut fine',text:'Aggiornato al '+(c.date?fmtWith(fDate,c.date):'—')+'. Dati informativi, non sono un consiglio d\'investimento.'})));
  cotCtrl=hist.length<2?(cb.replaceChildren(h('div',{class:'err',text:'Storico non disponibile.'})),null):mountChart(cb,{time:false,fmt:v=>nf(0).format(v),series:[{kind:'line',color:'acc',data:hist}]});return true}
export function renderCorr(box){const C=D.correlations;if(!C||!Array.isArray(C.matrix)||!C.matrix.length)return false;const L=C.labels||C.symbols||[],n=C.matrix.length;
  let best=null,worst=null;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const v=C.matrix[i][j];if(!isN(v))continue;if(!best||v>best.v)best={v,i,j};if(!worst||v<worst.v)worst={v,i,j}}
  const cell=(v,i,j)=>{const pc=isN(v)?Math.round(Math.abs(v)*80):0;return h('div',{class:'cc2',title:`${L[i]} / ${L[j]}: ${isN(v)?nf(2).format(v):'—'}`,style:isN(v)?`background:color-mix(in srgb,var(--${v>=0?'acc':'down'}) ${pc}%,var(--bg))`:''},h('span',{text:isN(v)?nf(1).format(Math.abs(v)<.05?0:v):''}))};
  put(box,h('p',{class:'sub',text:'Quanto si muovono insieme due mercati negli ultimi 60 giorni. Vicino a +1 (blu): salgono e scendono insieme. Vicino a −1 (rosso): vanno in direzioni opposte. Vicino a 0: nessun legame. Sfiora o tocca una cella per i dettagli.'}),
    h('div',{class:'cgrid',style:`grid-template-columns:var(--rw) repeat(${n},minmax(0,1fr))`},h('div'),L.slice(0,n).map(l=>h('div',{class:'cl',text:l})),
      C.matrix.flatMap((row,i)=>[h('div',{class:'rl',text:L[i]||''}),...row.slice(0,n).map((v,j)=>cell(v,i,j))])),
    best&&worst?h('p',{class:'note',text:`In questo periodo la coppia più "legata" è ${L[best.i]} / ${L[best.j]} (${nf(2).format(best.v)}); quella più "opposta" è ${L[worst.i]} / ${L[worst.j]} (${nf(2).format(worst.v)}).`}):null);return true}
export const SESS=[['Sydney','Australia/Sydney',600,960],['Tokyo','Asia/Tokyo',540,900],['Londra','Europe/London',480,990],['New York','America/New_York',570,960]];
export function lparts(tz,d){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d).map(x=>[x.type,x.value]));return {wd:p.weekday,min:(+p.hour%24)*60+ +p.minute}}
export const hhmm=m=>{m=((Math.round(m)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
export let sesTimer=null;
export function renderSessioni(box){if(sesTimer){clearInterval(sesTimer);sesTimer=null}
  const draw=()=>{const now=new Date(),rome=lparts(TZ,now);const rows=SESS.map(([nm,tz,o,c])=>{const lp=lparts(tz,now);const open=!/^(Sat|Sun)$/.test(lp.wd)&&lp.min>=o&&lp.min<c;
      const diff=((lp.min-rome.min+1440+720)%1440)-720,rs=(o-diff+1440)%1440,dur=c-o,segs=rs+dur>1440?[[rs,1440],[0,rs+dur-1440]]:[[rs,rs+dur]];
      return h('div',{class:'ses'},h('div',{},h('b',{text:nm}),h('div',{class:'mut',style:'font-size:12.5px',text:hhmm(rs)+'–'+hhmm(rs+dur)+' ora italiana'})),
        h('div',{},h('div',{class:'tl'},segs.map(([a,b])=>h('i',{style:`left:${a/14.4}%;width:${(b-a)/14.4}%;${open?'':'opacity:.4'}`})),h('b',{style:'left:'+rome.min/14.4+'%'})),
          h('div',{class:'mut tlx'},h('span',{text:'0'}),h('span',{text:'6'}),h('span',{text:'12'}),h('span',{text:'18'}),h('span',{text:'24'}))),
        h('span',{class:'pill',style:'color:var(--'+(open?'up':'mut')+');justify-self:start',text:open?'Aperta':'Chiusa'}))});
    put(box,h('p',{class:'sub',text:'Orari di Borsa in ora italiana (il fuso e l\'ora legale si aggiornano da soli). Adesso in Italia: '+hhmm(rome.min)+'. Il segno nero sulla barra è l\'ora attuale. Sabato e domenica sono chiusi.'}),rows)};
  draw();sesTimer=setInterval(()=>{if(document.hidden)return;try{draw()}catch(e){}},30000);return true}
export function renderEarn(box){const e=Array.isArray(D.earnings)?D.earnings.filter(x=>x&&x.symbol):[];if(!e.length)return false;const by={};e.forEach(x=>{(by[x.date||'']=by[x.date||'']||[]).push(x)});
  put(box,h('p',{class:'sub',text:'Le aziende che presentano i conti nelle prossime settimane (date indicative).'}),Object.keys(by).sort().map(d=>h('div',{},h('div',{class:'day',text:d?fmtWith(fDay,d):'Data da definire'}),by[d].map(x=>h('div',{class:'ev'},h('b',{class:'ti',text:(x.name||x.symbol)}),h('span',{class:'cc badge',text:x.symbol}),h('span',{class:'mut',style:'font-size:13px',text:[{after:'dopo la chiusura',before:"prima dell'apertura"}[x.time]||x.time,x.epsForecast?'utile/azione atteso '+x.epsForecast:''].filter(Boolean).join(' · ')}))))));return true}
