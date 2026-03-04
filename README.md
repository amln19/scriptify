# Scriptify

A Spicetify extension that adds a lyrics toggle to Spotify — switch between **Original** and **Romanized** lyrics with a single click. Spotify only shows lyrics in their original script, which isn't helpful if you can't read Devanagari, Hangul, or Kanji. Scriptify fixes that.

## Features

- 🔄 **Lyrics toggle** — switch between Original and Romanized (Latin transliteration) modes
- 🌍 **12+ writing systems** — Devanagari, Tamil, Bengali, Telugu, Kannada, Gujarati, Malayalam, Gurmukhi, Odia, Japanese (Hiragana/Katakana), Korean (Hangul), Chinese (CJK)
- 🇮🇳 **Purpose-built Hindi romanizer** — direct Devanagari → Hinglish parser with schwa deletion, nuqta handling, and a 500+ word lookup dictionary for natural results (bypasses IAST entirely)
- 🎯 **Playbar integration** — button sits in the bottom-right now-playing bar, right next to the native lyrics/queue/volume controls
- ⌨️ **Keyboard shortcuts** — `Ctrl+Shift+L` to toggle modes, `Ctrl+Shift+;` for settings
- 💾 **Persistent preferences** — mode choice is saved across sessions
- ⚡ **Zero flash** — a narrow MutationObserver + 100ms interval engine re-applies replacements before React re-renders can flash the original script
- 🔇 **Graceful degradation** — if romanization fails, the extension silently falls back to original lyrics with no visible errors

## Tech Stack

- **TypeScript** — strict mode, full type coverage
- **esbuild** — bundled as a single IIFE file (~214kb) for Spicetify's extension loader
- **Spicetify API** — `Playbar.Button`, `PopupModal`, `CosmosAsync`, `Player` events, `LocalStorage`, `Platform.History`
- **@indic-transliteration/sanscript** — IAST transliteration for non-Hindi Indic scripts (Tamil, Bengali, Gujarati, etc.)
- **Spotify Internal Lyrics API** — `spclient.wg.spotify.com/color-lyrics/v2` for full lyrics + language detection
- **LRCLIB API** — fallback lyrics source when Spotify's API is unavailable

## Getting Started

### Prerequisites

- **Node.js** (v18+) and **npm**
- **Spotify** desktop app
- **[Spicetify CLI](https://spicetify.app/docs/getting-started)** installed and configured (`spicetify backup apply` run at least once)

### Installation

1. **Clone the repo and install dependencies:**

   ```bash
   git clone https://github.com/amln19/scriptify.git
   cd scriptify
   npm install
   ```

2. **Build the extension:**

   ```bash
   npm run build
   ```

   This outputs `dist/scriptify.js` (~214kb).

3. **Copy to Spicetify extensions folder:**

   ```bash
   # macOS / Linux
   cp dist/scriptify.js ~/.config/spicetify/Extensions/

   # Windows (PowerShell)
   Copy-Item dist\scriptify.js "$env:APPDATA\spicetify\Extensions\"
   ```

4. **Enable and apply:**

   ```bash
   spicetify config extensions scriptify.js
   spicetify apply
   ```

5. **Restart Spotify** — the Scriptify button appears in the playbar.

### Development

For auto-rebuilding on file changes:

```bash
npm run watch
```

After rebuilding, copy the output and re-apply:

```bash
cp dist/scriptify.js ~/.config/spicetify/Extensions/scriptify.js
spicetify apply
```

Other scripts:

| Command             | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `npm run build`     | Production build (minified, no sourcemaps)                   |
| `npm run watch`     | Dev build with file watching (unminified, inline sourcemaps) |
| `npm run typecheck` | Run TypeScript type checking                                 |
| `npm run clean`     | Remove the `dist/` directory                                 |

## Environment Variables

No environment variables or API keys are required. All external APIs used (LRCLIB, Spotify internal) are free and unauthenticated.

## Usage

- **Left-click** the Scriptify button in the playbar to toggle: Original ↔ Romanized
- **Right-click** the button to open the settings panel
- The button glows green when Romanized mode is active
- A Spotify-style notification confirms each mode switch

## Architecture

```
src/
├── app.tsx                     # Entry point — waits for Spicetify, registers Playbar.Button
├── components/
│   ├── ToggleButton.tsx        # Settings panel (mode selector)
│   └── styles.ts               # Runtime CSS injection
├── services/
│   ├── lyricsInterceptor.ts    # Core orchestrator — DOM detection, replacement maps, MutationObserver engine
│   ├── romanizer.ts            # Multi-script romanization (direct Hindi parser + Sanscript IAST + CJK/Japanese/Korean)
│   └── lrclib.ts               # LRCLIB lyrics API client (fallback lyrics source)
├── utils/
│   └── scriptDetector.ts       # Unicode range analysis for writing system detection
├── types/
│   ├── index.ts                # Core types (LyricsMode, LyricLine, TrackInfo, LRCLibResponse)
│   └── spicetify.d.ts          # Spicetify global type declarations
└── settings.json               # Spicetify extension metadata
```

### How It Works

1. **Bootstrap** — `app.tsx` waits for Spicetify APIs, injects CSS, initializes the lyrics interceptor, and registers a `Playbar.Button`
2. **Lyrics collection** — on mode change or song change, the interceptor collects all lyrics via Spotify's internal API (primary) and DOM scraping (secondary), with LRCLIB as a fallback
3. **Processing** — lyrics are passed to the romanizer, which builds forward/reverse text replacement maps
4. **DOM replacement** — a continuous 100ms interval + a narrow MutationObserver on the lyrics container re-apply replacements whenever React re-renders lyrics elements
5. **Auto-stop** — the engine stops after 3 seconds of finding no lyrics elements (user navigated away) and restarts when lyrics reappear

### Romanization Engine

| Script                                                     | Method                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Devanagari (Hindi)                                         | Direct syllable parser with schwa deletion, nuqta handling, and 500+ word dictionary |
| Devanagari (Marathi, Sanskrit, Nepali)                     | Sanscript → IAST → diacritic stripping → Hinglish conventions                        |
| Tamil, Bengali, Telugu, Kannada, Gujarati, Malayalam, Odia | Sanscript → IAST → diacritic stripping                                               |
| Gurmukhi (Punjabi)                                         | Direct syllable parser with schwa deletion and addak (gemination) support            |
| Japanese (Hiragana/Katakana)                               | Built-in romaji lookup tables with compound kana and sokuon support                  |
| Korean (Hangul)                                            | Hangul syllable decomposition → revised romanization                                 |
| Chinese (CJK)                                              | Built-in pinyin map (500+ common characters)                                         |

## License

MIT
