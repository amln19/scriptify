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

const LRCLIB_BASE = "https://lrclib.net/api";
const LYRICS_CACHE = new Map<string, LyricLine[] | null>();
const MAX_CACHE_SIZE = 30;

/**
 * Parse an LRC timestamp "[mm:ss.xx]" to milliseconds.
 */
function parseLrcTimestamp(timestamp: string): number {
  const match = timestamp.match(/\[(\d+):(\d+)\.(\d+)\]/);
  if (!match) return 0;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const centiseconds = parseInt(match[3], 10);

  return minutes * 60 * 1000 + seconds * 1000 + centiseconds * 10;
}

/**
 * Parse raw LRC text into structured LyricLine array.
 */
function parseLrc(lrcText: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const rawLine of lrcText.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^\[(\d+:\d+\.\d+)\]\s*(.*)/);
    if (!match) continue;

    const timeMs = parseLrcTimestamp(`[${match[1]}]`);
    const text = match[2].trim();

    // Skip empty lyric lines and metadata tags
    if (text.length === 0 || text.startsWith("[")) continue;

    lines.push({ startTimeMs: timeMs, text });
  }

  // Sort by time
  lines.sort((a, b) => a.startTimeMs - b.startTimeMs);

  return lines;
}

/**
 * Fetch lyrics from LRCLIB by exact match (track name + artist + duration).
 */
async function fetchExact(track: TrackInfo): Promise<LRCLibResponse | null> {
  try {
    const params = new URLSearchParams({
      track_name: track.name,
      artist_name: track.artist,
      duration: Math.round(track.duration / 1000).toString(),
    });

    if (track.album) {
      params.set("album_name", track.album);
    }

    const response = await fetch(`${LRCLIB_BASE}/get?${params}`, {
      headers: { "User-Agent": "Scriptify Spicetify Extension v1.0" },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch lyrics from LRCLIB by search (more relaxed matching).
 */
async function fetchSearch(track: TrackInfo): Promise<LRCLibResponse | null> {
  try {
    const query = `${track.name} ${track.artist}`;
    const params = new URLSearchParams({ q: query });

    const response = await fetch(`${LRCLIB_BASE}/search?${params}`, {
      headers: { "User-Agent": "Scriptify Spicetify Extension v1.0" },
    });

    if (!response.ok) return null;

    const results: LRCLibResponse[] = await response.json();
    if (!results || results.length === 0) return null;

    // Find best match by duration proximity
    const targetDuration = track.duration / 1000;
    const sorted = results
      .filter((r) => r.syncedLyrics) // Only want synced lyrics
      .sort(
        (a, b) =>
          Math.abs(a.duration - targetDuration) -
          Math.abs(b.duration - targetDuration),
      );

    return sorted[0] || null;
  } catch {
    return null;
  }
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
    LYRICS_CACHE.set(track.id, null);
    return null;
  }
}
