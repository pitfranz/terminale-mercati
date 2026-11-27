// Cloudflare Worker: proxy di sola lettura verso il solo endpoint "spark" di Yahoo Finance.
// Serve per avere prezzi ogni minuto di azioni, valute e future dalla pagina (il browser da solo non puo'
// interrogare Yahoo: manca il permesso CORS). Non accetta altro che ?symbols=A,B,C (max 20 simboli).
//
// Risposta: { generatedAt, quotes: { "AAPL": [prezzo, variazione, variazione%, timestampUnix], ... } }
// Cache: 60 secondi per combinazione di simboli (caches.default), cosi' molti visitatori = poche richieste a Yahoo.

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/spark';
const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,20}$/;
const MAX_SYMBOLS = 20;
const CACHE_SECONDS = 60;

const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const rnd = (v, nd) => { const f = 10 ** nd; return Math.round(v * f) / f; };
const rp = v => rnd(v, Math.abs(v) >= 100 ? 2 : 4);

// Stesso calcolo del collector Python (collector/collect.py, spark_quotes).
export function parseSpark(j, nowSec = Math.floor(Date.now() / 1000)) {
  const out = {};
  for (const [sym, v] of Object.entries(j || {})) {
    if (!v || typeof v !== 'object') continue;
    const close = Array.isArray(v.close) ? v.close : [];
    const ts = Array.isArray(v.timestamp) ? v.timestamp : [];
    let last = null;
    for (let i = Math.min(close.length, ts.length) - 1; i >= 0; i--) { if (num(close[i]) !== null) { last = i; break; } }
    let price = num(v.fulldayPrice);
    if (price === null && last !== null) price = close[last];
    const prev = num(v.previousClose) || num(v.chartPreviousClose);
    if (price === null || !prev) continue;
    out[sym] = [rp(price), rp(price - prev), rnd((price / prev - 1) * 100, 2), last !== null ? ts[last] : nowSec];
  }
  return out;
}

export function parseSymbols(searchParams) {
  const raw = searchParams.get('symbols') || '';
  const list = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
  if (!list.length || list.length > MAX_SYMBOLS || !list.every(s => SYMBOL_RE.test(s))) return null;
  return list.sort();
}

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': (env && env.ALLOWED_ORIGIN) || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra },
    });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'metodo non consentito' }, 405);

    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/spark') return json({ error: 'non trovato' }, 404);
    const symbols = parseSymbols(url.searchParams);
    if (!symbols) return json({ error: 'usa ?symbols=AAPL,GC=F (massimo 20 simboli, solo lettere, cifre e . - = ^)' }, 400);

    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const key = new Request('https://cache.terminale.invalid/spark?symbols=' + encodeURIComponent(symbols.join(',')));
    if (cache) {
      const hit = await cache.match(key);
      if (hit) return new Response(hit.body, { status: 200, headers: { ...Object.fromEntries(hit.headers), ...cors } });
    }

    let upstream;
    try {
      upstream = await fetch(YAHOO + '?symbols=' + encodeURIComponent(symbols.join(',')).replace(/%2C/g, ',') + '&range=1d&interval=5m',
        { headers: { 'User-Agent': 'Mozilla/5.0' } });
    } catch (e) {
      return json({ error: 'Yahoo non raggiungibile' }, 502);
    }
    if (!upstream.ok) return json({ error: 'Yahoo ha risposto ' + upstream.status }, 502);
    let quotes;
    try { quotes = parseSpark(await upstream.json()); } catch (e) { return json({ error: 'risposta inattesa' }, 502); }

    const res = json({ generatedAt: new Date().toISOString(), quotes }, 200, { 'Cache-Control': 'public, max-age=' + CACHE_SECONDS });
    if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};
