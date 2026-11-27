#!/usr/bin/env python3
"""Commenta e chiude le issue di richiesta in base a requestsResult.

Uso: close_issues.py data.json issues_map.json
Richiede la CLI `gh` con GH_TOKEN e GH_REPO. Con DRY_RUN=1 stampa soltanto.
"""
import json, os, subprocess, sys

DRY = os.environ.get("DRY_RUN") == "1"


def gh(*args):
    cmd = ["gh", *args]
    if DRY:
        print("[dry-run]", " ".join(cmd))
        return ""
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def main(argv):
    data = json.load(open(argv[1], encoding="utf-8"))
    mapping = json.load(open(argv[2], encoding="utf-8"))
    results = data.get("requestsResult") or []
    by_q = {str(r.get("q", "")).lower(): r for r in results}
    by_sym = {r.get("symbol"): r for r in results if r.get("symbol")}
    base = os.environ.get("SITE_URL", "")
    for m in mapping:
        n = str(m["issue"])
        r = by_q.get(str(m["q"]).lower()) or (by_sym.get(m["symbol"]) if m.get("symbol") else None)
        if not r:
            continue  # non elaborata in questo giro
        try:
            if r.get("ok"):
                nome = r.get("name") or r.get("symbol") or m["q"]
                tier = {"core": "con dati completi", "lite": "con grafico a 1 anno e bias"}.get(r.get("tier"), "")
                msg = "Fatto! **%s** (%s) è ora nel terminale%s. Lo trovi cercandolo nella barra in alto." % (
                    nome, r.get("symbol", ""), (" " + tier) if tier else "")
                if base:
                    msg += "\n\n" + base
                gh("issue", "close", n, "--comment", msg)
            else:
                labels = gh("issue", "view", n, "--json", "labels", "--jq", "[.labels[].name]|join(\",\")")
                if "non-trovato" in labels.split(","):
                    continue  # già avvisato, niente spam
                gh("label", "create", "non-trovato", "--force", "--color", "d73a4a",
                   "--description", "Titolo non trovato dal collector")
                gh("issue", "edit", n, "--add-label", "non-trovato")
                gh("issue", "comment", n, "--body",
                   "Non sono riuscito a trovare «%s». Prova a modificare il titolo della issue con il nome ufficiale oppure "
                   "aggiungi nel testo una riga `Simbolo: XYZ` (il simbolo come appare su Yahoo Finance). "
                   "Al prossimo aggiornamento riproverò." % m["q"])
        except subprocess.CalledProcessError as e:
            print("issue %s: errore gh: %s" % (n, (e.stderr or "")[:200]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
