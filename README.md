# Scriptify

Spotify lyrics are often displayed only in the script they were written in. If you can’t read Devanagari, Hangul, Kanji, or other supported scripts, singing along can be difficult. Scriptify adds a one-click toggle that switches lyrics between **Original** and **Romanized** text, so you can follow the words without losing the original.

## Features

- **Lyrics toggle** — switch between Original and Romanized (Latin transliteration) modes
- **12 supported script families** — Devanagari, Gurmukhi, Bengali, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Japanese (Hiragana/Katakana), Korean (Hangul), and Chinese (Hanzi)
- **Curated Hindi romanizer** — direct Devanagari → Hinglish parser with schwa deletion, nuqta handling, and a curated Hindi word dictionary for natural results (bypasses IAST entirely)
- **Playbar integration** — button sits in the bottom-right now-playing bar, right next to the native lyrics/queue/volume controls
- **Simple keyboard shortcuts** — `Ctrl/Cmd+Shift+L` to toggle modes, `Ctrl/Cmd+Shift+;` for settings, `Ctrl/Cmd+Shift+J` to jump to the current line
- **Persistent preferences** — mode choice is saved across sessions
- **~Zero flash** — a narrow MutationObserver + 100ms interval engine re-applies replacements before React re-renders can flash the original script
- **Graceful degradation** — if romanization fails, the extension silently falls back to original lyrics with no visible errors

## Getting Started

### Marketplace installation

Search for **Scriptify** in the Spicetify Marketplace's **Extensions** tab and click **Install**.

### Prerequisites

- **Node.js** (v18+) and **npm**
- **Spotify** desktop app
- **[Spicetify CLI](https://spicetify.app/docs/getting-started)** installed and configured (`spicetify backup apply` run at least once)

### Manual installation

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

   This outputs `dist/scriptify.js`.

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

### Uninstalling

```bash
spicetify config extensions scriptify.js-
spicetify apply
```

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
| `npm test`          | Run deterministic unit and regression tests                  |
| `npm run clean`     | Remove the `dist/` directory; run `npm run build` before publishing again |

### Testing

`npm test` exercises the romanizers and script detector, LRCLIB parsing and
network/error behavior, lyrics lifecycle and availability state, preference
persistence, scrolling, and runtime style cleanup. It uses deterministic mocks
for Spicetify, the DOM, fetch, and timers, so it does not require Spotify or a
network connection.

The live Spotify/Spicetify integration still needs manual smoke testing after
Spotify updates: check a few supported scripts, rapid track/mode changes,
lyrics-panel close/reopen, playbar controls, settings, and keyboard shortcuts.

## Usage

- **Left-click** the Scriptify button in the playbar to toggle: Original ↔ Romanized
- **Right-click** the button to open the settings panel
- The button glows green when Romanized mode is active
- On tracks without usable romanizable lyrics, the button is disabled

## Tech Stack

- **TypeScript** — strict mode, full type coverage
- **esbuild** — bundled as a single minified IIFE file for Spicetify's extension loader
- **Spicetify API** — `Playbar.Button`, `PopupModal`, `CosmosAsync`, `Player` events, `LocalStorage`, `Platform.History`
- **@indic-transliteration/sanscript** — IAST transliteration for non-Hindi Indic scripts (Tamil, Bengali, Gujarati, etc.)
- **Spotify internal lyrics API** — `spclient.wg.spotify.com/color-lyrics/v2` for full lyrics and language detection, using the active Spotify session
- **LRCLIB API** — public, no-key fallback lyrics source when Spotify's API is unavailable

No API keys or environment variables are required.

## Limitations

- Romanization is available only for the script families listed above.
- Unsupported scripts are left unchanged; tracks with no romanizable lines disable the toggle.
- Chinese romanization uses an offline map of 250+ common characters; unmapped characters pass through unchanged.
- Japanese and Korean ideographs are treated as kanji/hanja when kana or Hangul identifies the line's language; there is no kanji reading dictionary.

## Architecture

```
src/
├── app.tsx                     # Entry point — waits for Spicetify, registers Playbar.Button
├── components/
│   ├── settingsPanel.ts        # Settings modal and fallback overlay
│   └── styles.ts               # Runtime CSS injection
├── services/
│   ├── lyricsInterceptor.ts    # Core orchestrator — DOM detection, replacement maps, MutationObserver engine
│   ├── romanizer.ts            # Public multi-script router
│   ├── romanizer/              # Language-specific romanization engines
│   │   ├── hindi.ts             # Direct Devanagari parser and word dictionaries
│   │   ├── indic.ts             # Sanscript pipeline and Indic exceptions
│   │   ├── gurmukhi.ts          # Direct Punjabi parser
│   │   ├── japanese.ts          # Kana to romaji
│   │   ├── korean.ts            # Hangul decomposition and liaison rules
│   │   └── chinese.ts           # Offline common-character pinyin map
│   └── lrclib.ts               # LRCLIB lyrics API client (fallback lyrics source)
├── utils/
│   ├── async.ts                # Shared timeout and async helpers
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
5. **Auto-stop** — the engine stops after 3 seconds of finding no lyrics elements (user navigated away) and hands off to a 1-second idle watcher that restarts it as soon as lyrics reappear — including when the panel is re-opened on the same track

### Romanization Engine

| Script                                                     | Method                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Devanagari (Hindi, language identified)                    | Direct syllable parser with schwa deletion, nuqta handling, and a curated word dictionary |
| Devanagari (Marathi, Sanskrit, Nepali, or unknown fallback) | Sanscript → IAST → diacritic stripping → Hinglish conventions                        |
| Gurmukhi (Punjabi)                                         | Direct syllable parser with schwa deletion and addak (gemination) support            |
| Tamil, Bengali, Telugu, Kannada, Gujarati, Malayalam, Odia | Sanscript → IAST → diacritic stripping                                               |
| Japanese (Hiragana/Katakana)                               | Built-in romaji lookup tables with compound kana and sokuon support                  |
| Korean (Hangul)                                            | Hangul syllable decomposition with common liaison and palatalization rules           |
| Chinese (CJK)                                              | Built-in pinyin map (250+ common characters; others pass through unchanged)          |

Ideographs inside a Japanese or Korean line are treated as kanji/hanja rather than
hanzi, so they are never given Mandarin readings; they are left as-is (there is no
kanji reading dictionary). Cyrillic, Arabic and Thai are detected but have no
romanizer, so the toggle stays greyed out for those songs instead of doing nothing.

## License

MIT
