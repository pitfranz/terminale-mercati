import {M} from './state.js';
import {ALIAS} from './search.js';
import {norm} from './util.js';

export const HC={};
export function loadHist(file){file=String(file).replace(/[^A-Za-z0-9_]/g,'_');
  return HC[file]||(HC[file]=fetch('data/h/'+file+'.json').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(e=>{delete HC[file];throw e}))}
export let DIR=null,LITEARR=[],LITE={},dirP=null,IDX=[],EMAP=new Map();
export const TYPE_BY_GROUP={'Indici':'Indice','Tassi':'Indice','Valute':'Valuta','Crypto':'Crypto','Future':'Future','Materie prime':'Future','Settori':'ETF'};
export const typeOfGroup=g=>TYPE_BY_GROUP[g]||(/^Azioni/.test(g||'')?'Azione':'Titolo');
export function buildIdx(){const mp=new Map();
  (DIR||[]).forEach(r=>{if(Array.isArray(r)&&r[0])mp.set(String(r[0]),{sym:String(r[0]),name:String(r[1]||''),type:String(r[2]||''),exch:String(r[3]||''),tier:'dir'})});
  LITEARR.forEach(r=>{const k=String(r[0]);const o=mp.get(k)||{sym:k,name:String(r[1]||''),type:typeOfGroup(r[2]),exch:''};o.tier='lite';mp.set(k,o)});
  M.forEach(m=>mp.set(m.symbol,{sym:m.symbol,name:m.name,type:typeOfGroup(m.group),exch:m.exchange||'',tier:'core',alias:ALIAS[m.symbol]||''}));
  IDX=[...mp.values()];EMAP=mp;IDX.forEach(e=>{e.ns=norm(e.sym).replace(/[^a-z0-9]/g,'');e.nn=norm(e.name);e.na=e.alias?norm(e.alias):''})}
export function ensureDir(){if(dirP)return dirP;
  const get=u=>fetch(u).then(r=>r.ok?r.json():[]).catch(()=>[]);
  dirP=Promise.all([get('data/dir.json'),get('data/lite.json')]).then(([d,l])=>{DIR=Array.isArray(d)?d:[];LITEARR=Array.isArray(l)?l.filter(Array.isArray):[];LITEARR.forEach(r=>LITE[r[0]]=r);buildIdx()});return dirP}
export const shardKey=s=>{const c=(String(s).match(/[A-Za-z0-9]/)||['0'])[0].toUpperCase();return /[0-9]/.test(c)?'0':c};
export const SH={};
export function loadShard(sym){const k=shardKey(sym);return SH[k]||(SH[k]=fetch('data/l/'+k+'.json').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).catch(e=>{delete SH[k];throw e}))}
export async function liteData(sym){const s=await loadShard(sym);return s&&s[sym]||null}
