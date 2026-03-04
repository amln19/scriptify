/**
 * Lyrics Interception & Processing Layer (v3)
 *
 * Core orchestrator of Scriptify. Architecture:
 * 1. Uses HARD-CODED obfuscated class names from Spicetify's css-map.json
 *    to find lyrics elements in the DOM
 * 2. Falls back to structural heuristics (dir="auto" grouped by parent)
 * 3. Fetches lyrics via Spotify's internal API (CosmosAsync) for map building
 * 4. Uses FORWARD/REVERSE maps for text replacement:
 *    - forwardMap: original text → replacement text
 *    - reverseMap: replacement text → original text
 * 5. Runs a continuous interval (100ms) that re-applies replacements,
 *    combating React re-renders that overwrite our textContent changes
 *
 * Key insight: React constantly re-renders lyrics (for scroll/highlight).
 * Single textContent swaps get overwritten immediately. The interval
 * approach detects when React puts back the original and re-applies.
 */

import { LyricsMode, type LyricLine } from "../types";
import { romanize, initRomanizer, setLanguageHint } from "./romanizer";
import { fetchLyrics, getCurrentTrackInfo } from "./lrclib";
import { hasNonLatinScript } from "../utils/scriptDetector";

// ─── Hard-coded CSS Class Names from css-map.json ─────────────────────────────

const LYRICS_CLASSES = {
  container: [
    "tr8V5eHsUaIkOYVw7eSG",
    "FUYNhisXTCmbzt9IDxnT",
    "lofIAg8Ixko3mfBrbfej",
  ],
  contentWrapper: [
    "esRByMgBY3TiENAsbDHA",
    "_Wna90no0o0dta47Heiw",
    "t_dtt9KL1wnNRvRO_y5L",
  ],
  contentContainer: [
    "Q2RPoHcoxygOoPLXLMww",
    "gqaWFmQeKNYnYD5gRv3x",
    "_EzvsrEJ47TI8hxzRoKx",
  ],
  lyricLine: [
    "NiCdLCpp3o2z6nBrayOn",
    "nw6rbs8R08fpPn7RWW2w",
    "BJ1zQ_ReY3QPaS7SW46s",
    "o69qODXrbOkf6Tv7fa51",
  ],
  lyricText: [
    "A3ohAQNHsDIMv2EM3Ytp",
    "BXlQFspJp_jq9SKhUSP3",
    "MmIREVIj8A2aFVvBZ2Ev",
  ],
  nowPlayingLyrics: ["hzUuLPdH48AzgQun5NYQ"],
  cinemaContainer: ["y7xcnM6yyOOrMwI77d5t"],
};

function classSelector(classes: string[]): string {
  return classes.map((c) => `.${c}`).join(", ");
}

// ─── State ────────────────────────────────────────────────────────────────────

let currentMode: LyricsMode = LyricsMode.Original;
let currentTrackId: string | null = null;
let modeChangeCallbacks: Array<(mode: LyricsMode) => void> = [];

// Lyrics availability tracking
let lyricsAvailable = true;
let availabilityCallbacks: Array<(available: boolean) => void> = [];

// Forward map: original text → replacement text
let forwardMap = new Map<string, string>();
// Reverse map: replacement text → original text
let reverseMap = new Map<string, string>();

// Replacement interval (100 ms reliable fallback)
let replaceInterval: ReturnType<typeof setInterval> | null = null;

// Lyrics-specific MutationObserver — narrow target, fast callback
let lyricsObserver: MutationObserver | null = null;
let lyricsObserverTarget: Element | null = null;

// Cached lyric elements — avoids expensive DOM queries in observer callback
let cachedLyricElements: Element[] = [];

// Guard flag — prevents observer from re-firing on our own DOM writes
let isWriting = false;

// Counter for consecutive interval ticks that find zero lyrics elements.
// After 30 ticks (3 s) the engine auto-stops to avoid wasted work.
let emptyTicks = 0;

// ─── Spotify Lyrics API ───────────────────────────────────────────────────────

let spotifyLyricsCache = new Map<string, LyricLine[]>();

// Language detected from Spotify's lyrics API (ISO code: "hi", "mr", "sa", etc.)
let detectedLanguage: string | null = null;

async function fetchSpotifyLyrics(
  trackId: string,
): Promise<LyricLine[] | null> {
  if (spotifyLyricsCache.has(trackId)) {
    return spotifyLyricsCache.get(trackId) || null;
  }

  try {
    const response = await Spicetify.CosmosAsync.get(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`,
    );

    if (!response?.lyrics?.lines) {
      console.log("[Scriptify] No lyrics from Spotify API for track:", trackId);
      return null;
    }

    // Extract language from Spotify lyrics API response
    if (response.lyrics.language) {
      detectedLanguage = response.lyrics.language;
      console.log(`[Scriptify] Detected lyrics language: ${detectedLanguage}`);
    }

    const lines: LyricLine[] = response.lyrics.lines
      .map((line: any) => ({
        startTimeMs: parseInt(line.startTimeMs, 10) || 0,
        text: line.words || "",
      }))
      .filter((line: LyricLine) => line.text.trim().length > 0);

    console.log(`[Scriptify] Fetched ${lines.length} lyrics from Spotify API`);

    if (spotifyLyricsCache.size >= 30) {
      const firstKey = spotifyLyricsCache.keys().next().value;
      if (firstKey) spotifyLyricsCache.delete(firstKey);
    }
    spotifyLyricsCache.set(trackId, lines);
    return lines;
  } catch (e) {
    console.warn("[Scriptify] Spotify lyrics API error:", e);
    return null;
  }
}

// ─── DOM Detection ────────────────────────────────────────────────────────────

/**
 * Find dir="auto" elements grouped by parent, return the largest group.
 * This avoids picking up unrelated UI text (playlist names, etc.)
 * by only returning elements that share a common parent container.
 */
function findBestDirAutoGroup(root: Element): Element[] | null {
  const dirElements = root.querySelectorAll("[dir='auto']");
  if (dirElements.length < 3) return null;

  // Group by parent element
  const parentGroups = new Map<Element, Element[]>();
  for (const el of dirElements) {
    const parent = el.parentElement;
    if (!parent) continue;
    if (!parentGroups.has(parent)) parentGroups.set(parent, []);
    parentGroups.get(parent)!.push(el);
  }

  // Also try grandparent grouping (lyrics might be: grandparent > parent > div[dir=auto])
  const grandparentGroups = new Map<Element, Element[]>();
  for (const el of dirElements) {
    const gp = el.parentElement?.parentElement;
    if (!gp) continue;
    if (!grandparentGroups.has(gp)) grandparentGroups.set(gp, []);
    grandparentGroups.get(gp)!.push(el);
  }

  // Find the largest group (try grandparent first for better scoping)
  let bestGroup: Element[] | null = null;
  let maxCount = 0;

  for (const [, children] of grandparentGroups) {
    if (children.length > maxCount) {
      maxCount = children.length;
      bestGroup = children;
    }
  }

  // Fall back to parent grouping if grandparent didn't give good results
  if (!bestGroup || maxCount < 3) {
    for (const [, children] of parentGroups) {
      if (children.length > maxCount) {
        maxCount = children.length;
        bestGroup = children;
      }
    }
  }

  return bestGroup;
}

/**
 * Find lyric line elements in the DOM.
 * Uses multiple strategies with priority ordering.
 */
function findLyricLineElements(): Element[] {
  // Strategy 1: Hard-coded lyric line classes
  const lineSel = classSelector(LYRICS_CLASSES.lyricLine);
  try {
    const elements = document.querySelectorAll(lineSel);
    if (elements.length > 0) {
      return Array.from(elements);
    }
  } catch {}

  // Strategy 2: data-testid selectors
  for (const testId of ["lyrics-lyricsContent-lyric", "fullscreen-lyric"]) {
    const elements = document.querySelectorAll(`[data-testid="${testId}"]`);
    if (elements.length > 0) {
      return Array.from(elements);
    }
  }

  // Strategy 3: Find dir="auto" elements in the main content area,
  // grouped by parent to avoid picking up UI text
  const mainContent =
    document.querySelector(
      ".main-view-container [data-overlayscrollbars-viewport]",
    ) ||
    document.querySelector(".main-view-container .os-viewport") ||
    document.querySelector(".main-view-container") ||
    document.querySelector(".Root__main-view");

  if (mainContent) {
    const best = findBestDirAutoGroup(mainContent);
    if (best && best.length >= 3) {
      // Filter to elements that actually have text content
      const textElements = best.filter((el) => {
        const text = el.textContent?.trim() || "";
        return text.length > 0 && text.length < 500;
      });
      if (textElements.length >= 3) {
        return textElements;
      }
    }
  }

  // Strategy 4: Right sidebar lyrics
  const sidebar = document.querySelector(".Root__right-sidebar");
  if (sidebar) {
    const best = findBestDirAutoGroup(sidebar);
    if (best && best.length >= 3) {
      const textElements = best.filter((el) => {
        const text = el.textContent?.trim() || "";
        return text.length > 0 && text.length < 500;
      });
      if (textElements.length >= 3) {
        return textElements;
      }
    }
  }

  return [];
}

/**
 * Get the text-bearing element within a lyric line.
 * Walks DOWN to find the deepest single-child path to the actual text.
 */
function getTextElement(lineEl: Element): Element {
  // Try css-map text class selectors
  const textSel = classSelector(LYRICS_CLASSES.lyricText);
  try {
    const textEl = lineEl.querySelector(textSel);
    if (textEl && textEl.textContent?.trim()) return textEl;
  } catch {}

  // Walk down the single-child path to find the deepest text element
  let target = lineEl;
  while (target.children.length === 1) {
    target = target.children[0];
  }

  // If we're at a leaf with text, use it
  if (target.children.length === 0 && target.textContent?.trim()) {
    return target;
  }

  // Try finding a span with text
  const span = lineEl.querySelector("span");
  if (span && span.textContent?.trim()) return span;

  // Fall back to the deepest element we found, or the line itself
  return target.textContent?.trim() ? target : lineEl;
}

/**
 * Read the current visible text from a lyric element.
 */
function readText(el: Element): string {
  return getTextElement(el).textContent?.trim() || "";
}

/**
 * Write replacement text to a lyric element.
 */
function writeText(el: Element, text: string): void {
  const textEl = getTextElement(el);
  if (textEl.textContent !== text) {
    textEl.textContent = text;
  }
}

// ─── Replacement Map Building ─────────────────────────────────────────────────

/**
 * Collect ALL original lyrics for the current track.
 * Uses Spotify API + DOM visible elements for completeness.
 */
async function collectOriginals(): Promise<string[]> {
  const originals: string[] = [];
  const seen = new Set<string>();

  // Source 1: Spotify internal API (has ALL lyrics, not just visible)
  const trackInfo = getCurrentTrackInfo();
  if (trackInfo) {
    const apiLyrics = await fetchSpotifyLyrics(trackInfo.id);
    if (apiLyrics) {
      for (const line of apiLyrics) {
        const text = line.text.trim();
        if (text && !seen.has(text)) {
          seen.add(text);
          originals.push(text);
        }
      }
    }
  }

  // Source 2: Currently visible DOM elements (catches any the API missed)
  const elements = findLyricLineElements();
  for (const el of elements) {
    const text = readText(el);
    if (text && !seen.has(text) && !reverseMap.has(text)) {
      seen.add(text);
      originals.push(text);
    }
  }

  // Source 3: LRCLIB fallback
  if (originals.length === 0 && trackInfo) {
    const lrclibLyrics = await fetchLyrics(trackInfo);
    if (lrclibLyrics) {
      for (const line of lrclibLyrics) {
        const text = line.text.trim();
        if (text && !seen.has(text)) {
          seen.add(text);
          originals.push(text);
        }
      }
    }
  }

  console.log(
    `[Scriptify] Collected ${originals.length} original lyrics lines`,
  );
  return originals;
}

/**
 * Build forward and reverse replacement maps for the current mode.
 */
async function buildReplacementMaps(mode: LyricsMode): Promise<void> {
  forwardMap.clear();
  reverseMap.clear();

  if (mode === LyricsMode.Original) return;

  const originals = await collectOriginals();
  if (originals.length === 0) {
    console.log("[Scriptify] No originals found, cannot build maps");
    return;
  }

  if (mode === LyricsMode.Romanized) {
    // Pass detected language to romanizer for script-appropriate post-processing
    setLanguageHint(detectedLanguage);
    let count = 0;
    for (const text of originals) {
      const romanized = romanize(text);
      if (romanized && romanized !== text) {
        forwardMap.set(text, romanized);
        reverseMap.set(romanized, text);
        count++;
      }
    }
    console.log(
      `[Scriptify] Built romanization map: ${count}/${originals.length} lines romanized`,
    );
    if (count === 0) {
      console.log(
        "[Scriptify] No lines were romanized. Lyrics may already be in Latin script.",
      );
    }
  }
}

// ─── Continuous Replacement Engine ────────────────────────────────────────────

/**
 * FAST replacement — iterates only cached elements, zero DOM queries.
 *
 * Called by the lyrics MutationObserver which fires as a microtask
 * BEFORE the browser paints, so the user never sees original text flash.
 */
function applyReplacementsCached(): void {
  if (currentMode === LyricsMode.Original || forwardMap.size === 0) return;
  if (isWriting || cachedLyricElements.length === 0) return;

  // Quick connectivity check: if most cached elements are gone,
  // React did a full re-render — refresh the cache inline.
  let connected = 0;
  for (const el of cachedLyricElements) {
    if (el.isConnected) connected++;
  }
  if (connected < cachedLyricElements.length / 2) {
    cachedLyricElements = findLyricLineElements();
    if (cachedLyricElements.length === 0) return;
  }

  isWriting = true;
  for (const el of cachedLyricElements) {
    if (!el.isConnected) continue;
    const text = readText(el);
    if (text && forwardMap.has(text)) {
      writeText(el, forwardMap.get(text)!);
    }
  }
  Promise.resolve().then(() => {
    isWriting = false;
  });
}

/**
 * FULL replacement — refreshes element cache and re-attaches observer.
 * Called by the 100 ms interval as the reliable fallback.
 *
 * Auto-stops after 3 s of finding zero lyrics elements (user closed
 * the lyrics panel). Restarted by the History/songchange listeners.
 */
function applyReplacements(): void {
  if (currentMode === LyricsMode.Original || forwardMap.size === 0) return;

  // Refresh element cache
  const elements = findLyricLineElements();
  if (elements.length === 0) {
    cachedLyricElements = [];
    emptyTicks++;
    if (emptyTicks >= 30) {
      stopContinuousReplacement();
      console.log("[Scriptify] Auto-stopped replacement (no lyrics visible)");
    }
    return;
  }
  cachedLyricElements = elements;
  emptyTicks = 0;

  // Ensure the narrow observer is attached
  ensureLyricsObserver();

  // Apply replacements
  isWriting = true;
  for (const el of cachedLyricElements) {
    const text = readText(el);
    if (text && forwardMap.has(text)) {
      writeText(el, forwardMap.get(text)!);
    }
  }
  Promise.resolve().then(() => {
    isWriting = false;
  });
}

/**
 * Find the narrowest lyrics-specific container for observer attachment.
 * Returns null rather than falling back to Root__main-view / body —
 * observing those broad targets causes UI interference (Issue 1).
 */
function findNarrowLyricsContainer(): Element | null {
  for (const classes of [
    LYRICS_CLASSES.contentContainer,
    LYRICS_CLASSES.contentWrapper,
    LYRICS_CLASSES.container,
  ]) {
    const sel = classSelector(classes);
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch {}
  }

  for (const id of ["lyrics-lyricsContent", "lyrics-page"]) {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) return el;
  }

  return null;
}

/**
 * Ensure a MutationObserver is attached to the lyrics container.
 * Re-attaches automatically when the container element changes.
 */
function ensureLyricsObserver(): void {
  const container = findNarrowLyricsContainer();
  if (!container) {
    if (lyricsObserver) {
      lyricsObserver.disconnect();
      lyricsObserver = null;
      lyricsObserverTarget = null;
    }
    return;
  }

  // Already observing this exact container
  if (container === lyricsObserverTarget && lyricsObserver) return;

  // (Re-)create observer on the new container
  if (lyricsObserver) lyricsObserver.disconnect();

  lyricsObserver = new MutationObserver(() => {
    if (isWriting) return;
    applyReplacementsCached();
  });

  lyricsObserver.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  lyricsObserverTarget = container;
}

function startContinuousReplacement(): void {
  if (replaceInterval) return;
  emptyTicks = 0;

  // Try to attach narrow observer immediately
  ensureLyricsObserver();

  // 100 ms interval refreshes cache + catches edge cases
  replaceInterval = setInterval(applyReplacements, 100);
  console.log("[Scriptify] Started continuous replacement");

  // Apply immediately
  applyReplacements();
}

function stopContinuousReplacement(): void {
  if (lyricsObserver) {
    lyricsObserver.disconnect();
    lyricsObserver = null;
    lyricsObserverTarget = null;
  }
  cachedLyricElements = [];
  emptyTicks = 0;
  if (replaceInterval) {
    clearInterval(replaceInterval);
    replaceInterval = null;
  }
}

// ─── Track Change Detection ───────────────────────────────────────────────────
// Track changes are detected via Spicetify.Player "songchange" event
// (registered in initLyricsInterceptor).  No MutationObserver on the
// main view is needed — observing Root__main-view caused excessive
// DOM activity that prevented Spotify from handling close-button clicks.

// ─── Public API ───────────────────────────────────────────────────────────────

export async function initLyricsInterceptor(): Promise<void> {
  await initRomanizer();

  // Detect initial track
  const trackInfo = getCurrentTrackInfo();
  if (trackInfo) {
    currentTrackId = trackInfo.id;
    console.log(
      `[Scriptify] Initial track: ${trackInfo.name} by ${trackInfo.artist}`,
    );
  }

  // Listen for track changes via Spicetify Player event
  try {
    Spicetify.Player.addEventListener("songchange", () => {
      const info = getCurrentTrackInfo();
      const newId = info?.id || null;

      if (newId && newId !== currentTrackId) {
        currentTrackId = newId;
        detectedLanguage = null;
        console.log(`[Scriptify] Song change: ${info?.name || "unknown"}`);

        // Check lyrics availability immediately
        checkAndNotifyAvailability(newId);

        if (currentMode !== LyricsMode.Original) {
          // Give Spotify time to render new lyrics before rebuilding maps
          setTimeout(async () => {
            await buildReplacementMaps(currentMode);
            startContinuousReplacement();
          }, 1500);
        }
      }
    });
  } catch {}

  // Listen for navigation — restart engine when returning to lyrics,
  // stop when navigating away.
  try {
    Spicetify.Platform.History.listen(() => {
      const path = Spicetify.Platform?.History?.location?.pathname || "";
      const isLyrics = path.includes("/lyrics");

      if (
        isLyrics &&
        currentMode !== LyricsMode.Original &&
        forwardMap.size > 0 &&
        !replaceInterval
      ) {
        startContinuousReplacement();
      }
    });
  } catch {}

  console.log("[Scriptify] Lyrics interceptor initialized");
}

export function getCurrentMode(): LyricsMode {
  return currentMode;
}

export async function cycleMode(): Promise<LyricsMode> {
  const nextMode =
    currentMode === LyricsMode.Original
      ? LyricsMode.Romanized
      : LyricsMode.Original;
  return setMode(nextMode);
}

export async function setMode(mode: LyricsMode): Promise<LyricsMode> {
  console.log(`[Scriptify] Setting mode: ${mode}`);

  // Step 1: Stop any existing replacement interval
  stopContinuousReplacement();

  // Step 2: Restore ALL visible lyrics to originals using the current reverseMap
  // This is critical when switching modes — the on-screen text may be a previous
  // replacement (romanized), and we need originals back before
  // building new maps or leaving in Original mode.
  if (reverseMap.size > 0) {
    const elements = findLyricLineElements();
    let restored = 0;
    for (const el of elements) {
      const text = readText(el);
      if (text && reverseMap.has(text)) {
        writeText(el, reverseMap.get(text)!);
        restored++;
      }
    }
    console.log(`[Scriptify] Restored ${restored} lyrics to originals`);
  }

  // Step 3: Clear old maps
  forwardMap.clear();
  reverseMap.clear();

  // Step 4: Update state
  currentMode = mode;
  try {
    Spicetify.LocalStorage.set("scriptify:mode", mode);
  } catch {}

  if (mode === LyricsMode.Original) {
    console.log("[Scriptify] Mode set to Original");
  } else {
    // Step 5: Build new maps and start continuous replacement.
    // On startup, lyrics may not be available yet — retry a few times.
    let retries = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000;

    while (retries <= MAX_RETRIES) {
      await buildReplacementMaps(mode);
      if (forwardMap.size > 0) {
        startContinuousReplacement();
        break;
      }
      if (retries < MAX_RETRIES) {
        retries++;
        console.log(
          `[Scriptify] No lyrics yet, retrying in ${RETRY_DELAY}ms (${retries}/${MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        // Bail if mode changed while we were waiting
        if (currentMode !== mode) return currentMode;
      } else {
        console.warn(
          "[Scriptify] No replacements built — lyrics may already be in target script",
        );
        break;
      }
    }
  }

  // Notify subscribers
  for (const cb of modeChangeCallbacks) {
    try {
      cb(mode);
    } catch {}
  }

  return currentMode;
}

export function onModeChange(callback: (mode: LyricsMode) => void): () => void {
  modeChangeCallbacks.push(callback);
  return () => {
    modeChangeCallbacks = modeChangeCallbacks.filter((cb) => cb !== callback);
  };
}

export function loadSavedMode(): LyricsMode {
  try {
    const saved = Spicetify.LocalStorage.get("scriptify:mode") as LyricsMode;
    if (saved && Object.values(LyricsMode).includes(saved)) {
      currentMode = saved;
      return saved;
    }
  } catch {}
  return LyricsMode.Original;
}

export function onLyricsAvailabilityChange(
  callback: (available: boolean) => void,
): () => void {
  availabilityCallbacks.push(callback);
  return () => {
    availabilityCallbacks = availabilityCallbacks.filter(
      (cb) => cb !== callback,
    );
  };
}

/**
 * Check whether ALL lyrics lines are already in Latin/romanized script.
 * If no line contains any non-Latin characters, Scriptify's romanization
 * is unnecessary — the lyrics are already readable.
 */
function areLyricsAlreadyRomanized(lyrics: LyricLine[]): boolean {
  // Every line must be purely Latin (no Devanagari, Gurmukhi, etc.)
  for (const line of lyrics) {
    const text = line.text.trim();
    if (text.length === 0) continue; // skip empty lines
    if (hasNonLatinScript(text)) return false; // found a non-Latin line
  }
  return true;
}

/**
 * Check lyrics availability for a track and notify subscribers.
 * "Available" for Scriptify means: lyrics exist AND they contain at least
 * one non-Latin line (otherwise romanization would be pointless).
 */
async function checkAndNotifyAvailability(trackId: string): Promise<void> {
  const lyrics = await fetchSpotifyLyrics(trackId);
  let available = lyrics !== null && lyrics.length > 0;
  // If lyrics exist but are already all-Latin, Scriptify has nothing to do
  if (available && lyrics && areLyricsAlreadyRomanized(lyrics)) {
    console.log(
      "[Scriptify] Lyrics already in Latin script — disabling button",
    );
    available = false;
  }
  if (available !== lyricsAvailable) {
    lyricsAvailable = available;
    for (const cb of availabilityCallbacks) {
      try {
        cb(available);
      } catch {}
    }
  }
}

/**
 * Check lyrics availability for the current track.
 * Called once at startup after the interceptor is initialized.
 * Retries briefly if no track is detected yet (Spotify may still be loading).
 */
export async function checkInitialLyricsAvailability(): Promise<void> {
  // If currentTrackId wasn't set during init, try again
  if (!currentTrackId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      const info = getCurrentTrackInfo();
      if (info?.id) {
        currentTrackId = info.id;
        break;
      }
    }
  }
  if (currentTrackId) {
    // Force notification even on first check (lyricsAvailable default is true,
    // but we need to notify if the track actually has no lyrics)
    const lyrics = await fetchSpotifyLyrics(currentTrackId);
    let available = lyrics !== null && lyrics.length > 0;
    if (available && lyrics && areLyricsAlreadyRomanized(lyrics)) {
      console.log(
        "[Scriptify] Initial track lyrics already in Latin script — disabling button",
      );
      available = false;
    }
    lyricsAvailable = available;
    for (const cb of availabilityCallbacks) {
      try {
        cb(available);
      } catch {}
    }
  }
}

export function destroyLyricsInterceptor(): void {
  stopContinuousReplacement();
  forwardMap.clear();
  reverseMap.clear();
  modeChangeCallbacks = [];
  availabilityCallbacks = [];
}
