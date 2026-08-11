/** Punjabi Gurmukhi direct romanizer. */

// ─── 5e. Gurmukhi Direct Romanizer ───────────────────────────────────────────
//
// Bypasses Sanscript for Gurmukhi (Punjabi) text.
// Sanscript cannot handle Addak (ੱ), adds inherent 'a' to every consonant
// without Punjabi-style schwa deletion, and maps ੈ → "e" instead of "ai".
// This parser handles all three correctly.

const G_CONSONANTS: Record<string, string> = {
  "\u0A15": "k", // ਕ
  "\u0A16": "kh", // ਖ
  "\u0A17": "g", // ਗ
  "\u0A18": "gh", // ਘ
  "\u0A19": "ng", // ਙ
  "\u0A1A": "ch", // ਚ
  "\u0A1B": "chh", // ਛ
  "\u0A1C": "j", // ਜ
  "\u0A1D": "jh", // ਝ
  "\u0A1E": "n", // ਞ
  "\u0A1F": "t", // ਟ
  "\u0A20": "th", // ਠ
  "\u0A21": "d", // ਡ
  "\u0A22": "dh", // ਢ
  "\u0A23": "n", // ਣ
  "\u0A24": "t", // ਤ
  "\u0A25": "th", // ਥ
  "\u0A26": "d", // ਦ
  "\u0A27": "dh", // ਧ
  "\u0A28": "n", // ਨ
  "\u0A2A": "p", // ਪ
  "\u0A2B": "ph", // ਫ
  "\u0A2C": "b", // ਬ
  "\u0A2D": "bh", // ਭ
  "\u0A2E": "m", // ਮ
  "\u0A2F": "y", // ਯ
  "\u0A30": "r", // ਰ
  "\u0A32": "l", // ਲ
  "\u0A33": "l", // ਲ਼
  "\u0A35": "v", // ਵ
  "\u0A38": "s", // ਸ
  "\u0A39": "h", // ਹ
  "\u0A59": "kh", // ਖ਼
  "\u0A5A": "g", // ਗ਼
  "\u0A5B": "z", // ਜ਼
  "\u0A5C": "r", // ੜ (retroflex flap R)
  "\u0A5E": "f", // ਫ਼
};

// Overrides when a consonant is followed by nukta (਼)
const G_NUKTA_OVERRIDE: Record<string, string> = {
  "\u0A38": "sh", // ਸ + ਼ = ਸ਼
  "\u0A2B": "f", // ਫ + ਼ = ਫ਼
  "\u0A1C": "z", // ਜ + ਼ = ਜ਼
};

const G_INDEP_VOWELS: Record<string, string> = {
  "\u0A05": "a", // ਅ
  "\u0A06": "aa", // ਆ
  "\u0A07": "i", // ਇ
  "\u0A08": "ee", // ਈ
  "\u0A09": "u", // ਉ
  "\u0A0A": "oo", // ਊ
  "\u0A0F": "e", // ਏ
  "\u0A10": "ai", // ਐ
  "\u0A13": "o", // ਓ
  "\u0A14": "au", // ਔ
};

const G_VOWEL_SIGNS: Record<string, string> = {
  "\u0A3E": "aa", // ਾ
  "\u0A3F": "i", // ਿ
  "\u0A40": "ee", // ੀ
  "\u0A41": "u", // ੁ
  "\u0A42": "oo", // ੂ
  "\u0A47": "e", // ੇ
  "\u0A48": "ai", // ੈ
  "\u0A4B": "o", // ੋ
  "\u0A4C": "au", // ੌ
};

const G_VIRAMA = "\u0A4D"; // ੍ halant
const G_ADDAK = "\u0A71"; // ੱ gemination marker
const G_TIPPI = "\u0A70"; // ੰ nasalization (word-final n)
const G_BINDI = "\u0A02"; // ਂ nasalization
const G_NUKTA = "\u0A3C"; // ਼ modifier dot

/**
 * When Addak (ੱ) doubles a consonant, the pre-output is the unaspirated
 * base of the consonant, not the full romanization. This ensures:
 *   ੱਛ → "ch" + "chh" = "chchh" (not "chh" + "chh" = "chhchh")
 *   ੱਬ → "b" + "b" = "bb" ✓
 */
const G_ADDAK_PREFIX: Record<string, string> = {
  k: "k",
  kh: "k",
  g: "g",
  gh: "g",
  ch: "ch",
  chh: "ch",
  j: "j",
  jh: "j",
  t: "t",
  th: "t",
  d: "d",
  dh: "d",
  n: "n",
  ng: "n",
  p: "p",
  ph: "p",
  b: "b",
  bh: "b",
  m: "m",
  y: "y",
  r: "r",
  l: "l",
  v: "v",
  s: "s",
  sh: "sh",
  h: "h",
  z: "z",
  f: "f",
};

/**
 * Determine whether a consonant should receive an inherent 'a' vowel.
 *
 * Punjabi schwa deletion rule (simplified):
 *  - Word-final consonant (followed by space/punct/end/non-Gurmukhi) → no 'a'
 *  - Before virama → no 'a'
 *  - Before independent vowel → no 'a' (the vowel replaces the inherent one)
 *  - Everything else (followed by consonant, tippi, bindi, addak, etc.) → keep 'a'
 *
 * This is much simpler than Hindi schwa deletion. In Gurmukhi, consonant
 * clusters without virama are rare; each consonant typically forms its own
 * syllable with an inherent 'a'.
 */
function needsInherentA(chars: string[], after: number): boolean {
  const n = chars.length;
  if (after >= n) return false; // word-final: no 'a'
  const c = chars[after];
  if (c === G_VIRAMA) return false;
  if (G_INDEP_VOWELS[c] !== undefined) return false; // independent vowel replaces inherent 'a'
  // If the next char is outside Gurmukhi Unicode range (space, punctuation,
  // Latin, etc.), treat the consonant as word-final → no 'a'
  const code = c.codePointAt(0) || 0;
  if (code < 0x0a00 || code > 0x0a7f) return false;
  // Medial schwa deletion: suppress inherent 'a' when the following consonant
  // itself carries an explicit vowel sign — e.g. ਕਦੀ → 'k'+'dee' (no 'a' between k and d).
  if (G_CONSONANTS[c] !== undefined) {
    let peek = after + 1;
    if (peek < n && chars[peek] === G_NUKTA) peek++; // skip nukta on next consonant
    if (peek < n && G_VOWEL_SIGNS[chars[peek]] !== undefined) return false;
  }
  // Otherwise (tippi, bindi, addak, another consonant without explicit vowel) → keep 'a'
  return true;
}

export function romanizeGurmukhiDirect(text: string): string {
  const chars = [...text];
  const n = chars.length;
  let out = "";
  let i = 0;

  while (i < n) {
    const ch = chars[i];

    // Addak: pre-output gemination prefix of the next consonant
    // For aspirated consonants (kh, chh, etc.) we output only the unaspirated
    // base, e.g. ੱਛ → "ch" + (next iter) "chh" = "chchh", not "chhchh".
    if (ch === G_ADDAK) {
      if (i + 1 < n) {
        let nextRoman = G_CONSONANTS[chars[i + 1]];
        // Check if the consonant after addak has a nukta override
        if (nextRoman && i + 2 < n && chars[i + 2] === G_NUKTA) {
          const over = G_NUKTA_OVERRIDE[chars[i + 1]];
          if (over) nextRoman = over;
        }
        if (nextRoman) {
          out += G_ADDAK_PREFIX[nextRoman] ?? nextRoman;
        }
      }
      i++;
      continue;
    }

    // Tippi / Bindi: nasalization → "n"
    if (ch === G_TIPPI || ch === G_BINDI) {
      out += "n";
      i++;
      continue;
    }

    // Virama: skip (lack of inherent vowel handled in consonant branch)
    if (ch === G_VIRAMA) {
      i++;
      continue;
    }

    // Lone nukta: skip
    if (ch === G_NUKTA) {
      i++;
      continue;
    }

    // Independent vowel
    const indep = G_INDEP_VOWELS[ch];
    if (indep !== undefined) {
      out += indep;
      i++;
      continue;
    }

    // Orphaned vowel sign (shouldn't happen in well-formed text, but handle gracefully)
    const orphanVS = G_VOWEL_SIGNS[ch];
    if (orphanVS !== undefined) {
      out += orphanVS;
      i++;
      continue;
    }

    // Consonant
    const con = G_CONSONANTS[ch];
    if (con !== undefined) {
      out += con;
      i++;

      // Nukta modifier: may override romanization (e.g. ਸ + ਼ = "sh")
      if (i < n && chars[i] === G_NUKTA) {
        const over = G_NUKTA_OVERRIDE[ch];
        if (over) out = out.slice(0, out.length - con.length) + over;
        i++;
      }

      // Virama: suppress inherent 'a'; next consonant handled in next iteration
      if (i < n && chars[i] === G_VIRAMA) {
        i++;
        continue;
      }

      // Vowel sign
      if (i < n && G_VOWEL_SIGNS[chars[i]] !== undefined) {
        const vs = G_VOWEL_SIGNS[chars[i]];
        out += vs;
        i++;
        // Tippi / Bindi after vowel sign
        if (i < n && (chars[i] === G_TIPPI || chars[i] === G_BINDI)) {
          out += "n";
          i++;
        }
        // Y-glide: ਿ + ਆ → "iya", ੀ + ਆ → "eya" (common Punjabi pattern)
        // When a vowel sign (especially i/ee) is followed by an independent
        // vowel, a glide consonant is inserted in natural pronunciation.
        if (i < n && G_INDEP_VOWELS[chars[i]] !== undefined) {
          if (vs === "i" || vs === "ee") {
            const nextV = G_INDEP_VOWELS[chars[i]];
            // Reduce "aa" → "a" in the glide context (ਿਆ = "iya" not "iyaa")
            out += "y" + (nextV === "aa" ? "a" : nextV);
            i++;
            // Tippi / Bindi after the independent vowel (e.g. ਿਆਂ → "iyan")
            if (i < n && (chars[i] === G_TIPPI || chars[i] === G_BINDI)) {
              out += "n";
              i++;
            }
          }
        }
        continue;
      }

      // No explicit vowel: apply Punjabi schwa deletion
      if (needsInherentA(chars, i)) {
        out += "a";
        if (i < n && (chars[i] === G_TIPPI || chars[i] === G_BINDI)) {
          out += "n";
          i++;
        }
      }
      continue;
    }

    // Gurmukhi digits ੦–੯
    const code = ch.codePointAt(0)!;
    if (code >= 0x0a66 && code <= 0x0a6f) {
      out += (code - 0x0a66).toString();
      i++;
      continue;
    }

    // Ik Onkar ੴ
    if (ch === "\u0A74") {
      out += "Ik Onkar";
      i++;
      continue;
    }

    // Pass through (Latin, spaces, punctuation)
    out += ch;
    i++;
  }

  // Punjabi colloquial: word-final long vowels shorten.
  // oon (ੂ + Tippi at word-end) → "u":  ਨੂੰ "noon" → "nu", ਤੈਨੂੰ "tainoon" → "tainu"
  out = out.replace(/oon(?!\p{L})/gu, "u");
  // Long ī word-final → short "i":  ਭਟਕਦੀ "bhatakdee" → "bhatakdi"
  out = out.replace(/ee(?!\p{L})/gu, "i");

  return out;
}
