/**
 * Translation Service
 *
 * Uses the free MyMemory Translation API (no API key required, generous rate limits)
 * and Google Translate's undocumented free endpoint as a fallback.
 *
 * Architecture decisions:
 * - MyMemory primary: 1000 words/day free, no key needed, good quality
 * - Google free fallback: Higher volume but may be rate-limited
 * - Aggressive caching: Translations are cached per track to avoid redundant API calls
 * - Batch processing: Lines are sent in batches to minimize API requests
 */

import type { LyricLine } from "../types";

const TRANSLATION_CACHE = new Map<string, Map<string, string>>();
const MAX_CACHE_SIZE = 50; // Cache translations for up to 50 tracks

/**
 * Get the user's preferred language for translations.
 * Defaults to English, can be overridden via Spicetify LocalStorage.
 */
export function getTargetLanguage(): string {
  try {
    const stored = Spicetify.LocalStorage.get("scriptify:targetLang");
    if (stored) return stored;
    // Try to get from Spotify's locale
    const locale = Spicetify.Locale?.getLocale?.();
    if (locale) {
      const lang = locale.split("-")[0].split("_")[0];
      return lang || "en";
    }
  } catch {
    // Spicetify not available yet
  }
  return "en";
}

export function setTargetLanguage(lang: string): void {
  try {
    Spicetify.LocalStorage.set("scriptify:targetLang", lang);
  } catch {
    // ignore
  }
}

/**
 * Get a cache key for a track.
 */
function getCacheKey(trackId: string, targetLang: string): string {
  return `${trackId}:${targetLang}`;
}

/**
 * Translate text using MyMemory API (primary).
 */
async function translateMyMemory(
  text: string,
  targetLang: string,
): Promise<string | null> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (data?.responseStatus === 200 && data?.responseData?.translatedText) {
      const translated = data.responseData.translatedText;
      // MyMemory returns the original text in all caps if it can't translate
      if (translated === text.toUpperCase()) return null;
      return translated;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Translate text using free Google Translate endpoint (fallback).
 */
async function translateGoogle(
  text: string,
  targetLang: string,
): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((segment: any[]) => segment[0]).join("");
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Translate a single text string with fallback chain.
 */
async function translateText(
  text: string,
  targetLang: string,
): Promise<string> {
  if (!text || text.trim().length === 0) return text;

  // Try MyMemory first
  const myMemoryResult = await translateMyMemory(text, targetLang);
  if (myMemoryResult) return myMemoryResult;

  // Fallback to Google Translate
  const googleResult = await translateGoogle(text, targetLang);
  if (googleResult) return googleResult;

  // If all fail, return original
  return text;
}

/**
 * Translate an array of lyric lines.
 * Uses batching and caching for efficiency.
 *
 * @param lines - Array of lyric lines to translate
 * @param trackId - Track identifier for caching
 * @param targetLang - Target language code (e.g., "en", "hi", "ta")
 * @returns Translated lyric lines, or null if translation fails entirely
 */
export async function translateLines(
  lines: LyricLine[],
  trackId: string,
  targetLang?: string,
): Promise<LyricLine[] | null> {
  const lang = targetLang || getTargetLanguage();
  const cacheKey = getCacheKey(trackId, lang);

  // Check cache
  if (TRANSLATION_CACHE.has(cacheKey)) {
    const cached = TRANSLATION_CACHE.get(cacheKey)!;
    return lines.map((line) => ({
      ...line,
      text: cached.get(line.text) || line.text,
    }));
  }

  try {
    // Deduplicate lines to minimize API calls
    const uniqueTexts = [
      ...new Set(lines.map((l) => l.text).filter((t) => t.trim().length > 0)),
    ];

    // Batch translate: combine lines with a delimiter to reduce API calls
    const BATCH_SIZE = 10;
    const translationMap = new Map<string, string>();

    for (let i = 0; i < uniqueTexts.length; i += BATCH_SIZE) {
      const batch = uniqueTexts.slice(i, i + BATCH_SIZE);
      const batchText = batch.join("\n");

      const translated = await translateText(batchText, lang);
      const translatedParts = translated.split("\n");

      // Map each original line to its translation
      batch.forEach((original, idx) => {
        const translatedLine = translatedParts[idx]?.trim() || original;
        translationMap.set(original, translatedLine);
      });

      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < uniqueTexts.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Cache the translations
    if (TRANSLATION_CACHE.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry
      const firstKey = TRANSLATION_CACHE.keys().next().value;
      if (firstKey) TRANSLATION_CACHE.delete(firstKey);
    }
    TRANSLATION_CACHE.set(cacheKey, translationMap);

    // Apply translations to all lines
    const result = lines.map((line) => ({
      ...line,
      text: translationMap.get(line.text) || line.text,
    }));

    return result;
  } catch (e) {
    console.warn("[Scriptify] Translation failed:", e);
    return null;
  }
}

/**
 * Clear the translation cache (e.g., when changing target language).
 */
export function clearTranslationCache(): void {
  TRANSLATION_CACHE.clear();
}
