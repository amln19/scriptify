/**
 * LRCLIB Lyrics Fetcher
 *
 * Fetches synced (LRC format) lyrics from the free LRCLIB API as a fallback
 * when Spotify's native lyrics DOM is unavailable or unparseable.
 *
 * LRCLIB (https://lrclib.net) provides:
 * - Free, no API key required
 * - Synced lyrics in standard LRC format
 * - Large database of song lyrics
 * - Search by track name, artist, album, and duration
 */

import type { LyricLine, LRCLibResponse, TrackInfo } from "../types";
import { withTimeout } from "../utils/async";

const LRCLIB_BASE = "https://lrclib.net/api";
const LYRICS_CACHE = new Map<string, LyricLine[] | null>();
const MAX_CACHE_SIZE = 30;
const REQUEST_TIMEOUT_MS = 8_000;
const FALLBACK_REQUEST_DELAY_MS = 250;
const MAX_SEARCH_DURATION_DIFFERENCE_SECONDS = 2;
const LRCLIB_CLIENT =
  "Scriptify v1.0 (https://github.com/amln19/scriptify)";

// Rate limits apply to the whole client, not a single track request. Keep the
// cooldown as state and fail quickly while it is active instead of parking a
// mode toggle on an arbitrary server-provided delay.
let rateLimitedUntilMs = 0;

class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`LRCLIB rate limited; retry after ${retryAfterMs}ms`);
    this.name = "RateLimitError";
  }
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 1_000;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return 1_000;
}

async function requestJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const response = await withTimeout(
    fetch(url, {
      headers: { "Lrclib-Client": LRCLIB_CLIENT },
      signal: controller.signal,
    }),
    REQUEST_TIMEOUT_MS,
    "LRCLIB request",
    () => controller.abort(),
  );

  if (response.status === 429) {
    throw new RateLimitError(
      parseRetryAfter(response.headers.get("Retry-After")),
    );
  }
  if (response.status >= 500) {
    throw new Error(`LRCLIB server error: ${response.status}`);
  }
  if (!response.ok) return null;
  return response.json();
}

async function requestJsonRespectingRateLimit(
  url: string,
): Promise<unknown | null> {
  if (Date.now() < rateLimitedUntilMs) {
    throw new RateLimitError(rateLimitedUntilMs - Date.now());
  }

  try {
    return await requestJson(url);
  } catch (error) {
    if (error instanceof RateLimitError) {
      rateLimitedUntilMs = Math.max(
        rateLimitedUntilMs,
        Date.now() + error.retryAfterMs,
      );
    }
    throw error;
  }
}

/** Matches one leading "[mm:ss.xx]" / "[mm:ss]" timestamp tag. */
const LRC_TIMESTAMP = /^\[(\d+):(\d+)(?:[.:](\d+))?\]/;

/**
 * Parse raw LRC text into structured LyricLine array.
 *
 * A line may carry SEVERAL timestamps when the same words recur (a chorus):
 * "[00:20.00][01:05.00]text". Each one becomes its own entry — matching only
 * the first tag would leave "[01:05.00]text" as the lyric and get it dropped
 * by the metadata filter below.
 */
function parseLrc(lrcText: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const rawLine of lrcText.split("\n")) {
    let rest = rawLine.trim();
    if (!rest) continue;

    // Consume every leading timestamp tag
    const timestamps: number[] = [];
    let match = rest.match(LRC_TIMESTAMP);
    while (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      // Fractions are hundredths ("12" = 120 ms) unless three digits are given
      const fraction = match[3] ?? "0";
      const fractionMs =
        parseInt(fraction, 10) * (fraction.length >= 3 ? 1 : 10);
      timestamps.push(minutes * 60 * 1000 + seconds * 1000 + fractionMs);
      rest = rest.slice(match[0].length);
      match = rest.match(LRC_TIMESTAMP);
    }

    if (timestamps.length === 0) continue; // metadata tag or junk

    const text = rest.trim();
    if (text.length === 0) continue; // timing-only line

    for (const startTimeMs of timestamps) {
      lines.push({ startTimeMs, text });
    }
  }

  // Sort by time
  lines.sort((a, b) => a.startTimeMs - b.startTimeMs);

  return lines;
}

/**
 * Fetch lyrics from LRCLIB by exact match (track name + artist + duration).
 */
async function fetchExact(track: TrackInfo): Promise<LRCLibResponse | null> {
  const params = new URLSearchParams({
    track_name: track.name,
    artist_name: track.artist,
    duration: Math.round(track.duration / 1000).toString(),
  });

  if (track.album) {
    params.set("album_name", track.album);
  }

  const result = await requestJsonRespectingRateLimit(
    `${LRCLIB_BASE}/get?${params}`,
  );
  if (result === null) return null;
  if (typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Unexpected LRCLIB exact-match response");
  }

  return result as LRCLibResponse;
}

/**
 * Fetch lyrics from LRCLIB by search (more relaxed matching).
 */
async function fetchSearch(track: TrackInfo): Promise<LRCLibResponse | null> {
  const params = new URLSearchParams({
    track_name: track.name,
    artist_name: track.artist,
  });
  if (track.album) params.set("album_name", track.album);

  const result = await requestJsonRespectingRateLimit(
    `${LRCLIB_BASE}/search?${params}`,
  );
  if (result === null) return null;
  if (!Array.isArray(result)) {
    throw new Error("Unexpected LRCLIB search response");
  }

  if (result.length === 0) return null;

  // Search is intentionally looser than /get, but accepting a same-duration
  // keyword hit from another release can suppress future retries with a map
  // that never matches Spotify's rendered lyrics. Require an identity match
  // and LRCLIB's documented duration tolerance before ranking candidates.
  const targetDuration = track.duration / 1000;
  const sorted = result
    .filter((candidate): candidate is LRCLibResponse =>
      isMatchingSearchResult(candidate, track, targetDuration),
    )
    .sort(
      (a, b) =>
        Math.abs(a.duration - targetDuration) -
        Math.abs(b.duration - targetDuration),
    );

  return sorted[0] || null;
}

function normalizeMatchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isMatchingSearchResult(
  candidate: unknown,
  track: TrackInfo,
  targetDuration: number,
): candidate is LRCLibResponse {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  const result = candidate as Partial<LRCLibResponse>;
  if (
    typeof result.trackName !== "string" ||
    typeof result.artistName !== "string" ||
    typeof result.albumName !== "string" ||
    typeof result.duration !== "number" ||
    typeof result.syncedLyrics !== "string"
  ) {
    return false;
  }
  if (
    normalizeMatchText(result.trackName) !== normalizeMatchText(track.name) ||
    normalizeMatchText(result.artistName) !== normalizeMatchText(track.artist)
  ) {
    return false;
  }
  if (
    track.album &&
    normalizeMatchText(result.albumName) !== normalizeMatchText(track.album)
  ) {
    return false;
  }
  return (
    Math.abs(result.duration - targetDuration) <=
    MAX_SEARCH_DURATION_DIFFERENCE_SECONDS
  );
}

/**
 * Get the current track info from Spicetify.
 */
export function getCurrentTrackInfo(): TrackInfo | null {
  try {
    const data = Spicetify.Player.data;
    if (!data) return null;

    const item = data.item || data.track;
    if (!item) return null;

    const uri = Spicetify.URI.from(item.uri);
    const id = uri?.id || item.uri;

    return {
      uri: item.uri,
      id,
      name: item.metadata?.title || item.name || "",
      artist:
        item.metadata?.artist_name || (item as any).artists?.[0]?.name || "",
      album: item.metadata?.album_title || "",
      duration: data.duration || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch synced lyrics for a track from LRCLIB.
 * Tries exact match first, then falls back to search.
 * Results are cached.
 */
export async function fetchLyrics(
  track: TrackInfo,
): Promise<LyricLine[] | null> {
  // Check cache
  if (LYRICS_CACHE.has(track.id)) {
    return LYRICS_CACHE.get(track.id) || null;
  }

  try {
    // Try exact match
    let response = await fetchExact(track);

    // Fallback to search
    if (!response?.syncedLyrics) {
      // LRCLIB asks clients to leave a short gap between sequential requests.
      await new Promise((resolve) =>
        setTimeout(resolve, FALLBACK_REQUEST_DELAY_MS),
      );
      response = await fetchSearch(track);
    }

    if (!response?.syncedLyrics) {
      LYRICS_CACHE.set(track.id, null);
      return null;
    }

    const lines = parseLrc(response.syncedLyrics);

    // Cache the result
    if (LYRICS_CACHE.size >= MAX_CACHE_SIZE) {
      const firstKey = LYRICS_CACHE.keys().next().value;
      if (firstKey) LYRICS_CACHE.delete(firstKey);
    }
    LYRICS_CACHE.set(track.id, lines);

    return lines;
  } catch (e) {
    console.warn("[Scriptify] LRCLIB fetch failed:", e);
    // Transport, timeout, rate-limit, and schema failures are transient. Do not
    // turn them into a session-long negative cache entry.
    return null;
  }
}
