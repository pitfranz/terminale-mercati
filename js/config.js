/* Per domini personalizzati: scrivi qui "proprietario/repository" (es. "mario/terminale-mercati"). Lascia vuoto per GitHub Pages. */
export const REPO_OVERRIDE="";
/* Opzionale: indirizzo del Cloudflare Worker (cartella worker/) per prezzi ogni minuto di azioni, valute e future. Es. "https://terminale.mioaccount.workers.dev". Vuoto = si usa solo live.json. */
export const WORKER_URL="";
export function deriveRepo(host,path,override){const ok=x=>/^[A-Za-z0-9._-]{1,100}$/.test(x||'');
  if(override){const m=String(override).split('/');return m.length===2&&ok(m[0])&&ok(m[1])?{owner:m[0],repo:m[1]}:null}
  host=String(host||'').toLowerCase();if(!/\.github\.io$/.test(host))return null;const owner=host.slice(0,-10);if(!ok(owner)||owner.indexOf('.')>=0)return null;
  const seg=String(path||'/').split('/').filter(Boolean)[0];const repo=seg&&!/\.html?$/i.test(seg)?seg:host;return ok(repo)?{owner,repo}:null}
export let GH=null;
try{GH=deriveRepo(location.hostname,location.pathname,REPO_OVERRIDE)}catch(e){}
export const CADENCE=GH?'ora nei giorni feriali':'2 ore nei giorni feriali';
export const issueUrl=(sym,name,q)=>GH?`https://github.com/${GH.owner}/${GH.repo}/issues/new?labels=richiesta&title=${encodeURIComponent('Aggiungi: '+(q||name||sym||''))}&body=${encodeURIComponent((sym?'Simbolo: '+sym+'\n':'')+(name?'Nome: '+name:''))}`:null;
