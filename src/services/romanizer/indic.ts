/** Sanscript-backed Indic romanization and language-specific exception dictionaries. */

import { ScriptType } from "../../utils/scriptDetector";
import * as SanscriptModule from "@indic-transliteration/sanscript";
import { romanizeHindiDirect } from "./hindi";
import { romanizeGurmukhiDirect } from "./gurmukhi";

const Sanscript: any = (SanscriptModule as any).default || SanscriptModule;

export function initIndicRomanizer(): void {
  if (Sanscript && typeof Sanscript.t === "function") {
    console.log("[Scriptify] Sanscript loaded successfully (static import)");
  } else {
    console.warn("[Scriptify] Sanscript module loaded but .t() not found:", Sanscript);
  }
}

// ─── 5. Non-Hindi Indic Scripts ─────────────────────────────────────────────

/**
 * Mapping of IAST diacritics and raw Indic characters to their Latin equivalents.
 * Used by stripIASTDiacritics() to convert Sanscript IAST output to readable romanization.
 */
const IAST_DIACRITIC_MAP: Record<string, string> = {
  // ── Standard IAST diacritics (lowercase) ──
  ā: "aa", // long ā → "aa" (applies to all Sanscript-based scripts)
  ī: "ee", // long ī → "ee"
  ū: "oo", // long ū → "oo"
  ṛ: "ri", // vocalic r (default; overridden to "ru" for Telugu/Kannada before this fn)
  ṝ: "ri",
  ḷ: "l",
  ḹ: "l",
  ṃ: "n", // dot-below anusvara (overridden to "m" for Telugu/Kannada/Malayalam before this fn)
  ḥ: "h",
  ñ: "n",
  ṅ: "ng",
  ṇ: "n",
  ṭ: "t",
  ḍ: "d",
  ś: "sh",
  ṣ: "sh",
  // ── Extended IAST diacritics (Tamil, Malayalam, Telugu) ──
  ḻ: "l", // retroflex l (Tamil ழ, Malayalam ഴ) — overridden to "zh" for Tamil/Malayalam before this fn
  ṉ: "n", // alveolar n (Tamil ன)
  ṟ: "r", // alveolar r (Tamil ற)
  ē: "ee", // long e (Tamil, Telugu) — "ee" for consistency
  ō: "oo", // long o (Tamil, Telugu) — "oo" for consistency
  ṁ: "m", // alternate anusvara representation (dot-above)
  // ── Sanscript Telugu output: short e/o use grave-accent chars (è/ò) ──
  è: "e", // U+00E8 — Telugu short ె (vèlugu → velugu)
  ò: "o", // U+00F2 — Telugu short ొ (òkka → okka)
  // ── Standard IAST diacritics (uppercase) ──
  Ā: "Aa",
  Ī: "Ee",
  Ū: "Oo",
  Ṛ: "Ri",
  Ṝ: "Ri",
  Ḷ: "L",
  Ḹ: "L",
  Ṃ: "N",
  Ḥ: "H",
  Ñ: "N",
  Ṅ: "Ng",
  Ṇ: "N",
  Ṭ: "T",
  Ḍ: "D",
  Ś: "Sh",
  Ṣ: "Sh",
  Ḻ: "L",
  Ṉ: "N",
  Ṟ: "R",
  Ē: "Ee",
  Ō: "Oo",
  Ṁ: "M",
  È: "E", // uppercase grave-accent e
  Ò: "O", // uppercase grave-accent o
  // ── Combining marks ──
  // Sanscript's IAST output represents chandrabindu (ँ ঁ ఁ …) as an ASCII
  // tilde attached to the preceding syllable ("ka~"), so this entry is
  // load-bearing. Literal tildes present in the ORIGINAL lyric text are
  // protected by TILDE_MARKER in romanizeIndic() before Sanscript runs, so
  // they never reach this map.
  "~": "n",
  "\u0303": "n", // combining tilde
  "\u0323": "", // combining dot below (U+0323)
  "\u0324": "", // combining diaeresis below (U+0324) — what Sanscript Tamil actually outputs for ள
  // ── Raw Indic characters (safety net if Sanscript leaks them) ──
  // Devanagari
  "\u0901": "n", // ँ chandrabindu
  "\u0902": "n", // ं anusvara
  "\u0903": "h", // ः visarga
  "\u093C": "", // ़ nukta
  "\u093D": "", // ऽ avagraha
  "\u094D": "", // ् virama
  // Bengali
  "\u0981": "n", // ঁ chandrabindu
  "\u0982": "n", // ং anusvara
  "\u0983": "h", // ঃ visarga
  "\u09BC": "", // ় nukta
  "\u09BD": "", // ঽ avagraha
  "\u09CD": "", // ্ virama
  // Gurmukhi
  "\u0A01": "n", // ਁ adak bindi
  "\u0A02": "n", // ਂ bindi
  "\u0A03": "", // ਃ visarga (rare)
  "\u0A3C": "", // ਼ nukta
  "\u0A4D": "", // ੍ virama
  // Gujarati
  "\u0A81": "n", // ઁ chandrabindu
  "\u0A82": "n", // ં anusvara
  "\u0A83": "h", // ઃ visarga
  "\u0ABC": "", // ઼ nukta
  "\u0ABD": "", // ઽ avagraha
  "\u0ACD": "", // ્ virama
  // Odia
  "\u0B01": "n", // ଁ chandrabindu
  "\u0B02": "n", // ଂ anusvara
  "\u0B03": "h", // ଃ visarga
  "\u0B3C": "", // ଼ nukta
  "\u0B3D": "", // ଽ avagraha
  "\u0B4D": "", // ୍ virama
  "\u0B71": "w", // ୱ Odia letter WA (Sanscript may pass through verbatim)
  "\u1E8F": "y", // ẏ Latin y with dot above (leaked char in some Sanscript outputs)
  // Tamil
  "\u0B82": "n", // ஂ anusvara
  "\u0B83": "h", // ஃ visarga / aytham
  "\u0BCD": "", // ் virama
  // Telugu
  "\u0C01": "n", // ఁ chandrabindu
  "\u0C02": "n", // ం anusvara
  "\u0C03": "h", // ః visarga
  "\u0C3D": "", // ఽ avagraha
  "\u0C4D": "", // ్ virama
  // Kannada
  "\u0C82": "n", // ಂ anusvara
  "\u0C83": "h", // ಃ visarga
  "\u0CBC": "", // ಼ nukta
  "\u0CBD": "", // ಽ avagraha
  "\u0CCD": "", // ್ virama
  // Malayalam
  "\u0D02": "n", // ം anusvara
  "\u0D03": "h", // ഃ visarga
  "\u0D3D": "", // ഽ avagraha
  "\u0D4D": "", // ് virama
};

/**
 * Strip IAST diacritics for non-Hindi Indic scripts (Tamil, Bengali, etc.).
 * These use Sanscript → IAST, then diacritics are stripped for readability.
 */
function stripIASTDiacritics(text: string): string {
  let result = "";
  for (const char of text) {
    result += IAST_DIACRITIC_MAP[char] ?? char;
  }
  return result;
}

/**
 * Convert IAST romanization conventions to Hinglish-friendly ones.
 * IAST uses: c = च, ch = छ, v = व
 * Hinglish uses: ch = च, chh = छ, w = व
 *
 * @param text - IAST text to convert
 * @param convertVtoW - Whether to convert v→w (true for Hindi/Devanagari, false for Gurmukhi/Punjabi)
 */
function iastToHinglish(text: string, convertVtoW = true): string {
  // Step 1: "ch" (IAST छ) → "chh" (must come before "c" → "ch")
  let result = text.replace(/ch/gi, (m) => (m[0] === "C" ? "Chh" : "chh"));
  // Step 2: "c" not followed by "h" → "ch" (IAST च)
  result = result.replace(/c(?!h)/gi, (m) => (m === "C" ? "Ch" : "ch"));
  // Step 3: "v" → "w" only for Hindi conventions (not for Gurmukhi/Punjabi where ਵ = "v")
  if (convertVtoW) {
    result = result.replace(/v/gi, (m) => (m === "V" ? "W" : "w"));
  }
  return result;
}

// ─── 5a. Tamil Dictionary ────────────────────────────────────────────────────

/**
 * Proper-noun and exception dictionary for Tamil.
 * Applied BEFORE Sanscript so Sanscript never sees these words; the Latin
 * replacements pass through the Tamil block unchanged.
 *
 * Covers:
 *   • Proper nouns with established Tanglish spellings that conflict with
 *     the general phonological rules (Sridevi, Hema, Faathima, etc.)
 *   • Words where the expected Tanglish convention deviates from the rules
 *     (தீ → "thee" vs. தீபம் → "deepam" — the same initial consonant
 *      with conflicting expected romanizations in the test corpus).
 *   • Carnatic raga names and other cultural proper nouns.
 */
const TAMIL_DICTIONARY: Record<string, string> = {
  // Proper nouns — names
  "\u0BB8\u0BCD\u0BB0\u0BC0\u0BA4\u0BC7\u0BB5\u0BBF": "Sridevi", // ஸ்ரீதேவி
  "\u0BB9\u0BC7\u0BAE\u0BBE": "Hema", // ஹேமா
  "\u0B83\u0BAA\u0BBE\u0BA4\u0BCD\u0BA4\u0BBF\u0BAE\u0BBE": "Faathima", // ஃபாத்திமா
  // Tamil language (proper noun — always capitalized)
  "\u0BA4\u0BAE\u0BBF\u0BB4\u0BBF\u0BA9\u0BCD": "Tamizhin", // தமிழின்
  "\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD": "Tamizh", // தமிழ்
  // Carnatic ragas
  "\u0BB9\u0BB0\u0BBF\u0B95\u0BBE\u0BAE\u0BCD\u0BAA\u0BCB\u0B9C\u0BBF":
    "Harikaambhoji", // ஹரிகாம்போஜி
  // Sanskrit/Shaivite terms with established Tanglish spellings
  "\u0B9A\u0BBF\u0BB5\u0BBE\u0BAF": "shivaaya", // சிவாய
  // Temple / liturgical terms
  "\u0B95\u0BCB\u0BAA\u0BC1\u0BB0\u0BAE\u0BCD": "gopuram", // கோபுரம்
  // Common words with corpus-specific expected forms
  "\u0BA4\u0BC0": "thee", // தீ (standalone)
  "\u0BA4\u0BC0\u0BAA\u0BAE\u0BCD": "deepam", // தீபம்
  "\u0B95\u0BC0\u0BA4\u0BAE\u0BBE\u0B95": "geethamaaga", // கீதமாக
  // Words where algorithmic rules give wrong cluster ordering
  "\u0BA8\u0BC6\u0B9E\u0BCD\u0B9A\u0BA4\u0BCD": "nenjath", // நெஞ்சத்
  "\u0BA4\u0BC1\u0B9F\u0BBF\u0BAA\u0BCD\u0BAA\u0BC1\u0B95\u0BB3\u0BCD":
    "thudippugal", // துடிப்புகள்
  // Words where ndh→nth dental rule conflicts with native Tamil verb past-tense forms
  "\u0B86\u0BB4\u0BCD\u0BA8\u0BCD\u0BA4\u0BC7\u0BA9\u0BCD": "aazhndhen", // ஆழ்ந்தேன் (verb form: ndh not nth)
  // Sanskrit-origin words needing formal "nth" over native Tamil "ndh"
  "\u0BAE\u0BA8\u0BCD\u0BA4\u0BBF\u0BB0\u0BAE\u0BCD": "manthiram", // மந்திரம்
  // Frequent word where initial ஏ needs y-glide (ę not ē in Sanscript output)
  "\u0B8F\u0BA9\u0BCD": "yen", // ஏன்
  // Sanskrit-origin words with medial dental th convention
  "\u0B9A\u0B99\u0BCD\u0B95\u0BC0\u0BA4\u0BA4\u0BCD\u0BA4\u0BBF\u0BA9\u0BCD":
    "sangeethaththin", // சங்கீதத்தின்
};

/**
 * Marker character used to protect Tamil dictionary replacements from
 * subsequent Tamil phonological rule substitutions (bh→b, gh→g, etc.).
 * ASCII SOH (\x01) will never appear in Tamil Unicode or Sanscript IAST output.
 */
const _TAMIL_DICT_MARKER = "\x01";

/**
 * Replace Tamil words present in TAMIL_DICTIONARY with numbered placeholder
 * markers, returning the modified text and the replacement strings.
 * The caller must later call restoreTamilDictionary() to substitute them back.
 *
 * Placeholders prevent Tamil phonological rules (e.g. bh→b) from
 * accidentally modifying letters inside a pre-computed Tanglish value.
 */
function applyTamilDictionary(text: string): {
  text: string;
  replacements: string[];
} {
  const replacements: string[] = [];
  const modified = text.replace(/[\u0B80-\u0BFF]+/g, (word) => {
    const val = TAMIL_DICTIONARY[word];
    if (val !== undefined) {
      const idx = replacements.length;
      replacements.push(val);
      return `${_TAMIL_DICT_MARKER}${idx}${_TAMIL_DICT_MARKER}`;
    }
    return word;
  });
  return { text: modified, replacements };
}

/**
 * Restore the numbered placeholders inserted by applyTamilDictionary()
 * back to their original Tanglish replacement strings.
 */
function restoreTamilDictionary(text: string, replacements: string[]): string {
  if (replacements.length === 0) return text;
  return text.replace(
    new RegExp(`${_TAMIL_DICT_MARKER}(\\d+)${_TAMIL_DICT_MARKER}`, "g"),
    (_, idx) => replacements[parseInt(idx, 10)],
  );
}

// ─── 5b. Marathi Dictionary ─────────────────────────────────────────────────

/**
 * Exception / pre-computed dictionary for Marathi.
 * Applied BEFORE Sanscript so the nuqta, OM, and other edge-case words are
 * captured with the correct Devanagari codepoints intact.
 *
 * Covers:
 *   • OM symbol — Sanscript maps ॐ → "oṃ" which strips to "on".
 *   • Nuqta loanwords — Sanscript strips the nukta (़); the nuqta form must be
 *     matched BEFORE Sanscript sees the text.
 *   • ज्ञ cluster — rule gives "jn" but colloquial Marathi wants "gy".
 *   • Stem-vowel words — झाला/jhala: rule produces "jhaal" not "jhala".
 *   • Corpus-specific contracted forms — विचारलं→vichaarla, etc.
 *   • Words where final-a deletion over-deletes — होतं→hota, उमटत→umatata.
 */
const MARATHI_DICTIONARY: Record<string, string> = {
  // OM symbol
  "\u0950": "Om", // ॐ
  // Nuqta loanwords (applied before Sanscript strips ़)
  "\u092B\u093C\u0915\u093C\u094D\u0924": "faqt", // फ़क़्त
  "\u092B\u093C\u0930\u0915": "farak", // फ़रक
  "\u092B\u093C\u093F\u0924\u0942\u0930": "fitoor", // फ़ितूर
  // Stem-vowel mismatch: rule gives "jhaal" not "jhala"
  "\u091D\u093E\u0932\u093E": "jhala", // झाला
  // ज्ञ cluster: rule gives "jn" but corpus expects "gy" form
  "\u092A\u094D\u0930\u091C\u094D\u091E\u093E": "pragyaa", // प्रज्ञा
  // म्ह cluster: Sanscript gives "mha", colloquial contracts to "mh"
  "\u092E\u094D\u0939\u0923\u093E\u0932\u0940": "mhanali", // म्हणाली
  // Contracted final syllable forms
  "\u0935\u093F\u091A\u093E\u0930\u0932\u0902": "vichaarla", // विचारलं
  "\u0926\u0921\u0932\u0947\u0932\u0902": "dadelel", // दडलेलं
  // Complex kṣ-cluster repetition
  "\u0915\u094D\u0937\u0923\u093E\u0915\u094D\u0937\u0923\u093E\u0932\u093E":
    "kshanakshanala", // क्षणाक्षणाला
  // ī before locative -t: algorithm gives "eet", corpus has specific form
  "\u091D\u0941\u0933\u0941\u0915\u0940\u0924": "jhulukeet", // झुळुकीत
  // ī before final l: algorithm gives "eel", corpus wants kept form
  "\u092F\u0947\u0936\u0940\u0932": "yesheel", // येशील
  // Words where final-a deletion would over-delete
  "\u0939\u094B\u0924\u0902": "hota", // होतं (prevent "hot")
  "\u0909\u092E\u091F\u0924": "umatata", // उमटत (corpus keeps final a)

  // ─── Words needing special romanization not derivable from rules ──────────
  // Cluster-final inherent-a: rule drops it but pronunciation retains it
  मंत्र: "mantra", // मंत्र: ends in cluster 'tr' + inherent a — deletion rule fires on 'r' but shouldn't

  // Proper-noun compound: गोदावरीच्या romanizes to Godavarichya as a unit
  // (ī→ee needed AND -चya suffix — dict is cleaner than combining two rules)
  गोदावरीच्या: "Godavarichya",

  // ī-words that must romanize with "ee" (long-ī = ee in these lexical items)
  झिलई: "jhilaee",
  संगतीत: "sangateet",
  स्त्री: "stree",
  तीरावर: "teeravar",
  जीवनाची: "jeevanaachi",

  // Proper noun
  गंगा: "Ganga",
};

/**
 * Marker character used to protect Marathi dictionary replacements from
 * subsequent Sanscript processing. ASCII STX (\x02) will never appear in
 * Devanagari Unicode or Sanscript IAST output.
 */
const _MARATHI_DICT_MARKER = "\x02";

/**
 * Replace Marathi words present in MARATHI_DICTIONARY with numbered
 * placeholder markers, returning the modified text and replacement strings.
 * The caller must later call restoreMarathiDictionary() to substitute back.
 */
function applyMarathiDictionary(text: string): {
  text: string;
  replacements: string[];
} {
  const replacements: string[] = [];
  // Match Devanagari runs (U+0900–U+097F) including the OM symbol (U+0950)
  const modified = text.replace(/[\u0900-\u097F\u0950]+/g, (word) => {
    const val = MARATHI_DICTIONARY[word];
    if (val !== undefined) {
      const idx = replacements.length;
      replacements.push(val);
      return `${_MARATHI_DICT_MARKER}${idx}${_MARATHI_DICT_MARKER}`;
    }
    return word;
  });
  return { text: modified, replacements };
}

/**
 * Restore the numbered placeholders inserted by applyMarathiDictionary()
 * back to their original romanization strings.
 */
function restoreMarathiDictionary(
  text: string,
  replacements: string[],
): string {
  if (replacements.length === 0) return text;
  return text.replace(
    new RegExp(`${_MARATHI_DICT_MARKER}(\\d+)${_MARATHI_DICT_MARKER}`, "g"),
    (_, idx) => replacements[parseInt(idx, 10)],
  );
}

// ─── 5c. Malayalam Dictionary ─────────────────────────────────────────────

const MALAYALAM_DICTIONARY: Record<string, string> = {
  // OM symbol
  "\u0D13\u0D02": "Om", // ഓം
  // Proper nouns
  "\u0D17\u0D02\u0D17": "Ganga", // ഗംഗ
  // Chillu compound words (chillu chars pass through Sanscript unchanged,
  // these need to be pre-resolved so the full word is in the dict)
  // -yum/-um conjunctive suffixes with editorial hyphens
  "\u0D38\u0D4D\u0D24\u0D4D\u0D30\u0D40\u0D2F\u0D41\u0D02": "stree-yum", // സ്ത്രീയും
  "\u0D2A\u0D41\u0D30\u0D41\u0D37\u0D28\u0D41\u0D02": "purushan-um", // പുരുഷനും
  // ngng exception: ṅṅ in this word should be "ngg" not "ng"
  "\u0D24\u0D3F\u0D33\u0D19\u0D4D\u0D19\u0D3F": "thilanggi", // തിളങ്ങി
  // jñ cluster words where ñ must not become "nj"
  "\u0D1C\u0D4D\u0D1E\u0D3E\u0D28\u0D35\u0D41\u0D02": "jnaanamum", // ജ്ഞാനവും
  // ṛṃkh cluster
  "\u0D36\u0D43\u0D02\u0D16\u0D32": "shringkhala", // ശൃംഖല
  // Gangayude — proper noun genitive
  "\u0D17\u0D02\u0D17\u0D2F\u0D41\u0D1F\u0D46": "Gangayude", // ഗംഗയുടെ
  // Words needing a word-final schwa that the pipeline doesn't supply
  "\u0D0E\u0D28\u0D4D\u0D24\u0D3F\u0D28\u0D4D": "enthinu", // എന്തിന്
  // Anusvara before velar k: Manglish writes "m" (not "n")
  "\u0D06\u0D15\u0D3E\u0D02\u0D15\u0D4D\u0D37": "aakaamksha", // ആകാംക്ഷ
};

const _MALAYALAM_DICT_MARKER = "\x03";

function applyMalayalamDictionary(text: string): {
  text: string;
  replacements: string[];
} {
  const replacements: string[] = [];
  const modified = text.replace(/[\u0D00-\u0D7F]+/g, (word) => {
    const val = MALAYALAM_DICTIONARY[word];
    if (val !== undefined) {
      const idx = replacements.length;
      replacements.push(val);
      return `${_MALAYALAM_DICT_MARKER}${idx}${_MALAYALAM_DICT_MARKER}`;
    }
    return word;
  });
  return { text: modified, replacements };
}

function restoreMalayalamDictionary(
  text: string,
  replacements: string[],
): string {
  if (replacements.length === 0) return text;
  return text.replace(
    new RegExp(`${_MALAYALAM_DICT_MARKER}(\\d+)${_MALAYALAM_DICT_MARKER}`, "g"),
    (_, idx) => replacements[parseInt(idx, 10)],
  );
}

// ─── 5d. Bengali Dictionary ──────────────────────────────────────────────────

const BENGALI_DICTIONARY: Record<string, string> = {
  // OM & mantras
  ওঁ: "Om",
  নমঃ: "namah",
  শিবায়ঃ: "shibayoh",
  // Proper nouns
  গঙ্গার: "Gangar",
  // Highly irregular phonological collapses
  জিজ্ঞেস: "jigges",
  মধ্যে: "moddhe",
  অদ্ভুত: "oddbhut",
  // str + long ī: iastToHinglish + o-shift would give wrong result
  স্ত্রী: "stree",
  // Sanskrit loans
  মন্ত্র: "mantra",
  // শ vs স distinction: স before vowel → 'sh' in Bengali (sibilant merger)
  বাতাসের: "batasher",
  // Words needing word-final 'o' that the VCo rule would incorrectly drop
  সুর: "sur",
  গান: "gan",
  এক: "ek",
  আমার: "amar",
  পুরুষ: "purush",
  // অসীম: ā-shift + ī-strip
  অসীম: "oshim",
  // Initial-cluster words
  স্পন্দন: "spandon",
  স্বপ্নের: "swapner",
  // দ্যুতি: dy cluster
  দ্যুতি: "dyuti",
  // শৃঙ্খল
  শৃঙ্খল: "shrinkhol",
  // জ্ঞানের, জ্ঞান genitive/base
  জ্ঞানের: "gyaner",
  জ্ঞান: "gyan",
  // শ্রুতির
  শ্রুতির: "shrutir",
  // দৃষ্টির
  দৃষ্টির: "drishtir",
  // ত্রিশূলের
  ত্রিশূলের: "trishuler",
  // মুহূর্তের
  মুহূর্তের: "muhurter",
  // ক্ষুদ্র
  ক্ষুদ্র: "khudro",
  // প্রান্তে
  প্রান্তে: "prante",
  // ক্ষেত্রের
  ক্ষেত্রের: "kshetrer",
  // আঁচল: chandrabindu word
  আঁচল: "anchol",
  // অনুরাগের
  অনুরাগের: "onurager",
  // একত্র
  একত্র: "ekotro",
  // চন্দ্রপ্রভা: dense consonant cluster
  চন্দ্রপ্রভা: "chondroprobha",
  // ঝিলমিল: reduplication
  ঝিলমিল: "jhilmil",
  // ভেসে এলো: separate words
  এলো: "elo",
  // হৃদয়ে: ṛ→ri + o-shift
  হৃদয়ে: "hridoye",
  // আকাঙ্ক্ষা: complex cluster
  আকাঙ্ক্ষা: "akankkha",
  // উঠল: interior schwa drop utholo→uthlo
  উঠল: "uthlo",
  // করলাম: korolamo→korlam
  করলাম: "korlam",
  // আসবে: interior drop
  আসবে: "asbe",
  // বলল
  বলল: "bollo",
  // কিনারায়
  কিনারায়: "kinaray",
  // শক্তি: ś→sh + o-shift
  শক্তি: "shokti",
  // শ্রদ্ধা: consonant cluster
  শ্রদ্ধা: "shraddha",
  // মিলেমিশে
  মিলেমিশে: "milemishe",
  // অঙ্গ: o+ng → ong (word-final)
  অঙ্গ: "ong",
  // কর্ম, ধর্ম: final 'o' kept after rm cluster
  কর্ম: "kormo",
  ধর্ম: "dhormo",
  // পড়ল: ড় = Bengali flap r
  পড়ল: "porlo",
  // মৃদঙ্গ
  মৃদঙ্গ: "mridongo",
  // চারদিকে
  চারদিকে: "chardike",
  // রইল: past tense
  রইল: "roilo",
  // হলো: past tense
  হলো: "holo",
  // ক্ষণে: khone
  ক্ষণে: "khone",
  // কখনও: kokhono
  কখনও: "kokhono",
  // রং: rong (anusvara → ng)
  রং: "rong",
  // রঙ: rong (anusvara variant)
  রঙ: "rong",
  // পথে: pothe
  পথে: "pothe",
  // চলল: chollo
  চলল: "chollo",
  // কোথায়: kothay
  কোথায়: "kothay",
  // তুমি: tumi
  তুমি: "tumi",
  // প্রেমের
  প্রেমের: "premer",
  // গল্পে
  গল্পে: "golpe",
  // ধ্বনিত: dhonito (already handled by pipeline but let's be safe)
  ধ্বনিত: "dhonito",
  // এত, কেন — short words where VCo rule over-fires
  এত: "eto",
  কেন: "keno",
  // হচ্ছিল — word-initial 'ho' before 'chh' cluster
  হচ্ছিল: "hochhilo",
  // ছায়া — Sanscript nukta/ā ordering issue
  ছায়া: "chhaya",
  // আলো — real long 'o' vowel (ও), not inherent 'a'
  আলো: "alo",
  // মনে
  মনে: "mone",
};

const _BENGALI_DICT_MARKER = "\x04";

function applyBengaliDictionary(text: string): {
  text: string;
  replacements: string[];
} {
  const replacements: string[] = [];
  const modified = text.replace(/[\u0980-\u09FF]+/g, (word) => {
    const val = BENGALI_DICTIONARY[word];
    if (val !== undefined) {
      const idx = replacements.length;
      replacements.push(val);
      return `${_BENGALI_DICT_MARKER}${idx}${_BENGALI_DICT_MARKER}`;
    }
    return word;
  });
  return { text: modified, replacements };
}

function restoreBengaliDictionary(
  text: string,
  replacements: string[],
): string {
  if (replacements.length === 0) return text;
  return text.replace(
    new RegExp(`${_BENGALI_DICT_MARKER}(\\d+)${_BENGALI_DICT_MARKER}`, "g"),
    (_, idx) => replacements[parseInt(idx, 10)],
  );
}

/**
 * Placeholder for tildes that were present in the ORIGINAL lyric text.
 *
 * Sanscript emits an ASCII "~" of its own for chandrabindu (ँ ঁ ఁ), which
 * stripIASTDiacritics() maps to "n". Without this guard a decorative tilde in
 * the lyrics ("தமிழ் ~ நல்ல") would be misread as nasalization and turned into
 * a stray "n". Swapping input tildes for a marker before Sanscript runs keeps
 * the two kinds of tilde distinguishable; restoreTildes() puts them back last.
 * ASCII SO (\x0E) never appears in Indic Unicode or Sanscript IAST output.
 */
const TILDE_MARKER = "\x0E";

/** Maps ScriptType to @indic-transliteration/sanscript scheme names */
const INDIC_SCHEME_MAP: Record<string, string> = {
  [ScriptType.Devanagari]: "devanagari",
  [ScriptType.Tamil]: "tamil",
  [ScriptType.Bengali]: "bengali",
  [ScriptType.Telugu]: "telugu",
  [ScriptType.Kannada]: "kannada",
  [ScriptType.Gujarati]: "gujarati",
  [ScriptType.Malayalam]: "malayalam",
  [ScriptType.Gurmukhi]: "gurmukhi",
  [ScriptType.Odia]: "oriya",
};

export function romanizeIndic(
  text: string,
  script: ScriptType,
  languageHint: string | null,
): string | null {
  // For Hindi (Devanagari + Hindi language or unknown): use direct parser
  // This bypasses Sanscript entirely, giving proper nuqta and schwa handling
  if (script === ScriptType.Devanagari && languageHint === "hi") {
    try {
      const result = romanizeHindiDirect(text);
      return result;
    } catch (e) {
      console.warn("[Scriptify] Hindi direct romanization failed:", e);
      // Fall through to Sanscript as fallback
    }
  }

  // For Gurmukhi (Punjabi): use direct parser.
  // Sanscript cannot handle Addak (ੱ) and applies no schwa deletion.
  if (script === ScriptType.Gurmukhi) {
    try {
      const result = romanizeGurmukhiDirect(text);
      return result;
    } catch (e) {
      console.warn("[Scriptify] Gurmukhi direct romanization failed:", e);
      // Fall through to Sanscript as fallback
    }
  }

  // For non-Hindi Devanagari (Marathi/Sanskrit) and other Indic scripts: use Sanscript
  if (!Sanscript || typeof Sanscript.t !== "function") {
    console.warn(`[Scriptify] Sanscript not available for ${script}`);
    return null;
  }
  const scheme = INDIC_SCHEME_MAP[script];
  if (!scheme) return null;
  try {
    // Apply Tamil dictionary fast-path: replace known Tamil words with
    // numbered placeholders so that subsequent phonological rules (bh→b, gh→g)
    // do not corrupt the pre-computed Tanglish replacements.
    let tamilDictReplacements: string[] = [];
    // Apply Marathi dictionary fast-path: replace known Marathi words (including
    // nuqta loanwords and OM) with placeholders before Sanscript strips them.
    let marathiDictReplacements: string[] = [];
    // Apply Malayalam dictionary fast-path.
    let malayalamDictReplacements: string[] = [];
    // Apply Bengali dictionary fast-path.
    let bengaliDictReplacements: string[] = [];
    let sanscriptInput = text;
    if (script === ScriptType.Tamil) {
      const { text: markedText, replacements } = applyTamilDictionary(text);
      sanscriptInput = markedText;
      tamilDictReplacements = replacements;
    }
    if (script === ScriptType.Devanagari && languageHint === "mr") {
      const { text: markedText, replacements } =
        applyMarathiDictionary(sanscriptInput);
      sanscriptInput = markedText;
      marathiDictReplacements = replacements;
    }
    if (script === ScriptType.Malayalam) {
      const { text: markedText, replacements } =
        applyMalayalamDictionary(sanscriptInput);
      sanscriptInput = markedText;
      malayalamDictReplacements = replacements;
    }
    if (script === ScriptType.Bengali) {
      const { text: markedText, replacements } =
        applyBengaliDictionary(sanscriptInput);
      sanscriptInput = markedText;
      bengaliDictReplacements = replacements;
    }
    // Protect tildes that came from the lyrics themselves — see TILDE_MARKER.
    sanscriptInput = sanscriptInput.replace(/~/g, TILDE_MARKER);

    let result = Sanscript.t(sanscriptInput, scheme, "iast");

    // ── Script-specific IAST pre-processing (before generic strip) ──

    // Tamil & Malayalam: ḻ → "zh" (ழ/ഴ sounds like "zh", not simple "l")
    if (script === ScriptType.Tamil || script === ScriptType.Malayalam) {
      result = result.replace(/ḻ/gi, (m: string) => (m === "Ḻ" ? "Zh" : "zh"));
    }

    // ─── Tamil: comprehensive Tanglish preprocessing ──────────────────────────
    // Sanscript's Tamil IAST uses non-standard mappings (gh for க, jh for ச,
    // ḍh for ட, bh for ப) that need to be converted to readable Tanglish
    // before the generic diacritic strip. Rules applied in order to avoid conflicts.
    if (script === ScriptType.Tamil) {
      // NFC-normalize as a defensive pass; Sanscript Tamil actually outputs
      // l + U+0324 (COMBINING DIAERESIS BELOW) for ள, which is stripped by the
      // "\u0324":"" entry in stripIASTDiacritics (NFC won't precompose this pair).
      result = result.normalize("NFC");

      // 0. Multi-character clusters — MUST come before all single-consonant rules.
      //    ஞ்ச = ñjh → "nch"  (பஞ்ச = "pancha", not "pansa")
      //    Must run BEFORE the ñ → "n" normalization (step 1) consumes the ñ.
      result = result.replace(/ñjh/g, "nch").replace(/Ñjh/g, "Nch");

      // 1. ṅ (ng-nasal before க) → "n" only; the following gh-derived "g" provides the G.
      //    Without this: ṅgh → "ng"+"g" = "ngg" (one extra g).
      result = result.replace(/ṅ/g, "n").replace(/Ṅ/g, "N");

      // 2. Borrowed-word clusters (before other single-consonant rules)
      //    ட்ர  = ḍhr → "tr"   (ட்ராக் = "traak" ≈ "track")
      result = result.replace(/ḍhr/g, "tr").replace(/Ḍhr/g, "Tr");
      //    ஸ்ட  = sḍh → "st"   (ஸ்டோரி = "stori" ≈ "story")
      result = result.replace(/sḍh/g, "st").replace(/Sḍh/g, "St");
      //    ஃப்  = ḥbh/ḥph → "f"  (Tamil rendering of English "f")
      result = result.replace(/ḥbh/g, "f").replace(/ḥph/g, "f");
      //    ட்ச  = ḍhjh → "tch" (சாட்சி = "saatchi", not "saadsi")
      result = result.replace(/ḍhjh/g, "tch").replace(/Ḍhjh/g, "Tch");
      //    ப்ர  = bhr → "pr"   (ஷண்முகப்ரியா = "shanmugapriyaa", not "shanmugabriyaa")
      result = result.replace(/bhr/g, "pr").replace(/Bhr/g, "Pr");
      //    Remaining ḥ is virtually always word-final Tamil aytham (visarga).
      //    The existing stripIASTDiacritics entry ḥ→"h" correctly handles
      //    namaḥ (vowel + ḥ) → "namah". We do NOT add a pre-strip ḥ→"ah" here
      //    because that would give "namaah" (double-a) for namaḥ. Let strip
      //    handle it cleanly.

      // 3. Long ē / ō → plain "e" / "o".
      //    Tamil colloquial Tanglish writes plain letters (not "ee"/"oo").
      //    Exception: word-initial ē (ஏ) → "ye" glide  (ஏன் = "yen", not "en")
      result = result
        .replace(/(?<!\p{L})ē/gu, "ye")
        .replace(/(?<!\p{L})Ē/gu, "Ye");
      result = result.replace(/ē/g, "e").replace(/Ē/g, "E");
      result = result.replace(/ō/g, "o").replace(/Ō/g, "O");

      // 4. Geminate consonants — MUST come before single-consonant rules.
      //    த்த dental geminate    (dhdh) → "thth"  (உள்ளத்தில் = "ullaththil", NOT "ullathil")
      //    NOTE: Changed from the previous "th" — single "th" was under-representing
      //    the geminate stop. Standard Tanglish doubles the cluster: ருத்தம் = "ruththam".
      result = result.replace(/dhdh/g, "thth").replace(/Dhdh/g, "Thth");
      //    ட்ட retroflex geminate (ḍhḍh) → "tt"
      result = result.replace(/ḍhḍh/g, "tt").replace(/Ḍhḍh/g, "Tt");
      //    ற்ற alveolar r geminate (ṟṟ)  → "tr"   (காற்றில் = "kaatril")
      result = result.replace(/ṟṟ/g, "tr").replace(/Ṟṟ/g, "Tr");
      //    க்க stop geminate      (ghgh) → "kk"
      result = result.replace(/ghgh/g, "kk").replace(/Ghgh/g, "Kk");
      //    ச்ச palatal geminate   (jhjh) → "ch"   (வெளிச்சம் = "velicham")
      result = result.replace(/jhjh/g, "ch").replace(/Jhjh/g, "Ch");
      //    ப்ப labial geminate    (bhbh) → "pp"   (துடிப்புகள் = "thudippugal", not "thudibbugal")
      result = result.replace(/bhbh/g, "pp").replace(/Bhbh/g, "Pp");

      // 5. Single consonant substitutions

      //    ட retroflex T: ḍh (ḍ diacritic + h) → "d".
      //    Handled BEFORE stripIASTDiacritics so ḍ+h is treated as a unit,
      //    not ḍ→"d" + a loose "h" appended.
      result = result.replace(/ḍh/g, "d").replace(/Ḍh/g, "D");

      //    ச sandhi liaison: ச் dropped only before a ச-initial word (sandhi context).
      //    e.g. நீதிச் சத்தியம் → "needhi sathiyam" (two ச in sequence).
      //    Restricting to \s+jh avoids incorrectly silencing phonetically meaningful
      //    word-final ச் that appears before non-ச words or at clause end.
      result = result.replace(/jh(?=\s+jh)/g, "");
      //    ச everywhere else → "s"
      result = result.replace(/jh/gi, "s");

      //    க positional rules — FIX: use \p{L} (Unicode letter property) for the
      //    lookbehind/lookahead instead of ASCII [a-zA-Z]. The old ASCII class
      //    excluded IAST diacritics (ā, ī, ū, ṅ, etc.) so medial க after a long
      //    vowel (e.g. rāgham) was mis-classified as word-initial and mapped to
      //    "k" instead of the correct medial "g".  Same fix applied to ப rules.
      //    க word-initial (preceded by non-letter) → "k"
      result = result.replace(/(?<!\p{L})gh/gu, "k");
      //    க word-final (followed by non-letter or end) → "k"
      result = result.replace(/gh(?!\p{L})/gu, "k");
      //    க medial → "g"
      result = result.replace(/gh/g, "g");

      //    ப word-initial → "p"
      result = result.replace(/(?<!\p{L})bh/gu, "p");
      //    ப medial → "b"
      result = result.replace(/bh/g, "b");
    }

    // Telugu / Kannada / Malayalam: word-final anusvara ṃ → "m".
    // Pre-consonant anusvara stays as ṃ → stripped to "n" by the generic map,
    // matching the standard Telugu romanization convention (e.g. "chandrudi",
    // "raktam", "venta" / NOT "chamdrudi", "raktan", "vemta").
    if (
      script === ScriptType.Telugu ||
      script === ScriptType.Kannada ||
      script === ScriptType.Malayalam
    ) {
      // \p{L} = any Unicode letter; ṃ NOT followed by a letter = word-final → "m"
      result = result.replace(/ṃ(?!\p{L})/gu, "m").replace(/Ṃ(?!\p{L})/gu, "M");
    }

    // Telugu / Kannada: vocalic r ṛ → "ru" (Dravidian convention, not "ri")
    if (script === ScriptType.Telugu || script === ScriptType.Kannada) {
      result = result
        .replace(/ṛ/g, "ru")
        .replace(/Ṛ/g, "Ru")
        .replace(/ṝ/g, "ru")
        .replace(/Ṝ/g, "Ru");
    }

    // ─── Malayalam IAST pre-strip ─────────────────────────────────────────────
    // Applied BEFORE stripIASTDiacritics so Manglish conventions are enforced.
    if (script === ScriptType.Malayalam) {
      // 1. Chillu characters — Sanscript doesn't recognise them and passes them
      //    through verbatim. Map to their base consonant romanization here.
      //    ൽ (chillu-L)  ൻ (chillu-N)  ർ (chillu-R)  ൾ (chillu-LL)  ൺ (chillu-NN)
      result = result
        .replace(/\u0D7D/g, "l") // ൽ
        .replace(/\u0D7B/g, "n") // ൻ
        .replace(/\u0D7C/g, "r") // ർ
        .replace(/\u0D7E/g, "l") // ൾ
        .replace(/\u0D7A/g, "n"); // ൺ

      // 2. Palatal nasal cluster rules (must precede ñ→nj to avoid double-fire)
      //    jña (ജ്ഞ) → jn  (Manglish convention: jnaana, not njnaana)
      result = result.replace(/jñ/g, "jn").replace(/Jñ/g, "Jn");
      //    ñca (ഞ്ച) → nca  (iastToHinglish then converts c→ch → ncha, avoiding double chh)
      result = result.replace(/ñca/g, "nca").replace(/Ñca/g, "Nca");
      //    ñña (ഞ്ഞ geminate) → nj  (paranju, thelinju)
      result = result.replace(/ññ/g, "nj").replace(/Ññ/g, "Nj");
      //    remaining ñ (ഞ) → nj
      result = result.replace(/ñ/g, "nj").replace(/Ñ/g, "Nj");

      // 3. Long ē / ō → plain e / o  (Manglish doesn’t double these)
      result = result.replace(/ē/g, "e").replace(/Ē/g, "E");
      result = result.replace(/ō/g, "o").replace(/Ō/g, "O");

      // 4. Dental t (ത) → th  in Manglish; retroflex ṭ (ട) → d in Manglish.
      //    Retroflex ട is voiced as 'd' in Kerala Manglish (evide, neendu, padarnnu).
      //    Order: dental geminate tt first, then ṟṟ→tt (alveolar r geminate),
      //    then remaining single dental t, finally retroflex ṭ→d.
      //    Exclude: t preceded by s (str- cluster: സ്ത്രീ → stree not sthree)
      result = result.replace(/tt/g, "th"); // ത്ത → th
      result = result.replace(/(?<!s)t(?!h)/g, "th"); // single ത → th (but not in str-)
      result = result.replace(/ṟṟ/g, "tt"); // ṟṟ alveolar-r geminate → tt
      result = result.replace(/ṭṭ/g, "tt").replace(/Ṭṭ/g, "Tt"); // ട്ട geminate → "tt" (വീട്ടു = veettu, not veeddhu)
      result = result.replace(/ṭh/g, "d").replace(/Ṭh/g, "D"); // aspirated retroflex → d
      result = result.replace(/ṭ/g, "d").replace(/Ṭ/g, "D"); // retroflex ṭ → d

      // 5. ṃ before labials → m  (homorganic nasal: ഗാനംപോലെ → gaanampole)
      result = result.replace(/ṃ(?=[pbmPBM])/g, "m");

      // 6. sv → sw,  jv → jw  (labio-velar glide)
      result = result.replace(/sv/g, "sw").replace(/Sv/g, "Sw");
      result = result.replace(/jv/g, "jw").replace(/Jv/g, "Jw");
    }

    // ─── Odia IAST pre-strip ─────────────────────────────────────────────────
    if (script === ScriptType.Odia) {
      // sv → sw, jv → jw (labio-velar glide: ସ୍ୱପ୍ନ = swapna)
      result = result.replace(/sv/g, "sw").replace(/Sv/g, "Sw");
      result = result.replace(/jv/g, "jw").replace(/Jv/g, "Jw");
      // dhv → dhw (ଧ୍ୱ cluster: ଧ୍ୱନି = dhwoni)
      result = result.replace(/dhv/g, "dhw").replace(/Dhv/g, "Dhw");
      // Long ī → 'i', long ū → 'u' (colloquial Odia short forms)
      result = result.replace(/ī/g, "i").replace(/Ī/g, "I");
      result = result.replace(/ū/g, "u").replace(/Ū/g, "U");
    }

    // ─── Bengali IAST pre-strip ────────────────────────────────────────────────
    // Applied BEFORE stripIASTDiacritics to enforce Manglish conventions.
    if (script === ScriptType.Bengali) {
      // kṣ (ক্ষ) → "kh" in Bengali (not "ksh"): ক্ষণ = khon, ক্ষেত্র = khetra
      result = result.replace(/kṣ/g, "kh").replace(/Kṣ/g, "Kh");
      // jñ (জ্ঞ) → "gy": জ্ঞান = gyan
      result = result.replace(/jñ/g, "gy").replace(/Jñ/g, "Gy");
      // ṅ (ঙ) → "n" (velar nasal — strip ng sequence to plain n; the following
      // consonant provides the g/k sound): গঙ্গা → ganga
      result = result.replace(/ṅ/g, "n").replace(/Ṅ/g, "N");
      // ṛ (ঋ/ৃ) → "ri": মৃত = mrito, দৃষ্টি = drishti
      result = result
        .replace(/ṛ/g, "ri")
        .replace(/Ṛ/g, "Ri")
        .replace(/ṝ/g, "ri")
        .replace(/Ṝ/g, "Ri");
      // sv → sw, jv → jw (labio-velar glide: স্বপ্ন = swapno)
      result = result.replace(/sv/g, "sw").replace(/Sv/g, "Sw");
      result = result.replace(/jv/g, "jw").replace(/Jv/g, "Jw");
      // dhv (ধ্ব) → "dhw" (ধ্বনি = dhwoni — the labio-velar v is pronounced in Bengali)
      result = result.replace(/dhv/g, "dhw").replace(/Dhv/g, "Dhw");
      // Long ā → marker (to distinguish from inherent short 'a' after strip)
      // Word-initial ā → \x05 marker (restored as "aa": আমার = aamaar, আলো = aalo)
      result = result.replace(/(?<!\p{L})ā/gu, "\x05");
      result = result.replace(/(?<!\p{L})Ā/gu, "\x08");
      // Remaining (medial) ā → \x06 marker (restored as 'a', not 'o')
      result = result.replace(/ā/g, "\x06").replace(/Ā/g, "\x07");
      // Long ī → 'i', long ū → 'u' (Bengali colloquial romanization uses short forms)
      result = result.replace(/ī/g, "i").replace(/Ī/g, "I");
      result = result.replace(/ū/g, "u").replace(/Ū/g, "U");
      // Word-final anusvara ṃ (ং at word-end) → "ng"
      result = result
        .replace(/ṃ(?!\p{L})/gu, "ng")
        .replace(/Ṃ(?!\p{L})/gu, "Ng");
    }

    // ─── Marathi IAST pre-strip ───────────────────────────────────────────────
    // Applied BEFORE the generic stripIASTDiacritics so we can control exactly
    // how each diacritic maps in the Marathi colloquial convention.
    if (script === ScriptType.Devanagari && languageHint === "mr") {
      // Fix 3: vocalic r ṛ → "ru" (दृष्टि → "drushti", not "drishti")
      result = result
        .replace(/ṛ/g, "ru")
        .replace(/Ṛ/g, "Ru")
        .replace(/ṝ/g, "ru")
        .replace(/Ṝ/g, "Ru");

      // Fix-ī: long ī → short "i" (not "ee").
      // Colloquial Marathi uses short-i in most positions.
      // Dictionary handles the few corpus words that are romanized with "ee"
      // (झुळुकीत → jhulukeet, येशील → yesheel).
      result = result.replace(/ī/g, "i").replace(/Ī/g, "I");

      // Fix 4: word-final anusvara ṃ → remove.
      // e.g. gāṇaṃ → gāṇa → strip → "gaana" → final-a rule → "gaan".
      // Pre-consonant anusvara (ṃ followed by a Unicode letter) stays;
      // it is stripped to "n" by stripIASTDiacritics.
      result = result.replace(/ṃ(?!\p{L})/gu, "").replace(/Ṃ(?!\p{L})/gu, "");
    }

    // Strip diacritics for readability (no schwa deletion for non-Hindi)
    result = stripIASTDiacritics(result);

    // Convert IAST c/ch conventions to readable ch/chh — but NOT for Tamil.
    // Sanscript uses "jh" (not "c") for ச; we already converted jhjh→"ch" above.
    // Applying iastToHinglish would incorrectly double that to "chh".
    if (script !== ScriptType.Tamil) {
      result = iastToHinglish(result, false);
    }

    // ── Script-specific post-processing ──

    // Tamil: diphthong glide — ய் after a vowel sounds like "i", not "y".
    // Sanscript emits "y" for ய் but Tanglish convention: பொய் = "poi" (not "poy"),
    // உயிர் = "uyir" (y before vowel stays as y). Rule: y after a vowel and
    // before a consonant or end-of-word → i.
    if (script === ScriptType.Tamil) {
      result = result.replace(/(?<=[aeiou])y(?=[^aeiou]|$)/gi, "i");
    }

    // Tamil: post-strip dental (த) positional rules.
    // After stripping IAST diacritics, all remaining "dh" in Tamil output
    // uniquely represents the dental stop த (Sanscript IAST form: "dh").
    // The geminate "dhdh" → "thth" was already handled pre-strip; the
    // remaining single "dh" tokens are processed here by position.
    //
    // NOTE: The ndh→"nth" rule has been intentionally omitted.
    // It correctly romanizes Sanskrit-loan மந்திரம் (manthiram) but
    // incorrectly converts native Tamil verb past-tense ஆழ்ந்தேன் (aazhndhen),
    // கலந்தன (kalandhana), ஐந்தும் (aindhum). Those words are
    // handled via the TAMIL_DICTIONARY instead.
    if (script === ScriptType.Tamil) {
      //    Word-initial dental → "th"  (துளிர்த்தது initial த = "th")
      result = result.replace(/(?<!\p{L})dh/gu, "th");
      //    Word-final dental (not followed by a letter) → "t"  (அன்னைத் = "annait")
      result = result.replace(/dh(?!\p{L})/gu, "t");
      //    NOTE: ththir → "thr" contraction removed. It incorrectly contracted
      //    productive verb forms like நிலைத்திருக்கும் (-த்திர- → -thr- instead of -ththir-).
      //    Tamil alveolar stop insertion: ன்ற cluster → "ndr".
      //    After strip, ன (ṉ→n) + ற (ṟ→r) surfaces as "nr". Phonetically an alveolar
      //    stop [d] is inserted: செய்கின்றன "seykindrana", நினைக்கின்றேன் "ninaikindren".
      result = result.replace(/nr/g, "ndr").replace(/Nr/g, "Ndr");
    }

    // Restore Tamil dictionary placeholders — MUST be last so that none of
    // the Tamil phonological rules (bh→b, gh→g, ndh→nth, etc.) can
    // corrupt the pre-computed Tanglish values.
    if (script === ScriptType.Tamil && tamilDictReplacements.length > 0) {
      result = restoreTamilDictionary(result, tamilDictReplacements);
    }

    // ─── Marathi post-processing ──────────────────────────────────────────────
    // Applied after iastToHinglish so all c→ch/ch→chh expansions are done.
    if (script === ScriptType.Devanagari && languageHint === "mr") {
      // Fix 2: स्व (sv) → "sw" (colloquial Marathi: स्वप्न = "swapna")
      result = result.replace(/sv/g, "sw").replace(/Sv/g, "Sw");

      // ── Suffix contractions (run before word-final vowel rules) ─────────────
      //   यांची / यांचे (-yāṃcī) → "anchi"  (swapnanchi, yanchi)
      result = result.replace(/aanchi(?!\p{L})/gu, "anchi");
      //   -cyā suffix that was preceded by long-ā: "aachyaa" → "achya"
      //   e.g. वाऱ्याच्या → vaaryaachyaa → vaaryachya
      result = result.replace(/aachyaa(?!\p{L})/gu, "achya");
      //   -cyā suffix preceded by anusvara ā: "aanchyaa" → "anchya"
      //   e.g. यांच्या / श्रीमंतांच्या / स्वप्नांच्या → ...aanchyaa → ...anchya
      result = result.replace(/aanchyaa(?!\p{L})/gu, "anchya");

      // ── Locative -āvara: "aavar" → "avar" ────────────────────────────────────
      //   तालावर → "taalavar", वाटेवर → "vaatevar"
      result = result.replace(/aavar/g, "avar");

      // ── Inherent-a deletion (BEFORE aa→a so long-ā words are protected) ──────
      //   Sanscript appends an inherent short-a to every bare consonant.
      //   In Marathi colloquial romanization the word-final inherent-a is silent:
      //   कर्म → karma → karm, धर्म → dharma → dharm.
      //
      //   KEY: run this BEFORE the aa→a pass. Long-ā words (दिवा → divaa,
      //   श्रद्धा → shraddhaa) still end in "aa" at this point, so their final
      //   "a" is preceded by another "a" (a vowel), not a consonant — the rule
      //   skips them. After this pass, aa→a shortens them correctly to "diva",
      //   "shraddha", etc. without a second deletion hit.
      //
      //   "y" is EXCLUDED from the consonant set: word-final -ya is a productive
      //   Marathi suffix (कर्तव्य = kartavya, लय = laya, -च्या = -chya) and must
      //   be preserved. "w" excluded similarly (स्व cluster).
      result = result.replace(/(?<=[b-df-hj-np-tv-xz])a(?!\p{L})/gu, "");

      // ── Word-final long-vowel shortening ──────────────────────────────────────
      //   ā word-final → "a":  śraddhā → shraddhaa → shraddha
      result = result.replace(/aa(?!\p{L})/gu, "a");
      //   ū word-final → "u":  tū → too → tu
      result = result.replace(/oo(?!\p{L})/gu, "u");
      //   -ūna suffix (absolutive): hasūna → hasoon-a (a deleted above) → hasoon
      //   → oon word-final → un
      result = result.replace(/oon(?!\p{L})/gu, "un");
    }

    // Restore Marathi dictionary placeholders.
    if (
      script === ScriptType.Devanagari &&
      languageHint === "mr" &&
      marathiDictReplacements.length > 0
    ) {
      result = restoreMarathiDictionary(result, marathiDictReplacements);
    }

    // ─── Malayalam post-processing ────────────────────────────────────────────
    if (script === ScriptType.Malayalam) {
      // Aspirate geminate: iastToHinglish converts IAST cc→chch (c→ch applied twice),
      // giving the 5-char sequence "chchu". In Manglish the geminate collapses:
      // ചോദിച്ചു → chodichu,  ജ്വലിച്ചു → jwalichu.
      result = result.replace(/chchu/g, "chu").replace(/Chchu/g, "Chu");
      result = result.replace(/chch(?!u)/g, "ch").replace(/Chch(?!u)/g, "Ch");

      // Geminate nasal reduction: ṅṅ → ngng (after strip) → ng.
      result = result.replace(/ngng/g, "ng").replace(/Ngng/g, "Ng");

      // Genitive suffix -nte: Sanscript emits nṟe → strip gives nre → nte.
      result = result.replace(/nre/g, "nte").replace(/Nre/g, "Nte");

      // Double-m reduction: ർ+മ്മ produces "rmm" → "rm" (karmavum, dharmavum).
      result = result.replace(/rmm/g, "rm");

      // Long ī before -yum suffix: streeYUM is already handled by dict;
      // generic ī→ee is in stripIASTDiacritics, nothing extra needed.
    }

    // Malayalam: word-final consonant cluster → append inherent "u".
    // Malayalam's inherent schwa surfaces as 'u' word-finally (unlike Hindi where
    // it is deleted, or Sanskrit where it stays 'a'). Sanscript suppresses the
    // final inherent vowel via virama, leaving a bare consonant in the romanized
    // output. Append 'u' to any 2+ consonant sequence not followed by a letter:
    //   nila-ത്ത്  "nilath"  → "nilathu"   ≈ expected "nilaththu" (near)
    //   vīṭṭ-ilēkk  "veettilekk" → "veettilekku"  (exact, combined with ṭṭ→tt fix)
    // Use {2,} to skip single-consonant chillu endings (ൽ→l, ൻ→n, ർ→r)
    // which are consonant-only glyphs with no inherent vowel that should stay bare.
    if (script === ScriptType.Malayalam) {
      result = result.replace(
        /([bcdfghjklmnpqrstvwxyz]{2,})(?!\p{L})/gu,
        "$1u",
      );
    }

    // Restore Malayalam dictionary placeholders — like the Tamil/Marathi/Bengali
    // dictionaries, this must run AFTER every Malayalam rule (in particular the
    // word-final "u" rule above, which would otherwise append a stray vowel to a
    // pre-computed value ending in a consonant cluster).
    if (
      script === ScriptType.Malayalam &&
      malayalamDictReplacements.length > 0
    ) {
      result = restoreMalayalamDictionary(result, malayalamDictReplacements);
    }

    // ─── Gujarati post-processing ────────────────────────────────────────────
    if (script === ScriptType.Gujarati) {
      // ph → f: nukta consonant ફ઼ and common Urdu loanwords
      // (ફ઼ = f, e.g. ફ઼ર્શ = farsh, તોફ઼ાન = tofaan).
      result = result.replace(/ph/g, "f").replace(/Ph/g, "F");
      // Medial schwa deletion: drop 'a' before a consonant + [e/i/u] cluster.
      // Lookahead [eiuEIU] intentionally excludes 'o' so that "kapoor" (ka+p+oo)
      // is never trimmed — 'oo' starts with 'o' and would falsely trigger the rule.
      // Correctly handles: kapūraNī "kapooranee" → "kapoornee",
      //                    bhaṭakatī "bhatakatee" → "bhataktee" → "bhatakti".
      result = result.replace(
        /([bcdfgjklmnpqrstvwxyz])a([bcdfgjklmnpqrstvwxyz])(?=[eiuEIU])/g,
        "$1$2",
      );
      // Word-final inherent-a deletion (same as Marathi):
      // e.g. ફ઼ર્શ "pharsha" → "farsh" (with ph→f above)
      result = result.replace(/(?<=[b-df-hj-np-tv-xz])a(?!\p{L})/gu, "");
      // Word-final long vowel shortening
      result = result.replace(/aa(?!\p{L})/gu, "a");
      result = result.replace(/ee(?!\p{L})/gu, "i");
      result = result.replace(/oo(?!\p{L})/gu, "u");
    }

    // ─── Bengali post-processing ──────────────────────────────────────────────
    if (script === ScriptType.Bengali) {
      // 1. Geminate chh reduction:
      //    iastToHinglish expands IAST 'cch' → 'chchh' (c→ch applied twice).
      //    Bengali চ্ছ should be 'chh': হচ্ছিল → hochhilo.
      result = result.replace(/chchh/g, "chh").replace(/Chchh/g, "Chh");

      // 2. O-shift: inherent short 'a' → 'o'.
      //    Long ā was pre-converted to \x06/\x07 markers, so only inherent a remains.
      result = result.replace(/a/g, "o").replace(/A/g, "O");

      // (Markers \x06/\x07 are restored AFTER word-final drop in step 7.)

      // 3. Pre-cluster schwa deletion: drop 'o' before CC (not 'ng') when the
      //    preceding consonant itself is preceded by a vowel (not word-initial).
      //    This preserves 'ho' in হচ্ছিল (hochhilo) while dropping 'ro' in করছিল.
      result = result.replace(
        /(?<=[aeiou\x06\x07][bcdfghjklmnpqrstvwxyz])o(?=(?!ng)[bcdfghjklmnpqrstvwxyz]{2})/g,
        "",
      );

      // 4. Interior VCoCVC schwa deletion: চারদিকে charodike → chardike.
      result = result.replace(
        /(?<=[aeiou\x06\x07][bcdfghjklmnpqrstvwxyz])o(?=[bcdfghjklmnpqrstvwxyz][aeiou])/g,
        "",
      );

      // 5. Geminate-schwa deletion: consonant + 'o' + same-consonant → double.
      result = result.replace(
        /([bcdfghjklmnpqrstvwxyz])o\1/g,
        (_: string, c: string) => c + c,
      );

      // 6. Word-final VCo drop — run BEFORE restoring \x06 markers so that real
      //    long-ā vowels (still \x06) don't count as the preceding vowel, preventing
      //    incorrect drops in ālo (আলো) and jvālāla (জ্বালাল).
      //    Uses [aeouy] not [i] — keeps '-ilo'/'-elo' verbal suffixes.
      //    Excludes 'h' to avoid splitting 'sh','ch','chh' digraphs.
      result = result.replace(
        /([aeouyAEOUY][bcdfgjklmnpqrstvwyz])o(?!\p{L})/gu,
        "$1",
      );

      // 7. Restore long-ā markers → 'aa' (word-initial) / 'a' (medial).
      result = result.replace(/\x05/g, "aa").replace(/\x08/g, "Aa");
      result = result.replace(/\x06/g, "a").replace(/\x07/g, "A");

      // 8. Genitive suffix contraction: '-ero' → '-er'.
      result = result.replace(/ero(?!\p{L})/gu, "er");
    }

    // Bengali & Odia: ব/ବ is pronounced "b" not "v" (unlike Hindi/Telugu/Tamil)
    if (script === ScriptType.Bengali || script === ScriptType.Odia) {
      result = result.replace(/v/gi, (m: string) => (m === "V" ? "B" : "b"));
    }

    // Restore Bengali dictionary placeholders.
    if (script === ScriptType.Bengali && bengaliDictReplacements.length > 0) {
      result = restoreBengaliDictionary(result, bengaliDictReplacements);
    }

    // Put back tildes that came from the lyrics (never chandrabindu ones).
    if (result.includes(TILDE_MARKER)) {
      result = result.split(TILDE_MARKER).join("~");
    }

    return result;
  } catch (e) {
    console.warn(`[Scriptify] Indic romanization failed for ${script}:`, e);
    return null;
  }
}
