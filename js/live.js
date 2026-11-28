// Aggiornamento "live" senza ricaricare la pagina.
//  1) live.json (branch `live`, aggiornato dal workflow veloce ogni 5 minuti): prezzi, notizie, calendario.
//  2) Cloudflare Worker (opzionale, WORKER_URL in config.js): prezzi ogni minuto di azioni, valute, future.
//  3) Coinbase (pubblico, CORS aperto): prezzi crypto ogni minuto, se non c'e' il Worker.
// Per provare in locale: http://localhost:8000/?live=data/live.json  (&worker=URL, &cb=1).
import {$, fHM, fmtWith, h, isN, safe} from './util.js';
import {BYSYM, D, M} from './state.js';
import {GH, WORKER_URL} from './config.js';
import {LITE} from './data.js';
import {renderPunto, renderMarkets, renderWatch, watch} from './markets.js';
import {renderNews} from './news.js';
import {renderCal} from './calendar.js';

const QS = new URLSearchParams(location.search);
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const LIVE_URL = LOCAL && QS.get('live') ? QS.get('live')
  : (GH ? `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/live/live.json` : null);
const WORKER = (LOCAL && QS.get('worker')) || WORKER_URL || '';
const CB_ON = !!GH || (LOCAL && QS.has('cb'));
const CB_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USD';
export const LIVE_ON = !!(LIVE_URL || WORKER || CB_ON);

// celle da evidenziare nel prossimo ridisegno
export const FLASH = new Set();
const liveQuotes = new WeakMap();
export const getLiveQuote = market => liveQuotes.get(market);
export const flashCls = m => FLASH.has(m.symbol) ? (m.change >= 0 ? ' flu' : ' fld') : '';

// dettaglio attualmente aperto (per aggiornare prezzo e ultima barra del grafico)
let cur = null;
export const getCurDetail = () => cur;
export const setCurDetail = x => { cur = x; };

/* ---------- applicazione delle quotazioni ---------- */
export function applyQuote(sym, p, c, pc, ts, fromPriceOnly) {
  const m = BYSYM[sym];
  if (!m) { const lr = LITE[sym]; if (lr && isN(p) && isN(pc)) { lr[3] = p; lr[4] = pc; } return false; }
  if (!isN(p)) return false;
  const t = ts ? ts * 1000 : Date.now();
  const mt = Date.parse(m.marketTime) || 0;
  if (t < mt - 300000) return false;                 // piu' vecchia di quella che la pagina mostra gia' (barre da 5 min)
  if (fromPriceOnly) {                               // es. Coinbase: solo prezzo, la variazione si calcola sulla chiusura precedente
    if (!isN(m.prevClose) || !m.prevClose) return false;
    c = p - m.prevClose; pc = (p / m.prevClose - 1) * 100;
  }
  if (!isN(c) || !isN(pc)) return false;
  const quote = liveQuotes.get(m);
  if (!quote || t >= quote.time) liveQuotes.set(m, { price: p, time: t });
  pc = Math.round(pc * 100) / 100;
  if (m.price === p && m.changePct === pc) return false;
  const old = m.price;
  m.price = p; m.change = c; m.changePct = pc;
  if (!fromPriceOnly) m.prevClose = p - c;
  m.marketTime = new Date(Math.max(t, mt)).toISOString();
  if (isN(m.dayHigh) && p > m.dayHigh) m.dayHigh = p;
  if (isN(m.dayLow) && p < m.dayLow) m.dayLow = p;
  if (Array.isArray(m.spark) && m.spark.length) m.spark[m.spark.length - 1] = p;
  if (old !== p) FLASH.add(sym);
  return true;
}

function applyQuotes(obj) {
  let ch = false;
  if (obj && typeof obj === 'object') {
    for (const [s, q] of Object.entries(obj)) {
      if (Array.isArray(q) && typeof q[0] === 'number' && applyQuote(s, q[0], q[1], q[2], q[3])) ch = true;
    }
  }
  return ch;
}

function mergeLive(j) {
  let ch = applyQuotes(j && j.quotes);
  if (j && Array.isArray(j.news) && j.news.length) {
    if (!Array.isArray(D.news)) D.news = [];
    const have = new Set(D.news.map(n => n.id));
    let add = 0;
    for (const n of j.news) if (n && n.id && n.title && !have.has(n.id)) { D.news.push(n); have.add(n.id); add++; }
    if (add) {
      D.news.sort((a, b) => String(b.published).localeCompare(String(a.published)));
      D.news.length = Math.min(D.news.length, 400);
      if (!$('#news').contains(document.activeElement)) safe($('#news'), renderNews);
    }
  }
  if (j && Array.isArray(j.calendar) && j.calendar.length && JSON.stringify(j.calendar) !== JSON.stringify(D.calendar)) {
    D.calendar = j.calendar;
    safe($('#cal'), renderCal);
    ch = true;       // il riepilogo "Il punto" cita il prossimo evento
  }
  return { ch, t: Date.parse(j && j.generatedAt) || 0 };
}

/* ---------- sorgenti ---------- */
async function fetchJSON(url, ms = 12000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: url === LIVE_URL ? 'no-cache' : 'default' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function pollWorker() {
  const syms = [...new Set([...watch, ...M.map(m => m.symbol)])].filter(s => /^[A-Za-z0-9.\-=^]{1,20}$/.test(s));
  const batches = [];
  for (let i = 0; i < syms.length; i += 20) batches.push(syms.slice(i, i + 20));
  const res = await Promise.allSettled(batches.map(b => fetchJSON(WORKER + (WORKER.includes('?') ? '&' : '?') + 'symbols=' + encodeURIComponent(b.join(',')))));
  let ok = false, ch = false;
  for (const r of res) if (r.status === 'fulfilled') { ok = true; if (applyQuotes(r.value && r.value.quotes)) ch = true; }
  if (!ok) throw new Error('worker non raggiungibile');
  return { ch, t: Date.now() };
}

async function pollCoinbase() {
  const j = await fetchJSON(CB_URL);
  const rates = j && j.data && j.data.rates;
  if (!rates) throw new Error('risposta Coinbase inattesa');
  let ch = false;
  for (const m of M) {
    if (m.group !== 'Crypto' || !/-USD$/.test(m.symbol)) continue;
    const r = parseFloat(rates[m.symbol.slice(0, -4)]);
    if (r > 0) {
      const p = 1 / r;
      const price = p >= 100 ? Math.round(p * 100) / 100 : Math.round(p * 1e4) / 1e4;
      if (applyQuote(m.symbol, price, null, null, 0, true)) ch = true;
    }
  }
  return { ch, t: Date.now() };
}

/* ---------- ridisegno ---------- */
function refreshUI() {
  const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('#mk tbody tr');
  const fi = row ? [...row.parentNode.children].indexOf(row) : -1;
  safe($('#punto'), renderPunto);
  safe($('#watch'), renderWatch);
  safe($('#mk'), renderMarkets);
  if (fi >= 0) { const r = $('#mk tbody') && $('#mk tbody').children[fi]; if (r) r.focus(); }
  if (cur) { try { cur.repaint(); } catch (e) { /* ignora */ } }
  FLASH.clear();
}

let shown = 0, timer = null, fails = 0, busy = false;
let nextPollAt = 0, countdown = null;

function paintLabel() {
  if (shown) $('#liveTs').textContent = ' · Prezzi aggiornati alle ' + fmtWith(fHM, shown);
}

function paintCountdown() {
  if (document.hidden) return;
  if (busy) {
    countdown.textContent = 'Controllo dei dati…';
    return;
  }
  const seconds = Math.max(0, Math.ceil((nextPollAt - performance.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  const label = fails ? 'Riprovo tra ' : 'Prossimo controllo tra ';
  countdown.textContent = label + minutes + ':' + remainder;
}

async function tick() {
  if (busy || document.hidden) return;
  clearTimeout(timer);
  busy = true;
  paintCountdown();
  let ok = false, ch = false, t = 0;
  const take = r => { ok = true; ch = ch || r.ch; t = Math.max(t, r.t); };
  try {
    if (LIVE_URL) { try { take(mergeLive(await fetchJSON(LIVE_URL))); } catch (e) { console.warn('live.json:', e.message); } }
    if (WORKER) { try { take(await pollWorker()); } catch (e) { console.warn('worker:', e.message); } }
    else if (CB_ON) { try { take(await pollCoinbase()); } catch (e) { console.warn('coinbase:', e.message); } }
    if (ok) {
      fails = 0;
      shown = Math.max(shown, t || Date.now());
      paintLabel();
      if (ch) refreshUI();
      cur?.updateQuote?.();
    } else {
      fails++;
    }
  } finally {
    busy = false;
    // Controllo ogni minuto, con attese di 2/4/5 minuti dopo errori consecutivi.
    schedule(Math.min(300000, 60000 * 2 ** Math.min(fails, 3)));
  }
}

function schedule(delay) {
  clearTimeout(timer);
  nextPollAt = performance.now() + delay;
  timer = setTimeout(tick, delay);
  paintCountdown();
}

export function startLive() {
  if (!LIVE_ON || countdown) return;
  countdown = h('span', { id: 'liveCountdown', class: 'pill', role: 'timer',
    title: 'Controllo automatico ogni minuto. I dati cambiano quando le fonti pubblicano nuove rilevazioni.' });
  $('#liveTs').after(countdown);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (performance.now() >= nextPollAt) tick();
    else paintCountdown();
  });
  schedule(1500);
  setInterval(paintCountdown, 1000);
}
