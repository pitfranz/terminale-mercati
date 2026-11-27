#!/usr/bin/env python3
"""Converte le issue aperte (JSON di `gh issue list`) in requests.json per il collector.

Uso: issues_to_requests.py issues.json requests.json [issues_map.json]

Una issue e' una richiesta se il titolo inizia con "Aggiungi:" oppure ha l'etichetta `richiesta`.
Titolo:  "Aggiungi: <testo>"        -> q = <testo>
Corpo (opzionale): righe "Simbolo: XYZ" e "Nome: ..."
Il contenuto delle issue e' testo non fidato: viene ripulito e limitato.
"""
import json, re, sys
from datetime import datetime, timezone

MAX_REQUESTS = 20
SYM_RE = re.compile(r"^[A-Za-z0-9.^=\-]{1,20}$")


def clean(text, n):
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text or "")
    return re.sub(r"\s+", " ", text).strip()[:n]


def parse(issue):
    title = issue.get("title") or ""
    labels = {(l.get("name") if isinstance(l, dict) else str(l)) for l in (issue.get("labels") or [])}
    m = re.match(r"\s*aggiungi\s*:\s*(.*)$", title, re.I | re.S)
    if not m and "richiesta" not in labels:
        return None
    q = clean(m.group(1) if m else title, 100)
    sym = name = None
    for line in (issue.get("body") or "").splitlines():
        mm = re.match(r"\s*(simbolo|symbol|ticker)\s*:\s*(.*)$", line, re.I)
        if mm and not sym:
            cand = clean(mm.group(2), 20)
            if SYM_RE.match(cand):
                sym = cand
            continue
        mm = re.match(r"\s*nome\s*:\s*(.*)$", line, re.I)
        if mm and not name:
            name = clean(mm.group(1), 100) or None
    if not q:
        q = sym or name or ""
    if not q:
        return None
    return {"q": q, "symbol": sym, "name": name}


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    try:
        issues = json.load(open(argv[1], encoding="utf-8"))
    except Exception:
        issues = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reqs, mapping, seen = [], [], set()
    for it in sorted(issues, key=lambda i: i.get("number", 0)):
        r = parse(it)
        if not r:
            continue
        mapping.append({"issue": it.get("number"), "q": r["q"], "symbol": r["symbol"]})
        key = (r["symbol"] or r["q"]).lower()
        if key in seen or len(reqs) >= MAX_REQUESTS:
            continue
        seen.add(key)
        r["at"] = now
        reqs.append(r)
    json.dump(reqs, open(argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if len(argv) > 3:
        json.dump(mapping, open(argv[3], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("richieste dalle issue: %d (su %d issue aperte)" % (len(reqs), len(issues)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
