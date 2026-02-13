#!/usr/bin/env bash
#
# stop.sh - Arresta Mondor Commander
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MC_DIR="$SCRIPT_DIR/mondor-commander"
PID_FILE="$MC_DIR/.mc.pid"

# ══════════════════════════════════════════════════════
# Colori ANSI
# ══════════════════════════════════════════════════════
FG_YELLOW='\033[1;33m'
FG_RED='\033[1;31m'
FG_GREEN='\033[1;32m'
BOLD='\033[1m'
NC='\033[0m'

if [ ! -f "$PID_FILE" ]; then
    echo -e "  ${FG_YELLOW}${BOLD}▓▓${NC} Mondor Commander non risulta in esecuzione (nessun PID file)."
    exit 0
fi

PID=$(cat "$PID_FILE")

if ! kill -0 "$PID" 2>/dev/null; then
    echo -e "  ${FG_YELLOW}${BOLD}▓▓${NC} Processo $PID non trovato (gia' terminato)."
    rm -f "$PID_FILE"
    exit 0
fi

echo -e "  ${FG_YELLOW}${BOLD}▓▓${NC} Arresto Mondor Commander (PID $PID)..."
kill "$PID" 2>/dev/null

# Attendi fino a 5 secondi per terminazione pulita
for i in $(seq 1 50); do
    if ! kill -0 "$PID" 2>/dev/null; then
        break
    fi
    sleep 0.1
done

# Se ancora attivo, forza con SIGKILL
if kill -0 "$PID" 2>/dev/null; then
    echo -e "  ${FG_RED}${BOLD}▓▓${NC} Terminazione forzata (SIGKILL)..."
    kill -9 "$PID" 2>/dev/null || true
fi

rm -f "$PID_FILE"
echo -e "  ${FG_GREEN}${BOLD}▓▓${NC} Server arrestato."
echo ""
