#!/usr/bin/env python3
"""Terminale economico - data collector (Python 3 stdlib only).

Usage: python3 collect.py --out <dir> [--previous <old data.json>]
Writes <dir>/data.json and <dir>/h/<file>.json (shapes: see SPEC.md).

Every source is wrapped in try/except; on failure the matching section of the
previous data.json is reused and flagged stale:true in `sources`.
"""
import argparse, csv, concurrent.futures as cf, datetime as dt, email.utils, hashlib, html
import bisect, calendar, io, json, math, os, re, sys, time, urllib.parse, urllib.request, urllib.error
import xml.etree.ElementTree as ET

# NOTE: Yahoo answers 429 to long browser UA strings from this proxy but accepts the bare "Mozilla/5.0".
UA = "Mozilla/5.0"
T0 = time.time()
MARKET_DEADLINE = 420  # seconds after start: stop retrying Yahoo calls
CONC = 6               # worker threads for Yahoo downloads
NOW = dt.datetime.now(dt.timezone.utc)


def iso(d):
    return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- write-only-if-changed + manifest
import hashlib
OUT_ROOT = None
CHANGED = []          # relative paths actually (re)written in this run


def _normalized(path, raw):
    """Bytes to compare: volatile timestamps are ignored so that an identical payload is not rewritten."""
    name = os.path.basename(path)
    if name in ("data.json", "live.json", "manifest.json"):
        try:
            o = json.loads(raw)
            o.pop("generatedAt", None)
            if name == "data.json":
                for v in (o.get("sources") or {}).values():
                    if isinstance(v, dict):
                        v.pop("at", None)
            return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        except Exception:
            return raw
    return raw


def write_if_changed(path, text):
    """Write `text` to `path` only if its (normalized) content differs from the file already there."""
    raw = text.encode("utf-8")
    try:
        with open(path, "rb") as f:
            old = f.read()
        if old == raw or _normalized(path, old) == _normalized(path, raw):
            return False
    except OSError:
        pass
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(raw)
    os.replace(tmp, path)
    CHANGED.append(os.path.relpath(path, OUT_ROOT) if OUT_ROOT else path)
    return True


def file_hash(path):
    with open(path, "rb") as f:
        return hashlib.sha1(_normalized(path, f.read())).hexdigest()[:16]


def build_manifest(out):
    files = {}
    for root, _, names in os.walk(out):
        for n in names:
            full = os.path.join(root, n)
            rel = os.path.relpath(full, out).replace(os.sep, "/")
            if rel == "manifest.json" or n.endswith(".tmp"):
                continue
            files[rel] = file_hash(full)
    h = hashlib.sha1("\n".join("%s:%s" % kv for kv in sorted(files.items())).encode()).hexdigest()
    return {"generatedAt": iso(NOW), "hash": h, "count": len(files), "files": files}


# ---------------------------------------------------------------- HTTP
def fetch(url, retries=5, timeout=30, headers=None, data=None, base_wait=2, max_wait=30, deadline=None):
    """GET/POST with exponential backoff on 429/5xx/network errors. Closes responses."""
    h = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    last = None
    for i in range(retries):
        if deadline and time.time() - T0 > deadline:
            raise RuntimeError("deadline reached")
        try:
            req = urllib.request.Request(url, headers=h, data=data)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            try:
                e.close()
            except Exception:
                pass
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(max_wait, base_wait * (2 ** i)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = e
            time.sleep(min(max_wait, base_wait * (2 ** i)))
    raise RuntimeError("failed after %d tries: %s" % (retries, last))


def fetch_json(url, **kw):
    return json.loads(fetch(url, **kw).decode("utf-8", "replace"))


# ---------------------------------------------------------------- universe
# (symbol, nome, gruppo, descrizione)
U = [
 ("^GSPC", "S&P 500", "Indici", "Le 500 maggiori aziende quotate negli Stati Uniti. E' il termometro più usato per capire come va la Borsa americana."),
 ("^NDX", "Nasdaq 100", "Indici", "Le 100 maggiori aziende non finanziarie del Nasdaq, soprattutto tecnologia (Apple, Microsoft, Nvidia). Tende a muoversi più dell'S&P 500."),
 ("^DJI", "Dow Jones", "Indici", "Indice storico di 30 grandi società industriali e finanziarie americane. Meno ampio dell'S&P 500 ma molto citato nei telegiornali."),
 ("^RUT", "Russell 2000", "Indici", "Mille e più piccole aziende americane: racconta lo stato di salute dell'economia interna degli USA più delle multinazionali."),
 ("FTSEMIB.MI", "FTSE MIB", "Indici", "I 40 titoli più grandi e scambiati di Piazza Affari a Milano: banche, energia, lusso, industria."),
 ("^STOXX50E", "Euro Stoxx 50", "Indici", "Le 50 maggiori aziende dell'area euro. Misura l'andamento complessivo delle grandi imprese europee."),
 ("^GDAXI", "DAX", "Indici", "I 40 principali titoli della Borsa di Francoforte: è l'indice di riferimento dell'economia tedesca."),
 ("^FCHI", "CAC 40", "Indici", "I 40 maggiori titoli della Borsa di Parigi, con forte presenza di lusso e grande industria."),
 ("^FTSE", "FTSE 100", "Indici", "Le 100 maggiori società quotate a Londra, in gran parte petrolio, banche e beni di consumo con ricavi internazionali."),
 ("^N225", "Nikkei 225", "Indici", "Il principale indice della Borsa di Tokyo, composto da 225 grandi aziende giapponesi."),
 ("^HSI", "Hang Seng", "Indici", "L'indice della Borsa di Hong Kong: un buon indicatore dell'umore degli investitori sulla Cina."),
 ("^VIX", "VIX (indice della paura)", "Indici", "Misura quanta volatilità si aspettano gli investitori sull'S&P 500 nel prossimo mese. Sopra 30 c'è nervosismo, sotto 15 calma."),
 ("GC=F", "Oro", "Materie prime", "Il classico bene rifugio: tende a salire quando c'è incertezza, inflazione o i tassi calano. Prezzo in dollari per oncia."),
 ("SI=F", "Argento", "Materie prime", "Metallo prezioso ma anche industriale (elettronica, pannelli solari): si muove come l'oro ma con oscillazioni più ampie."),
 ("CL=F", "Petrolio WTI", "Materie prime", "Il petrolio di riferimento americano. Influenza il prezzo di benzina e bollette e quindi l'inflazione."),
 ("BZ=F", "Petrolio Brent", "Materie prime", "Il petrolio di riferimento per l'Europa e il resto del mondo. Il suo prezzo si riflette sui carburanti alla pompa."),
 ("NG=F", "Gas naturale USA", "Materie prime", "Prezzo del gas negli Stati Uniti (Henry Hub). Conta per l'energia americana e, indirettamente, per i mercati globali del gas."),
 ("HG=F", "Rame", "Materie prime", "Detto 'dottor rame' perché la sua domanda anticipa lo stato dell'industria e dell'edilizia mondiali, Cina in testa."),
 ("EURUSD=X", "EUR/USD", "Valute", "Quanti dollari servono per un euro. Se sale l'euro si rafforza: viaggiare e importare dagli USA costa meno."),
 ("GBPUSD=X", "GBP/USD", "Valute", "Quanti dollari servono per una sterlina britannica."),
 ("USDJPY=X", "USD/JPY", "Valute", "Quanti yen servono per un dollaro. Lo yen è considerato una valuta rifugio e risente molto dei tassi della Banca del Giappone."),
 ("EURGBP=X", "EUR/GBP", "Valute", "Quante sterline servono per un euro: il cambio tra le due principali valute europee."),
 ("EURCHF=X", "EUR/CHF", "Valute", "Quanti franchi svizzeri servono per un euro. Il franco è un'altra valuta rifugio."),
 ("DX-Y.NYB", "Indice dollaro", "Valute", "Il valore del dollaro rispetto a un paniere di sei valute principali (euro in testa). Sale quando il dollaro si rafforza."),
 ("^IRX", "T-Bill USA 3 mesi", "Tassi", "Rendimento dei titoli di stato americani a 3 mesi: segue da vicino i tassi della banca centrale USA (Fed)."),
 ("^FVX", "Treasury USA 5 anni", "Tassi", "Rendimento del titolo di stato americano a 5 anni, in percentuale annua."),
 ("^TNX", "Treasury USA 10 anni", "Tassi", "Il tasso di riferimento mondiale: da lui dipendono mutui, prestiti e valutazioni delle azioni. Se sale, il denaro costa di più."),
 ("^TYX", "Treasury USA 30 anni", "Tassi", "Rendimento del titolo di stato americano a 30 anni: riflette le attese di lungo periodo su inflazione e debito."),
 ("BTC-USD", "Bitcoin", "Crypto", "La più grande criptovaluta per valore di mercato. Molto volatile, scambiata 24 ore su 24."),
 ("ETH-USD", "Ethereum", "Crypto", "La seconda criptovaluta per valore, base di moltissime applicazioni e contratti 'smart' sulla blockchain."),
 ("AAPL", "Apple", "Azioni USA", "iPhone, Mac e servizi digitali: una delle aziende più grandi al mondo per valore in Borsa."),
 ("MSFT", "Microsoft", "Azioni USA", "Windows, Office, cloud Azure e investimenti nell'intelligenza artificiale (OpenAI)."),
 ("NVDA", "Nvidia", "Azioni USA", "Produce i chip più usati per l'intelligenza artificiale: il suo titolo è un simbolo del boom dell'AI."),
 ("AMZN", "Amazon", "Azioni USA", "E-commerce e cloud (AWS): una delle maggiori aziende del mondo per ricavi."),
 ("GOOGL", "Alphabet (Google)", "Azioni USA", "La società di Google, YouTube e Android; vive soprattutto di pubblicità online e cloud."),
 ("META", "Meta", "Azioni USA", "La società di Facebook, Instagram e WhatsApp; guadagna soprattutto con la pubblicità."),
 ("TSLA", "Tesla", "Azioni USA", "Auto elettriche, batterie e guida autonoma. Titolo molto seguito e molto volatile."),
 ("ENI.MI", "Eni", "Azioni Italia", "Il gruppo energetico italiano: petrolio, gas e rinnovabili. Dà buoni dividendi e segue il prezzo del petrolio."),
 ("ISP.MI", "Intesa Sanpaolo", "Azioni Italia", "La maggiore banca italiana per dimensioni. Beneficia di tassi più alti e distribuisce ricchi dividendi."),
 ("UCG.MI", "UniCredit", "Azioni Italia", "Grande banca italiana con forte presenza anche in Germania e nell'Europa centro-orientale."),
 ("ENEL.MI", "Enel", "Azioni Italia", "Il principale gruppo elettrico italiano, tra i maggiori al mondo nelle energie rinnovabili."),
 ("RACE.MI", "Ferrari", "Azioni Italia", "La casa di Maranello: auto di lusso in quantità limitata, molto apprezzata dagli investitori."),
 ("STLAM.MI", "Stellantis", "Azioni Italia", "Gruppo automobilistico nato da Fiat Chrysler e PSA (Peugeot): Fiat, Jeep, Peugeot, Opel e altri marchi."),
]
GROUP_ORDER = {g: i for i, g in enumerate(["Indici", "Materie prime", "Valute", "Tassi", "Crypto", "Azioni USA", "Azioni Italia"])}

# ---- v2: universe extensions (core tier) -------------------------------------------------------
GROUP_ORDER = {g: i for i, g in enumerate(["Indici", "Materie prime", "Valute", "Tassi", "Crypto", "Azioni USA",
                                            "Azioni Italia", "Future", "Settori"])}
CCY = {"USD": ("dollaro USA", "dollari USA"), "EUR": ("euro", "euro"), "GBP": ("sterlina", "sterline"),
       "JPY": ("yen", "yen"), "AUD": ("dollaro australiano", "dollari australiani"),
       "NZD": ("dollaro neozelandese", "dollari neozelandesi"), "CAD": ("dollaro canadese", "dollari canadesi"),
       "CHF": ("franco svizzero", "franchi svizzeri"), "CNH": ("yuan cinese", "yuan cinesi"),
       "MXN": ("peso messicano", "pesos messicani"), "TRY": ("lira turca", "lire turche"),
       "ZAR": ("rand sudafricano", "rand sudafricani"), "SEK": ("corona svedese", "corone svedesi"),
       "NOK": ("corona norvegese", "corone norvegesi"), "PLN": ("zloty polacco", "zloty polacchi")}
EMERGING = {"CNH", "MXN", "TRY", "ZAR", "PLN"}
FX_PAIRS = ["AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "CHFJPY", "EURAUD",
            "EURCAD", "EURNZD", "GBPCHF", "GBPAUD", "AUDNZD", "USDCNH", "USDMXN", "USDTRY", "USDZAR", "USDSEK",
            "USDNOK", "USDPLN"]


def fx_row(p):
    b, q = p[:3], p[3:]
    d = "Quanti %s servono per un %s. Se sale, %s si rafforza rispetto a %s." % (
        CCY[q][1], CCY[b][0], CCY[b][0], CCY[q][1])
    if b in EMERGING or q in EMERGING:
        d += " Coinvolge una valuta emergente: movimenti spesso più ampi e rapidi."
    if p == "USDCNH":   # Yahoo has no history for USDCNH=X / CNH=X: use onshore USD/CNY (CNY=X)
        return ("CNY=X", "USD/CNY", "Valute", d.replace(CCY["CNH"][1], "yuan cinesi"))
    return (p + "=X", "%s/%s" % (b, q), "Valute", d)


U += [fx_row(p) for p in FX_PAIRS]
U += [
 ("ES=F", "S&P 500 e-mini (future)", "Future", "Contratto future sull'S&P 500: si scambia quasi 24 ore su 24 e anticipa l'apertura della Borsa USA."),
 ("NQ=F", "Nasdaq 100 e-mini (future)", "Future", "Contratto future sul Nasdaq 100, molto seguito per capire l'umore sulla tecnologia prima dell'apertura."),
 ("YM=F", "Dow Jones e-mini (future)", "Future", "Contratto future sul Dow Jones Industrial Average."),
 ("RTY=F", "Russell 2000 e-mini (future)", "Future", "Contratto future sulle piccole aziende americane (Russell 2000)."),
 ("ZN=F", "T-Note 10 anni (future)", "Future", "Future sul titolo di stato USA a 10 anni. Il prezzo sale quando i rendimenti scendono, e viceversa."),
 ("ZB=F", "T-Bond 30 anni (future)", "Future", "Future sul titolo di stato USA a 30 anni: molto sensibile alle attese su tassi e inflazione."),
 ("PL=F", "Platino", "Future", "Metallo prezioso usato in gioielleria e nell'industria automobilistica (marmitte catalitiche)."),
 ("PA=F", "Palladio", "Future", "Metallo prezioso usato soprattutto nei catalizzatori delle auto a benzina."),
 ("ZC=F", "Mais", "Future", "Prezzo del mais, base di alimentazione animale e biocarburanti. Dipende da meteo e raccolti."),
 ("ZW=F", "Grano", "Future", "Prezzo del grano tenero: influenza pane e pasta ed è sensibile a meteo e tensioni geopolitiche."),
 ("ZS=F", "Soia", "Future", "Prezzo della soia, usata per mangimi e oli vegetali; la Cina è il maggior acquirente."),
 ("KC=F", "Caffè", "Future", "Prezzo del caffè arabica: dipende dai raccolti in Brasile e da clima e valute."),
 ("CC=F", "Cacao", "Future", "Prezzo del cacao, materia prima del cioccolato; concentrato in pochi paesi africani."),
 ("SB=F", "Zucchero", "Future", "Prezzo dello zucchero grezzo, legato a raccolti (Brasile, India) e al prezzo del petrolio (etanolo)."),
 ("BTC=F", "Bitcoin CME (future)", "Future", "Contratto future sul Bitcoin quotato al CME di Chicago, usato soprattutto da investitori istituzionali."),
 ("XLK", "Tecnologia", "Settori", "ETF sul settore tecnologico dell'S&P 500 (Apple, Microsoft, Nvidia)."),
 ("XLF", "Finanza", "Settori", "ETF sul settore finanziario dell'S&P 500: banche, assicurazioni, società di investimento."),
 ("XLE", "Energia", "Settori", "ETF sul settore energetico dell'S&P 500: petrolio e gas."),
 ("XLV", "Sanità", "Settori", "ETF sul settore sanitario dell'S&P 500: farmaceutica, biotech, ospedali."),
 ("XLY", "Consumi discrezionali", "Settori", "ETF sui beni non essenziali: auto, e-commerce, lusso, viaggi. Va bene quando la gente spende."),
 ("XLP", "Consumi di base", "Settori", "ETF sui beni di prima necessità (alimentari, igiene): settore difensivo."),
 ("XLI", "Industria", "Settori", "ETF sul settore industriale dell'S&P 500: aerospazio, macchinari, trasporti."),
 ("XLB", "Materiali", "Settori", "ETF sulle aziende di materiali di base: chimica, metalli, minerario."),
 ("XLU", "Servizi di pubblica utilità", "Settori", "ETF su elettricità, gas e acqua: settore difensivo che paga dividendi."),
 ("XLRE", "Immobiliare", "Settori", "ETF sulle società immobiliari quotate, sensibili ai tassi d'interesse."),
 ("XLC", "Comunicazione", "Settori", "ETF su media e telecomunicazioni (Alphabet, Meta, Netflix)."),
 ("SPY", "S&P 500 (ETF SPY)", "Settori", "L'ETF più scambiato al mondo: replica l'S&P 500."),
 ("QQQ", "Nasdaq 100 (ETF QQQ)", "Settori", "ETF che replica il Nasdaq 100, a forte componente tecnologica."),
 ("GLD", "Oro (ETF GLD)", "Settori", "ETF che replica il prezzo dell'oro fisico."),
 ("TLT", "Treasury 20+ anni (ETF TLT)", "Settori", "ETF sui titoli di stato USA a lunga scadenza: sale quando i tassi scendono."),
]
SECTOR_SYMS = ["XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC"]
CRYPTO_FALLBACK = [("BTC", "Bitcoin"), ("ETH", "Ethereum"), ("XRP", "XRP"), ("BNB", "BNB"), ("SOL", "Solana"),
                   ("DOGE", "Dogecoin"), ("ADA", "Cardano"), ("TRX", "TRON"), ("LINK", "Chainlink"),
                   ("AVAX", "Avalanche"), ("XLM", "Stellar"), ("SUI", "Sui"), ("BCH", "Bitcoin Cash"),
                   ("HBAR", "Hedera"), ("LTC", "Litecoin"), ("DOT", "Polkadot"), ("SHIB", "Shiba Inu"),
                   ("TON", "Toncoin"), ("UNI", "Uniswap"), ("NEAR", "NEAR Protocol")]
STABLE = {"usdt", "usdc", "dai", "usde", "fdusd", "tusd", "usds", "usdd", "pyusd", "usdy", "usdtb", "susds", "susde",
          "gusd", "busd", "frax", "lusd", "usd0", "usd1", "rlusd", "eurc", "usdg", "bfusd", "usdf", "ustb", "buidl"}


def file_of(sym):
    return re.sub(r"[^A-Za-z0-9]", "_", sym)


# ---------------------------------------------------------------- helpers
def num(x):
    return x if isinstance(x, (int, float)) and x == x else None


def rp(v, nd=None):
    """Round price: >=100 -> 2 decimals, else 4 (FX-friendly)."""
    if v is None:
        return None
    if nd is None:
        nd = 2 if abs(v) >= 100 else 4
    r = round(v, nd)
    return int(r) if r == int(r) and abs(r) < 1e15 and nd == 0 else r


def pct(a, b):
    if a is None or b in (None, 0):
        return None
    return round((a / b - 1) * 100, 2)


# ---------------------------------------------------------------- markets
def yahoo_chart(sym, rng, interval):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=%s" % (
        urllib.parse.quote(sym, safe=""), rng, interval)
    j = fetch_json(url, deadline=MARKET_DEADLINE)
    res = (j.get("chart") or {}).get("result")
    if not res:
        raise RuntimeError("no result: %s" % ((j.get("chart") or {}).get("error")))
    return res[0]


def bars(res):
    ts = res.get("timestamp") or []
    q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    o, h, l, c, v = (q.get(k) or [] for k in ("open", "high", "low", "close", "volume"))
    out = []
    for i, t in enumerate(ts):
        cl = c[i] if i < len(c) else None
        if cl is None:   # drop null bars
            continue
        g = lambda arr: arr[i] if i < len(arr) else None
        out.append([t, g(o), g(h), g(l), cl, g(v)])
    return out


def rs(v):
    """Round an indicator value to a sensible precision."""
    if v is None:
        return None
    a = abs(v)
    return round(v, 2 if a >= 100 else 3 if a >= 1 else 5)


# ---- technical indicators ---------------------------------------------------------------------
def sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def ema_series(vals, n):
    k = 2.0 / (n + 1)
    e = vals[0]
    out = [e]
    for v in vals[1:]:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def rsi_calc(closes, n=14):
    if len(closes) < n + 1:
        return None
    g = l = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        g += max(d, 0); l += max(-d, 0)
    g /= n; l /= n
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        l = (l * (n - 1) + max(-d, 0)) / n
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def macd_hist(closes):
    if len(closes) < 35:
        return None
    line = [a - b for a, b in zip(ema_series(closes, 12), ema_series(closes, 26))]
    sig = ema_series(line, 9)
    return line[-1] - sig[-1]


def atr_calc(h, l, c, n=14):
    if len(c) < n + 1:
        return None
    tr = [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, len(c))]
    a = sum(tr[:n]) / n
    for x in tr[n:]:
        a = (a * (n - 1) + x) / n
    return a


def clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def bias_calc(closes, unit):
    """Bias score -100..100 = weighted sum of 8 signals, each in [-1, +1] times its weight:
         price vs SMA20 (10), vs SMA50 (15), vs SMA200 (20), SMA50 vs SMA200 (15),
         slope of SMA50 over 10 bars (10, saturates at +-3%), RSI14 (15, (RSI-50)/25),
         MACD histogram sign (10), 20-bar momentum (5, saturates at +-10%).
       Signals that cannot be computed (not enough bars) are dropped and the score is rescaled on the
       remaining weights. Labels: >=50 strong bullish, >=15 bullish, <=-15 bearish, <=-50 strong bearish.
       `unit` = 'giorni' or 'settimane' (used in the Italian reasons)."""
    n = len(closes)
    if n < 25:
        return None
    p = closes[-1]
    comps = []   # (weight, value, reason)
    for w, k in ((10, 20), (15, 50), (20, 200)):
        m = sma(closes, k)
        if m:
            up = p > m
            txt = "Prezzo %s la media a %d %s" % ("sopra" if up else "sotto", k, unit)
            if k == 200:
                txt += (": trend di lungo periodo positivo" if up else ": trend di lungo periodo debole")
            comps.append((w, 1.0 if up else -1.0, txt))
    s50, s200 = sma(closes, 50), sma(closes, 200)
    if s50 and s200:
        up = s50 > s200
        comps.append((15, 1.0 if up else -1.0, "La media a 50 è %s quella a 200: il trend di fondo è %s" % (
            "sopra" if up else "sotto", "positivo" if up else "negativo")))
    if n >= 60:
        s50_old = sum(closes[-60:-10]) / 50
        if s50:
            sl = (s50 / s50_old - 1) * 100
            comps.append((10, clamp(sl / 3), "La media a 50 %s sta %s (%+.1f%% in 10 %s)" % (
                unit, "salendo" if sl >= 0 else "scendendo", sl, unit)))
    r = rsi_calc(closes)
    if r is not None:
        if r >= 70:
            t = "RSI %.0f: molto forte, ma in zona di ipercomprato (possibile pausa)" % r
        elif r <= 30:
            t = "RSI %.0f: molto debole, ma in zona di ipervenduto (possibile rimbalzo)" % r
        else:
            t = "RSI %.0f: slancio %s" % (r, "positivo" if r >= 55 else "negativo" if r <= 45 else "neutro")
        comps.append((15, clamp((r - 50) / 25), t))
    mh = macd_hist(closes)
    if mh is not None:
        comps.append((10, 1.0 if mh > 0 else -1.0, "Indicatore MACD %s: la spinta recente è %s" % (
            "positivo" if mh > 0 else "negativo", "al rialzo" if mh > 0 else "al ribasso")))
    if n > 21:
        mom = (p / closes[-21] - 1) * 100
        comps.append((5, clamp(mom / 10), "Negli ultimi 20 %s il prezzo è %s del %.1f%%" % (
            unit, "salito" if mom >= 0 else "sceso", abs(mom))))
    wsum = sum(c[0] for c in comps)
    if not wsum:
        return None
    score = round(sum(w * v for w, v, _ in comps) / wsum * 100)
    label = ("Rialzista forte" if score >= 50 else "Rialzista" if score >= 15 else
             "Ribassista forte" if score <= -50 else "Ribassista" if score <= -15 else "Neutrale")
    top = sorted(comps, key=lambda c: -abs(c[0] * c[1]))[:5]
    return {"score": score, "label": label, "reasons": [c[2] for c in top]}


def weekly_bars(daily, gmt=0):
    """Aggregate daily bars [t,o,h,l,c,v] into ISO-week bars."""
    out, key = [], None
    for b in daily:
        d = dt.datetime.fromtimestamp(b[0] + gmt, dt.timezone.utc).isocalendar()
        k = (d[0], d[1])
        h = b[2] if b[2] is not None else b[4]
        l = b[3] if b[3] is not None else b[4]
        o = b[1] if b[1] is not None else b[4]
        if k != key:
            out.append([b[0], o, h, l, b[4], b[5] or 0]); key = k
        else:
            w = out[-1]
            w[2] = max(w[2], h); w[3] = min(w[3], l); w[4] = b[4]; w[5] += b[5] or 0
    return out


def pivots(h, l, c):
    P = (h + l + c) / 3
    return {"P": rp(P), "R1": rp(2 * P - l), "R2": rp(P + (h - l)), "S1": rp(2 * P - h), "S2": rp(P - (h - l))}


def swing_levels(daily, price, look=120, k=3):
    seg = daily[-look:]
    H = [b[2] if b[2] is not None else b[4] for b in seg]
    L = [b[3] if b[3] is not None else b[4] for b in seg]
    hi, lo = [], []
    for i in range(k, len(seg) - k):
        if H[i] == max(H[i - k:i + k + 1]):
            hi.append(H[i])
        if L[i] == min(L[i - k:i + k + 1]):
            lo.append(L[i])

    def pick(vals, rev):
        out = []
        for v in sorted(vals, reverse=rev):
            if all(abs(v / o - 1) > 0.006 for o in out):
                out.append(v)
            if len(out) == 3:
                break
        return [rp(v) for v in out]
    return (pick([v for v in lo if v < price], True), pick([v for v in hi if v > price], False)[:3])


def tech_core(daily, price, today_bar, high52, low52):
    closes = [b[4] for b in daily]
    H = [b[2] if b[2] is not None else b[4] for b in daily]
    L = [b[3] if b[3] is not None else b[4] for b in daily]
    a = atr_calc(H, L, closes)
    s200 = sma(closes, 200)
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(len(closes) - 20, len(closes))
            if closes[i - 1] > 0 and closes[i] > 0]
    vol = None
    if len(rets) >= 15:
        mu = sum(rets) / len(rets)
        vol = math.sqrt(sum((r - mu) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(252) * 100
    wk = weekly_bars(daily)
    bd = bias_calc(closes, "giorni")
    bw = bias_calc([w[4] for w in wk], "settimane")
    pd = daily[-2] if today_bar and len(daily) > 1 else daily[-1]
    pw = wk[-2] if len(wk) > 1 else wk[-1]
    sup, res = swing_levels(daily, price)
    t = {"sma20": rs(sma(closes, 20)), "sma50": rs(sma(closes, 50)), "sma200": rs(s200),
         "rsi14": round(rsi_calc(closes), 1) if rsi_calc(closes) is not None else None,
         "macdHist": rs(macd_hist(closes)), "atr14": rs(a),
         "atrPct": round(a / price * 100, 2) if a and price else None,
         "vol20": round(vol, 1) if vol is not None else None,
         "pos52": round((price - low52) / (high52 - low52), 3) if high52 and low52 and high52 > low52 else None,
         "distSma200Pct": round((price / s200 - 1) * 100, 2) if s200 else None,
         "bias": {"daily": bd, "weekly": bw},
         "levels": {"pivotD": pivots(pd[2] if pd[2] is not None else pd[4], pd[3] if pd[3] is not None else pd[4], pd[4]),
                    "pivotW": pivots(pw[2], pw[3], pw[4]),
                    "prevDay": {"h": rp(pd[2] if pd[2] is not None else pd[4]), "l": rp(pd[3] if pd[3] is not None else pd[4])},
                    "prevWeek": {"h": rp(pw[2]), "l": rp(pw[3])},
                    "supports": sup, "resistances": res},
         "expectedRange": {"low": rp(price - a) if a else None, "high": rp(price + a) if a else None}}
    return t


# ---- quotes -----------------------------------------------------------------------------------
def minus_month(d0):
    y, m = d0.year, d0.month - 1
    if m == 0:
        y, m = y - 1, 12
    return dt.date(y, m, min(d0.day, calendar.monthrange(y, m)[1]))


def quote_stats(meta, daily, intr=None):
    """Price, prevClose, changes etc. from Yahoo meta + daily bars (see prevClose note below)."""
    gmt = meta.get("gmtoffset") or 0
    ldate = lambda t: (t + gmt) // 86400
    closes = [b[4] for b in daily]
    price = num(meta.get("regularMarketPrice"))
    if price is None:
        price = closes[-1]
    mtime = meta.get("regularMarketTime") or daily[-1][0]
    # prevClose logic (range=5y: meta.chartPreviousClose is the close BEFORE the range start -> useless).
    # Verified against raw Yahoo: meta.regularMarketChangePercent is the true session change (fulldayChange is NOT:
    # for stocks it includes extended hours). Futures/rates also have holiday-session quirks missing from the daily
    # bars (e.g. GC=F has no bar for Thanksgiving) so Yahoo's figure beats naive bars.
    #  1) prev = price / (1 + regularMarketChangePercent/100); snap to a recent daily close if within 0.05%
    #     (removes rounding noise of the rounded percent);
    #  2) else from bars: if the last daily bar is today's session (same exchange-local date as regularMarketTime)
    #     prev = closes[-2]; else the last bar is the previous close -> meta.previousClose or closes[-1].
    today_bar = ldate(daily[-1][0]) == ldate(mtime)
    fp = num(meta.get("regularMarketChangePercent"))
    if fp is not None and fp > -99:
        prev = price / (1 + fp / 100)
        snap = min(closes[-5:], key=lambda c: abs(c - prev))
        if prev and abs(snap - prev) / abs(prev) < 0.0005:
            prev = snap
    elif today_bar and len(closes) > 1:
        prev = closes[-2]
    else:
        prev = num(meta.get("previousClose")) or closes[-1]
    dh, dl = num(meta.get("regularMarketDayHigh")), num(meta.get("regularMarketDayLow"))
    if (dh is None or dl is None) and intr:
        last_day = ldate(intr[-1][0])
        hs = [b[2] for b in intr if ldate(b[0]) == last_day and b[2] is not None]
        ls = [b[3] for b in intr if ldate(b[0]) == last_day and b[3] is not None]
        if hs and ls:
            dh, dl = max(hs), min(ls)
    last252 = daily[-252:]
    hi = [b[2] if b[2] is not None else b[4] for b in last252] + [price]
    lo = [b[3] if b[3] is not None else b[4] for b in last252] + [price]
    # period changes: reference = last close on/before the target date among FINISHED sessions
    ref = daily[:-1] if today_bar else daily
    pdate = dt.datetime.fromtimestamp(mtime + gmt, dt.timezone.utc).date()

    def ref_close(target):
        tt = dt.datetime(target.year, target.month, target.day, tzinfo=dt.timezone.utc).timestamp()
        cand = [b[4] for b in ref if (b[0] + gmt) <= tt + 86399]
        return cand[-1] if cand else None
    try:
        y1 = pdate.replace(year=pdate.year - 1)
    except ValueError:
        y1 = pdate.replace(year=pdate.year - 1, day=28)
    return {"price": price, "prev": prev, "today_bar": today_bar, "mtime": mtime, "gmt": gmt,
            "dh": dh, "dl": dl, "hi52": max(hi), "lo52": min(lo),
            "chg1w": pct(price, ref_close(pdate - dt.timedelta(days=7))),
            "chg1m": pct(price, ref_close(minus_month(pdate))),
            "chgYtd": pct(price, ref_close(dt.date(pdate.year - 1, 12, 31))),
            "chg1y": pct(price, ref_close(y1) or (ref[0][4] if ref and abs(ref[0][0] + gmt - dt.datetime(
                y1.year, y1.month, y1.day, tzinfo=dt.timezone.utc).timestamp()) < 8 * 86400 else None))}


CORE_DAILY = {}   # symbol -> (daily bars, gmt) of this run (used by the analysis sections)


def build_market(sym, name, group, desc, check=None):
    d = yahoo_chart(sym, "5y", "1d")
    meta = d.get("meta") or {}
    daily = bars(d)
    if len(daily) < 2:
        raise RuntimeError("too few daily bars")
    try:
        intr = bars(yahoo_chart(sym, "5d", "30m"))
    except Exception as e:  # intraday is optional
        log("  intraday fail", sym, e)
        intr = []
    st = quote_stats(meta, daily, intr)
    price, prev = st["price"], st["prev"]
    if check and abs(price / check - 1) > 0.3:
        raise RuntimeError("price mismatch vs reference (%s vs %s)" % (price, check))
    m = {
        "symbol": sym, "file": file_of(sym), "name": name, "group": group,
        "currency": meta.get("currency") or "USD",
        "price": rp(price), "prevClose": rp(prev), "change": rp(price - prev), "changePct": pct(price, prev),
        "dayHigh": rp(st["dh"]), "dayLow": rp(st["dl"]), "high52": rp(st["hi52"]), "low52": rp(st["lo52"]),
        "chg1w": st["chg1w"], "chg1m": st["chg1m"], "chgYtd": st["chgYtd"], "chg1y": st["chg1y"],
        "marketTime": iso(dt.datetime.fromtimestamp(st["mtime"], dt.timezone.utc)),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName") or "",
        "spark": [rp(c) for c in [b[4] for b in daily][-30:]],
        "desc": desc,
    }
    try:
        m["tech"] = tech_core(daily, price, st["today_bar"], st["hi52"], st["lo52"])
    except Exception as e:
        log("  tech fail", sym, e)
    hist = {
        "symbol": sym,
        "daily": [[b[0]] + [rp(x) for x in b[1:5]] + [int(b[5]) if b[5] is not None else None] for b in daily],
        "intraday": [[b[0]] + [rp(x) for x in b[1:5]] + [int(b[5]) if b[5] is not None else None] for b in intr],
    }
    return m, hist, daily, st["gmt"]


def crypto_universe():
    """Top-20 crypto by market cap from CoinGecko (no stablecoins/wrapped/staked) -> Yahoo '<SYM>-USD'.
    Returns (candidates, top250, ok). candidates: [(sym, name, rank, cg_price)] over-sampled (Yahoo may lack some)."""
    try:
        j = fetch_json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc"
                       "&per_page=250&page=1", retries=3, timeout=40)
        top = [(c["symbol"].upper(), c["name"], c.get("market_cap_rank"), c.get("current_price"), c["id"]) for c in j]
        cands = []
        for sym, name, rank, price, cid in top:
            low = (sym.lower(), name.lower(), cid.lower())
            if sym.lower() in STABLE or re.search(r"wrapped|staked|bridged|\busd|usd\b|\bw?steth|restaked|tether gold|liquid", name.lower()):
                continue
            if cid.lower().startswith(("wrapped", "staked", "bridged", "coinbase-wrapped", "binance-peg")):
                continue
            if price and 0.97 < price < 1.03 and "usd" in name.lower():
                continue
            cands.append((sym, name, rank, price))
        return cands[:32], top, True
    except Exception as e:
        log("  coingecko fail", e)
        return [(s, n, i + 1, None) for i, (s, n) in enumerate(CRYPTO_FALLBACK)], [], False


def collect_markets(outdir, prev):
    prev_m = {m["symbol"]: m for m in (prev.get("markets") or [])}
    core_dir = os.path.join(outdir, "h")
    os.makedirs(core_dir, exist_ok=True)
    cands, top250, cg_ok = crypto_universe()
    jobs = [(s, n, g, d, None) for s, n, g, d in U]
    have = {s for s, *_ in U}
    for sym, name, rank, price in cands:
        ys = sym + "-USD"
        if ys in have:
            continue
        jobs.append((ys, name, "Crypto", "Criptovaluta tra le maggiori per valore di mercato (n. %s al mondo). "
                     "Prezzo molto volatile, scambiato 24 ore su 24." % (rank or "?"), price))
    results = {}

    def work(j):
        sym, name, group, desc, check = j
        try:
            return sym, build_market(sym, name, group, desc, check), None
        except Exception as e:
            return sym, None, str(e)
    failed = []
    with cf.ThreadPoolExecutor(max_workers=CONC) as ex:
        for sym, r, err in ex.map(work, jobs):
            if r:
                results[sym] = r
            else:
                failed.append((sym, err))
                log("  market fail", sym, err)
    # pick top-20 crypto (rank order) that succeeded; BTC/ETH come from U
    crypto_keep = []
    for sym, name, rank, price in cands:
        ys = sym + "-USD"
        if ys in results and len(crypto_keep) < 20:
            crypto_keep.append(ys)
    out, written = [], set()
    for sym, name, group, desc, check in jobs:
        if group == "Crypto" and sym not in crypto_keep and sym not in {s for s, _, g, _ in U}:
            continue   # over-sampled candidate beyond the top 20
        if sym in results:
            m, h, daily, gmt = results[sym]
            write_if_changed(os.path.join(core_dir, m["file"] + ".json"), json.dumps(h, separators=(",", ":")))
            written.add(m["file"] + ".json")
            CORE_DAILY[sym] = (daily, gmt)
            out.append(m)
        elif sym in prev_m:
            out.append(prev_m[sym])
            written.add(prev_m[sym]["file"] + ".json")
    # remove history files that are no longer in core
    for fn in os.listdir(core_dir):
        if fn not in written:
            try:
                os.remove(os.path.join(core_dir, fn))
            except OSError:
                pass
    real_failed = [(s, e) for s, e in failed if not (s.endswith("-USD") and s not in crypto_keep and s not in {x[0] for x in U})]
    stale = [s for s, _ in real_failed]
    src = {"ok": not real_failed, "at": iso(NOW),
           "error": ("%d/%d failed: %s" % (len(real_failed), len(jobs), ", ".join(stale))) if real_failed else None,
           "stale": bool(stale)}
    return out, src, top250, cg_ok


# ---------------------------------------------------------------- news
TAG = re.compile(r"<[^>]+>")


def clean(s, n=300):
    s = html.unescape(TAG.sub(" ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def parse_date(s):
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except Exception:
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d


def parse_feed(raw):
    root = ET.fromstring(raw)
    items = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        g = {}
        for ch in it:
            t = ch.tag.split("}")[-1]
            if t == "link":
                g.setdefault("link", (ch.text or ch.attrib.get("href") or "").strip())
            else:
                g.setdefault(t, (ch.text or "").strip())
        d = parse_date(g.get("pubDate") or g.get("published") or g.get("updated") or g.get("date"))
        items.append({"title": clean(g.get("title"), 300), "link": g.get("link", ""),
                      "published": d, "summary": clean(g.get("description") or g.get("summary") or "")})
    return items


SYMS = {s for s, *_ in U}
# (key, url, source label, category, lang, symbols)
def feed_list():
    f = []
    for s in ["^GSPC", "^NDX", "GC=F", "CL=F", "EURUSD=X", "BTC-USD", "AAPL", "NVDA", "MSFT", "TSLA", "ISP.MI"]:
        f.append(("yf:" + s, "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%s&region=US&lang=en-US" % urllib.parse.quote(s),
                  "Yahoo Finance", "Mercati", "en", [s]))
    f += [
        ("mw", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "MarketWatch", "Mercati", "en", []),
        ("fed", "https://www.federalreserve.gov/feeds/press_all.xml", "Federal Reserve", "Banche centrali", "en", []),
        ("ecb", "https://www.ecb.europa.eu/rss/press.html", "BCE", "Banche centrali", "en", []),
        ("ansa", "https://www.ansa.it/sito/notizie/economia/economia_rss.xml", "ANSA", "Italia", "it", []),
    ]
    return f


SEARCH = [("stock market", "Mercati"), ("gold price", "Mercati"), ("federal reserve", "Banche centrali"),
          ("inflation", "Economia USA"), ("jobs report unemployment", "Economia USA"),
          ("us economy gdp", "Economia USA"), ("ecb interest rates", "Banche centrali")]


def nid(title, link):
    return hashlib.md5((link or title).encode()).hexdigest()[:12]


def norm_title(t):
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def collect_news(prev):
    items, status = [], {}

    def do_feed(f):
        key, url, label, cat, lang, syms = f
        res = []
        for it in parse_feed(fetch(url, retries=4, timeout=25)):
            if not it["title"] or not it["link"]:
                continue
            res.append(dict(it, source=label, category=cat, lang=lang, symbols=list(syms)))
        return res

    def do_search(q):
        query, cat = q
        url = "https://query1.finance.yahoo.com/v1/finance/search?q=%s&newsCount=20&quotesCount=0" % urllib.parse.quote(query)
        j = fetch_json(url, retries=4)
        for _ in range(2):  # Yahoo search sometimes returns an empty news list: retry briefly
            if j.get("news"):
                break
            time.sleep(2)
            j = fetch_json(url, retries=4)
        res = []
        for n in j.get("news") or []:
            if not n.get("title") or not n.get("link"):
                continue
            d = n.get("providerPublishTime")
            res.append({"title": clean(n["title"]), "link": n["link"],
                        "published": dt.datetime.fromtimestamp(d, dt.timezone.utc) if d else None,
                        "summary": "", "source": n.get("publisher") or "Yahoo Finance", "category": cat, "lang": "en",
                        "symbols": [s for s in (n.get("relatedTickers") or []) if s in SYMS]})
        return res

    jobs = [(f[0], do_feed, f) for f in feed_list()] + [("search:" + q[0], do_search, q) for q in SEARCH]
    results = {}
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(fn, arg): key for key, fn, arg in jobs}
        for fu in cf.as_completed(futs):
            key = futs[fu]
            try:
                results[key] = fu.result()
            except Exception as e:
                results[key] = None
                status[key] = str(e)
                log("  news fail", key, e)

    log("  news per feed:", {k: (len(v) if v is not None else None) for k, v in results.items()})
    # source groups for status reporting
    groups = {"yahoo_rss": [k for k in results if k.startswith("yf:")],
              "yahoo_search": [k for k in results if k.startswith("search:")],
              "marketwatch": ["mw"], "fed_press": ["fed"], "ecb_press": ["ecb"], "ansa": ["ansa"]}
    srcs = {}
    merged = {}
    for gname, keys in groups.items():
        bad = [k for k in keys if results.get(k) is None]
        okc = sum(1 for k in keys if results.get(k))
        srcs[gname] = {"ok": okc > 0 or not bad, "at": iso(NOW),
                       "error": ("; ".join("%s: %s" % (k, status[k]) for k in bad) or None) if bad else None,
                       "stale": False}
        if bad and okc == 0:
            srcs[gname]["ok"] = False
            srcs[gname]["stale"] = True
    # merge/dedupe
    order = sorted([it for k, v in results.items() if v for it in v],
                   key=lambda x: x["published"] or dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc), reverse=True)
    by_key = {}
    for it in order:
        k1, k2 = it["link"].split("?")[0].rstrip("/"), norm_title(it["title"])
        tgt = by_key.get(k1) or by_key.get(k2)
        if tgt:
            for s in it["symbols"]:
                if s not in tgt["symbols"]:
                    tgt["symbols"].append(s)
            if tgt["category"] == "Mercati" and it["category"] != "Mercati":
                tgt["category"] = it["category"]  # a more specific category wins
            if not tgt["summary"] and it["summary"]:
                tgt["summary"] = it["summary"]
            by_key[k1] = by_key[k2] = tgt
            continue
        by_key[k1] = by_key[k2] = it
        merged[id(it)] = it
    news = list(merged.values())
    # reuse previous items of sources that failed completely
    failed_labels = set()
    lab = {"yahoo_rss": "Yahoo Finance", "marketwatch": "MarketWatch", "fed_press": "Federal Reserve",
           "ecb_press": "BCE", "ansa": "ANSA"}
    for g, l in lab.items():
        if srcs[g]["stale"]:
            failed_labels.add(l)
    out = []
    for it in news:
        out.append({"id": nid(it["title"], it["link"]), "title": it["title"], "link": it["link"],
                    "source": it["source"],
                    "published": iso(it["published"]) if it["published"] else iso(NOW),
                    "category": it["category"], "symbols": it["symbols"], "lang": it["lang"],
                    "summary": it["summary"]})
    seen = {n["id"] for n in out}
    for n in prev.get("news") or []:
        if n.get("source") in failed_labels and n["id"] not in seen:
            out.append(n)
    out.sort(key=lambda n: n["published"], reverse=True)
    # keep 150 newest, but first reserve the 15 newest items of each smaller category
    ids = set()
    for cat in ("Banche centrali", "Italia", "Economia USA"):
        ids.update(n["id"] for n in [x for x in out if x["category"] == cat][:15])
    for n in out:
        if len(ids) >= 150:
            break
        ids.add(n["id"])
    keep = [n for n in out if n["id"] in ids]
    return keep[:150], srcs


# ---------------------------------------------------------------- macro
START_Y = NOW.year - 5
START = dt.date(START_Y, NOW.month, 1)


def macro_item(id_, name, country, unit, freq, source, url, pts, desc):
    pts = [[d, round(v, 2)] for d, v in pts if v is not None]
    pts = [p for p in pts if p[0] >= START.isoformat()]
    if not pts:
        raise RuntimeError("no points for " + id_)
    out = {"id": id_, "name": name, "country": country, "unit": unit, "frequency": freq,
           "source": source, "sourceUrl": url,
           "latest": {"date": pts[-1][0], "value": pts[-1][1]},
           "previous": {"date": pts[-2][0], "value": pts[-2][1]} if len(pts) > 1 else None,
           "points": pts, "desc": desc}
    return out


def ecb_csv(path):
    raw = fetch("https://data-api.ecb.europa.eu/service/data/%s&format=csvdata" % path if "?" in path
                else "https://data-api.ecb.europa.eu/service/data/%s?format=csvdata" % path, retries=3, timeout=40)
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    return [(r["TIME_PERIOD"], float(r["OBS_VALUE"])) for r in rows if r.get("OBS_VALUE") not in (None, "")]


def month_date(p):  # '2021-01' -> '2021-01-01'
    return p + "-01"


def quarter_end(p):  # '2021-Q1' -> '2021-03-31'
    y, q = p.split("-Q")
    m = int(q) * 3
    return "%s-%02d-%02d" % (y, m, {3: 31, 6: 30, 9: 30, 12: 31}[m])


def eurostat(dataset, params, geos):
    for geo in geos:
        q = urllib.parse.urlencode(dict(params, geo=geo, format="JSON"))
        j = fetch_json("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/%s?%s" % (dataset, q), retries=3, timeout=40)
        vals = j.get("value") or {}
        if not vals:
            continue
        tidx = j["dimension"]["time"]["category"]["index"]
        inv = {v: k for k, v in tidx.items()}
        # all other dims have size 1 -> flat index == time position
        return [(inv[int(i)], v) for i, v in sorted(vals.items(), key=lambda kv: int(kv[0]))]
    raise RuntimeError("no data for %s %s" % (dataset, geos))


def collect_macro(prev):
    prev_m = {m["id"]: m for m in (prev.get("macro") or [])}
    since_m = "%d-%02d" % (START_Y, NOW.month)
    since_q = "%d-Q1" % START_Y
    srcs, out = {}, []

    def run(srcname, specs):
        errs = []
        for id_, fn in specs:
            try:
                out.append(fn())
            except Exception as e:
                errs.append("%s: %s" % (id_, str(e)[:160]))
                log("  macro fail", id_, e)
                if id_ in prev_m:
                    out.append(prev_m[id_])
        srcs[srcname] = {"ok": not errs, "at": iso(NOW), "error": "; ".join(errs) or None,
                         "stale": bool(errs and any(i in prev_m for i, _ in specs))}

    # ---- ECB
    def dfr():
        rows = ecb_csv("FM/B.U2.EUR.4F.KR.DFR.LEV?startPeriod=2019-01-01")
        rows.sort()
        s0 = START.isoformat()
        base = [r for r in rows if r[0] <= s0]
        pts = [(s0, base[-1][1] if base else rows[0][1])] + [r for r in rows if r[0] > s0]
        today = NOW.date().isoformat()
        if pts[-1][0] < today:
            pts.append((today, pts[-1][1]))   # extend the step line to today
        it = macro_item("ea_dfr", "Tasso sui depositi BCE", "Eurozona", "%", "giornaliera", "BCE",
                        "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html",
                        pts, "Il tasso di riferimento della Banca Centrale Europea: è ciò che le banche ricevono depositando liquidità presso la BCE. "
                             "Quando sale, mutui e prestiti diventano più cari; quando scende, il credito costa meno.")
        ch = [r for r in rows if r[0] <= NOW.date().isoformat()]
        it["latest"] = {"date": ch[-1][0], "value": ch[-1][1]}  # date of last decision
        it["previous"] = {"date": ch[-2][0], "value": ch[-2][1]} if len(ch) > 1 else None
        return it

    def hicp_new(geos):
        # ECOICOP v2 dataset (prc_hicp_minr, coicop18=TOTAL): the old ECB ICP key and prc_hicp_manr stop at 2025-12
        return eurostat("prc_hicp_minr", {"coicop18": "TOTAL", "unit": "RCH_A", "sinceTimePeriod": "2025-01"}, geos)

    def splice(old, new):
        cut = new[0][0]
        return [r for r in old if r[0] < cut] + list(new)

    def ea_hicp():
        rows = ecb_csv("ICP/M.U2.N.000000.4.ANR?startPeriod=%s" % since_m)
        try:
            rows = splice(rows, hicp_new(["EA21", "EA20", "EA"]))
        except Exception as e:
            log("  ea_hicp new series fail", e)
        return macro_item("ea_hicp", "Inflazione Eurozona (annua)", "Eurozona", "%", "mensile", "BCE / Eurostat",
                          "https://www.ecb.europa.eu/stats/macroeconomic_and_sectoral/hicp/html/index.en.html",
                          [(month_date(p), v) for p, v in rows],
                          "Di quanto sono aumentati i prezzi al consumo nei paesi dell'euro rispetto a un anno prima. L'obiettivo della BCE è il 2%.")
    run("ecb_sdw", [("ea_dfr", dfr), ("ea_hicp", ea_hicp)])

    # ---- Eurostat
    def it_hicp():
        r = eurostat("prc_hicp_manr", {"coicop": "CP00", "sinceTimePeriod": since_m}, ["IT"])
        try:
            r = splice(r, hicp_new(["IT"]))
        except Exception as e:
            log("  it_hicp new series fail", e)
        return macro_item("it_hicp", "Inflazione Italia (annua)", "Italia", "%", "mensile", "Eurostat",
                          "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_manr/default/table?lang=en",
                          [(month_date(p), v) for p, v in r],
                          "Quanto sono saliti i prezzi in Italia rispetto a un anno fa (indice armonizzato europeo, IPCA). Misura quanto si è ridotto il potere d'acquisto.")

    def unemp(geos, id_, name, country, desc):
        def f():
            r = eurostat("une_rt_m", {"s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT", "sinceTimePeriod": since_m}, geos)
            return macro_item(id_, name, country, "%", "mensile", "Eurostat",
                              "https://ec.europa.eu/eurostat/databrowser/view/une_rt_m/default/table?lang=en",
                              [(month_date(p), v) for p, v in r], desc)
        return f

    def it_gdp():
        r = eurostat("namq_10_gdp", {"unit": "CLV_PCH_PRE", "s_adj": "SCA", "na_item": "B1GQ", "sinceTimePeriod": since_q}, ["IT"])
        return macro_item("it_gdp", "PIL Italia (variazione trimestrale)", "Italia", "%", "trimestrale", "Eurostat",
                          "https://ec.europa.eu/eurostat/databrowser/view/namq_10_gdp/default/table?lang=en",
                          [(quarter_end(p), v) for p, v in r],
                          "Di quanto è cresciuta (o calata) l'economia italiana rispetto al trimestre precedente. Due trimestri negativi di fila indicano una recessione.")
    run("eurostat", [
        ("it_hicp", it_hicp),
        ("it_unemp", unemp(["IT"], "it_unemp", "Disoccupazione Italia", "Italia",
                           "Percentuale di persone in cerca di lavoro sul totale della forza lavoro in Italia (dato destagionalizzato).")),
        ("ea_unemp", unemp(["EA21", "EA20", "EA"], "ea_unemp", "Disoccupazione Eurozona", "Eurozona",
                           "Percentuale di persone in cerca di lavoro nei paesi dell'euro (dato destagionalizzato).")),
        ("it_gdp", it_gdp)])

    # ---- NY Fed (effective fed funds rate)
    def effr():
        j = fetch_json("https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=%s&endDate=%s&type=rate" % (START.isoformat(), NOW.date().isoformat()), retries=3, timeout=40)
        rows = sorted((r["effectiveDate"], float(r["percentRate"])) for r in j["refRates"] if r.get("percentRate") is not None)
        month_end = {}
        for d, v in rows:
            month_end[d[:7]] = (d, v)
        pts = sorted(month_end.values())
        if pts[-1][0] != rows[-1][0]:
            pts.append(rows[-1])
        it = macro_item("us_effr", "Tasso Fed (fed funds effettivo)", "Stati Uniti", "%", "giornaliera", "NY Fed",
                        "https://www.newyorkfed.org/markets/reference-rates/effr", pts,
                        "Il tasso a cui le banche americane si prestano denaro overnight, guidato dalle decisioni della Federal Reserve. "
                        "E' il 'prezzo del denaro' più importante al mondo.")
        return it
    run("nyfed", [("us_effr", effr)])

    # ---- BLS (best effort: free v1 API has a daily quota)
    def bls_all():
        body = json.dumps({"seriesid": ["CUUR0000SA0", "LNS14000000", "CES0000000001"],
                           "startyear": str(START_Y - 1), "endyear": str(NOW.year)}).encode()
        j = json.loads(fetch("https://api.bls.gov/publicAPI/v1/timeseries/data/", data=body, retries=2, timeout=40,
                             headers={"Content-Type": "application/json"}).decode())
        if j.get("status") != "REQUEST_SUCCEEDED":
            raise RuntimeError("; ".join(j.get("message") or [str(j.get("status"))])[:200])
        res = {}
        for s in j["Results"]["series"]:
            d = {}
            for o in s["data"]:
                if o["period"].startswith("M") and o["period"] != "M13" and o["value"] not in ("-", ""):
                    d["%s-%s" % (o["year"], o["period"][1:])] = float(o["value"])
            res[s["seriesID"]] = d
        return res
    try:
        res = bls_all()
        def mk(id_, name, unit, desc, pts, url):
            return macro_item(id_, name, "Stati Uniti", unit, "mensile", "BLS", url, pts, desc)
        cpi, un, pay = res["CUUR0000SA0"], res["LNS14000000"], res["CES0000000001"]
        def prev_year(k):
            y, m = k.split("-"); return "%d-%s" % (int(y) - 1, m)
        def prev_month(k):
            y, m = map(int, k.split("-")); y, m = (y - 1, 12) if m == 1 else (y, m - 1); return "%d-%02d" % (y, m)
        cpi_pts = [(k + "-01", (v / cpi[prev_year(k)] - 1) * 100) for k, v in sorted(cpi.items()) if prev_year(k) in cpi]
        pay_pts = [(k + "-01", v - pay[prev_month(k)]) for k, v in sorted(pay.items()) if prev_month(k) in pay]
        out.append(mk("us_cpi", "Inflazione USA (CPI, annua)", "%",
                      "Di quanto sono aumentati i prezzi al consumo negli Stati Uniti rispetto a un anno fa. La Fed punta al 2%.",
                      cpi_pts, "https://www.bls.gov/cpi/"))
        out.append(mk("us_unemp", "Disoccupazione USA", "%",
                      "Percentuale di americani senza lavoro che lo cercano attivamente.", [(k + "-01", v) for k, v in sorted(un.items())],
                      "https://www.bls.gov/cps/"))
        out.append(mk("us_payrolls", "Nuovi posti di lavoro USA (non agricoli)", "migliaia",
                      "Quanti posti di lavoro in più (o in meno) ha creato l'economia americana nell'ultimo mese, in migliaia. Dato molto atteso dai mercati.",
                      pay_pts, "https://www.bls.gov/ces/"))
        srcs["bls"] = {"ok": True, "at": iso(NOW), "error": None, "stale": False}
    except Exception as e:
        log("  bls fail", e)
        had = False
        for i in ("us_cpi", "us_unemp", "us_payrolls"):
            if i in prev_m:
                out.append(prev_m[i]); had = True
        srcs["bls"] = {"ok": False, "at": iso(NOW), "error": str(e)[:200], "stale": had}
    # generic freshness guard: latest point too old for the series frequency -> flag source stale
    limits = {"mensile": 122, "trimestrale": 245}   # days (~4 / ~8 months)
    owner = {"ea_dfr": "ecb_sdw", "ea_hicp": "ecb_sdw", "it_hicp": "eurostat", "it_unemp": "eurostat",
             "ea_unemp": "eurostat", "it_gdp": "eurostat", "us_effr": "nyfed",
             "us_cpi": "bls", "us_unemp": "bls", "us_payrolls": "bls"}
    for m in out:
        lim = limits.get(m["frequency"])
        if not lim:
            continue
        age = (NOW.date() - dt.date.fromisoformat(m["latest"]["date"])).days
        if age > lim:
            sn = owner.get(m["id"], "macro")
            msg = "%s: latest point %s is %d days old (limit %d for %s series)" % (m["id"], m["latest"]["date"], age, lim, m["frequency"])
            log("  stale macro", msg)
            e = srcs.setdefault(sn, {"ok": True, "at": iso(NOW), "error": None, "stale": False})
            e["ok"] = False
            e["stale"] = True
            e["error"] = (e["error"] + "; " if e["error"] else "") + msg
    return out, srcs


# ---------------------------------------------------------------- curve
def tenor(h):
    m = re.match(r"\s*([\d.]+)\s*(Mo|Month|Yr|Year)", h, re.I)
    if not m:
        return None
    n = float(m.group(1)); unit = m.group(2).lower()
    if unit.startswith("m"):
        lab = ("%gM" % n); yrs = n / 12
    else:
        lab = ("%gY" % n); yrs = n
    return lab, round(yrs, 3)


def collect_curve(prev):
    def year_rows(y):
        url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/%d/all"
               "?type=daily_treasury_yield_curve&field_tdr_date_value=%d&page&_format=csv" % (y, y))
        rows = list(csv.DictReader(io.StringIO(fetch(url, retries=3, timeout=40).decode("utf-8-sig"))))
        res = {}
        for r in rows:
            d = dt.datetime.strptime(r["Date"], "%m/%d/%Y").date()
            pts = []
            for k, v in r.items():
                t = tenor(k) if k != "Date" else None
                if t and v not in (None, ""):
                    try:
                        pts.append({"tenor": t[0], "years": t[1], "value": float(v)})
                    except ValueError:
                        pass
            if pts:
                res[d] = sorted(pts, key=lambda p: p["years"])
        return res
    try:
        rows = year_rows(NOW.year)
        try:
            rows.update(year_rows(NOW.year - 1))
        except Exception as e:
            log("  curve prev-year fail", e)
        latest = max(rows)

        def near(target):
            c = [d for d in rows if d <= target]
            return max(c) if c else None
        cmp_ = []
        for label, tgt in (("1 mese fa", latest - dt.timedelta(days=30)), ("1 anno fa", latest - dt.timedelta(days=365))):
            d = near(tgt)
            if d:
                cmp_.append({"label": label, "date": d.isoformat(), "points": rows[d]})
        return ({"source": "US Treasury", "date": latest.isoformat(), "points": rows[latest], "compare": cmp_},
                {"ok": True, "at": iso(NOW), "error": None, "stale": False})
    except Exception as e:
        log("  curve fail", e)
        return prev.get("curve"), {"ok": False, "at": iso(NOW), "error": str(e)[:200], "stale": bool(prev.get("curve"))}


# ---------------------------------------------------------------- calendar
def collect_calendar(prev, retries=3):
    try:
        j = fetch_json("https://nfs.faireconomy.media/ff_calendar_thisweek.json", retries=retries, timeout=30,
                       base_wait=10, max_wait=20)
        out = []
        for e in j:
            d = parse_date(e.get("date"))
            if not d:
                continue
            out.append({"date": iso(d), "country": e.get("country") or "", "title": e.get("title") or "",
                        "impact": e.get("impact") or "Low", "forecast": e.get("forecast") or "",
                        "previous": e.get("previous") or "", "actual": e.get("actual") or None})
        if not out:
            raise RuntimeError("empty calendar")
        out.sort(key=lambda x: x["date"])
        return out, {"ok": True, "at": iso(NOW), "error": None, "stale": False}
    except Exception as e:
        log("  calendar fail", e)
        return prev.get("calendar") or [], {"ok": False, "at": iso(NOW), "error": str(e)[:200],
                                            "stale": bool(prev.get("calendar"))}


# ---------------------------------------------------------------- v2: index constituents, directory, lite tier
from html.parser import HTMLParser


class _TP(HTMLParser):
    """Minimal HTML table extractor -> list of tables, each a list of rows (lists of cell text)."""
    def __init__(s):
        super().__init__()
        s.tables, s.stack, s.row, s.cell = [], [], None, None

    def handle_starttag(s, t, a):
        if t == "table":
            s.stack.append([])
        elif t == "tr" and s.stack:
            s.row = []
        elif t in ("td", "th") and s.row is not None:
            s.cell = []
        elif t in ("br", "sup") and s.cell is not None:
            s.cell.append(" " if t == "br" else "")

    def handle_endtag(s, t):
        if t in ("td", "th") and s.cell is not None and s.row is not None:
            s.row.append(re.sub(r"\s+", " ", "".join(s.cell)).strip()); s.cell = None
        elif t == "tr" and s.row is not None and s.stack:
            s.stack[-1].append(s.row); s.row = None
        elif t == "table" and s.stack:
            s.tables.append(s.stack.pop())

    def handle_data(s, d):
        if s.cell is not None:
            s.cell.append(d)


def wiki_constituents(page, suffix, minrows, us=False):
    """Parse a Wikipedia index page -> [(yahoo_symbol, name, sector)]. Robust to column order: picks the table whose
    header has a Ticker/Symbol column and >= minrows rows."""
    raw = fetch("https://en.wikipedia.org/wiki/" + page, retries=4, timeout=40).decode("utf-8", "replace")
    p = _TP()
    p.feed(raw)
    best = None
    for t in p.tables:
        if len(t) < minrows or not t[0]:
            continue
        hdr = [re.sub(r"\[.*?\]", "", c).strip().lower() for c in t[0]]
        ti = next((i for i, c in enumerate(hdr) if c.startswith(("ticker", "symbol", "epic"))), None)
        if ti is None:
            continue
        if best is None or len(t) > len(best[0]):
            best = (t, hdr, ti)
    if not best:
        raise RuntimeError("no constituents table in " + page)
    t, hdr, ti = best
    ni = next((i for i, c in enumerate(hdr) if c in ("company", "security", "name") and i != ti), None)
    si = next((i for i, c in enumerate(hdr) if "sector" in c), None)
    out = []
    for r in t[1:]:
        if len(r) <= ti:
            continue
        tk = re.sub(r"\[.*?\]|\s+", "", r[ti]).upper() if us else re.sub(r"\[.*?\]|\s", "", r[ti])
        if not tk or not re.match(r"^[A-Za-z0-9.\-^]+$", tk):
            continue
        if us:
            sym = tk.replace(".", "-")
        elif "." in tk and tk.rsplit(".", 1)[1].upper() in {"MI", "DE", "PA", "L", "AS", "MC", "BR", "HE", "IR", "LS", "VI"}:
            sym = tk.rsplit(".", 1)[0].upper() + "." + tk.rsplit(".", 1)[1].upper()
        else:
            sym = tk.upper().replace(".", "-") + suffix
        name = r[ni] if ni is not None and ni < len(r) else sym
        out.append((sym, re.sub(r"\[.*?\]", "", name).strip(), (r[si] if si is not None and si < len(r) else "") or ""))
    if len(out) < minrows - 5:
        raise RuntimeError("too few rows parsed for " + page)
    return out


def nasdaq100_constituents():
    j = fetch_json("https://api.nasdaq.com/api/quote/list-type/nasdaq100", retries=3, timeout=30)
    rows = j["data"]["data"]["rows"]
    out = [(r["symbol"].replace(".", "-"), short_name(r["companyName"]), r.get("sector") or "") for r in rows]
    if len(out) < 90:
        raise RuntimeError("nasdaq100 short list")
    return out


INDEX_SPECS = [  # key, loader, group, expected size
    ("sp500", lambda: wiki_constituents("List_of_S%26P_500_companies", "", 400, us=True), "Azioni USA"),
    ("ndx", nasdaq100_constituents, "Azioni USA"),
    ("ftsemib", lambda: wiki_constituents("FTSE_MIB", ".MI", 30), "Azioni Europa"),
    ("dax", lambda: wiki_constituents("DAX", ".DE", 30), "Azioni Europa"),
    ("cac40", lambda: wiki_constituents("CAC_40", ".PA", 30), "Azioni Europa"),
    ("estx50", lambda: wiki_constituents("EURO_STOXX_50", "", 40), "Azioni Europa"),
    ("ftse100", lambda: wiki_constituents("FTSE_100_Index", ".L", 80), "Azioni Europa"),
]

# Fallback snapshot (zlib+base64 JSON {index: [[symbol, name, sector], ...]}) used when Wikipedia/Nasdaq fail.
SNAPSHOT_B64 = (
    "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"
)   # snapshot of constituents taken 2026-11-27


def load_snapshot():
    import base64, zlib
    if not SNAPSHOT_B64:
        return {}
    return json.loads(zlib.decompress(base64.b64decode(SNAPSHOT_B64)).decode("utf-8"))


def collect_indices(prev_lists):
    """-> (dict index -> [(sym,name,sector)], sources). Falls back to previous run's lists, then to the embedded snapshot."""
    snap = load_snapshot()
    res, errs, used_snap = {}, [], []

    def one(spec):
        key, fn, group = spec
        try:
            return key, fn(), None
        except Exception as e:
            return key, None, str(e)[:120]
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        for key, r, err in ex.map(one, INDEX_SPECS):
            if r:
                res[key] = r
            else:
                errs.append("%s: %s" % (key, err))
                log("  index list fail", key, err)
                fb = prev_lists.get(key) or snap.get(key)
                if fb:
                    res[key] = [tuple(x) for x in fb]
                    used_snap.append(key)
    src = {"ok": not errs, "at": iso(NOW), "error": "; ".join(errs) or None, "stale": bool(used_snap)}
    return res, src


def short_name(n):
    n = re.sub(r"\s+-\s+.*$", "", n or "")
    n = re.sub(r"\s+(Common Stock|Ordinary Shares?|Class [A-Z]\b.*|American Depositary (Shares|Receipts?).*|"
               r"Common Shares?|Capital Stock|Depositary Shares.*)$", "", n.strip(), flags=re.I)
    return n.strip(" ,.")[:42]


EXCH_NAMES = {"N": "NYSE", "A": "NYSE American", "P": "NYSE Arca", "Z": "Cboe BZX", "V": "IEX"}
SUFFIX_EXCH = {".MI": "Borsa Italiana", ".DE": "Xetra", ".PA": "Euronext Parigi", ".L": "Londra",
               ".AS": "Euronext Amsterdam", ".MC": "Madrid", ".BR": "Euronext Bruxelles", ".HE": "Helsinki",
               ".IR": "Dublino", ".LS": "Lisbona", ".VI": "Vienna"}
BAD_NAME = re.compile(r"\b(Warrants?|Rights?|Units?|Preferred|Notes? due|Trust Preferred|Subordinated|Depositary Shares)\b|%", re.I)


def collect_directory():
    """US listed securities from nasdaqtrader -> [[symbol, name, type, exchange], ...]"""
    out, seen = [], set()
    raw = fetch("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", retries=3, timeout=40).decode("utf-8", "replace")
    for ln in raw.splitlines()[1:]:
        f = ln.split("|")
        if len(f) < 8 or f[0].startswith("File Creation"):
            continue
        sym, name, _, test, status, _, etf, nxt = f[:8]
        if test == "Y" or nxt == "Y" or status in ("E", "Q", "G", "H", "J", "K") or BAD_NAME.search(name) or "$" in sym:
            continue
        s = sym.replace(".", "-")
        if s not in seen:
            seen.add(s); out.append([s, short_name(name), "ETF" if etf == "Y" else "Azione", "NASDAQ"])
    raw = fetch("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", retries=3, timeout=40).decode("utf-8", "replace")
    for ln in raw.splitlines()[1:]:
        f = ln.split("|")
        if len(f) < 8 or f[0].startswith("File Creation"):
            continue
        sym, name, ex, _, etf, _, test, _ = f[:8]
        if test == "Y" or BAD_NAME.search(name) or "$" in sym:
            continue
        s = sym.replace(".", "-")
        if s not in seen:
            seen.add(s); out.append([s, short_name(name), "ETF" if etf == "Y" else "Azione", EXCH_NAMES.get(ex, ex)])
    if len(out) < 3000:
        raise RuntimeError("directory too small (%d)" % len(out))
    return out


def guess_group(sym, dirmap):
    if sym.endswith("=X"):
        return "Valute"
    if sym.endswith("=F"):
        return "Future"
    if sym.startswith("^"):
        return "Indici"
    if sym.endswith("-USD"):
        return "Crypto"
    e = dirmap.get(sym)
    if e and e[1] == "ETF":
        return "ETF"
    if "." in sym and "." + sym.rsplit(".", 1)[1] in SUFFIX_EXCH:
        return "Azioni Europa"
    if "." in sym:
        return "Azioni Altro"
    return "Azioni USA"


def type_of_group(g, sym):
    return {"Indici": "Indice", "Tassi": "Indice", "Valute": "Valuta", "Crypto": "Crypto", "Future": "Future",
            "Materie prime": "Future", "Settori": "ETF", "ETF": "ETF"}.get(g, "Azione")


def shard_of(sym):
    for ch in sym:
        if ch.isalnum():
            return "0" if ch.isdigit() else ch.upper()
    return "0"


def build_lite(sym, name, group, sector):
    d = yahoo_chart(sym, "1y", "1d")
    meta = d.get("meta") or {}
    daily = bars(d)
    if len(daily) < 25:
        raise RuntimeError("too few bars")
    st = quote_stats(meta, daily)
    price, prev = st["price"], st["prev"]
    vols = [b[5] for b in daily[-30:] if b[5]]
    wk = weekly_bars(daily)
    e = {"name": name or meta.get("longName") or meta.get("shortName") or sym,
         "exchange": meta.get("fullExchangeName") or meta.get("exchangeName") or "",
         "currency": meta.get("currency") or "USD", "group": group}
    if sector:
        e["sector"] = sector
    e.update({"price": rp(price), "prevClose": rp(prev), "change": rp(price - prev), "changePct": pct(price, prev),
              "chg1w": st["chg1w"], "chg1m": st["chg1m"], "chgYtd": st["chgYtd"], "chg1y": st["chg1y"],
              "high52": rp(st["hi52"]), "low52": rp(st["lo52"]),
              "volume": int(num(meta.get("regularMarketVolume")) or (daily[-1][5] or 0)),
              "avgVol": int(sum(vols) / len(vols)) if vols else None,
              "closes": [[b[0], rp(b[4])] for b in daily],
              "bias": {"daily": bias_calc([b[4] for b in daily], "giorni"),
                       "weekly": bias_calc([w[4] for w in wk], "settimane")}})
    return e


def load_old_shards(*dirs):
    old = {}
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if fn.endswith(".json"):
                try:
                    old.update(json.load(open(os.path.join(d, fn))))
                except Exception:
                    pass
    return old


def collect_lite(outdir, tasks, old_shards):
    """tasks: [(sym, name, group, sector)] -> (lite dict sym->entry, failed list). Shards written to <out>/l/."""
    ldir = os.path.join(outdir, "l")
    os.makedirs(ldir, exist_ok=True)
    lite, failed = {}, []

    def work(t):
        sym, name, group, sector = t
        try:
            return sym, build_lite(sym, name, group, sector), None
        except Exception as e:
            return sym, None, str(e)[:100]
    with cf.ThreadPoolExecutor(max_workers=CONC) as ex:
        for sym, e, err in ex.map(work, tasks):
            if e:
                lite[sym] = e
            else:
                failed.append((sym, err))
    stale = 0
    for sym, err in failed:
        if sym in old_shards:       # keep last known data for symbols that failed transiently (e.g. 429)
            lite[sym] = old_shards[sym]; stale += 1
    shards = {}
    for sym, e in lite.items():
        shards.setdefault(shard_of(sym), {})[sym] = e
    written = set()
    for k, v in shards.items():
        write_if_changed(os.path.join(ldir, k + ".json"), json.dumps(v, separators=(",", ":"), ensure_ascii=False))
        written.add(k + ".json")
    for fn in os.listdir(ldir):
        if fn not in written:
            try:
                os.remove(os.path.join(ldir, fn))
            except OSError:
                pass
    return lite, failed, stale


# ---------------------------------------------------------------- v2: requests (--requests)
RQ_TYPES = {"EQUITY", "ETF", "FUTURE", "CRYPTOCURRENCY", "CURRENCY", "INDEX"}


def resolve_request(q):
    j = fetch_json("https://query1.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=8&newsCount=0" %
                   urllib.parse.quote(q), retries=4, timeout=25)
    for it in j.get("quotes") or []:
        if it.get("quoteType") in RQ_TYPES and it.get("symbol"):
            return it["symbol"], it.get("shortname") or it.get("longname") or it["symbol"], it["quoteType"]
    return None, None, None


def group_from_quote_type(qt, sym, dirmap):
    return {"ETF": "ETF", "FUTURE": "Future", "CRYPTOCURRENCY": "Crypto", "CURRENCY": "Valute", "INDEX": "Indici"}.get(
        qt) or guess_group(sym, dirmap)


# ---------------------------------------------------------------- v2: market analysis sections
def dkey(t, gmt=0):
    return int((t + gmt) // 86400)


def kd(k):
    return dt.date.fromordinal(719163 + k).isoformat()   # 719163 = date(1970,1,1).toordinal()


# ---- COT (CFTC legacy futures-only, Socrata dataset 6dca-aqww) ----
COT_MARKETS = [  # code, name, symbols, kind
    ("088691", "Oro", ["GC=F", "XAUUSD"], "x"), ("084691", "Argento", ["SI=F"], "x"),
    ("067651", "Petrolio WTI", ["CL=F"], "x"), ("085692", "Rame", ["HG=F"], "x"),
    ("023651", "Gas naturale", ["NG=F"], "x"),
    ("099741", "Euro", ["EURUSD=X"], ("EUR/USD", 1)), ("097741", "Yen giapponese", ["USDJPY=X"], ("USD/JPY", -1)),
    ("096742", "Sterlina", ["GBPUSD=X"], ("GBP/USD", 1)), ("232741", "Dollaro australiano", ["AUDUSD=X"], ("AUD/USD", 1)),
    ("090741", "Dollaro canadese", ["USDCAD=X"], ("USD/CAD", -1)), ("092741", "Franco svizzero", ["USDCHF=X"], ("USD/CHF", -1)),
    ("112741", "Dollaro neozelandese", ["NZDUSD=X"], ("NZD/USD", 1)), ("095741", "Peso messicano", ["USDMXN=X"], ("USD/MXN", -1)),
    ("13874A", "S&P 500 e-mini", ["ES=F", "^GSPC"], "x"), ("209742", "Nasdaq 100 e-mini", ["NQ=F", "^NDX"], "x"),
    ("124603", "Dow Jones e-mini", ["YM=F", "^DJI"], "x"), ("043602", "T-Note 10 anni", ["ZN=F", "^TNX"], "x"),
    ("133741", "Bitcoin CME", ["BTC=F", "BTC-USD"], "x"),
]


def cot_note(name, kind, net, idx):
    side = "long (puntano al rialzo)" if net > 0 else "short (puntano al ribasso)"
    s = "Gli speculatori (grandi fondi) sono netti %s su %s." % (side, name)
    if isinstance(kind, tuple):
        pair, sgn = kind
        up = (net > 0) == (sgn > 0)
        s += " Lettura sulla coppia %s: posizionamento %s." % (pair, "a favore di un rialzo" if up else "a favore di un ribasso")
    if idx is not None and idx >= 80:
        s += " Posizionamento molto affollato sul lato long: attenzione a possibili inversioni."
    elif idx is not None and idx <= 20:
        s += " Posizionamento molto affollato sul lato short: attenzione a possibili inversioni."
    return s + " Dato settimanale, riferito al martedì."


def collect_cot():
    since = (NOW - dt.timedelta(days=3 * 365 + 28)).strftime("%Y-%m-%d")
    codes = ",".join("'%s'" % c[0] for c in COT_MARKETS)
    q = urllib.parse.urlencode({
        "$select": "cftc_contract_market_code,report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all",
        "$where": "cftc_contract_market_code in(%s) AND report_date_as_yyyy_mm_dd >= '%s'" % (codes, since),
        "$order": "report_date_as_yyyy_mm_dd DESC", "$limit": "6000"})
    rows = fetch_json("https://publicreporting.cftc.gov/resource/6dca-aqww.json?" + q, retries=4, timeout=60)
    by = {}
    for r in rows:
        try:
            by.setdefault(r["cftc_contract_market_code"], []).append(
                (r["report_date_as_yyyy_mm_dd"][:10], float(r["noncomm_positions_long_all"]), float(r["noncomm_positions_short_all"])))
        except (KeyError, ValueError):
            pass
    out = []
    for code, name, syms, kind in COT_MARKETS:
        rs_ = sorted(by.get(code, []))[-156:]
        if len(rs_) < 20:
            log("  cot: no data for", name)
            continue
        nets = [l - s for _, l, s in rs_]
        net = nets[-1]
        lo, hi = min(nets), max(nets)
        idx = round((net - lo) / (hi - lo) * 100) if hi > lo else 50
        lg, sh = rs_[-1][1], rs_[-1][2]
        out.append({"market": name, "symbols": syms, "date": rs_[-1][0], "netSpec": int(net),
                    "netSpecChg": int(net - nets[-2]) if len(nets) > 1 else 0,
                    "longPct": round(lg / (lg + sh) * 100, 1) if lg + sh else None, "cotIndex3y": idx,
                    "history": [[d, int(n)] for (d, _, _), n in zip(rs_, nets)],
                    "note": cot_note(name, kind, net, idx)})
    if not out:
        raise RuntimeError("no COT rows")
    return out


FNG_IT = {"extreme fear": "Paura estrema", "fear": "Paura", "neutral": "Neutrale", "greed": "Avidità",
          "extreme greed": "Avidità estrema"}


def collect_crypto_fng():
    j = fetch_json("https://api.alternative.me/fng/?limit=90", retries=3, timeout=25)
    d = j["data"]
    hist = [[dt.datetime.fromtimestamp(int(x["timestamp"]), dt.timezone.utc).date().isoformat(), int(x["value"])]
            for x in reversed(d)]
    return {"value": int(d[0]["value"]), "label": FNG_IT.get(d[0]["value_classification"].lower(), d[0]["value_classification"]),
            "history": hist}


def collect_trending(namemap):
    j = fetch_json("https://query1.finance.yahoo.com/v1/finance/trending/US?count=20", retries=3, timeout=25)
    qs = j["finance"]["result"][0]["quotes"]
    return [s["symbol"] for s in qs if s.get("symbol")]


def pearson(a, b):
    n = len(a)
    if n < 10:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va <= 0 or vb <= 0:
        return None
    return round(sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb), 2)


CORR_SET = [("^GSPC", "S&P 500"), ("^NDX", "Nasdaq 100"), ("FTSEMIB.MI", "FTSE MIB"), ("GC=F", "Oro"), ("SI=F", "Argento"),
            ("CL=F", "Petrolio WTI"), ("EURUSD=X", "EUR/USD"), ("USDJPY=X", "USD/JPY"), ("DX-Y.NYB", "Indice dollaro"),
            ("^TNX", "Treasury 10a"), ("BTC-USD", "Bitcoin"), ("^VIX", "VIX")]


def collect_correlations(days=60):
    rets = {}
    for sym, _ in CORR_SET:
        if sym not in CORE_DAILY:
            continue
        daily, gmt = CORE_DAILY[sym]
        r, prevc = {}, None
        for b in daily:
            if prevc:
                r[dkey(b[0], gmt)] = b[4] / prevc - 1
            prevc = b[4]
        rets[sym] = r
    syms = [s for s, _ in CORR_SET if s in rets]
    mat = []
    for a in syms:
        row = []
        for b in syms:
            if a == b:
                row.append(1.0); continue
            common = sorted(set(rets[a]) & set(rets[b]))[-days:]
            row.append(pearson([rets[a][k] for k in common], [rets[b][k] for k in common]))
        mat.append(row)
    if len(syms) < 6:
        raise RuntimeError("too few series")
    names = dict(CORR_SET)
    return {"labels": [names[s] for s in syms], "symbols": syms, "matrix": mat, "days": days}


def collect_currency_strength(markets):
    mk = {m["symbol"]: m for m in markets}
    pairs = [m for m in markets if m["symbol"].endswith("=X") and m["symbol"] != "DX-Y.NYB"]
    acc = {c: {"d1": [], "w1": [], "m1": []} for c in ("USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD")}
    for m in pairs:
        b, q = m["symbol"][:3], m["symbol"][3:6]
        if b not in acc or q not in acc:
            continue
        for key, f in (("d1", "changePct"), ("w1", "chg1w"), ("m1", "chg1m")):
            v = m.get(f)
            if v is None:
                continue
            acc[b][key].append(v)       # base currency gains when the pair rises
            acc[q][key].append(-v)      # quote currency loses
    out = [{"ccy": c, **{k: (round(sum(v) / len(v), 2) if v else None) for k, v in d.items()}} for c, d in acc.items()]
    out.sort(key=lambda x: -(x["d1"] or 0))
    return out


def collect_sectors(markets):
    names = {"XLK": "Tecnologia", "XLF": "Finanza", "XLE": "Energia", "XLV": "Sanità", "XLY": "Consumi discrezionali",
             "XLP": "Consumi di base", "XLI": "Industria", "XLB": "Materiali", "XLU": "Servizi di pubblica utilità",
             "XLRE": "Immobiliare", "XLC": "Comunicazione"}
    mk = {m["symbol"]: m for m in markets}
    out = [{"symbol": s, "name": names[s], "d1": mk[s]["changePct"], "w1": mk[s]["chg1w"], "m1": mk[s]["chg1m"],
            "ytd": mk[s]["chgYtd"]} for s in SECTOR_SYMS if s in mk]
    if not out:
        raise RuntimeError("no sector ETFs")
    return out


def collect_movers(markets, lite):
    def rowfrom(sym, name, price, chg, vol):
        return (sym, name, price, chg, (price or 0) * (vol or 0))
    us, eu = [], []
    for m in markets:
        d = CORE_DAILY.get(m["symbol"])
        vol = d[0][-1][5] if d else None
        if m["group"] == "Azioni USA":
            us.append(rowfrom(m["symbol"], m["name"], m["price"], m["changePct"], vol))
        elif m["group"] == "Azioni Italia":
            eu.append(rowfrom(m["symbol"], m["name"], m["price"], m["changePct"], vol))
    for sym, e in lite.items():
        r = rowfrom(sym, e["name"], e["price"], e["changePct"], e.get("volume") or e.get("avgVol"))
        if e["group"] == "Azioni USA":
            us.append(r)
        elif e["group"] == "Azioni Europa":
            eu.append(r)

    def pack(rows):
        rows = [r for r in rows if r[3] is not None and r[2]]
        f = lambda r: [r[0], r[1], r[2], r[3]]
        return {"gainers": [f(r) for r in sorted(rows, key=lambda r: -r[3])[:10]],
                "losers": [f(r) for r in sorted(rows, key=lambda r: r[3])[:10]],
                "active": [f(r) for r in sorted(rows, key=lambda r: -r[4])[:10]]}
    return {"us": pack(us), "eu": pack(eu)}


def _asof(keys, vals, k):
    i = bisect.bisect_right(keys, k) - 1
    return (i, vals[i]) if i >= 0 else (None, None)


def collect_sentiment(sp_lite):
    """Fear/Greed-style 0-100 thermometer = average of component scores (each 0..100):
       1 VIX vs its 1y mean: 50 + (1 - VIX/mean)*125; 2 S&P500 vs SMA125: 50 + pct*5;
       3 breadth = % of S&P 500 stocks above SMA50; 4 new highs vs lows = highs/(highs+lows)*100 among S&P 500
       stocks within 2% of the 52w high / 2% of the 52w low; 5 safe-haven demand = 50 + (SPY 20d% - TLT 20d%)*5;
       6 gold vs S&P 500: 50 - (gold 20d% - S&P 20d%)*5. History uses components 1,2,3,5,6."""
    need = ["^VIX", "^GSPC", "SPY", "TLT", "GC=F"]
    if any(s not in CORE_DAILY for s in need):
        raise RuntimeError("missing core series")
    ser = {}
    for s in need:
        daily, gmt = CORE_DAILY[s]
        ser[s] = ([dkey(b[0], gmt) for b in daily], [b[4] for b in daily])
    # breadth history (S&P 500 lite closes)
    sp = list(sp_lite.values())
    breadth_hist = {}
    for e in sp:
        cl = e["closes"]
        c = [x[1] for x in cl]
        if len(c) < 55:
            continue
        run = 0.0
        for i, v in enumerate(c):
            run += v
            if i >= 50:
                run -= c[i - 50]
            if i >= 49:
                k = dkey(cl[i][0], -18000)
                a = breadth_hist.setdefault(k, [0, 0])
                a[1] += 1
                if v > run / 50:
                    a[0] += 1

    def comps_at(k, full=False):
        out = []
        kv, cv = ser["^VIX"]
        i, v = _asof(kv, cv, k)
        if i is not None and i >= 100:
            mean = sum(cv[max(0, i - 251):i + 1]) / len(cv[max(0, i - 251):i + 1])
            out.append(("Volatilità (VIX)", round(v, 1), clamp(50 + (1 - v / mean) * 125, 0, 100),
                        "VIX %.1f contro una media annua di %.1f: più è alto, più gli investitori hanno paura." % (v, mean)))
        kg, cg = ser["^GSPC"]
        i, v = _asof(kg, cg, k)
        if i is not None and i >= 125:
            m = sum(cg[i - 124:i + 1]) / 125
            p = (v / m - 1) * 100
            out.append(("S&P 500 vs media 125 giorni", round(p, 2), clamp(50 + p * 5, 0, 100),
                        "L'S&P 500 è %.1f%% %s la sua media a 125 giorni." % (abs(p), "sopra" if p >= 0 else "sotto")))
        b = breadth_hist.get(k)
        if b and b[1] >= 100:
            p = b[0] / b[1] * 100
            out.append(("Ampiezza del mercato", round(p, 1), p,
                        "%.0f%% dei titoli dell'S&P 500 è sopra la propria media a 50 giorni." % p))
        ks, cs = ser["SPY"]
        kt, ct = ser["TLT"]
        i, v = _asof(ks, cs, k)
        j, w = _asof(kt, ct, k)
        if i is not None and j is not None and i >= 20 and j >= 20:
            d = (v / cs[i - 20] - 1) * 100 - (w / ct[j - 20] - 1) * 100
            out.append(("Domanda di beni rifugio", round(d, 2), clamp(50 + d * 5, 0, 100),
                        "Negli ultimi 20 giorni le azioni (SPY) hanno fatto %+.1f punti rispetto ai titoli di stato lunghi (TLT)." % d))
        kgo, cgo = ser["GC=F"]
        i, v = _asof(kgo, cgo, k)
        j, w = _asof(kg, cg, k)
        if i is not None and j is not None and i >= 20 and j >= 20:
            d = (v / cgo[i - 20] - 1) * 100 - (w / cg[j - 20] - 1) * 100
            out.append(("Oro vs azioni", round(d, 2), clamp(50 - d * 5, 0, 100),
                        "Negli ultimi 20 giorni l'oro ha fatto %+.1f punti rispetto all'S&P 500: se l'oro corre, c'è prudenza." % d))
        if full and sp:
            hi = lo = 0
            for e in sp:
                p_, h_, l_ = e["price"], e.get("high52"), e.get("low52")
                if p_ and h_ and p_ >= h_ * 0.98:
                    hi += 1
                if p_ and l_ and p_ <= l_ * 1.02:
                    lo += 1
            sc = hi / (hi + lo) * 100 if hi + lo else 50
            out.append(("Nuovi massimi vs minimi", "%d/%d" % (hi, lo), sc,
                        "%d titoli dell'S&P 500 vicini ai massimi annui contro %d vicini ai minimi." % (hi, lo)))
        return out
    kg = ser["^GSPC"][0]
    today = kg[-1]
    comps = comps_at(today, full=True)
    if len(comps) < 3:
        raise RuntimeError("too few sentiment components")
    score = round(sum(c[2] for c in comps) / len(comps))
    label = ("Paura estrema" if score < 20 else "Paura" if score < 40 else "Neutrale" if score < 60 else
             "Euforia" if score >= 80 else "Avidità")
    hist = []
    for k in kg[-200:]:
        cc = comps_at(k)
        if len(cc) >= 3:
            hist.append([kd(k), round(sum(c[2] for c in cc) / len(cc))])
    return {"score": score, "label": label,
            "components": [{"name": n, "value": v, "score": round(s), "desc": d} for n, v, s, d in comps],
            "history": hist}


def collect_earnings(us_syms, names):
    out, d = [], NOW.date()
    days = []
    while len(days) < 10:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            days.append(d)

    def one(day):
        j = fetch_json("https://api.nasdaq.com/api/calendar/earnings?date=%s" % day.isoformat(), retries=3, timeout=25)
        return day, ((j.get("data") or {}).get("rows") or [])
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        for day, rows in ex.map(one, days):
            for r in rows:
                s = (r.get("symbol") or "").replace(".", "-")
                if s in us_syms:
                    t = r.get("time") or ""
                    out.append({"date": day.isoformat(), "symbol": s, "name": names.get(s) or r.get("name"),
                                "time": "pre" if "pre" in t else "after" if "after" in t else "",
                                "epsForecast": r.get("epsForecast") or None, "marketCap": r.get("marketCap") or None})
    if not out:
        raise RuntimeError("no earnings rows")
    return out[:200]


# ---------------------------------------------------------------- main
def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--previous")
    ap.add_argument("--requests", help="JSON file: [{q, symbol, name, at}, ...] user requests for new tickers")
    ap.add_argument("--mode", choices=["full", "fast"], default="full",
                    help="full: everything (hourly). fast: only live quotes + news + calendar -> live.json")
    ap.add_argument("--symbols", help="fast mode: JSON list of symbols to quote (data/symbols.json of the site)")
    ap.add_argument("--previous-manifest", dest="previous_manifest",
                    help="manifest.json of the currently published site, to list what changed")
    ap.add_argument("--changed-out", dest="changed_out", help="write the list of changed files here (empty = nothing)")
    a = ap.parse_args()
    out = a.out
    global OUT_ROOT
    OUT_ROOT = out
    if a.mode == "fast":
        return run_fast(a)
    os.makedirs(os.path.join(out, "h"), exist_ok=True)
    prev = {}
    for p in [a.previous, os.path.join(out, "data.json")]:
        if p and os.path.exists(p):
            prev = load_json(p, {}) or {}
            if prev:
                break
    sources, data, timing = {}, {}, {}

    def src(name, ok, err=None, stale=False):
        sources[name] = {"ok": ok, "at": iso(NOW), "error": err, "stale": stale}

    def guarded(name, fn, prev_val=None, optional=False):
        """Run fn(); on failure return previous value (stale) and record the failure."""
        t = time.time()
        try:
            v = fn()
            src(name, True)
        except Exception as e:
            log("  %s fail: %s" % (name, e))
            v = prev_val
            src(name, False, str(e)[:200], stale=prev_val is not None)
        timing[name] = round(time.time() - t, 1)
        return v

    # ---- 1. index constituents + directory + requests ------------------------------------------
    t = time.time()
    idx, s = collect_indices({})
    sources["indices"] = s
    timing["indices"] = round(time.time() - t, 1)
    dir_us = guarded("directory", collect_directory, None)
    if dir_us is None:
        old = load_json(os.path.join(out, "dir.json"))
        dir_us = [[x[0], x[1], x[2], x[3]] for x in (old or []) if x[4] == "dir" and x[2] in ("Azione", "ETF")]
    dirmap = {x[0]: (x[1], x[2], x[3]) for x in dir_us}

    # ---- 2. core markets -------------------------------------------------------------------
    t = time.time()
    try:
        markets, s, top250, cg_ok = collect_markets(out, prev)
    except Exception as e:
        log("STEP FAIL markets", e)
        markets, s, top250, cg_ok = prev.get("markets") or [], {"ok": False, "at": iso(NOW), "error": str(e)[:200], "stale": True}, [], False
    sources["yahoo_markets"] = s
    sources["coingecko"] = {"ok": cg_ok, "at": iso(NOW), "error": None if cg_ok else "fallback list used", "stale": False}
    timing["markets"] = round(time.time() - t, 1)
    core_syms = {m["symbol"] for m in markets}
    names = {m["symbol"]: m["name"] for m in markets}

    # ---- 3. user requests ----------------------------------------------------------------------
    extra = [dict(x) for x in (prev.get("extra") or [])]
    extra_syms = {x["symbol"] for x in extra}
    req_results = {r.get("q"): r for r in (prev.get("requestsResult") or [])}
    pending = []     # (request, symbol, name, group)
    if a.requests:
        reqs = load_json(a.requests, []) or []
        for rq in reqs:
            q = (rq.get("q") or rq.get("symbol") or "").strip()
            if not q:
                continue
            sym, nm, qt = (rq.get("symbol") or None), rq.get("name"), None
            try:
                if not sym:
                    sym, nm, qt = resolve_request(q)
            except Exception as e:
                log("  resolve fail", q, e)
            if not sym:
                req_results[q] = {"q": q, "symbol": None, "name": None, "ok": False, "status": "non trovato", "tier": None}
                continue
            sym = sym.strip().upper() if re.match(r"^[A-Za-z0-9.\-=^]+$", sym) else sym
            if sym in core_syms:
                req_results[q] = {"q": q, "symbol": sym, "name": names.get(sym), "ok": True, "status": "ok", "tier": "core"}
            elif sym in extra_syms:
                req_results[q] = {"q": q, "symbol": sym, "name": nm or next((x.get("name") for x in extra if x["symbol"] == sym), None) or sym,
                                  "ok": True, "status": "ok", "tier": "lite"}
            else:
                pending.append((q, sym, nm or (dirmap.get(sym) or [None])[0], group_from_quote_type(qt, sym, dirmap)))

    # ---- 4. lite tier --------------------------------------------------------------------------
    tasks, seen, sp_syms = [], set(core_syms), set()
    for key, _, group in INDEX_SPECS:
        for sym, name, sector in idx.get(key, []):
            if key == "sp500":
                sp_syms.add(sym)
            if sym in seen:
                continue
            seen.add(sym)
            if key == "ndx" and not sector:
                sector = ""
            tasks.append((sym, name, group, sector))
    sector_of = {sym: sec for sym, _, sec in idx.get("sp500", [])}
    tasks = [(s_, n_, g_, sector_of.get(s_) or sec_) for s_, n_, g_, sec_ in tasks]
    for x in extra:
        if x["symbol"] not in seen:
            seen.add(x["symbol"])
            tasks.append((x["symbol"], x.get("name"), x.get("group") or guess_group(x["symbol"], dirmap), ""))
    pend_syms = set()
    for q, sym, nm, grp in pending:
        if sym not in seen:
            seen.add(sym); pend_syms.add(sym)
            tasks.append((sym, nm, grp, ""))
    t = time.time()
    old_shards = load_old_shards(os.path.join(out, "l"),
                                 os.path.join(os.path.dirname(os.path.abspath(a.previous)), "l") if a.previous else None)
    try:
        lite, lfailed, lstale = collect_lite(out, tasks, old_shards)
        bad = [(s_, e_) for s_, e_ in lfailed if s_ not in pend_syms]
        src("yahoo_lite", len(bad) <= max(5, len(tasks) * 0.03),
            ("%d/%d failed (%d kept from previous run): %s" % (len(bad), len(tasks), lstale, ", ".join(s_ for s_, _ in bad[:25]))) if bad else None,
            stale=lstale > 0)
        if bad:
            log("  lite failures:", len(bad), [s_ for s_, _ in bad[:40]])
    except Exception as e:
        log("STEP FAIL lite", e)
        lite, lfailed = {}, []
        src("yahoo_lite", False, str(e)[:200], True)
    timing["lite"] = round(time.time() - t, 1)
    # resolve pending requests
    failed_syms = {s_ for s_, _ in lfailed}
    for q, sym, nm, grp in pending:
        if sym in lite and sym not in failed_syms:
            extra.append({"symbol": sym, "name": lite[sym]["name"], "q": q, "addedAt": iso(NOW), "group": grp})
            extra_syms.add(sym)
            req_results[q] = {"q": q, "symbol": sym, "name": lite[sym]["name"], "ok": True, "status": "ok", "tier": "lite"}
        else:
            req_results[q] = {"q": q, "symbol": sym, "name": nm, "ok": False, "status": "non trovato", "tier": None}
    data["extra"] = extra
    data["requestsResult"] = list(req_results.values())
    # lite-tier names keep to the first spelling; core names win in the directory
    for sym, e in lite.items():
        names.setdefault(sym, e["name"])

    # ---- 5. analysis sections --------------------------------------------------------------------
    data["cot"] = guarded("cftc", collect_cot, prev.get("cot"))
    data["cryptoFng"] = guarded("crypto_fng", collect_crypto_fng, prev.get("cryptoFng"))
    lite_sp = {s_: lite[s_] for s_ in sp_syms if s_ in lite}
    data["sentiment"] = guarded("sentiment", lambda: collect_sentiment_wrap(lite_sp), prev.get("sentiment"))
    data["currencyStrength"] = guarded("currency_strength", lambda: collect_currency_strength(markets), prev.get("currencyStrength"))
    data["sectors"] = guarded("sectors", lambda: collect_sectors(markets), prev.get("sectors"))
    data["correlations"] = guarded("correlations", collect_correlations, prev.get("correlations"))
    movers = guarded("movers", lambda: collect_movers(markets, lite), (prev.get("movers") or None))
    tr_syms = guarded("trending", lambda: collect_trending(names), None)
    if movers is not None:
        look = {m["symbol"]: [m["symbol"], m["name"], m["price"], m["changePct"]] for m in markets}
        for s_, e in lite.items():
            look[s_] = [s_, e["name"], e["price"], e["changePct"]]
        if tr_syms:
            movers["trending"] = [look.get(s_) or [s_, (dirmap.get(s_) or [s_])[0], None, None] for s_ in tr_syms]
        elif "trending" not in movers:
            movers["trending"] = []
    data["movers"] = movers
    data["trending"] = (movers or {}).get("trending", [])
    us_syms = {m["symbol"] for m in markets if m["group"] == "Azioni USA"} | {s_ for s_, e in lite.items() if e["group"] == "Azioni USA"}
    er = guarded("earnings", lambda: collect_earnings(us_syms, names), prev.get("earnings"), optional=True)
    if er:
        data["earnings"] = er

    # ---- 6. news / macro / curve / calendar (unchanged logic) -------------------------------------
    steps = [
        ("news", lambda: collect_news(prev)),
        ("macro", lambda: collect_macro(prev)),
        ("curve", lambda: collect_curve(prev)),
        ("calendar", lambda: collect_calendar(prev)),
    ]
    for name, fn in steps:
        t = time.time()
        try:
            val, s = fn()
        except Exception as e:  # never crash
            log("STEP FAIL", name, e)
            val = prev.get(name) or ([] if name != "curve" else None)
            s = {"ok": False, "at": iso(NOW), "error": str(e)[:200], "stale": True}
        data[name] = val
        if name == "calendar":
            sources["forexfactory"] = s
        elif name == "curve":
            sources["treasury"] = s
        else:
            sources.update(s)
        timing[name] = round(time.time() - t, 1)
    data["markets"] = markets

    # ---- 7. lite index + directory -----------------------------------------------------------------
    lite_idx = [[s_, e["name"], e["group"], e["price"], e["changePct"], e["chgYtd"],
                 ((e.get("bias") or {}).get("daily") or {}).get("score")] for s_, e in sorted(lite.items())]
    write_if_changed(os.path.join(out, "lite.json"), json.dumps(lite_idx, separators=(",", ":"), ensure_ascii=False))
    dmap = {}
    for sym, name, typ, exch in dir_us:
        dmap[sym] = [sym, name, typ, exch, "dir"]
    for sym, name, grp, sec in tasks:
        pass
    for s_, e in lite.items():
        exch = e.get("exchange") or ""
        if "." in s_ and "." + s_.rsplit(".", 1)[1] in SUFFIX_EXCH:
            exch = SUFFIX_EXCH["." + s_.rsplit(".", 1)[1]]
        dmap[s_] = [s_, e["name"], type_of_group(e["group"], s_), exch, "lite"]
    for m in markets:
        dmap[m["symbol"]] = [m["symbol"], m["name"], type_of_group(m["group"], m["symbol"]), m["exchange"], "core"]
    for sym, name, rank, price, cid in top250:
        ys = sym + "-USD"
        if ys not in dmap:
            dmap[ys] = [ys, name, "Crypto", "Crypto", "dir"]
    dir_list = sorted(dmap.values(), key=lambda x: x[0])
    write_if_changed(os.path.join(out, "dir.json"), json.dumps(dir_list, separators=(",", ":"), ensure_ascii=False))

    doc = {"generatedAt": iso(NOW), "sources": sources}
    for k in ("markets", "news", "macro", "curve", "calendar", "cot", "sentiment", "cryptoFng", "currencyStrength",
              "movers", "trending", "sectors", "correlations", "earnings", "extra", "requestsResult"):
        if k in data and data[k] is not None:
            doc[k] = data[k]
    write_if_changed(os.path.join(out, "data.json"), json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    # symbol list for the fast mode (core + lite)
    write_if_changed(os.path.join(out, "symbols.json"),
                     json.dumps(sorted({m["symbol"] for m in markets} | set(lite)), separators=(",", ":")))
    finish_manifest(out, a)

    # ---- summary -----------------------------------------------------------------------------------
    print("== Terminale collector v2: %.0fs ==" % (time.time() - T0))
    for k, v in sources.items():
        print("  %-18s %s%s %s" % (k, "OK  " if v["ok"] else "FAIL", " (stale)" if v["stale"] else "", v["error"] or ""))
    from collections import Counter
    print("  core=%d (%s)" % (len(markets), dict(Counter(m["group"] for m in markets))))
    print("  lite=%d  dir=%d  extra=%d  news=%d macro=%d cot=%d earnings=%d calendar=%d" % (
        len(lite), len(dir_list), len(extra), len(doc.get("news", [])), len(doc.get("macro", [])),
        len(doc.get("cot") or []), len(doc.get("earnings") or []), len(doc.get("calendar") or [])))
    print("  step seconds:", timing)
    def sz(p): return os.path.getsize(p) / 1024
    print("  data.json=%.0fKB lite.json=%.0fKB dir.json=%.0fKB" % (
        sz(os.path.join(out, "data.json")), sz(os.path.join(out, "lite.json")), sz(os.path.join(out, "dir.json"))))
    for sub in ("h", "l"):
        d = os.path.join(out, sub)
        fs = [sz(os.path.join(d, f)) for f in os.listdir(d)] if os.path.isdir(d) else []
        if fs:
            print("  %s/ files=%d max=%.0fKB total=%.0fKB" % (sub, len(fs), max(fs), sum(fs)))
    nfiles = 3 + sum(len(os.listdir(os.path.join(out, s_))) for s_ in ("h", "l") if os.path.isdir(os.path.join(out, s_)))
    print("  published files (h+l+3 json) = %d" % nfiles)
    return 0


def finish_manifest(out, a):
    """Write manifest.json and report which files differ from the published manifest (or from the old local files)."""
    man = build_manifest(out)
    write_if_changed(os.path.join(out, "manifest.json"), json.dumps(man, separators=(",", ":")))
    prev = load_json(a.previous_manifest, None) if a.previous_manifest else None
    if prev and prev.get("files"):
        pf = prev["files"]
        changed = sorted([k for k, v in man["files"].items() if pf.get(k) != v] + [k for k in pf if k not in man["files"]])
    else:
        changed = sorted(man["files"])      # no reference: everything counts as new
    print("== changed vs %s: %d of %d files" % ("published manifest" if prev else "nothing (first run)", len(changed), len(man["files"])))
    for k in changed[:40]:
        print("   CHANGED", k)
    if len(changed) > 40:
        print("   ... +%d more" % (len(changed) - 40))
    print("== written locally in this run: %d files" % len(CHANGED))
    if a.changed_out:
        with open(a.changed_out, "w") as f:
            f.write("\n".join(changed) + ("\n" if changed else ""))


# ---------------------------------------------------------------- fast mode (live.json)
SPARK_URL = "https://query1.finance.yahoo.com/v8/finance/spark?symbols=%s&range=1d&interval=5m"


def spark_quotes(batch):
    """Yahoo spark for up to 20 symbols -> {sym: [price, change, changePct, tsUnix]}.
    Mapping vs the full mode (quote_stats): price = fulldayPrice (= regularMarketPrice, equal to the last 5m close),
    prev = previousClose (= chart meta previousClose; verified equal to regularMarketChangePercent's base for stocks,
    FX, crypto, indices). Known difference: futures/rates around holidays, where the full mode derives the previous close
    from regularMarketChangePercent; the next full run (hourly) re-aligns these values."""
    j = fetch_json(SPARK_URL % urllib.parse.quote(",".join(batch), safe=","), retries=3, timeout=25)
    res = {}
    for sym, v in (j or {}).items():
        if not isinstance(v, dict):
            continue
        close, ts = v.get("close") or [], v.get("timestamp") or []
        last = next((i for i in range(min(len(close), len(ts)) - 1, -1, -1) if num(close[i]) is not None), None)
        price = num(v.get("fulldayPrice"))
        if price is None and last is not None:
            price = close[last]
        prev = num(v.get("previousClose")) or num(v.get("chartPreviousClose"))
        if price is None or not prev:
            continue
        t = ts[last] if last is not None else int(NOW.timestamp())
        res[sym] = [rp(price), rp(price - prev), round((price / prev - 1) * 100, 2), t]
    return res


def run_fast(a):
    out = a.out
    os.makedirs(out, exist_ok=True)
    live_path = os.path.join(out, "live.json")
    prev = load_json(live_path, {}) or {}
    syms = load_json(a.symbols, None) if a.symbols else None
    if not syms:
        log("  no symbols.json: falling back to the core list")
        syms = sorted({s for s, *_ in U} | {s + "-USD" for s, _ in CRYPTO_FALLBACK})
    syms = [s for s in dict.fromkeys(syms) if isinstance(s, str) and re.match(r"^[A-Za-z0-9.\-=^]{1,20}$", s)]
    quotes = dict(prev.get("quotes") or {})     # keep the last known value for symbols that fail
    batches = [syms[i:i + 20] for i in range(0, len(syms), 20)]
    ok_b = 0

    def work(b):
        try:
            return spark_quotes(b)
        except Exception as e:
            log("  spark batch fail", b[:2], e)
            return None
    with cf.ThreadPoolExecutor(max_workers=CONC) as ex:
        for r in ex.map(work, batches):
            if r is not None:
                ok_b += 1
                quotes.update(r)
    symset = set(syms)
    quotes = {k: quotes[k] for k in sorted(quotes) if k in symset}
    news = prev.get("news") or []
    try:
        n, _ = collect_news(prev)
        if n:
            news = n[:80]
    except Exception as e:
        log("  news fail", e)
    cal = prev.get("calendar") or []
    # the calendar source rate-limits (429): ask it once, only every 15 minutes (or when we have nothing yet)
    if not cal or (NOW.minute // 5) % 3 == 0:
        try:
            c, _ = collect_calendar(prev, retries=1)
            if c:
                cal = c
        except Exception as e:
            log("  calendar fail", e)
    doc = {"generatedAt": iso(NOW), "quotes": quotes, "news": news, "calendar": cal}
    wrote = write_if_changed(live_path, json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    print("== fast: %d symbols, %d/%d batches ok, %.0fs -> live.json %s (%.0f KB)" % (
        len(syms), ok_b, len(batches), time.time() - T0, "CHANGED" if wrote else "unchanged", os.path.getsize(live_path) / 1024))
    if a.changed_out:
        with open(a.changed_out, "w") as f:
            f.write("live.json\n" if wrote else "")
    return 0


def collect_sentiment_wrap(lite_sp):
    return collect_sentiment(lite_sp)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:
        log("FATAL", e)
        sys.exit(1)
