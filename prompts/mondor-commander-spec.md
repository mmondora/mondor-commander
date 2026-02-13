# Mondor Commander (MC) — Product Specification

## Overview

**Mondor Commander** è un tool CLI che analizza una o due directory e serve un'interfaccia web interattiva ispirata a Norton Commander (MS-DOS). L'interfaccia permette confronto file, rilevamento duplicati, analisi spazio disco con clustering visuale, il tutto in un'estetica retro DOS-style.

### Invocazione

```bash
mc <path1> [path2]
```

- **Due path**: confronto diretto tra le due directory
- **Un path**: analisi singola directory (browsing, duplicati, spazio disco)

All'avvio, MC:
1. Esegue il parsing ricorsivo delle directory fornite
2. Calcola hash, dimensioni, metadati
3. Avvia un web server locale (porta default: `8333`, configurabile con `--port`)
4. Apre automaticamente il browser (disattivabile con `--no-open`)
5. Serve l'interfaccia HTML interattiva

---

## Stack Tecnologico

| Componente | Tecnologia |
|---|---|
| Runtime | Node.js >= 18 |
| Web Server | Express.js (minimale) |
| Frontend | Single HTML file, vanilla JS + CSS (zero framework) |
| Hashing | Node.js `crypto` (SHA-256, chunk-based per file grandi) |
| File system | Node.js `fs/promises` con ricorsione |
| Package | npm, eseguibile via `npx mondor-commander` o installazione globale |

### Motivazione stack
Nessun framework frontend: l'estetica è retro DOS, la semplicità è un valore. Un singolo file HTML con CSS inline e JS vanilla riduce complessità, dipendenze e tempo di build a zero. Express è sufficiente per servire file statici e una REST API minimale.

---

## Architettura

```
┌─────────────────────────────────────────────────┐
│                    CLI (mc)                       │
│  - Arg parsing (commander.js)                    │
│  - Validazione path                              │
│  - Orchestrazione scan + server                  │
└──────────────┬──────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌──────────┐      ┌──────────────┐
│ Scanner  │      │ Web Server   │
│ Engine   │      │ (Express)    │
│          │      │              │
│ - Walk   │      │ GET /api/... │
│ - Hash   │      │ GET /        │
│ - Stats  │      │ WS (progress)│
└────┬─────┘      └──────┬───────┘
     │                   │
     ▼                   ▼
┌──────────┐      ┌──────────────┐
│ Analysis │      │ Frontend     │
│ Engine   │      │ (HTML single │
│          │      │  file)       │
│ - Diff   │      │              │
│ - Dupes  │      │ - Dual pane  │
│ - Space  │      │ - Treemap    │
│ - Cluster│      │ - Diff view  │
└──────────┘      └──────────────┘
```

### Flusso dati

1. **Scan fase** (asincrono, con progress via WebSocket):
   - Walk ricorsivo delle directory
   - Per ogni file: `stat()` → dimensione, date, permessi
   - Hash SHA-256 (streaming, chunk 64KB per non saturare memoria)
   - Risultato: array di `FileEntry` objects

2. **Analysis fase** (post-scan):
   - Costruzione indici per path, hash, dimensione, estensione
   - Calcolo duplicati (same hash, different path)
   - Se due directory: diff set (only-left, only-right, common, modified)
   - Clustering per tipo/estensione e dimensione
   - Aggregazione spazio disco per directory (treemap data)

3. **Serve fase**:
   - API REST per dati analizzati (JSON)
   - Frontend HTML che consuma le API
   - WebSocket per progress dello scan iniziale

---

## Data Model

### FileEntry

```typescript
interface FileEntry {
  path: string;          // path relativo alla root della directory
  absolutePath: string;  // path assoluto
  name: string;          // filename
  extension: string;     // estensione (lowercase, senza punto)
  size: number;          // bytes
  sizeHuman: string;     // "1.2 MB"
  hash: string;          // SHA-256
  modified: string;      // ISO date
  created: string;       // ISO date
  isDirectory: boolean;
  isSymlink: boolean;
  permissions: string;   // unix-style "rwxr-xr-x"
  depth: number;         // profondità dalla root
}
```

### ScanResult

```typescript
interface ScanResult {
  root: string;
  totalFiles: number;
  totalDirs: number;
  totalSize: number;
  totalSizeHuman: string;
  scanDuration: number;  // ms
  files: FileEntry[];
  tree: TreeNode[];      // struttura ad albero per navigazione
}
```

### ComparisonResult (solo modalità due directory)

```typescript
interface ComparisonResult {
  onlyLeft: FileEntry[];      // file presenti solo in dir1
  onlyRight: FileEntry[];     // file presenti solo in dir2
  common: FileEntry[];        // file identici (stesso path relativo + stesso hash)
  modified: ModifiedFile[];   // stesso path relativo, hash diverso
  duplicates: DuplicateGroup[]; // file con stesso hash in posizioni diverse
}

interface ModifiedFile {
  relativePath: string;
  left: FileEntry;
  right: FileEntry;
  sizeDiff: number;
  newerSide: 'left' | 'right';
}

interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileEntry[];  // tutti i file con questo hash (da entrambe le dir)
}
```

### SpaceAnalysis

```typescript
interface SpaceAnalysis {
  byExtension: { extension: string; count: number; totalSize: number; }[];
  byDirectory: { path: string; totalSize: number; fileCount: number; }[];
  treemapData: TreemapNode[];  // per visualizzazione treemap
  largestFiles: FileEntry[];   // top 50 file per dimensione
  emptyFiles: FileEntry[];
  emptyDirs: string[];
}

interface TreemapNode {
  name: string;
  size: number;
  children?: TreemapNode[];
  file?: FileEntry;  // solo per foglie
}
```

---

## API REST

Base URL: `http://localhost:8333/api`

| Endpoint | Metodo | Descrizione |
|---|---|---|
| `/api/status` | GET | Stato scan (scanning/ready), progresso % |
| `/api/scan/left` | GET | ScanResult directory sinistra |
| `/api/scan/right` | GET | ScanResult directory destra (404 se modalità singola) |
| `/api/compare` | GET | ComparisonResult (404 se modalità singola) |
| `/api/space/left` | GET | SpaceAnalysis directory sinistra |
| `/api/space/right` | GET | SpaceAnalysis directory destra |
| `/api/duplicates` | GET | Lista DuplicateGroup globale |
| `/api/browse?side=left&path=/sub/dir` | GET | Listing di una sottodirectory specifica |
| `/api/file-content?side=left&path=/file.txt` | GET | Contenuto testuale di un file (solo text/*, max 1MB) |

### WebSocket `/ws`

Eventi emessi dal server durante lo scan:

```json
{ "type": "scan:progress", "side": "left", "scanned": 1234, "found": 5678 }
{ "type": "scan:complete", "side": "left", "duration": 3400 }
{ "type": "analysis:complete" }
{ "type": "error", "message": "..." }
```

---

## Interfaccia Utente — Design

### Estetica: Norton Commander DOS

L'interfaccia replica fedelmente il look-and-feel di Norton Commander:

- **Font**: monospace (suggerito: `"IBM Plex Mono"`, fallback `"Courier New"`, `monospace`)
- **Colori**: sfondo blu scuro (`#000080`), testo cyan (`#00FFFF`), header giallo (`#FFFF00`), selezione su sfondo cyan con testo nero, bordi fatti con caratteri box-drawing Unicode (`─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`)
- **Layout**: nessun bordo CSS arrotondato, nessuna ombra, nessun gradiente. Tutto pixel-perfect retro.
- **Animazioni**: nessuna (o minime, tipo cursore lampeggiante)

### Layout principale

```
┌─────────────────────────────┬─────────────────────────────┐
│  /home/user/project-a       │  /home/user/project-b       │
│  ─────────────────────────  │  ─────────────────────────  │
│  ..                    <DIR> │  ..                    <DIR> │
│  src/                  <DIR> │  src/                  <DIR> │
│  README.md            2.4KB │  README.md            2.1KB │
│  package.json         1.1KB │  package.json         1.1KB │
│  index.js             4.5KB │  index.js             8.2KB │ ← evidenziato diverso
│                              │  extra.js             1.0KB │ ← solo a destra
│                              │                              │
├─────────────────────────────┴─────────────────────────────┤
│ F1 Help  F3 View  F5 Compare  F6 Space  F7 Dupes  F10 Quit│
└───────────────────────────────────────────────────────────┘
```

### Viste (Tab/F-keys)

#### 1. **Browser** (default, F1)
Dual-pane classico Norton Commander. Navigazione directory con click o tastiera (frecce, Enter, Backspace). Se modalità singola directory, un solo pannello centrato.

Codice colore file:
- 🟢 Verde: identico in entrambe le directory
- 🔴 Rosso: presente solo in questa directory
- 🟡 Giallo: presente in entrambe ma modificato (hash diverso)
- ⚪ Bianco: file normali (modalità singola directory)
- 🔵 Blu: directory

#### 2. **Compare** (F5, solo dual mode)
Vista confronto dettagliata:
- Pannello sinistro: file solo a sinistra
- Pannello centrale: file modificati (con delta size e data)
- Pannello destro: file solo a destra
- Statistiche riassuntive in alto

#### 3. **Space Analysis** (F6)
Treemap interattivo dello spazio disco:
- Rettangoli proporzionali alla dimensione
- Colore per tipo file (estensione)
- Click per drill-down nelle sottodirectory
- Sidebar con top-50 file più grandi e breakdown per estensione
- Se dual mode: treemap affiancati per confronto visuale

#### 4. **Duplicates** (F7)
Lista duplicati raggruppati per hash:
- Ogni gruppo mostra: hash (troncato), dimensione, e tutti i path
- Ordinabile per: dimensione sprecata, numero copie
- Summary in alto: spazio totale recuperabile eliminando i duplicati
- Se dual mode: evidenzia duplicati cross-directory

#### 5. **File Viewer** (F3, su file selezionato)
Overlay/modal che mostra:
- Contenuto testo per file testuali (syntax highlighting basico con highlight.js da CDN)
- Info metadati per file binari
- Se dual mode e file presente in entrambe: diff side-by-side (solo per file testuali, con evidenziazione righe aggiunte/rimosse)

### Barra di stato (footer)

Sempre visibile:
```
Left: 1,234 files | 45.6 MB    Right: 1,567 files | 52.3 MB    Scan: 2.1s
```

### Keyboard shortcuts

| Tasto | Azione |
|---|---|
| `Tab` | Switch focus tra pannelli |
| `↑/↓` | Navigazione file |
| `Enter` | Entra in directory / apri file viewer |
| `Backspace` | Directory su |
| `F1` | Vista Browser |
| `F3` | File Viewer |
| `F5` | Vista Compare |
| `F6` | Vista Space |
| `F7` | Vista Duplicates |
| `F10` o `q` | Chiudi (mostra conferma) |
| `/` | Quick search/filter nel pannello corrente |

---

## CLI Options

```
Usage: mc [options] <path1> [path2]

Arguments:
  path1          First directory to analyze
  path2          Second directory to compare (optional)

Options:
  -p, --port <number>      Server port (default: 8333)
  --no-open                Don't auto-open browser
  --max-depth <number>     Max recursion depth (default: unlimited)
  --max-file-size <size>   Skip hashing files larger than this (default: "1GB")
  --exclude <patterns...>  Glob patterns to exclude (default: node_modules, .git, .DS_Store)
  --no-hash                Skip SHA-256 hashing (faster, no duplicate detection)
  --follow-symlinks        Follow symbolic links (default: false)
  -v, --verbose            Verbose logging
  -h, --help               Show help
  -V, --version            Show version
```

---

## Struttura Progetto

```
mondor-commander/
├── package.json
├── bin/
│   └── mc.js                    # CLI entry point (#!/usr/bin/env node)
├── src/
│   ├── cli.js                   # Arg parsing con commander.js
│   ├── scanner/
│   │   ├── walker.js            # Ricorsione filesystem
│   │   ├── hasher.js            # SHA-256 streaming
│   │   └── analyzer.js          # Post-processing (duplicati, space, diff)
│   ├── server/
│   │   ├── index.js             # Express setup + routes
│   │   ├── api.js               # API handlers
│   │   └── websocket.js         # WS per progress
│   └── frontend/
│       └── index.html           # *** SINGOLO FILE: HTML + CSS + JS ***
├── test/
│   ├── scanner.test.js
│   ├── analyzer.test.js
│   └── fixtures/                # Directory di test con strutture note
└── README.md
```

---

## Performance e Limiti

### Soglie operative
- **< 10,000 file**: scan + hash in pochi secondi, tutto in memoria → OK
- **10,000 - 100,000 file**: scan progressivo con progress bar, hashing parallelizzato (worker pool con `Promise.all` e concurrency limit di 10)
- **> 100,000 file**: warning all'utente, suggerimento di usare `--exclude` o `--max-depth`. Funziona ma può richiedere minuti.

### Hashing
- Streaming con chunk da 64KB per non caricare file interi in memoria
- File > `--max-file-size` vengono saltati per l'hash (segnalati come "not hashed")
- Hashing parallelizzato con pool limitato (default: 10 file concurrent)

### Frontend
- Il treemap usa `<canvas>` per performance con molti rettangoli
- La lista file usa virtual scrolling se > 1000 items (implementazione minimale: renderizza solo le righe visibili)
- I dati vengono fetchati via API, non embedded nell'HTML

---

## Milestone di Sviluppo

### M1 — CLI + Scanner (Foundation)
- [ ] Setup progetto npm, bin/mc.js, commander.js
- [ ] Walker ricorsivo con glob exclude
- [ ] Hasher streaming SHA-256
- [ ] Output console basico (conteggi, dimensioni)
- [ ] Test unitari per walker e hasher

### M2 — Analysis Engine
- [ ] Costruzione indici (by-hash, by-path, by-extension)
- [ ] Rilevamento duplicati
- [ ] Calcolo diff tra due directory (only-left, only-right, common, modified)
- [ ] Aggregazione spazio per estensione e directory
- [ ] Generazione dati treemap
- [ ] Test unitari per analyzer

### M3 — Web Server + API
- [ ] Express server con tutte le route API
- [ ] WebSocket per progress scan
- [ ] Endpoint browse per navigazione sottodirectory
- [ ] Endpoint file-content per visualizzazione file testuali
- [ ] Auto-apertura browser

### M4 — Frontend: Browser View
- [ ] Layout Norton Commander (dual pane, box drawing chars)
- [ ] CSS retro DOS (colori, font monospace, no decorazioni moderne)
- [ ] Navigazione directory con click e tastiera
- [ ] Codice colore file (identico/diverso/solo-qui)
- [ ] Barra di stato con statistiche
- [ ] Progress bar durante scan iniziale

### M5 — Frontend: Compare + Space + Duplicates
- [ ] Vista Compare (three-column diff summary)
- [ ] Vista Space con treemap canvas
- [ ] Drill-down treemap click
- [ ] Top-50 file più grandi, breakdown per estensione
- [ ] Vista Duplicates con raggruppamento e statistiche
- [ ] Sidebar spazio recuperabile

### M6 — Frontend: File Viewer + Polish
- [ ] Modal/overlay file viewer
- [ ] Syntax highlighting basico (highlight.js da CDN)
- [ ] Diff side-by-side per file modificati (algoritmo diff semplice, riga per riga)
- [ ] Quick search/filter (`/`)
- [ ] F-key shortcuts tutti funzionanti
- [ ] Responsive: se finestra stretta, pannelli in stack verticale

### M7 — Packaging + Docs
- [ ] README con screenshot ASCII e istruzioni
- [ ] `npx mondor-commander` funzionante
- [ ] npm publish ready
- [ ] Edge cases: symlink loop detection, permessi negati, path Unicode

---

## Note Implementative per Claude Code

### Priorità assolute
1. **L'estetica DOS è non negoziabile**: se non sembra Norton Commander, è sbagliato. I box-drawing characters, i colori DOS, il font monospace sono requisiti funzionali, non decorativi.
2. **Singolo file HTML**: tutto il frontend deve stare in `src/frontend/index.html`. CSS in `<style>`, JS in `<script>`. Nessun bundler, nessun build step.
3. **Funziona con un path o due**: la modalità singola directory non è un caso degradato, è un'esperienza completa (browse, space, duplicates). Le viste "Compare" e le colonne colorate sono semplicemente disabilitate.

### Pattern da seguire
- Usa `async/await` ovunque, no callback
- Usa `fs/promises` mai `fs` sincrono
- Express route handlers: gestione errori con try/catch e risposta 500 strutturata
- Il frontend fa polling su `/api/status` finché lo scan non è completo, poi fetcha i dati
- Nessuna dipendenza frontend (no React, no Vue, no jQuery) — solo DOM API native
- Per il treemap: implementazione canvas custom, algoritmo squarified treemap
- Per il diff testuale: implementazione basica LCS (longest common subsequence)

### Dipendenze npm consentite
```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "express": "^4.18.0",
    "ws": "^8.16.0",
    "open": "^10.0.0",
    "glob": "^10.0.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
```

### Cosa NON fare
- Non usare TypeScript (vanilla JS con JSDoc per type hints se necessario)
- Non usare bundler (webpack, vite, ecc.)
- Non caricare librerie CSS esterne
- Non usare framework frontend
- Non fare file watching / hot reload (non è un dev server)
- Non implementare operazioni di copia/move/delete file (solo visualizzazione)
- Non leggere file binari per il viewer (solo text/*)

---

## Esempio di sessione

```bash
$ mc ~/projects/app-v1 ~/projects/app-v2
🔍 Scanning /Users/michele/projects/app-v1...
🔍 Scanning /Users/michele/projects/app-v2...
████████████████████████████ 100% | 2,341 files scanned in 1.8s

🌐 Mondor Commander running at http://localhost:8333
   Press Ctrl+C to stop
```

Il browser si apre automaticamente mostrando il dual-pane con i file colorati.

---

*Mondor Commander — "I see you have two directories..."*
