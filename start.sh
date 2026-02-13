#!/usr/bin/env bash
#
# start.sh - Avvia Mondor Commander
#
# Uso:
#   ./start.sh <dir1> [dir2] [opzioni]
#
# Esempio:
#   ./start.sh ~/Documenti ~/Backup
#   ./start.sh /tmp/progetto
#   ./start.sh /tmp/v1 /tmp/v2 --port 9000 --no-open

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MC_DIR="$SCRIPT_DIR/mondor-commander"

# ══════════════════════════════════════════════════════
# Colori ANSI — stile DOS bold
# ══════════════════════════════════════════════════════
BG_BLUE='\033[44m'
FG_CYAN='\033[1;36m'
FG_YELLOW='\033[1;33m'
FG_WHITE='\033[1;37m'
FG_RED='\033[1;31m'
FG_GREEN='\033[1;32m'
FG_GRAY='\033[0;37m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ══════════════════════════════════════════════════════
# Banner
# ══════════════════════════════════════════════════════
banner() {
    echo ""
    echo -e "${FG_CYAN}${BOLD}"
    echo '  ╔══════════════════════════════════════════════════════════╗'
    echo '  ║                                                          ║'
    echo '  ║   ███╗   ███╗ ██████╗ ███╗   ██╗██████╗  ██████╗ ██████╗║'
    echo '  ║   ████╗ ████║██╔═══██╗████╗  ██║██╔══██╗██╔═══██╗██╔══██║'
    echo '  ║   ██╔████╔██║██║   ██║██╔██╗ ██║██║  ██║██║   ██║██████╔║'
    echo '  ║   ██║╚██╔╝██║██║   ██║██║╚██╗██║██║  ██║██║   ██║██╔══██║'
    echo '  ║   ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║██████╔╝╚██████╔╝██║  ██║'
    echo '  ║   ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚═╝  ╚═║'
    echo '  ║                                                          ║'
    echo -e "  ║   ${FG_YELLOW}C O M M A N D E R${FG_CYAN}                    ${DIM}v1.0.0${NC}${FG_CYAN}${BOLD}   ║"
    echo '  ║                                                          ║'
    echo '  ╚══════════════════════════════════════════════════════════╝'
    echo -e "${NC}"
}

# ══════════════════════════════════════════════════════
# Box con bordi DOS
# ══════════════════════════════════════════════════════
box_line() {
    echo -e "  ${FG_CYAN}│${NC}  $1"
}

box_top() {
    echo -e "  ${FG_CYAN}┌──────────────────────────────────────────────────────────┐${NC}"
}

box_bottom() {
    echo -e "  ${FG_CYAN}└──────────────────────────────────────────────────────────┘${NC}"
}

box_sep() {
    echo -e "  ${FG_CYAN}├──────────────────────────────────────────────────────────┤${NC}"
}

# ══════════════════════════════════════════════════════
# Usage
# ══════════════════════════════════════════════════════
usage() {
    echo ""
    box_top
    box_line "${FG_YELLOW}${BOLD}USO:${NC}"
    box_line ""
    box_line "  ${FG_WHITE}$0 <dir_sinistra> [dir_destra] [opzioni]${NC}"
    box_line ""
    box_sep
    box_line "${FG_YELLOW}${BOLD}OPZIONI:${NC}"
    box_line ""
    box_line "  ${FG_GREEN}--port PORTA${NC}        Porta HTTP (default: 8333)"
    box_line "  ${FG_GREEN}--no-open${NC}           Non aprire il browser"
    box_line "  ${FG_GREEN}--no-hash${NC}           Salta hashing SHA-256 (piu' veloce)"
    box_line "  ${FG_GREEN}--max-depth N${NC}       Profondita' massima ricorsione"
    box_line "  ${FG_GREEN}--exclude PATTERN${NC}   Pattern glob da escludere"
    box_line "  ${FG_GREEN}-v, --verbose${NC}       Log dettagliato"
    box_line ""
    box_sep
    box_line "${FG_YELLOW}${BOLD}ESEMPI:${NC}"
    box_line ""
    box_line "  ${FG_GRAY}# Confronta due directory${NC}"
    box_line "  ${FG_WHITE}$0 ~/progetti/v1 ~/progetti/v2${NC}"
    box_line ""
    box_line "  ${FG_GRAY}# Analizza singola directory${NC}"
    box_line "  ${FG_WHITE}$0 ~/progetti/app${NC}"
    box_line ""
    box_line "  ${FG_GRAY}# Porta custom, senza browser${NC}"
    box_line "  ${FG_WHITE}$0 /tmp/a /tmp/b --port 9000 --no-open${NC}"
    box_line ""
    box_bottom
    echo ""
}

# ══════════════════════════════════════════════════════
# Errore formattato
# ══════════════════════════════════════════════════════
die() {
    echo -e "  ${FG_RED}${BOLD}██ ERRORE:${NC} ${FG_RED}$1${NC}" >&2
    echo ""
    exit 1
}

# ══════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════
banner

# Verifica argomenti minimi
if [ $# -lt 1 ]; then
    echo -e "  ${FG_RED}${BOLD}██ ERRORE:${NC} ${FG_RED}Serve almeno una directory.${NC}"
    usage
    exit 1
fi

# Verifica Node.js
if ! command -v node &>/dev/null; then
    die "node non trovato. Installare Node.js >= 18."
fi

NODE_VER=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_VER" -lt 18 ] 2>/dev/null; then
    die "Serve Node.js >= 18. Trovato: $(node --version)"
fi

# Verifica che mondor-commander esista
if [ ! -d "$MC_DIR" ]; then
    die "Directory mondor-commander/ non trovata in $SCRIPT_DIR"
fi

# npm install se necessario
if [ ! -d "$MC_DIR/node_modules" ]; then
    echo -e "  ${FG_YELLOW}▓▓${NC} Installazione dipendenze..."
    (cd "$MC_DIR" && npm install --silent) || die "npm install fallito"
    echo -e "  ${FG_GREEN}▓▓${NC} Dipendenze installate."
    echo ""
fi

# Raccogli il primo argomento (dir1)
DIR1="$1"
shift

# Controlla se il secondo argomento e' una directory (non un'opzione)
DIR2=""
if [ $# -gt 0 ] && [ "${1:0:1}" != "-" ] && [ -d "$1" ]; then
    DIR2="$1"
    shift
fi

# Verifica directory
if [ ! -d "$DIR1" ]; then
    die "'$DIR1' non esiste o non e' una directory."
fi

if [ -n "$DIR2" ] && [ ! -d "$DIR2" ]; then
    die "'$DIR2' non esiste o non e' una directory."
fi

# Mostra configurazione
box_top
if [ -n "$DIR2" ]; then
    box_line "${FG_YELLOW}${BOLD}MODALITA':${NC}  ${FG_WHITE}Confronto directory${NC}"
    box_line "${FG_YELLOW}${BOLD}SINISTRA:${NC}   ${FG_GREEN}$(cd "$DIR1" && pwd)${NC}"
    box_line "${FG_YELLOW}${BOLD}DESTRA:${NC}     ${FG_GREEN}$(cd "$DIR2" && pwd)${NC}"
else
    box_line "${FG_YELLOW}${BOLD}MODALITA':${NC}  ${FG_WHITE}Analisi singola directory${NC}"
    box_line "${FG_YELLOW}${BOLD}DIRECTORY:${NC}  ${FG_GREEN}$(cd "$DIR1" && pwd)${NC}"
fi
box_bottom
echo ""

# Avvia Mondor Commander
echo -e "  ${FG_CYAN}${BOLD}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${NC}"
echo -e "  ${FG_CYAN}${BOLD}▓▓${NC}  ${FG_WHITE}Avvio Mondor Commander...${NC}"
echo -e "  ${FG_CYAN}${BOLD}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${NC}"
echo ""

if [ -n "$DIR2" ]; then
    exec node "$MC_DIR/bin/mc.js" "$DIR1" "$DIR2" "$@"
else
    exec node "$MC_DIR/bin/mc.js" "$DIR1" "$@"
fi
