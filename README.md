# Terminale — mercati ed economia, in chiaro

Un mini "terminale" gratuito per chi non è un professionista: prezzi di indici, materie prime, valute, crypto e migliaia di titoli, grafici, notizie, calendario economico, dati macro, bias tecnico e analisi di mercato. Tutto in italiano, tutto gratis, e **si aggiorna da solo** grazie a GitHub Actions (nessun server, nessun costo, nessun token di Claude).

> **Avviso.** Le informazioni sono a scopo puramente informativo. Bias, indicatori e segnali sono calcoli automatici: **non sono consigli d'investimento**, non sono una previsione e non sono un invito a comprare o vendere. I prezzi possono essere in ritardo o contenere errori.

---

## Come funziona (3 livelli di aggiornamento)

| Livello | Cosa aggiorna | Quanto spesso | Come |
|---|---|---|---|
| **Completo** | tutto: storici, grafici, bias, analisi, macro, notizie | ogni ora nei giorni feriali (ogni 3 ore nel weekend) | workflow `aggiorna-completo.yml` → ripubblica il sito su GitHub Pages **solo se qualcosa è cambiato** |
| **Veloce** | prezzi di tutti i titoli, notizie, calendario | ogni 5 minuti | workflow `aggiorna-veloce.yml` → scrive il solo file `live.json` sul branch `live` (un unico commit sovrascritto: la cronologia non cresce) |
| **Nel browser** | crypto (sempre), tutto il resto (solo con il Worker opzionale) | ogni 60 secondi | la pagina interroga Coinbase (crypto) e, se configurato, un Cloudflare Worker (azioni, valute, future) |

Sii realista sulle aspettative:

* **GitHub non permette di andare sotto i 5 minuti** per i lavori programmati, e sotto carico può far partire un'esecuzione con **qualche minuto di ritardo** (a volte anche saltarla). Per questo i prezzi "veloci" sono *quasi* in tempo reale, non in tempo reale.
* Il file `live.json` viene servito da `raw.githubusercontent.com`, che tiene la risposta **in cache fino a ~5 minuti**.
* **Ogni minuto, davvero**, lo hai solo per le **crypto** (Coinbase, già incluso) e per tutto il resto **solo se attivi il Worker opzionale** (vedi sotto). Senza Worker, azioni/valute/future si muovono ogni ~5 minuti.
* La pagina non fa nulla quando la scheda è in background e rallenta da sola se una fonte non risponde.

---

## Installazione passo per passo (10 minuti, nessuna competenza richiesta)

### 1. Crea il repository
1. Crea un account gratuito su <https://github.com> (se non ce l'hai).
2. In alto a destra: **+ → New repository**.
3. Nome, ad esempio, `terminale-mercati`. Scegli **Public** (vedi più sotto perché).
4. Premi **Create repository**.

### 2. Carica i file
*Metodo facile (dal browser):*
1. Decomprimi `terminale-mercati.zip` sul tuo computer.
2. Nel repository appena creato clicca **uploading an existing file**.
3. Trascina **tutto il contenuto** della cartella `terminale-mercati` (comprese le cartelle nascoste: `.github`, se il tuo sistema le nasconde, attiva "mostra file nascosti"). L'importante è che nella radice del repository ci siano `index.html`, `js/`, `css/`, `collector/`, `scripts/`, `.github/`…
4. Premi **Commit changes**.

*Metodo con git:* `git init`, `git add .`, `git commit -m "primo commit"`, `git branch -M main`, `git remote add origin <url>`, `git push -u origin main`.

> Il ramo principale deve chiamarsi **`main`**.

### 3. Attiva GitHub Pages
**Settings → Pages → Build and deployment → Source: _GitHub Actions_.** (Non servono altre impostazioni.)

### 4. Permessi per le Actions
**Settings → Actions → General → Workflow permissions →** lascia pure il valore predefinito: i workflow dichiarano da soli i permessi che servono (scrittura del branch `live`, pubblicazione di Pages, risposte alle richieste).

### 5. Avvia la prima raccolta
1. Vai nella scheda **Actions**. Se vedi un pulsante verde "I understand my workflows, go ahead and enable them", premilo.
2. Scegli **Aggiorna tutto (completo)** a sinistra → **Run workflow** → **Run workflow**.
3. Dopo 2–3 minuti compare il segno verde. Il sito è online.
4. Poi lancia nello stesso modo **Aggiorna prezzi (veloce)**: alla prima esecuzione **crea da solo il branch `live`**. Da quel momento i prezzi si aggiornano ogni ~5 minuti.

### 6. Dove trovi il sito
`https://<tuo-nome-utente>.github.io/<nome-repository>/`
(es. `https://mario.github.io/terminale-mercati/`). Se chiami il repository `<tuo-nome-utente>.github.io` il sito sarà direttamente su `https://<tuo-nome-utente>.github.io/`.
L'indirizzo esatto compare anche in **Settings → Pages** e nel riepilogo del workflow.

Sul telefono puoi "installarlo" come app: in Chrome/Android menu **⋮ → Aggiungi a schermata Home**, in Safari/iPhone **Condividi → Aggiungi a Home**.

---

## Chiedere un nuovo titolo

Nella barra di ricerca scrivi il nome di un'azienda, una crypto, un future…: se non è ancora nel terminale vedi **«Aggiungi al terminale»**. Il pulsante apre GitHub con una *issue* già compilata (titolo `Aggiungi: <nome>`, e se serve una riga `Simbolo: XYZ`): premi **Submit new issue** (serve un account GitHub gratuito). Appena la issue viene aperta parte l'aggiornamento completo, il titolo viene aggiunto e la issue viene commentata e chiusa. Se non lo trova, la issue resta aperta con un commento: modifica il titolo con il nome ufficiale o aggiungi `Simbolo: XYZ` (come su Yahoo Finance) e riprova.

Puoi anche aprire tu la issue a mano: titolo `Aggiungi: Palantir`, nel testo (facoltativo) `Simbolo: PLTR`.

---

## Prezzi ogni minuto per azioni, valute e future (opzionale: Cloudflare Worker)

Il browser non può interrogare Yahoo Finance da solo, quindi serve un piccolo "ponte" gratuito:

1. Crea un account gratuito su <https://dash.cloudflare.com/sign-up>.
2. Sul tuo computer installa [Node.js](https://nodejs.org) e, in una finestra del terminale, entra nella cartella `worker/` di questo progetto.
3. Esegui `npx wrangler login` (si apre il browser per autorizzare), poi `npx wrangler deploy`.
4. Il comando stampa un indirizzo tipo `https://terminale-prezzi.<tuo-account>.workers.dev`: copialo.
5. Apri il file `js/config.js`, scrivi l'indirizzo in `WORKER_URL`, salva il file e caricalo di nuovo su GitHub (parte da solo il ripubblicamento).
6. (Consigliato) in `worker/wrangler.toml` metti in `ALLOWED_ORIGIN` l'indirizzo del tuo sito (es. `https://mario.github.io`) e rilancia `npx wrangler deploy`, così solo il tuo sito può usarlo.

Il Worker fa passare **solo** l'endpoint "spark" di Yahoo, accetta al massimo 20 simboli per richiesta e mette i risultati in cache per 60 secondi: molti visitatori = poche richieste a Yahoo. Il piano gratuito di Cloudflare (100.000 richieste al giorno) basta per un uso personale o per pochi visitatori.

---

## Quanto costa? (minuti di GitHub Actions)

* **Repository pubblico: gratis e senza limiti di minuti.** È la scelta consigliata.
* **Repository privato:** il piano gratuito include **2.000 minuti al mese**. Il lavoro veloce parte ~288 volte al giorno e GitHub arrotonda ogni esecuzione al minuto: sono **~8.600 minuti/mese solo lui**, più ~600 esecuzioni complete al mese (~1.500–2.000 minuti). **Superi di molto il limite**: se vuoi un repository privato, riduci le frequenze (ad es. veloce ogni 30 minuti e completo ogni 3 ore) oppure usa un repository pubblico.

---

## Cambiare gli orari

Gli orari sono righe `cron` nei file di `.github/workflows/`. Il formato è `minuto ora giorno mese giorno-della-settimana` e l'orario è **UTC** (in Italia: UTC+1 d'inverno, UTC+2 d'estate).

* `aggiorna-veloce.yml` → `*/5 * * * *` = ogni 5 minuti (minimo possibile). Per ogni 15 minuti: `*/15 * * * *`.
* `aggiorna-completo.yml` → `7 * * * 1-5` = al minuto 7 di ogni ora dal lunedì al venerdì; `7 */3 * * 0,6` = ogni 3 ore sabato e domenica.

Dopo aver modificato, salva (commit): il nuovo orario vale subito.

---

## Se qualcosa non va

* **Il sito mostra "Non riesco a caricare i dati"**: lancia a mano **Aggiorna tutto (completo)** e controlla che finisca col segno verde; verifica **Settings → Pages → Source = GitHub Actions**.
* **Il workflow è rosso**: apri l'esecuzione e leggi il passaggio fallito. Il caso più comune è un'impostazione di Pages mancante.
* **Yahoo risponde 429 (Too Many Requests)**: è un limite temporaneo di Yahoo. Il collector riprova da solo e, se non ce la fa, **tiene i dati dell'ultima volta** segnandoli "non aggiornati" nel pannello *Fonti dei dati*. Di solito si risolve da solo al giro successivo.
* **Dati dell'inflazione/lavoro USA (BLS) "non aggiornati"**: la fonte limita le richieste anonime; il dato resta quello precedente finché non risponde.
* **Il calendario economico è vuoto o vecchio**: la fonte (ForexFactory) limita le richieste; si riprova da solo ogni 15 minuti.
* **I prezzi "veloci" sono in ritardo**: GitHub può ritardare i lavori programmati (anche di 10–20 minuti nelle ore di punta) e `raw.githubusercontent.com` usa una cache di ~5 minuti. Non è un guasto.
* **Dopo 60 giorni senza attività GitHub disattiva i workflow programmati**: se succede, in **Actions** premi **Enable workflow**; fare un qualsiasi commit sul ramo `main` li riattiva.
* **Il browser dice che `live.json` non si trova** (all'inizio): il branch `live` nasce alla prima esecuzione di *Aggiorna prezzi (veloce)*.
* **In locale** (per provare) non aprire `index.html` con doppio clic: i moduli JavaScript richiedono un server. Dalla cartella del sito: `python3 -m http.server 8000` e poi <http://localhost:8000/>. Per provare i prezzi live in locale: `http://localhost:8000/?live=data/live.json`.

---

## Com'è fatto

```
index.html, css/, js/ (moduli ES), assets/, manifest.webmanifest   la pagina (nessun bundler)
vendor/                                    TradingView Lightweight Charts 4.2.3 (Apache-2.0), incluso per non dipendere da CDN
collector/collect.py                       il raccoglitore (solo libreria standard di Python): --mode full | fast
scripts/                                   issues_to_requests.py, close_issues.py, build.sh
worker/                                    Cloudflare Worker opzionale
.github/workflows/                         aggiorna-completo.yml, aggiorna-veloce.yml
```

I dati **non** sono nel repository: il sito pubblicato li contiene (cartella `data/`) e il branch `live` contiene solo `live.json`.

**Fonti:** Yahoo Finance, CoinGecko, Coinbase, alternative.me, BCE, Eurostat, US Treasury, BLS, NY Fed, CFTC, Nasdaq Trader, Wikipedia, MarketWatch, ANSA, Federal Reserve, ForexFactory. Ogni fonte e il suo stato sono elencati nella pagina (*Fonti dei dati*).

Licenza: MIT (file `LICENSE`). La libreria dei grafici in `vendor/` ha la sua licenza (Apache-2.0).
