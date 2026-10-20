#!/usr/bin/env bash
# Serves the Matrix Table extension on http://localhost:8770 — the URL in
# "matrix-table localhost.trex" — and lists Tableau shape palettes for the Format dialog's icon pickers.
# Dev preview (no Tableau needed): http://localhost:8770/dev/preview.html
set -euo pipefail
cd "$(dirname "$0")"
exec python3 serve.py
