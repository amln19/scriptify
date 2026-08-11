/**
 * Lyrics Interception & Processing Layer
 *
 * Core orchestrator of Scriptify. Architecture:
 * 1. Uses HARD-CODED obfuscated class names from Spicetify's css-map.json
 *    to find lyrics elements in the DOM
 * 2. Falls back to structural heuristics (dir="auto" grouped by parent)
 * 3. Fetches lyrics via Spotify's internal API (CosmosAsync) for map building
 * 4. Uses a FORWARD map: original text → romanized text
 * 5. INJECTS a styled sub-element (.scriptify-romanized) below each lyric line
 *    instead of replacing the original text, giving a dual-line display
 * 6. Runs a continuous interval (100ms) that re-injects sub-elements after
 *    React re-renders wipe them
 *
 * Key insight: React constantly re-renders lyrics (for scroll/highlight).
 * Injected DOM nodes are wiped on each render. The interval + MutationObserver
 * re-inject the romanized sub-elements before the user notices.
 */

import {
  LyricsMode,
  DisplayStyle,
  type LyricLine,
  type TrackInfo,
} from "../types";
import {
  romanize,
  initRomanizer,
  setLanguageHint,
  hasRomanizableScript,
} from "./romanizer";
import { fetchLyrics, getCurrentTrackInfo } from "./lrclib";
import { TimeoutError, withTimeout } from "../utils/async";

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
};

function classSelector(classes: string[]): string {
  return classes.map((c) => `.${c}`).join(", ");
}

// Pre-computed selectors — LYRICS_CLASSES is a static constant, so these
// strings never change. Computing them once avoids repeated .map().join()
// calls in hot paths (observer callback, 100ms interval).
const SEL_LYRIC_LINE = classSelector(LYRICS_CLASSES.lyricLine);
const SEL_LYRIC_TEXT = classSelector(LYRICS_CLASSES.lyricText);
const SEL_CONTENT_CONTAINER = classSelector(LYRICS_CLASSES.contentContainer);
const SEL_CONTENT_WRAPPER = classSelector(LYRICS_CLASSES.contentWrapper);
const SEL_CONTAINER = classSelector(LYRICS_CLASSES.container);

// ─── State ────────────────────────────────────────────────────────────────────

let currentMode: LyricsMode = LyricsMode.Original;
let currentTrackId: string | null = null;
let modeChangeCallbacks: Array<(mode: LyricsMode) => void> = [];

// Lyrics availability tracking
let lyricsAvailable = true;
let availabilityCallbacks: Array<(available: boolean) => void> = [];

// Forward map: original text → romanized text
let forwardMap = new Map<string, string>();

// Replacement interval (100 ms reliable fallback)
let replaceInterval: ReturnType<typeof setInterval> | null = null;

// Idle watcher — polls for the lyrics panel re-opening after the engine
// auto-stopped. See startIdleWatch().
let idleWatchInterval: ReturnType<typeof setInterval> | null = null;
const IDLE_WATCH_INTERVAL_MS = 1000;

// Lyrics-specific MutationObserver — narrow target, fast callback
let lyricsObserver: MutationObserver | null = null;
let lyricsObserverTarget: Element | null = null;

// Cached lyric elements — avoids expensive DOM queries in observer callback
let cachedLyricElements: Element[] = [];

// Guard flag — prevents observer from re-firing on our own DOM writes
let isWriting = false;

// Subscriptions owned by this module — held so destroyLyricsInterceptor() can
// undo them. Without this a hot-reload stacks a second songchange handler and a
// second History subscription on top of the live ones.
let songChangeHandler: (() => void) | null = null;
let historyUnsubscribe: (() => void) | null = null;

// Invalidates async work whenever the track, mode, or interceptor lifecycle
// changes. Async operations may cache track-keyed network results, but must not
// mutate current UI/module state unless their captured generation is current.
let stateGeneration = 0;
let isDestroyed = false;
const pendingSongChangeTimeouts = new Set<ReturnType<typeof setTimeout>>();

// Cache for getTextElement() — avoids re-walking the DOM subtree of each
// lyric line on every observer fire. Keyed on the line element; WeakMap
// entries are automatically released when elements are garbage-collected.
const textElementCache = new WeakMap<Element, Element>();

// Counter for consecutive interval ticks that find zero lyrics elements.
// After 30 ticks (3 s) the engine auto-stops to avoid wasted work.
let emptyTicks = 0;

// Display style: dual-line (annotation below) or replace-only (swap text visually)
let displayStyle: DisplayStyle = DisplayStyle.DualLine;

// Romanized font size multiplier (1.0 = default 0.72em base)
let romanizedFontSizeMultiplier = 1.0;
const FONT_SIZE_BASE_EM = 0.72;

// A mode change should not hold the playbar/UI hostage while both remote lyric
// sources are unavailable. DOM-only retries continue after the initial network
// collection, but the initial collection itself has a fixed upper bound.
const INITIAL_MAP_BUILD_TIMEOUT_MS = 12_000;

function isStateCurrent(
  generation: number,
  trackId: string | null,
  mode?: LyricsMode,
): boolean {
  return (
    !isDestroyed &&
    generation === stateGeneration &&
    trackId === currentTrackId &&
    (mode === undefined || mode === currentMode)
  );
}

function cancelPendingSongChangeTimeouts(): void {
  for (const timeout of pendingSongChangeTimeouts) clearTimeout(timeout);
  pendingSongChangeTimeouts.clear();
}

// ─── Spotify Lyrics API ───────────────────────────────────────────────────────

/**
 * Cached Spotify API result for one track.
 * The language travels WITH the lines: it is per-track state that a bare
 * lines-only cache would silently drop on a cache hit, leaving a Marathi or
 * Sanskrit track to be romanized with Hindi rules on every replay.
 * An empty `lines` array is a negative result ("API answered, no lyrics").
 */
interface CachedLyrics {
  lines: LyricLine[];
  language: string | null;
}

let spotifyLyricsCache = new Map<string, CachedLyrics>();
const SPOTIFY_REQUEST_TIMEOUT_MS = 8_000;

function cacheSpotifyLyrics(trackId: string, entry: CachedLyrics): void {
  if (spotifyLyricsCache.size >= 30) {
    const firstKey = spotifyLyricsCache.keys().next().value;
    if (firstKey) spotifyLyricsCache.delete(firstKey);
  }
  spotifyLyricsCache.set(trackId, entry);
}

async function fetchSpotifyLyrics(
  trackId: string,
): Promise<CachedLyrics | null> {
  const cached = spotifyLyricsCache.get(trackId);
  if (cached) return cached;

  try {
    const response = await withTimeout(
      Spicetify.CosmosAsync.get(
        `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`,
      ),
      SPOTIFY_REQUEST_TIMEOUT_MS,
      "Spotify lyrics request",
    );

    if (!response?.lyrics?.lines) {
      console.log("[Scriptify] No lyrics from Spotify API for track:", trackId);
      // Remember the negative answer so the availability check and each
      // buildReplacementMaps() retry don't re-request it.
      const empty = { lines: [], language: null };
      cacheSpotifyLyrics(trackId, empty);
      return empty;
    }

    // Extract language from Spotify lyrics API response
    const language: string | null = response.lyrics.language || null;
    if (language) {
      console.log(`[Scriptify] Detected lyrics language: ${language}`);
    }

    const lines: LyricLine[] = response.lyrics.lines
      .map((line: any) => ({
        startTimeMs: parseInt(line.startTimeMs, 10) || 0,
        text: line.words || "",
      }))
      .filter((line: LyricLine) => line.text.trim().length > 0);

    console.log(`[Scriptify] Fetched ${lines.length} lyrics from Spotify API`);

    const entry = { lines, language };
    cacheSpotifyLyrics(trackId, entry);
    return entry;
  } catch (e) {
    // Transport failure — deliberately NOT cached: the track may well have
    // lyrics and the next attempt should be able to find them.
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
  try {
    const elements = document.querySelectorAll(SEL_LYRIC_LINE);
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
 * Results are cached per element — the inner DOM structure of a lyric line
 * is stable between React re-renders; the cache is invalidated when the
 * returned element is disconnected (React replaced the inner subtree).
 */
function getTextElement(lineEl: Element): Element {
  // Return cached result if the text element is still in the DOM
  const cached = textElementCache.get(lineEl);
  if (cached?.isConnected) return cached;

  let result: Element;

  // Try css-map text class selectors
  try {
    const textEl = lineEl.querySelector(SEL_LYRIC_TEXT);
    if (textEl && textEl.textContent?.trim()) {
      textElementCache.set(lineEl, textEl);
      return textEl;
    }
  } catch {}

  // Walk down the single-child path to find the deepest text element
  let target = lineEl;
  while (target.children.length === 1) {
    target = target.children[0];
  }

  // If we're at a leaf with text, use it
  if (target.children.length === 0 && target.textContent?.trim()) {
    textElementCache.set(lineEl, target);
    return target;
  }

  // Try finding a span with text
  const span = lineEl.querySelector("span");
  if (span && span.textContent?.trim()) {
    textElementCache.set(lineEl, span);
    return span;
  }

  // Fall back to the deepest element we found, or the line itself
  result = target.textContent?.trim() ? target : lineEl;
  textElementCache.set(lineEl, result);
  return result;
}

/**
 * Read the current visible text from a lyric element.
 */
function readText(el: Element): string {
  return getTextElement(el).textContent?.trim() || "";
}

/**
 * Inject a romanized sub-element below the lyric line.
 * If one already exists with the same text, skip. If React wiped it, re-inject.
 * The sub-element fades in via CSS transition.
 * In replace-only mode, also hides the original text visually.
 */
function injectRomanized(lineEl: Element, romanizedText: string): void {
  // A structural fallback can identify a leaf element whose source lyric is a
  // direct text node. Wrap that source before appending our sibling: otherwise
  // future text reads include the injected romanization, and Replace mode has
  // no element it can hide.
  const textEl = getTextElement(lineEl);
  if (textEl === lineEl) {
    const textNodes = Array.from(lineEl.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (textNodes.length > 0) {
      const original = document.createElement("span");
      original.className = "scriptify-original";
      lineEl.insertBefore(original, textNodes[0]);
      for (const node of textNodes) original.appendChild(node);
      textElementCache.set(lineEl, original);
    }
  }

  // Keep the replace-line class in sync with the current display style on every
  // path — including the "text changed" one below, which used to return early
  // and leave a recycled line stuck in the previous style.
  if (displayStyle === DisplayStyle.ReplaceOnly) {
    lineEl.classList.add("scriptify-replace-line");
  } else {
    lineEl.classList.remove("scriptify-replace-line");
  }

  // Check if we already injected for this line
  const existing = lineEl.querySelector(".scriptify-romanized");
  if (existing) {
    // Text changed (different line scrolled into this element) — update
    if (existing.textContent !== romanizedText) {
      existing.textContent = romanizedText;
    }
    return;
  }

  // Create and inject
  const sub = document.createElement("div");
  sub.className = "scriptify-romanized";
  sub.textContent = romanizedText;
  lineEl.appendChild(sub);

  // Trigger fade-in: add .scriptify-visible on next frame
  requestAnimationFrame(() => {
    sub.classList.add("scriptify-visible");
  });
}

/** Remove this line's injected annotation and any replace-only state. */
function removeRomanizedFromLine(lineEl: Element): void {
  lineEl.querySelector(".scriptify-romanized")?.remove();
  lineEl.classList.remove("scriptify-replace-line");
}

/** Keep one rendered lyric line consistent with the current replacement map. */
function syncRomanizedLine(lineEl: Element, romanized: string | undefined): void {
  if (romanized) {
    injectRomanized(lineEl, romanized);
  } else {
    // React virtualizes/reuses lyric elements. A line that changed from a
    // mapped script to Latin or an unsupported/missing line must not retain
    // the previous line's romanization.
    removeRomanizedFromLine(lineEl);
  }
}

/**
 * Remove all injected romanized sub-elements from the DOM.
 * Also removes replace-line classes that hide original text.
 */
function removeAllRomanized(): void {
  const elements = document.querySelectorAll(".scriptify-romanized");
  for (const el of elements) {
    el.remove();
  }
  const replaceLines = document.querySelectorAll(".scriptify-replace-line");
  for (const el of replaceLines) {
    el.classList.remove("scriptify-replace-line");
  }
}

/**
 * Find the lyric line element currently most visible on screen.
 * First checks for Spotify's own active-line marker, then falls back
 * to the line whose center is closest to the viewport center.
 * Call this BEFORE any DOM height changes so the reference is accurate.
 */
function findCurrentLyricElement(): Element | null {
  const elements = findLyricLineElements();
  if (elements.length === 0) return null;

  // Spotify marks the active line with aria-current="true" or a data attribute
  for (const el of elements) {
    if (
      el.getAttribute("aria-current") === "true" ||
      el.getAttribute("data-active") === "true"
    ) {
      return el;
    }
  }

  // Fallback: find the line whose center is closest to mid-viewport
  const viewportMid = window.innerHeight / 2;
  let closest: Element | null = null;
  let closestDist = Infinity;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue; // not rendered
    const dist = Math.abs(rect.top + rect.height / 2 - viewportMid);
    if (dist < closestDist) {
      closestDist = dist;
      closest = el;
    }
  }
  return closest;
}

/**
 * After a height change (sub-elements added/removed), scroll `el` back to
 * the vertical center of the lyrics panel. Uses requestAnimationFrame so
 * the browser has recalculated layout before we scroll.
 */
function restoreScrollToElement(el: Element, delayMs = 0): void {
  const doScroll = (): void => {
    if (!el.isConnected) return;
    el.scrollIntoView({
      behavior: "instant" as ScrollBehavior,
      block: "center",
    });
  };

  if (delayMs > 0) {
    setTimeout(() => requestAnimationFrame(doScroll), delayMs);
  } else {
    requestAnimationFrame(doScroll);
  }
}

// ─── Replacement Map Building ─────────────────────────────────────────────────

/**
 * Collect ALL original lyrics for the current track.
 * Uses Spotify API + DOM visible elements for completeness.
 */
interface CollectedOriginals {
  originals: string[];
  language: string | null;
}

async function collectOriginals(
  trackInfo: TrackInfo | null,
  includeNetworkSources = true,
): Promise<CollectedOriginals> {
  const originals: string[] = [];
  const seen = new Set<string>();
  let language: string | null = null;

  // Source 1: Spotify internal API (has ALL lyrics, not just visible)
  if (trackInfo && includeNetworkSources) {
    const spotifyResult = await fetchSpotifyLyrics(trackInfo.id);
    if (spotifyResult) {
      language = spotifyResult.language;
      for (const line of spotifyResult.lines) {
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
    if (text && !seen.has(text)) {
      seen.add(text);
      originals.push(text);
    }
  }

  // Source 3: LRCLIB fallback
  if (originals.length === 0 && trackInfo && includeNetworkSources) {
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
  return { originals, language };
}

/**
 * Build forward and reverse replacement maps for the current mode.
 *
 * Returns how many original lines were collected, which lets the caller tell
 * "the lyrics haven't rendered yet" (retry is worthwhile) apart from "the
 * lyrics are here but none of them can be romanized" (retrying is pointless).
 */
interface BuildReplacementResult {
  originalCount: number;
  replacementCount: number;
  applied: boolean;
}

async function buildReplacementMaps(
  mode: LyricsMode,
  generation: number,
  expectedTrackId: string | null,
  trackInfo: TrackInfo | null,
  includeNetworkSources = true,
): Promise<BuildReplacementResult> {
  if (mode === LyricsMode.Original) {
    return { originalCount: 0, replacementCount: 0, applied: false };
  }

  const { originals, language } = await collectOriginals(
    trackInfo,
    includeNetworkSources,
  );
  if (!isStateCurrent(generation, expectedTrackId, mode)) {
    return {
      originalCount: originals.length,
      replacementCount: 0,
      applied: false,
    };
  }
  if (originals.length === 0) {
    console.log("[Scriptify] No originals found, cannot build maps");
    return { originalCount: 0, replacementCount: 0, applied: true };
  }

  const nextMap = new Map<string, string>();
  if (mode === LyricsMode.Romanized) {
    // Pass this result's language to the romanizer. This work is synchronous,
    // so another async operation cannot interleave after the current-state check.
    setLanguageHint(language);
    let count = 0;
    for (const text of originals) {
      const romanized = romanize(text);
      if (romanized && romanized !== text) {
        nextMap.set(text, romanized);
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

  if (!isStateCurrent(generation, expectedTrackId, mode)) {
    return {
      originalCount: originals.length,
      replacementCount: nextMap.size,
      applied: false,
    };
  }

  // Commit atomically. Concurrent builders never share a partially built map.
  forwardMap = nextMap;
  return {
    originalCount: originals.length,
    replacementCount: nextMap.size,
    applied: true,
  };
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
    syncRomanizedLine(el, text && forwardMap.get(text));
  }
  Promise.resolve().then(() => {
    isWriting = false;
  });
}

/**
 * FULL injection — refreshes element cache and re-attaches observer.
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
      // Hand over to the cheap idle watcher: re-opening the lyrics panel on the
      // same track changes neither the route nor the song, so nothing else
      // would ever restart the engine.
      startIdleWatch();
      console.log(
        "[Scriptify] Auto-stopped injection (no lyrics visible; watching for their return)",
      );
    }
    return;
  }
  cachedLyricElements = elements;
  emptyTicks = 0;

  // Ensure the narrow observer is attached
  ensureLyricsObserver();

  // Inject romanized sub-elements
  isWriting = true;
  for (const el of cachedLyricElements) {
    const text = readText(el);
    syncRomanizedLine(el, text && forwardMap.get(text));
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
  for (const sel of [
    SEL_CONTENT_CONTAINER,
    SEL_CONTENT_WRAPPER,
    SEL_CONTAINER,
  ]) {
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

/**
 * Low-frequency watcher that runs INSTEAD of the 100 ms engine while the lyrics
 * panel is closed. One DOM query per second is negligible next to the ten per
 * second the engine does, and it means the user can close and re-open the panel
 * on the same track without losing romanization until the next song.
 */
function startIdleWatch(): void {
  if (idleWatchInterval || replaceInterval) return;
  idleWatchInterval = setInterval(() => {
    // Nothing left to re-apply — stop watching.
    if (currentMode === LyricsMode.Original || forwardMap.size === 0) {
      stopIdleWatch();
      return;
    }
    if (findLyricLineElements().length > 0) {
      console.log("[Scriptify] Lyrics reappeared — restarting injection");
      startContinuousReplacement();
    }
  }, IDLE_WATCH_INTERVAL_MS);
}

function stopIdleWatch(): void {
  if (idleWatchInterval) {
    clearInterval(idleWatchInterval);
    idleWatchInterval = null;
  }
}

function startContinuousReplacement(): void {
  stopIdleWatch();
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
  stopIdleWatch();
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
  isDestroyed = false;
  stateGeneration++;
  cancelPendingSongChangeTimeouts();
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
    songChangeHandler = () => {
      const info = getCurrentTrackInfo();
      const newId = info?.id || null;

      if (newId && newId !== currentTrackId) {
        const generation = ++stateGeneration;
        currentTrackId = newId;
        cancelPendingSongChangeTimeouts();
        stopContinuousReplacement();
        removeAllRomanized();
        forwardMap.clear();
        console.log(`[Scriptify] Song change: ${info?.name || "unknown"}`);

        // Check lyrics availability immediately. Completion is ignored if a
        // newer track/mode/lifecycle generation supersedes this one.
        void checkAndNotifyAvailability(info!);

        if (currentMode !== LyricsMode.Original) {
          // Give Spotify time to render new lyrics before rebuilding maps
          const mode = currentMode;
          const timeout = setTimeout(async () => {
            pendingSongChangeTimeouts.delete(timeout);
            if (!isStateCurrent(generation, newId, mode)) return;

            const result = await buildReplacementMaps(
              mode,
              generation,
              newId,
              info!,
            );
            if (
              result.applied &&
              result.replacementCount > 0 &&
              isStateCurrent(generation, newId, mode)
            ) {
              startContinuousReplacement();
            }
          }, 1500);
          pendingSongChangeTimeouts.add(timeout);
        }
      }
    };
    Spicetify.Player.addEventListener("songchange", songChangeHandler);
  } catch {}

  // Listen for navigation — restart engine when returning to lyrics,
  // stop when navigating away.
  try {
    historyUnsubscribe = Spicetify.Platform.History.listen(() => {
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
  let generation = ++stateGeneration;
  const expectedTrackId = currentTrackId;
  const trackInfo = getCurrentTrackInfo();
  cancelPendingSongChangeTimeouts();

  // Capture the currently visible line BEFORE any DOM height changes.
  // We'll scroll back to it after the toggle to preserve reading position.
  const anchorEl = findCurrentLyricElement();

  // Step 1: Stop any existing replacement interval
  stopContinuousReplacement();

  // Step 2: Remove all injected romanized sub-elements
  removeAllRomanized();

  // Step 3: Clear old maps
  forwardMap.clear();

  // Step 4: Update state
  currentMode = mode;
  try {
    Spicetify.LocalStorage.set("scriptify:mode", mode);
  } catch {}

  if (mode === LyricsMode.Original) {
    // Height decreased (sub-elements removed) — restore scroll immediately
    if (anchorEl) restoreScrollToElement(anchorEl);
  } else {
    // Step 5: Build new maps and start continuous replacement.
    // On startup, lyrics may not be available yet — retry a few times.
    let retries = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000;

    while (retries <= MAX_RETRIES) {
      let result: BuildReplacementResult;
      try {
        // Remote sources are consulted once. Later retries are deliberately
        // DOM-only: they wait for Spotify to render rather than multiplying
        // network timeouts and rate-limit pressure.
        const build = buildReplacementMaps(
          mode,
          generation,
          expectedTrackId,
          trackInfo,
          retries === 0,
        );
        result =
          retries === 0
            ? await withTimeout(
                build,
                INITIAL_MAP_BUILD_TIMEOUT_MS,
                "Initial lyrics collection",
              )
            : await build;
      } catch (error) {
        if (!isStateCurrent(generation, expectedTrackId, mode)) {
          return currentMode;
        }
        if (error instanceof TimeoutError) {
          // The timed-out builder may still settle later. Advance the
          // generation so it cannot commit a stale map or restart the engine.
          generation = ++stateGeneration;
          forwardMap.clear();
          console.warn(
            "[Scriptify] Initial lyrics collection timed out — leaving lyrics unchanged",
          );
          break;
        }
        throw error;
      }
      if (!result.applied || !isStateCurrent(generation, expectedTrackId, mode)) {
        return currentMode;
      }
      if (result.replacementCount > 0) {
        startContinuousReplacement();
        // Height increased (sub-elements injected) — wait for first injection
        // pass (~100ms interval) then restore scroll position
        if (anchorEl) restoreScrollToElement(anchorEl, 200);
        break;
      }
      if (result.originalCount > 0) {
        // The lyrics ARE here, they just can't be romanized (script we have no
        // engine for, or already Latin). Retrying only spends 10 s repeating
        // the same work, so stop now.
        console.warn(
          "[Scriptify] Lyrics found but nothing to romanize — leaving them as-is",
        );
        break;
      }
      if (retries < MAX_RETRIES) {
        retries++;
        console.log(
          `[Scriptify] No lyrics yet, retrying in ${RETRY_DELAY}ms (${retries}/${MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        // Bail if track, mode, lifecycle, or another operation changed while
        // this retry was waiting.
        if (!isStateCurrent(generation, expectedTrackId, mode)) {
          return currentMode;
        }
      } else {
        console.warn(
          "[Scriptify] No replacements built — lyrics may already be in target script",
        );
        break;
      }
    }
  }

  if (!isStateCurrent(generation, expectedTrackId, mode)) return currentMode;

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

// ─── Display Style ────────────────────────────────────────────────────────────

export function getDisplayStyle(): DisplayStyle {
  return displayStyle;
}

export function loadSavedDisplayStyle(): DisplayStyle {
  try {
    const saved = Spicetify.LocalStorage.get(
      "scriptify:displayStyle",
    ) as DisplayStyle;
    if (saved && Object.values(DisplayStyle).includes(saved)) {
      displayStyle = saved;
      return saved;
    }
  } catch {}
  return DisplayStyle.DualLine;
}

export async function setDisplayStyle(style: DisplayStyle): Promise<void> {
  displayStyle = style;
  try {
    Spicetify.LocalStorage.set("scriptify:displayStyle", style);
  } catch {}

  // If currently showing romanized lyrics, refresh the display
  if (currentMode === LyricsMode.Romanized && forwardMap.size > 0) {
    removeAllRomanized();
    // Re-inject with new style
    applyReplacements();
  }
}

// ─── Font Size ────────────────────────────────────────────────────────────────

export function getRomanizedFontSizeMultiplier(): number {
  return romanizedFontSizeMultiplier;
}

export function loadSavedFontSize(): number {
  try {
    const saved = Spicetify.LocalStorage.get("scriptify:fontSizeMultiplier");
    if (saved) {
      const val = parseFloat(saved);
      if (!isNaN(val) && val >= 0.5 && val <= 1.5) {
        romanizedFontSizeMultiplier = val;
        applyFontSizeVariable();
        return val;
      }
    }
  } catch {}
  return 1.0;
}

export function setRomanizedFontSize(multiplier: number): void {
  romanizedFontSizeMultiplier = Math.max(0.5, Math.min(1.5, multiplier));
  try {
    Spicetify.LocalStorage.set(
      "scriptify:fontSizeMultiplier",
      romanizedFontSizeMultiplier.toString(),
    );
  } catch {}
  applyFontSizeVariable();

  // Re-sync scroll to the current line so the user doesn't lose their place
  // after the height change caused by the font size adjustment
  setTimeout(() => scrollToCurrentLine(), 50);
}

function applyFontSizeVariable(): void {
  const emSize = romanizedFontSizeMultiplier * FONT_SIZE_BASE_EM;
  document.documentElement.style.setProperty(
    "--scriptify-font-size",
    `${emSize}em`,
  );
}

// ─── Jump to Current Line ─────────────────────────────────────────────────────

export function scrollToCurrentLine(): boolean {
  const elements = findLyricLineElements();
  if (elements.length === 0) return false;

  // Look for Spotify's active line marker
  for (const el of elements) {
    if (
      el.getAttribute("aria-current") === "true" ||
      el.getAttribute("data-active") === "true"
    ) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
  }

  // Fall back to the active class pattern
  for (const el of elements) {
    const classes = el.className || "";
    if (classes.includes("Active") || classes.includes("active")) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
  }

  return false;
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
 * Can Scriptify actually do anything with these lyrics?
 *
 * Requires at least one line in a script we have an engine for. Checking merely
 * for "non-Latin" is not enough: a Russian, Arabic or Thai song is non-Latin but
 * has no romanizer behind it, so the button would light up and do nothing.
 */
function hasRomanizableLyrics(
  lyrics: LyricLine[],
  language: string | null,
): boolean {
  setLanguageHint(language);
  for (const line of lyrics) {
    const text = line.text.trim();
    if (text.length === 0) continue; // skip empty lines
    if (hasRomanizableScript(text)) return true;
  }
  return false;
}

async function getLyricsForAvailability(
  trackInfo: TrackInfo,
): Promise<{ lines: LyricLine[]; language: string | null }> {
  const spotifyResult = await fetchSpotifyLyrics(trackInfo.id);
  if (spotifyResult && spotifyResult.lines.length > 0) {
    return spotifyResult;
  }

  // Spotify being unavailable is not proof that Scriptify has nothing to do.
  // Prefer already-rendered lyrics, then use the documented LRCLIB fallback.
  const domLines = findLyricLineElements()
    .map((element) => readText(element))
    .filter((text) => text.length > 0)
    .map((text) => ({ startTimeMs: 0, text }));
  if (domLines.length > 0) return { lines: domLines, language: null };

  const lrclibLines = await fetchLyrics(trackInfo);
  return { lines: lrclibLines || [], language: null };
}

/**
 * Check lyrics availability for a track and notify subscribers.
 * "Available" for Scriptify means: lyrics exist AND at least one line is in a
 * script we can romanize (otherwise the toggle would be a no-op).
 *
 * @param force - notify subscribers even if the value didn't change (used for
 *                the first check, where `lyricsAvailable` still holds its
 *                optimistic default).
 */
async function checkAndNotifyAvailability(
  trackInfo: TrackInfo,
  force = false,
): Promise<void> {
  const result = await getLyricsForAvailability(trackInfo);
  if (isDestroyed || currentTrackId !== trackInfo.id) return;

  let available = result.lines.length > 0;
  if (
    available &&
    !hasRomanizableLyrics(result.lines, result.language)
  ) {
    console.log(
      "[Scriptify] Lyrics are already Latin or in an unsupported script — disabling button",
    );
    available = false;
  }
  if (available !== lyricsAvailable || force) {
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
    // Force notification even on first check (lyricsAvailable defaults to true,
    // but we need to notify if the track actually has no usable lyrics)
    const info = getCurrentTrackInfo();
    if (info?.id === currentTrackId) {
      await checkAndNotifyAvailability(info, true);
    }
  }
}

export function destroyLyricsInterceptor(): void {
  isDestroyed = true;
  stateGeneration++;
  cancelPendingSongChangeTimeouts();
  stopContinuousReplacement();
  removeAllRomanized();
  forwardMap.clear();
  modeChangeCallbacks = [];
  availabilityCallbacks = [];

  // Drop the Spicetify subscriptions, otherwise a reload leaves the previous
  // instance's handlers running alongside the new one's.
  if (songChangeHandler) {
    try {
      Spicetify.Player.removeEventListener("songchange", songChangeHandler);
    } catch {}
    songChangeHandler = null;
  }
  if (historyUnsubscribe) {
    try {
      historyUnsubscribe();
    } catch {}
    historyUnsubscribe = null;
  }
}
