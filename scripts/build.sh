#!/usr/bin/env bash
# Prepara la cartella _site/ (pagina + dati) da pubblicare su GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
DATA_DIR="${1:-data}"
[ -f "$DATA_DIR/data.json" ] || { echo "Manca $DATA_DIR/data.json: il collector non ha prodotto dati" >&2; exit 1; }
rm -rf _site
mkdir -p _site
cp index.html manifest.webmanifest _site/
cp -r css js assets vendor _site/
cp -r "$DATA_DIR" _site/data
touch _site/.nojekyll
echo "_site pronto: $(find _site -type f | wc -l) file, $(du -sh _site | cut -f1)"
