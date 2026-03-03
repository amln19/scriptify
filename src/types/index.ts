/** Core types for the Scriptify extension */

export enum LyricsMode {
  Original = "original",
  Romanized = "romanized",
  Translated = "translated",
}

export interface LyricLine {
  /** Start time in milliseconds */
  startTimeMs: number;
  /** The lyric text */
  text: string;
  /** End time in milliseconds (optional, for word-level sync) */
  endTimeMs?: number;
}

export interface TrackInfo {
  uri: string;
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
}

export interface LRCLibResponse {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}
