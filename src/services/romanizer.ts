/**
 * Romanization engine public API and mixed-script router.
 *
 * Individual script engines live in adjacent modules so language-specific
 * dictionaries and phonology can evolve without obscuring routing behavior.
 */

import {
  ScriptType,
  detectScript,
  hasNonLatinScript,
  detectAllScripts,
} from "../utils/scriptDetector";
import { initIndicRomanizer, romanizeIndic } from "./romanizer/indic";
import { romanizeJapanese } from "./romanizer/japanese";
import { romanizeKorean } from "./romanizer/korean";
import { romanizeChinese } from "./romanizer/chinese";

/** ISO language code from the current track's Spotify lyrics metadata. */
let currentLanguageHint: string | null = null;

export function setLanguageHint(lang: string | null): void {
  currentLanguageHint =
    lang?.trim().toLowerCase().split(/[-_]/, 1)[0] || null;
  console.log(`[Scriptify] Language hint set: ${currentLanguageHint}`);
}

// ─── 9. Script Routing ───────────────────────────────────────────────────────

/**
 * Scripts that actually have a romanization engine behind them.
 * Must be kept in sync with the switch in romanizeSegment() — anything absent
 * here is detected but passed through untouched (Cyrillic, Arabic, Thai).
 */
const ROMANIZABLE_SCRIPTS: ReadonlySet<ScriptType> = new Set([
  ScriptType.Devanagari,
  ScriptType.Tamil,
  ScriptType.Bengali,
  ScriptType.Telugu,
  ScriptType.Kannada,
  ScriptType.Gujarati,
  ScriptType.Malayalam,
  ScriptType.Gurmukhi,
  ScriptType.Odia,
  ScriptType.Japanese,
  ScriptType.Korean,
  ScriptType.CJK,
]);

/**
 * Does this text contain any script Scriptify can actually romanize?
 *
 * Distinct from hasNonLatinScript(): a Cyrillic or Arabic line IS non-Latin but
 * has no engine, so offering the toggle for it would be a no-op.
 */
export function hasRomanizableScript(text: string): boolean {
  const scripts = detectAllScripts(text);
  if (![...scripts].some((script) => ROMANIZABLE_SCRIPTS.has(script))) {
    return false;
  }

  // Block membership alone overstates capability for partial engines such as
  // the finite CJK map and decomposed/compatibility Hangul. The public answer
  // should reflect whether this exact text can actually change.
  const result = romanize(text);
  return result !== null && result !== text;
}

/**
 * CJK ideographs are shared: they are Chinese hanzi, Japanese kanji AND Korean
 * hanja. When a line also carries kana or Hangul, its ideographs belong to that
 * language, and sending them to the pinyin map would print Mandarin readings in
 * the middle of a Japanese line (心の中で → "Xīnnozhōngde"). detectScript()
 * already reconciles this for a whole string; per-character segmentation has to
 * apply the same rule explicitly.
 *
 * Returns the language that owns the line's ideographs, or null if plain CJK.
 */
function resolveCJKHost(scripts: Set<ScriptType>): ScriptType | null {
  if (!scripts.has(ScriptType.CJK)) return null;
  if (scripts.has(ScriptType.Japanese)) return ScriptType.Japanese;
  if (scripts.has(ScriptType.Korean)) return ScriptType.Korean;
  return null;
}

/**
 * Dispatch a single same-script text segment to the correct romanizer.
 * Does not handle mixed-script input — callers must split first.
 * Returns null for unsupported or unknown scripts.
 */
function romanizeSegment(text: string, script: ScriptType): string | null {
  switch (script) {
    case ScriptType.Devanagari:
    case ScriptType.Tamil:
    case ScriptType.Bengali:
    case ScriptType.Telugu:
    case ScriptType.Kannada:
    case ScriptType.Gujarati:
    case ScriptType.Malayalam:
    case ScriptType.Gurmukhi:
    case ScriptType.Odia:
      return romanizeIndic(text, script, currentLanguageHint);

    case ScriptType.Japanese:
      return romanizeJapanese(text);

    case ScriptType.Korean:
      return romanizeKorean(text);

    case ScriptType.CJK:
      return romanizeChinese(text);

    default:
      return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Initialize bundled romanization dependencies. */
export async function initRomanizer(): Promise<void> {
  initIndicRomanizer();
}

/**
 * Romanize a single line of text.
 *
 * Handles mixed-script lines (e.g. Hindi+English, Hindi+Punjabi) by splitting
 * into same-script segments and romanizing each non-Latin one independently.
 * Returns null if the text has no non-Latin content (nothing to do).
 */
export function romanize(text: string): string | null {
  if (!text || text.trim().length === 0) return null;

  // Fast path: purely Latin text needs no romanization
  if (!hasNonLatinScript(text)) return null;

  const allScripts = detectAllScripts(text);

  // Kanji/hanja belong to the kana or Hangul they sit next to, not to Chinese.
  const cjkHost = resolveCJKHost(allScripts);
  if (cjkHost) {
    allScripts.delete(ScriptType.CJK);
    allScripts.add(cjkHost);
  }

  const nonLatinScripts = new Set(
    [...allScripts].filter((s) => s !== ScriptType.Latin),
  );

  // If the entire line is a single non-Latin script with no Latin mixed in,
  // send the whole line to that script's romanizer — it handles everything natively.
  if (nonLatinScripts.size === 1 && !allScripts.has(ScriptType.Latin)) {
    const [singleScript] = nonLatinScripts;
    const r = romanizeSegment(text, singleScript);
    if (!r) return null;
    return r
      .trim()
      .replace(/^[a-z]/, (c) => c.toUpperCase())
      .replace(/([.!?]\s+)([a-z])/g, (_, punc, ch) => punc + ch.toUpperCase());
  }

  // Mixed-script line: segment the text into consecutive runs of the same
  // script and romanize each non-Latin segment independently.
  // This correctly handles:
  //   • Latin + Devanagari (e.g. "let's start वे")
  //   • Devanagari + Gurmukhi (e.g. "इतनी सी ये बात ਵੇ")
  //   • Latin + Devanagari + Gurmukhi (e.g. "aaja, let's go ਵੇ")
  //   • Any other combination
  const parts: string[] = [];
  let current = "";
  let currentSegScript: ScriptType = ScriptType.Unknown;

  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    // Neutral chars (ASCII whitespace and punctuation) attach to current run
    if (
      code <= 0x7f &&
      (code <= 0x40 ||
        (code >= 0x5b && code <= 0x60) ||
        (code >= 0x7b && code <= 0x7f))
    ) {
      current += char;
      continue;
    }
    let charScript = detectScript(char);
    // Route this line's ideographs to the language that owns them (see above).
    if (cjkHost && charScript === ScriptType.CJK) charScript = cjkHost;
    if (charScript !== currentSegScript) {
      if (current.length > 0) {
        const isLatin =
          currentSegScript === ScriptType.Latin ||
          currentSegScript === ScriptType.Unknown;
        parts.push(
          isLatin ? current : `\x00${currentSegScript}\x01${current}\x00`,
        );
      }
      current = "";
      currentSegScript = charScript;
    }
    current += char;
  }
  if (current.length > 0) {
    const isLatin =
      currentSegScript === ScriptType.Latin ||
      currentSegScript === ScriptType.Unknown;
    parts.push(isLatin ? current : `\x00${currentSegScript}\x01${current}\x00`);
  }

  let anyRomanized = false;
  let result = parts
    .map((part) => {
      if (part.startsWith("\x00") && part.endsWith("\x00")) {
        const inner = part.slice(1, -1);
        const sep = inner.indexOf("\x01");
        const segScript = inner.slice(0, sep) as ScriptType;
        const raw = inner.slice(sep + 1);
        const romanized = romanizeSegment(raw, segScript);
        if (romanized && romanized !== raw) {
          anyRomanized = true;
          return romanized;
        }
        return raw;
      }
      return part;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  if (!anyRomanized) return null;

  // Sentence case: capitalize the first letter of the line and after
  // sentence-ending punctuation (. ! ?) within the line.
  result = result
    .replace(/^[a-z]/, (c) => c.toUpperCase())
    .replace(/([.!?]\s+)([a-z])/g, (_, punc, ch) => punc + ch.toUpperCase());
  return result;
}
