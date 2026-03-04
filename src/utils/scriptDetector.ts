/**
 * Script Detection Utility
 * Detects the writing system of text to route to the correct romanization engine.
 */

export enum ScriptType {
  Latin = "latin",
  Devanagari = "devanagari",
  Tamil = "tamil",
  Bengali = "bengali",
  Telugu = "telugu",
  Kannada = "kannada",
  Gujarati = "gujarati",
  Malayalam = "malayalam",
  Gurmukhi = "gurmukhi",
  Odia = "odia",
  CJK = "cjk",
  Japanese = "japanese",
  Korean = "korean",
  Cyrillic = "cyrillic",
  Arabic = "arabic",
  Thai = "thai",
  Unknown = "unknown",
}

interface UnicodeRange {
  start: number;
  end: number;
  script: ScriptType;
}

const UNICODE_RANGES: UnicodeRange[] = [
  // Devanagari
  { start: 0x0900, end: 0x097f, script: ScriptType.Devanagari },
  { start: 0xa8e0, end: 0xa8ff, script: ScriptType.Devanagari },
  // Bengali
  { start: 0x0980, end: 0x09ff, script: ScriptType.Bengali },
  // Gurmukhi
  { start: 0x0a00, end: 0x0a7f, script: ScriptType.Gurmukhi },
  // Gujarati
  { start: 0x0a80, end: 0x0aff, script: ScriptType.Gujarati },
  // Odia
  { start: 0x0b00, end: 0x0b7f, script: ScriptType.Odia },
  // Tamil
  { start: 0x0b80, end: 0x0bff, script: ScriptType.Tamil },
  // Telugu
  { start: 0x0c00, end: 0x0c7f, script: ScriptType.Telugu },
  // Kannada
  { start: 0x0c80, end: 0x0cff, script: ScriptType.Kannada },
  // Malayalam
  { start: 0x0d00, end: 0x0d7f, script: ScriptType.Malayalam },
  // Thai
  { start: 0x0e00, end: 0x0e7f, script: ScriptType.Thai },
  // Korean (Hangul)
  { start: 0xac00, end: 0xd7af, script: ScriptType.Korean },
  { start: 0x1100, end: 0x11ff, script: ScriptType.Korean },
  { start: 0x3130, end: 0x318f, script: ScriptType.Korean },
  // Japanese (Hiragana + Katakana)
  { start: 0x3040, end: 0x309f, script: ScriptType.Japanese },
  { start: 0x30a0, end: 0x30ff, script: ScriptType.Japanese },
  { start: 0x31f0, end: 0x31ff, script: ScriptType.Japanese },
  // CJK Unified Ideographs (shared by Chinese/Japanese/Korean)
  { start: 0x4e00, end: 0x9fff, script: ScriptType.CJK },
  { start: 0x3400, end: 0x4dbf, script: ScriptType.CJK },
  { start: 0xf900, end: 0xfaff, script: ScriptType.CJK },
  // Cyrillic
  { start: 0x0400, end: 0x04ff, script: ScriptType.Cyrillic },
  { start: 0x0500, end: 0x052f, script: ScriptType.Cyrillic },
  // Arabic
  { start: 0x0600, end: 0x06ff, script: ScriptType.Arabic },
  { start: 0x0750, end: 0x077f, script: ScriptType.Arabic },
  { start: 0xfb50, end: 0xfdff, script: ScriptType.Arabic },
  // Latin
  { start: 0x0041, end: 0x024f, script: ScriptType.Latin },
];

/**
 * Detect the dominant script in a string.
 * Counts characters belonging to each script range and returns the most common.
 */
export function detectScript(text: string): ScriptType {
  if (!text || text.trim().length === 0) return ScriptType.Unknown;

  const counts = new Map<ScriptType, number>();

  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;

    // Skip whitespace and punctuation
    if (
      code <= 0x40 ||
      (code >= 0x5b && code <= 0x60) ||
      (code >= 0x7b && code <= 0x7f)
    ) {
      continue;
    }

    for (const range of UNICODE_RANGES) {
      if (code >= range.start && code <= range.end) {
        counts.set(range.script, (counts.get(range.script) || 0) + 1);
        break;
      }
    }
  }

  if (counts.size === 0) return ScriptType.Unknown;

  // If we have Japanese kana alongside CJK, classify as Japanese
  const japaneseCount = counts.get(ScriptType.Japanese) || 0;
  const cjkCount = counts.get(ScriptType.CJK) || 0;
  if (japaneseCount > 0 && cjkCount > 0) {
    counts.set(ScriptType.Japanese, japaneseCount + cjkCount);
    counts.delete(ScriptType.CJK);
  }

  // If Korean alongside CJK, classify as Korean
  const koreanCount = counts.get(ScriptType.Korean) || 0;
  if (koreanCount > 0 && cjkCount > 0 && japaneseCount === 0) {
    counts.set(ScriptType.Korean, koreanCount + cjkCount);
    counts.delete(ScriptType.CJK);
  }

  let dominant: ScriptType = ScriptType.Unknown;
  let maxCount = 0;
  for (const [script, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      dominant = script;
    }
  }

  return dominant;
}

/**
 * Return all script types found in the text (with at least 1 character each).
 * Useful for detecting mixed-script lines.
 */
export function detectAllScripts(text: string): Set<ScriptType> {
  const found = new Set<ScriptType>();
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    // Detect Latin letters in the basic ASCII range (A-Z, a-z).
    // These are below 0x80 so the UNICODE_RANGES loop below would skip them,
    // but we must know whether Latin is present for the mixed-script check.
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      found.add(ScriptType.Latin);
      continue;
    }
    if (code <= 0x7f) continue; // skip other ASCII (digits, punctuation, control)
    for (const range of UNICODE_RANGES) {
      if (code >= range.start && code <= range.end) {
        found.add(range.script);
        break;
      }
    }
  }
  return found;
}

/**
 * Check if the text contains ANY non-Latin script characters.
 * Used to detect mixed-script lines (e.g., Hindi + English).
 */
export function hasNonLatinScript(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    // Skip whitespace, punctuation, digits, basic ASCII symbols
    if (code <= 0x7f) continue;
    // Any character above basic ASCII that falls in a known non-Latin range
    for (const range of UNICODE_RANGES) {
      if (
        range.script !== ScriptType.Latin &&
        code >= range.start &&
        code <= range.end
      ) {
        return true;
      }
    }
  }
  return false;
}
