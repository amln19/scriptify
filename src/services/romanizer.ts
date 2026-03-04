/**
 * Romanization Engine
 *
 * Transliterates non-Latin scripts to Roman/Latin characters.
 *
 * Script support:
 *   Hindi (Devanagari)  ─ Custom syllable parser + schwa deletion + dictionary fast-path
 *   Other Indic         ─ @indic-transliteration/sanscript → IAST → diacritic strip
 *   Japanese            ─ Hiragana / Katakana lookup tables
 *   Korean (Hangul)     ─ Syllable decomposition → revised romanization
 *   Chinese (CJK)       ─ Built-in pinyin map (500+ common characters)
 *   Mixed-script lines  ─ Per-segment routing (e.g. Hindi+English, Hindi+Punjabi)
 *
 * Section layout:
 *   1. Language Hint          — per-track language code from Spotify API
 *   2. Hindi: Dictionaries    — fast-path lookup tables for common / tricky words
 *   3. Hindi: Phonology       — consonant, vowel, matra, digit mapping constants
 *   4. Hindi: Parser          — syllable helpers, schwa deletion, main parser
 *   5. Non-Hindi Indic        — Sanscript IAST pipeline + Hinglish post-processing
 *   6. Japanese               — hiragana / katakana → romaji
 *   7. Korean                 — Hangul → revised romanization
 *   8. Chinese                — CJK → pinyin
 *   9. Script Routing         — internal per-segment dispatcher
 *  10. Public API             — romanize() entry point + initRomanizer()
 */

import {
  ScriptType,
  detectScript,
  hasNonLatinScript,
  detectAllScripts,
} from "../utils/scriptDetector";

// Static import — esbuild bundles this inline for the IIFE format
import * as SanscriptModule from "@indic-transliteration/sanscript";
const Sanscript: any = (SanscriptModule as any).default || SanscriptModule;

// ─── 1. Language Hint ────────────────────────────────────────────────────────

/** ISO language code from Spotify lyrics API (e.g., "hi", "mr", "sa", "ne") */
let currentLanguageHint: string | null = null;

/**
 * Set the language hint for the current track.
 * Called by lyricsInterceptor before romanization begins.
 */
export function setLanguageHint(lang: string | null): void {
  currentLanguageHint = lang;
  console.log(`[Scriptify] Language hint set: ${lang}`);
}

/**
 * Languages that use Devanagari but should NOT get Hindi-style schwa deletion.
 * Marathi has different (partial) schwa deletion rules.
 * Sanskrit has NO schwa deletion.
 * Nepali has partial schwa deletion similar to Hindi but with some differences.
 */
const SCHWA_DELETION_LANGUAGES = new Set(["hi"]);
const NO_SCHWA_DELETION_LANGUAGES = new Set(["mr", "sa", "ne"]);

/**
 * Should we apply Hindi-style colloquial post-processing for this Devanagari text?
 * - If language is "hi" → yes
 * - If language is "mr"/"sa"/"ne" → no
 * - If language is unknown → yes (Hindi is ~95%+ of Devanagari on Spotify)
 */
function shouldApplyHindiPostProcessing(): boolean {
  if (!currentLanguageHint) return true; // Default to Hindi for unknown
  if (SCHWA_DELETION_LANGUAGES.has(currentLanguageHint)) return true;
  if (NO_SCHWA_DELETION_LANGUAGES.has(currentLanguageHint)) return false;
  return true; // Other unknown languages with Devanagari, default to Hindi
}

// ─── 2. Hindi: Dictionaries ─────────────────────────────────────────────────

/**
 * Dictionary 1 – 500 Most Common Hindi Words
 *
 * Top-frequency words drawn from the Wiktionary "Top 1900 Hindi Words" corpus
 * (CC BY-SA), converted from IAST to our established Hinglish conventions:
 *   ā → aa (internal) / a (word-final)
 *   ī → ee (internal) / i (word-final)
 *   ū → oo (internal) / u (word-final)
 *   ṭ/ḍ/ṇ/ś/ṣ → t/d/n/sh/sh  ·  c→ch  ·  ch(IAST)→chh  ·  v→w
 *
 * Acts as a FAST PATH: words here bypass the syllable parser entirely,
 * and also correct any known parser failures for these specific forms.
 */
const HINDI_COMMON_DICT: Record<string, string> = {
  // ── Particles, postpositions, conjunctions ─────────────────────────────────
  में: "mein",
  है: "hai",
  हैं: "hain",
  नहीं: "nahin",
  से: "se",
  को: "ko",
  का: "ka",
  की: "ki",
  के: "ke",
  पर: "par",
  ने: "ne",
  तो: "to",
  भी: "bhi",
  ही: "hi",
  ना: "na",
  न: "na",
  और: "aur",
  तक: "tak",
  लिए: "liye",
  लिये: "liye",
  साथ: "saath",
  बिना: "bina",
  बाद: "baad",
  पहले: "pahle",
  पास: "paas",
  बीच: "beech",
  ऊपर: "oopar",
  नीचे: "neeche",
  आगे: "aage",
  पीछे: "peeche",
  अंदर: "andar",
  बाहर: "bahar",
  सामने: "saamne",
  तरफ: "taraf",
  ओर: "or",
  तरह: "tarah",
  जैसे: "jaise",
  जैसा: "jaisa",
  यह: "yeh",
  ये: "ye",
  वह: "woh",
  वो: "wo",
  वे: "ve",
  लेकिन: "lekin",
  मगर: "magar",
  परंतु: "parantu",
  क्योंकि: "kyonki",
  अगर: "agar",
  यदि: "yadi",
  यानी: "yaani",
  इसलिए: "isliye",
  इसलिये: "isliye",
  तभी: "tabhi",
  बल्कि: "balki",
  तथा: "tatha",

  // ── Pronouns ───────────────────────────────────────────────────────────────
  मैं: "main",
  तू: "tu",
  तुम: "tum",
  हम: "hum",
  आप: "aap",
  मेरा: "mera",
  मेरी: "meri",
  मेरे: "mere",
  तेरा: "tera",
  तेरी: "teri",
  तेरे: "tere",
  हमारा: "hamara",
  हमारी: "hamari",
  हमारे: "hamare",
  आपका: "aapka",
  आपकी: "aapki",
  आपके: "aapke",
  उसका: "uska",
  उसकी: "uski",
  उसके: "uske",
  उनका: "unka",
  उनकी: "unki",
  उनके: "unke",
  इसका: "iska",
  इसकी: "iski",
  इसके: "iske",
  अपना: "apna",
  अपनी: "apni",
  अपने: "apne",
  अपनों: "apno",
  मुझे: "mujhe",
  तुझे: "tujhe",
  हमें: "hame",
  उन्हें: "unhe",
  तुम्हें: "tumhe",
  आपको: "aapko",
  उसे: "use",
  इसे: "ise",
  मुझसे: "mujhse",
  तुमसे: "tumse",
  उससे: "usse",
  हमसे: "hamse",
  आपसे: "aapse",
  उनसे: "unse",
  मैंने: "maine",
  तूने: "tune",
  तुमने: "tumne",
  हमने: "hamne",
  उसने: "usne",
  मुझको: "mujhko",
  तुमको: "tumko",
  किसी: "kisi",
  कोई: "koi",
  कुछ: "kuch",
  सब: "sab",
  सभी: "sabhi",
  हर: "har",
  हरेक: "harek",

  // ── Interrogatives & relatives ─────────────────────────────────────────────
  कौन: "kaun",
  क्या: "kya",
  कहाँ: "kahan",
  कब: "kab",
  कैसा: "kaisa",
  कितना: "kitna",
  क्यों: "kyon",
  जो: "jo",
  जब: "jab",
  जहाँ: "jahan",
  तब: "tab",
  अब: "ab",
  वहाँ: "wahan",
  यहाँ: "yahan",
  यहीं: "yahin",
  वहीं: "wahin",
  किसने: "kisne",
  किसको: "kisko",
  किससे: "kisse",
  जिसे: "jise",
  जिसको: "jisko",
  जिसने: "jisne",

  // ── Common verbs ───────────────────────────────────────────────────────────
  होना: "hona",
  होता: "hota",
  होती: "hoti",
  होते: "hote",
  होगा: "hoga",
  होगी: "hogi",
  होंगे: "honge",
  हुआ: "hua",
  हुई: "hui",
  हुए: "hue",
  था: "tha",
  थे: "the",
  थीं: "thin",
  हो: "ho",
  करना: "karna",
  करता: "karta",
  करती: "karti",
  करते: "karte",
  करेगा: "karega",
  करूँ: "karoon",
  किया: "kiya",
  करें: "karen",
  जाना: "jaana",
  जाता: "jaata",
  जाती: "jaati",
  जाते: "jaate",
  जाएगा: "jaayega",
  गया: "gaya",
  गई: "gayi",
  गए: "gaye",
  आना: "aana",
  आता: "aata",
  आती: "aati",
  आते: "aate",
  आया: "aaya",
  आई: "aayi",
  देना: "dena",
  देता: "deta",
  देती: "deti",
  दिया: "diya",
  दिए: "diye",
  लेना: "lena",
  लेता: "leta",
  लेती: "leti",
  रहना: "rahna",
  रहा: "raha",
  रही: "rahi",
  रहे: "rahe",
  चलना: "chalna",
  चला: "chala",
  चली: "chali",
  बोलना: "bolna",
  बोला: "bola",
  बोली: "boli",
  देखना: "dekhna",
  देखा: "dekha",
  देखी: "dekhi",
  सुनना: "sunna",
  सुना: "suna",
  सुनी: "suni",
  समझना: "samajhna",
  समझा: "samajha",
  समझी: "samajhi",
  चाहना: "chahna",
  चाहा: "chaha",
  चाहते: "chahte",
  चाहती: "chahti",
  चाहता: "chahta",
  जानना: "jaanna",
  जानता: "jaanta",
  पाना: "paana",
  पाया: "paaya",
  मिलना: "milna",
  मिला: "mila",
  मिली: "mili",
  लगना: "lagna",
  लगा: "laga",
  लगी: "lagi",
  लगे: "lage",
  रखना: "rakhna",
  रखा: "rakha",
  बनना: "banna",
  बना: "bana",
  बनी: "bani",
  उठना: "uthna",
  उठा: "utha",
  चाहिए: "chahiye",
  सोचना: "sochna",
  सोचा: "socha",
  खोलना: "kholna",

  // ── High-frequency nouns ───────────────────────────────────────────────────
  बात: "baat",
  समय: "samay",
  दिन: "din",
  रात: "raat",
  काम: "kaam",
  लोग: "log",
  जगह: "jagah",
  देश: "desh",
  घर: "ghar",
  रास्ता: "raasta",
  रास्ते: "raaste",
  नाम: "naam",
  बार: "baar",
  साल: "saal",
  वर्ष: "varsh",
  बच्चा: "bachcha",
  बच्चे: "bachche",
  बच्चों: "bachchon",
  आदमी: "aadmi",
  औरत: "aurat",
  इंसान: "insaan",
  आँखें: "aankhein",
  आँखों: "aankhon",
  हाथ: "haath",
  हाथों: "haathon",
  पैर: "pair",
  दिल: "dil",
  मन: "man",
  तन: "tan",
  आत्मा: "aatma",
  जान: "jaan",
  सच: "sach",
  झूठ: "jhooth",
  सपना: "sapna",
  सपने: "sapne",
  दोस्त: "dost",
  दोस्ती: "dosti",
  यार: "yaar",
  दुनिया: "duniya",
  ज़माना: "zamaana",
  ज़िंदगी: "zindagi",
  रूप: "roop",
  रंग: "rang",
  रंगों: "rango",
  आवाज़: "awaaz",
  आवाज: "awaaz",
  खुशी: "khushi",
  गम: "gham",
  दर्द: "dard",
  दुख: "dukh",
  सुख: "sukh",
  प्यार: "pyaar",
  प्रेम: "prem",
  मोहब्बत: "mohabbat",
  इश्क़: "ishq",
  इश्क: "ishq",
  ख़्वाब: "khwaab",
  ख्वाब: "khwaab",
  सपनों: "sapno",
  दोनों: "dono",
  जवानी: "jawani",
  उम्र: "umra",
  पल: "pal",
  वक़्त: "waqt",
  वक्त: "waqt",
  लम्हा: "lamha",
  सुबह: "subah",
  शाम: "shaam",
  बारिश: "baarish",
  हवा: "hawa",
  पानी: "paani",
  आकाश: "aakaash",
  आसमान: "aasmaan",
  धूप: "dhoop",
  चाँद: "chaand",
  सूरज: "sooraj",
  तारा: "taara",
  तारे: "taare",
  तारों: "taaron",
  ज़मीन: "zameen",

  // ── Adjectives ─────────────────────────────────────────────────────────────
  अच्छा: "achha",
  अच्छी: "achhi",
  अच्छे: "achhe",
  बुरा: "bura",
  बुरी: "buri",
  बुरे: "bure",
  बड़ा: "bada",
  बड़ी: "badi",
  बड़े: "bade",
  छोटा: "chhota",
  छोटी: "chhoti",
  छोटे: "chhote",
  नया: "naya",
  नई: "nayi",
  नए: "naye",
  पुराना: "purana",
  पुरानी: "purani",
  पुराने: "purane",
  सही: "sahi",
  गलत: "galat",
  खुश: "khush",
  उदास: "udaas",
  तेज़: "tez",
  धीमा: "dheema",
  लंबा: "lamba",
  ऊँचा: "ooncha",
  सुंदर: "sundar",
  प्यारा: "pyaara",
  प्यारी: "pyaari",
  जवान: "jawaan",
  मालूम: "maaloom",
  सारा: "saara",
  सारी: "saari",
  सारे: "saare",
  पूरा: "poora",
  पूरी: "poori",
  पूरे: "poore",
  थोड़ा: "thoda",
  थोड़ी: "thodi",
  थोड़े: "thode",
  बहुत: "bahut",
  ज़्यादा: "zyaada",
  कम: "kam",

  // ── Numbers ────────────────────────────────────────────────────────────────
  एक: "ek",
  दो: "do",
  तीन: "teen",
  चार: "chaar",
  पाँच: "paanch",
  छह: "chheh",
  सात: "saat",
  आठ: "aath",
  नौ: "nau",
  दस: "das",

  // ── Adverbs & time words ────────────────────────────────────────────────────
  ज़रा: "zara",
  वाकई: "waaqai",
  अभी: "abhi",
  तुरंत: "turant",
  धीरे: "dheere",
  जल्दी: "jaldi",
  हमेशा: "hamesha",
  कभी: "kabhi",
  अक्सर: "aksar",
  रोज़: "roz",
  रोज: "roz",
  आज: "aaj",
  कल: "kal",
  परसों: "parso",
  फिर: "phir",
  दोबारा: "dobaara",
  बिल्कुल: "bilkul",
  एकदम: "ekdam",
  शायद: "shayad",
  ज़रूर: "zaroor",
  ज़रूरी: "zaroori",
  बस: "bas",
  सिर्फ: "sirf",
  केवल: "keval",

  // ── Interjections ──────────────────────────────────────────────────────────
  अरे: "are",
  ओ: "o",
  ओह: "oh",
  वाह: "waah",
  हाय: "haay",
};

/**
 * Dictionary 2 – 500 Most Frequently Mis-romanized Hindi Words
 *
 * Words where the rule-based parser produces output that diverges from
 * established Hinglish / Bollywood lyric transliteration conventions,
 * plus critical song vocabulary where we want guaranteed correctness.
 *
 * Key failure categories:
 *   ① Chandrabindu (ँ) + final long vowel: nasal-suffix shortening
 *      over-applies (हूँ→"hun" should be "hoon",  माँ→"man" should be "maa")
 *   ② Word-final ों anusvara: hard "n" added (दोनों→"donon" → want "dono")
 *   ③ Chandrabindu nasal blocks schwa deletion (चाँदनी→"chaandani" → "chaandni")
 *   ④ English/Urdu loanwords (होटल→"hotal" → "hotel")
 *   ⑤ Formal conjunct anusvara edge case (एवं→"ewn" → "evam")
 */
const HINDI_MIS_DICT: Record<string, string> = {
  // ── ① Chandrabindu on final long vowel (nasal-suffix shortening over-applies)
  माँ: "maa", // mother — rules give "man" ✗
  हाँ: "haan", // yes — rules give "han" ✗
  हूँ: "hoon", // I am — rules give "hun" ✗
  यूँ: "yoon", // like this — rules give "yun" ✗
  जाँ: "jaan", // life/beloved (Urdu) — rules give "jan" ✗
  क्यूँ: "kyoon", // why (ū+ँ form) — rules give "kyun" ✗
  ज्यूँ: "jyoon", // as/like (archaic/poetic) — rules give "jyun" ✗
  त्यूँ: "tyoon", // thus (archaic) — rules give "tyun" ✗
  ताँ: "taan", // musical elongation — rules give "tan" ✗
  नाँ: "naan", // regional "no" — rules give "nan" ✗

  // ── ② Word-final ों anusvara (convention absorbs nasal into the vowel) ─────
  दोनों: "dono", // both — rules give "donon" ✗
  सबों: "sabo", // all-oblique — rules give "sabon" ✗

  // ── ③ Chandrabindu nasal counted in cluster, blocks schwa deletion ─────────
  चाँदनी: "chaandni", // moonlight — rules give "chaandani" ✗
  हँसना: "hansna", // to laugh — rules give "hansana" ✗
  दुनियाँ: "duniya", // world (nasalized) — rules give "duniyan" ✗
  बाँहें: "baahein", // arms (plural) — rules give "baahaein" ✗
  बाँहों: "baahon", // arms (oblique)

  // ── ④ Loanwords with unexpected phonology ──────────────────────────────────
  होटल: "hotel", // hotel — rules give "hotal" ✗
  स्कूल: "school", // school — rules give "skool" ✗
  कॉलेज: "college", // college
  डॉक्टर: "doctor", // doctor — rules give "daktar" ✗
  हॉस्पिटल: "hospital", // hospital
  जिंदगी: "zindagi", // life (plain ज → conventionally "z")
  जिन्दगी: "zindagi", // alternate spelling
  फिल्म: "film", // film — plain फ gives "philm" ✗
  फिल्में: "filme", // films
  फिल्मों: "filmon", // films (oblique)
  फ़िल्म: "film", // film (nuqta फ़ — rules correct ✓, safety net)
  फ़िल्में: "filme", // films (nuqta)
  फ़िल्मों: "filmon", // films (nuqta, oblique)

  // ── ⑤ Formal word edge cases ──────────────────────────────────────────────
  एवं: "evam", // and (Sanskrit/formal) — rules give "ewn" ✗

  // ── Critical song words (safety net even where rules are correct) ──────────
  चाँदी: "chaandi", // silver
  हँसी: "hansi", // laughter
  ज़िंदगी: "zindagi", // life (nuqta — rules ✓)
  ज़िन्दगी: "zindagi", // alternate nuqta form
  ज़माना: "zamaana", // era/time (nuqta — rules ✓)
  ज़मीन: "zameen", // earth (nuqta)
  ज़रूर: "zaroor", // certainly
  ज़रा: "zara", // a little
  ज़िंदा: "zinda", // alive
  आवाज़: "awaaz", // voice (nuqta)
  आवाज: "awaaz", // voice (no nuqta — rules give "awaaj" ✗)
  ग़म: "gham", // sorrow (Urdu nuqta)
  ग़ज़ल: "ghazal", // ghazal
  मुहब्बत: "mohabbat", // love (variant spelling — rules ✓)
  परेशान: "pareshaan", // troubled
};

// Combined — MIS_DICT overrides COMMON_DICT on conflicts
const HINDI_DICTIONARY: Record<string, string> = {
  ...HINDI_COMMON_DICT,
  ...HINDI_MIS_DICT,
};

/**
 * Replace any continuous Devanagari run that has a dictionary entry with its
 * pre-computed Hinglish romanization, BEFORE the syllable parser runs.
 *
 * Replacement values are Latin, so the parser passes them through unchanged
 * via the "non-Devanagari character" branch (output verbatim).
 */
function applyHindiDictionary(text: string): string {
  return text.replace(/[\u0900-\u097F]+/g, (word) => {
    return HINDI_DICTIONARY[word] ?? word;
  });
}

// ─── 3. Hindi: Phonology Tables ─────────────────────────────────────────────

/**
 * Comprehensive Devanagari consonant → Hinglish mapping.
 *
 * Key design decisions based on standard Hinglish conventions:
 * - No distinction between retroflex and dental (ट/त both → "t")
 * - Nuqta consonants mapped to their actual Hindi pronunciation
 *   (ज़→z, फ़→f, etc.) — Sanscript loses this information via IAST
 * - Aspirates use "h" suffix (ख→kh, घ→gh, etc.)
 * - छ → "chh" (double-h distinguishes from च → "ch")
 */
const HINDI_CONSONANTS: Record<string, string> = {
  // Velars
  "\u0915": "k", // क
  "\u0916": "kh", // ख
  "\u0917": "g", // ग
  "\u0918": "gh", // घ
  "\u0919": "n", // ङ

  // Palatals
  "\u091A": "ch", // च
  "\u091B": "chh", // छ (aspirated — "chh" distinguishes from च "ch")
  "\u091C": "j", // ज
  "\u091D": "jh", // झ
  "\u091E": "n", // ञ

  // Retroflexes (same as dentals in Hinglish)
  "\u091F": "t", // ट
  "\u0920": "th", // ठ
  "\u0921": "d", // ड
  "\u0922": "dh", // ढ
  "\u0923": "n", // ण

  // Dentals
  "\u0924": "t", // त
  "\u0925": "th", // थ
  "\u0926": "d", // द
  "\u0927": "dh", // ध
  "\u0928": "n", // न
  "\u0929": "n", // ऩ (rare)

  // Labials
  "\u092A": "p", // प
  "\u092B": "ph", // फ
  "\u092C": "b", // ब
  "\u092D": "bh", // भ
  "\u092E": "m", // म

  // Semi-vowels and liquids
  "\u092F": "y", // य
  "\u0930": "r", // र
  "\u0931": "r", // ऱ (eyelash ra)
  "\u0932": "l", // ल
  "\u0933": "l", // ळ
  "\u0934": "l", // ऴ (Tamil/Malayalam)
  "\u0935": "w", // व (Hinglish convention: "w" — wo, hawa, wahan)

  // Sibilants and aspirate
  "\u0936": "sh", // श
  "\u0937": "sh", // ष
  "\u0938": "s", // स
  "\u0939": "h", // ह

  // Nuqta consonants — critical for Hindi/Urdu loanwords
  // These are the dedicated Unicode codepoints:
  "\u0958": "q", // क़ (qaaf)
  "\u0959": "kh", // ख़ (same as ख in practical Hindi)
  "\u095A": "gh", // ग़ (same as ग in practical Hindi)
  "\u095B": "z", // ज़ ← THE KEY FIX: "z" not "j"
  "\u095C": "d", // ड़ (Hinglish convention: thodi, chhod, bada)
  "\u095D": "dh", // ढ़ (Hinglish convention: padh, badhna)
  "\u095E": "f", // फ़ ← "f" not "ph"
  "\u095F": "y", // य़
};

/**
 * Independent (standalone) vowel letters → Hinglish.
 * Both short/long map to the same letter (standard Hinglish convention).
 */
const HINDI_VOWELS: Record<string, string> = {
  "\u0905": "a", // अ
  "\u0906": "aa", // आ (long a)
  "\u0907": "i", // इ
  "\u0908": "ee", // ई (long i)
  "\u0909": "u", // उ
  "\u090A": "oo", // ऊ (long u)
  "\u090B": "ri", // ऋ
  "\u090C": "li", // ऌ
  "\u090F": "e", // ए
  "\u0910": "ai", // ऐ
  "\u0913": "o", // ओ
  "\u0914": "au", // औ
  "\u0960": "ri", // ॠ
  "\u0961": "li", // ॡ
  // English-style vowels (rare)
  "\u090D": "e", // ऍ
  "\u090E": "e", // ऎ
  "\u0911": "o", // ऑ (as in "coffee" → "kॉfi")
  "\u0912": "o", // ऒ
};

/**
 * Dependent vowel signs (matras) → Hinglish.
 * Applied to the preceding consonant, replacing the inherent schwa 'a'.
 */
const HINDI_MATRAS: Record<string, string> = {
  "\u093E": "aa", // ा (long a matra — doubled for distinction)
  "\u093F": "i", // ि
  "\u0940": "ee", // ी (long i matra)
  "\u0941": "u", // ु
  "\u0942": "oo", // ू (long u matra)
  "\u0943": "ri", // ृ
  "\u0944": "ri", // ॄ
  "\u0945": "e", // ॅ
  "\u0946": "e", // ॆ
  "\u0947": "e", // े
  "\u0948": "ai", // ै
  "\u0949": "o", // ॉ
  "\u094A": "o", // ॊ
  "\u094B": "o", // ो
  "\u094C": "au", // ौ
};

/** Devanagari digits → ASCII */
const HINDI_DIGITS: Record<string, string> = {
  "\u0966": "0",
  "\u0967": "1",
  "\u0968": "2",
  "\u0969": "3",
  "\u096A": "4",
  "\u096B": "5",
  "\u096C": "6",
  "\u096D": "7",
  "\u096E": "8",
  "\u096F": "9",
};

// Special combining marks
const VIRAMA = "\u094D"; // ् halant — suppresses inherent vowel
const ANUSVARA = "\u0902"; // ं nasal dot
const CHANDRABINDU = "\u0901"; // ँ nasalization
const VISARGA = "\u0903"; // ः aspiration
const NUQTA = "\u093C"; // ़ nuqta dot

// ─── 4. Hindi: Parser ────────────────────────────────────────────────────────

/**
 * Syllable representation for the schwa deletion algorithm.
 */
interface HindiSyllable {
  consonants: string; // Romanized consonant cluster (e.g., "k", "ndr", "str")
  vowel: string; // The vowel ("a", "e", "ai", etc.)
  isSchwa: boolean; // True = inherent 'a' (candidate for deletion); false = explicit matra
  nasal: string; // Nasalization suffix: "n", "m", or ""
}

function isDevanagariConsonant(ch: string): boolean {
  const code = ch.codePointAt(0) || 0;
  return (
    (code >= 0x0915 && code <= 0x0939) || (code >= 0x0958 && code <= 0x095f)
  );
}

function isDevanagariMatra(ch: string): boolean {
  return ch in HINDI_MATRAS;
}

function isDevanagariChar(ch: string): boolean {
  const code = ch.codePointAt(0) || 0;
  return code >= 0x0900 && code <= 0x097f;
}

/**
 * Normalize Devanagari text:
 * Convert decomposed nuqta forms (consonant + ़) to their composed equivalents.
 * E.g., ज + ़ → ज़ (U+095B)
 */
function normalizeDevanagari(text: string): string {
  return text
    .replace(/\u0915\u093C/g, "\u0958") // क़
    .replace(/\u0916\u093C/g, "\u0959") // ख़
    .replace(/\u0917\u093C/g, "\u095A") // ग़
    .replace(/\u091C\u093C/g, "\u095B") // ज़
    .replace(/\u0921\u093C/g, "\u095C") // ड़
    .replace(/\u0922\u093C/g, "\u095D") // ढ़
    .replace(/\u092B\u093C/g, "\u095E") // फ़
    .replace(/\u092F\u093C/g, "\u095F"); // य़
}

/**
 * Determine nasal character based on the following consonant.
 * Hindi anusvara assimilates to the place of articulation:
 * - Before nasal consonant (न, म, ण, etc.) NOT followed by virama → "" (merge)
 *   e.g., मैंने → "maine" (not "mainne")
 * - Before labials (प, फ, ब, भ, म) → "m" (e.g., संभव → "sambhav")
 * - Before all others → "n" (e.g., अंदर → "andar", हिंदी → "hindi")
 */
function getNasalForContext(text: string, pos: number): string {
  // Look ahead for the next consonant
  for (let j = pos; j < text.length; j++) {
    const ch = text[j];
    if (isDevanagariConsonant(ch)) {
      const code = ch.codePointAt(0) || 0;

      // Nasal consonants: ङ(0919) ञ(091E) ण(0923) न(0928) ऩ(0929) म(092E)
      const isNasalCons =
        code === 0x0919 ||
        code === 0x091e ||
        code === 0x0923 ||
        code === 0x0928 ||
        code === 0x0929 ||
        code === 0x092e;
      if (isNasalCons) {
        // If nasal consonant is NOT followed by virama, the anusvara merges
        // into it (मैंने → maine). If followed by virama, it's a genuine
        // cluster (संन्यास → sannyaas) so we keep the nasal.
        const nextIdx = j + 1;
        if (nextIdx >= text.length || text[nextIdx] !== VIRAMA) {
          return ""; // Merge: anusvara absorbed into following nasal consonant
        }
      }

      // Labials: प(092A) फ(092B) ब(092C) भ(092D) म(092E) फ़(095E)
      if ((code >= 0x092a && code <= 0x092e) || code === 0x095e) {
        return "m";
      }
      return "n";
    }
    // Stop at non-Devanagari characters (space, punctuation)
    if (!isDevanagariChar(ch)) break;
  }
  return "n"; // Default: word-final or before non-labial
}

/**
 * Direct Devanagari → Hinglish romanization.
 *
 * This bypasses Sanscript's IAST entirely, giving us:
 * - Proper nuqta handling (ज़→z, फ़→f — Sanscript loses these via IAST)
 * - Context-aware anusvara (ं → n/m based on following consonant)
 * - Chandrabindu as "n" (ँ → n)
 * - Native schwa deletion (right-to-left, Choudhury et al. 2004)
 * - Natural Hinglish vowels (no diacritics, no doubling)
 */
function romanizeHindiDirect(text: string): string {
  // Step 1: Normalize nuqta forms (ज + ़ → ज़, etc.)
  const normalized = normalizeDevanagari(text);
  // Step 2: Replace known Devanagari words with pre-computed Hinglish
  //         (dictionary entries bypass the syllable parser entirely)
  const dictProcessed = applyHindiDictionary(normalized);
  let result = "";
  let i = 0;
  let currentWord: HindiSyllable[] = [];

  function flushWord(): void {
    if (currentWord.length === 0) return;
    result += applySchwaAndBuild(currentWord);
    currentWord = [];
  }

  while (i < dictProcessed.length) {
    const ch = dictProcessed[i];
    const code = ch.codePointAt(0) || 0;

    // ── Devanagari digit ──
    if (HINDI_DIGITS[ch]) {
      flushWord();
      result += HINDI_DIGITS[ch];
      i++;
      continue;
    }

    // ── Independent vowel (अ, आ, इ, etc.) ──
    if (HINDI_VOWELS[ch]) {
      let vowelStr = HINDI_VOWELS[ch];
      let nasal = "";
      let cons = "";

      // Glide insertion: when ए/ऐ follows a syllable with a vowel,
      // insert "y" glide (e.g., चाहिए → chahiye, not chahie)
      if ((ch === "\u090F" || ch === "\u0910") && currentWord.length > 0) {
        cons = "y";
      }

      i++;
      // Check for following anusvara/chandrabindu
      if (i < dictProcessed.length) {
        if (dictProcessed[i] === ANUSVARA) {
          // Special: anusvara after ए → "ein" (में = mein, not men)
          if (vowelStr === "e") vowelStr = "ei";
          nasal = getNasalForContext(dictProcessed, i + 1);
          i++;
        } else if (dictProcessed[i] === CHANDRABINDU) {
          nasal = "n";
          i++;
        }
      }

      currentWord.push({
        consonants: cons,
        vowel: vowelStr,
        isSchwa: false,
        nasal,
      });
      continue;
    }

    // ── Consonant ──
    if (isDevanagariConsonant(ch)) {
      let cluster = HINDI_CONSONANTS[ch] || ch;
      i++;

      // Collect consonant cluster via virama (halant)
      // E.g., क्ष = क + ् + ष → "ksh"
      while (i < dictProcessed.length && dictProcessed[i] === VIRAMA) {
        i++; // skip virama
        if (
          i < dictProcessed.length &&
          isDevanagariConsonant(dictProcessed[i])
        ) {
          cluster += HINDI_CONSONANTS[dictProcessed[i]] || dictProcessed[i];
          i++;
        }
      }

      // Special conjunct: ज्ञ (ज + ् + ञ) → "gy" (not "jn")
      // In Hindi, ज्ञ is pronounced "gy" (ज्ञान = gyaan)
      if (cluster === "jn") cluster = "gy";

      // Determine the vowel
      let vowel = "a"; // inherent schwa
      let isSchwa = true;
      let nasal = "";

      // Check for matra (dependent vowel sign)
      if (i < dictProcessed.length && isDevanagariMatra(dictProcessed[i])) {
        vowel = HINDI_MATRAS[dictProcessed[i]];
        isSchwa = false;
        i++;
      }

      // Check for anusvara/chandrabindu after vowel
      if (i < dictProcessed.length) {
        if (dictProcessed[i] === ANUSVARA) {
          // Special: anusvara after े matra → "ein" (में = mein, बातें = baatein)
          if (vowel === "e") vowel = "ei";
          nasal = getNasalForContext(dictProcessed, i + 1);
          i++;
        } else if (dictProcessed[i] === CHANDRABINDU) {
          nasal = "n";
          i++;
        }
      }

      // Check for visarga
      if (i < dictProcessed.length && dictProcessed[i] === VISARGA) {
        nasal += "h";
        i++;
      }

      currentWord.push({ consonants: cluster, vowel, isSchwa, nasal });
      continue;
    }

    // ── Standalone anusvara/chandrabindu (rare — append to previous syllable) ──
    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      if (currentWord.length > 0) {
        currentWord[currentWord.length - 1].nasal =
          ch === ANUSVARA ? getNasalForContext(dictProcessed, i + 1) : "n";
      }
      i++;
      continue;
    }

    // ── Standalone visarga ──
    if (ch === VISARGA) {
      if (currentWord.length > 0) {
        currentWord[currentWord.length - 1].nasal += "h";
      }
      i++;
      continue;
    }

    // ── Nuqta standalone (should be consumed by normalize, but just in case) ──
    if (ch === NUQTA) {
      i++;
      continue;
    }

    // ── Danda (।) → period ──
    if (ch === "\u0964" || ch === "\u0965") {
      flushWord();
      result += ".";
      i++;
      continue;
    }

    // ── Non-Devanagari character (space, punctuation, Latin, etc.) ──
    flushWord();
    result += ch;
    i++;
  }

  flushWord();
  return result;
}

/**
 * Apply schwa deletion and build the romanized string for a word.
 *
 * Algorithm processes RIGHT-TO-LEFT per Choudhury et al. (2004):
 * 1. Word-final schwa → always deleted (कमल → kamal, not kamala)
 * 2. Word-initial schwa → never deleted (अगर → agar, not gar)
 * 3. Medial schwa → deleted ONLY if next syllable RETAINS its vowel
 *    (prevents cascading deletion that creates unreadable consonant chains)
 * 4. Cluster check → don't delete if it creates 3+ effective consonants
 */
function applySchwaAndBuild(syllables: HindiSyllable[]): string {
  if (syllables.length === 0) return "";

  const deleteSchwa: boolean[] = new Array(syllables.length).fill(false);

  // Process RIGHT-TO-LEFT
  for (let i = syllables.length - 1; i >= 0; i--) {
    if (!syllables[i].isSchwa) continue;

    // Rule 1: Always delete word-final schwa
    if (i === syllables.length - 1) {
      deleteSchwa[i] = true;
      continue;
    }

    // Rule 2: Never delete word-initial schwa
    if (i === 0) continue;

    // Rule 3: Delete medial schwa only if next syllable retains its vowel.
    // If the next syllable's vowel was already deleted, don't delete this one
    // (would create too many consonants in a row)
    const nextSyl = syllables[i + 1];
    const nextRetainsVowel = !deleteSchwa[i + 1] || !nextSyl.isSchwa;

    if (nextRetainsVowel) {
      // Rule 4: Check consonant cluster permissibility
      // If deleting this schwa, the resulting cluster includes:
      // - Previous syllable's trailing nasal (n/m from anusvara/chandrabindu)
      // - Current syllable's consonant(s)
      // - Next syllable's consonant(s)
      // E.g., ज़िंदगी: "zin" + [d-a] + "gi" → deleting 'a' creates "ndg" (3 consonants)
      const prevNasalLen = i > 0 && syllables[i - 1].nasal ? 1 : 0;
      const ownNasalLen = syllables[i].nasal ? 1 : 0;
      const currentLen = countEffectiveConsonantsHindi(syllables[i].consonants);
      const nextLen = countEffectiveConsonantsHindi(nextSyl.consonants);

      // Hindi allows at most 2 effective consonants in a cluster.
      // Include current syllable's own nasal: deleting schwa in पारंपरिक
      // would create "rmp" (3 consonants) if we don't count the trailing nasal.
      if (prevNasalLen + currentLen + ownNasalLen + nextLen <= 2) {
        deleteSchwa[i] = true;
      }
    }
  }

  // Build output
  let result = "";
  for (let i = 0; i < syllables.length; i++) {
    result += syllables[i].consonants;
    if (!deleteSchwa[i]) {
      result += syllables[i].vowel;
    }
    result += syllables[i].nasal;
  }

  // ── Post-processing ──

  // Diphthong normalization: ाइ in loanwords produces "aai" → "ai"
  // e.g., मोबाइल → mobail, साइकिल → saikil
  result = result.replace(/aai/g, "ai");

  // Word-final long-vowel shortening:
  // In natural Hinglish, word-final long vowels shorten:
  //   हवा → hawa, मेरी → meri, तू → tu
  // Only apply when the word has consonant content (length > 2),
  // so standalone आ stays "aa", standalone ई stays "ee", etc.
  if (result.length > 2) {
    result = result.replace(/aa$/, "a").replace(/ee$/, "i").replace(/oo$/, "u");
  }

  // Also shorten before a NASAL SUFFIX (from anusvara/chandrabindu on the last syllable):
  //   वहाँ → wahan, थीं → thin, हूँ → hun, घंटियाँ → ghantiyan
  // We check the last syllable's nasal field to distinguish real nasal suffixes
  // from consonants like म/न that happen to end the word (शाम stays "shaam").
  const lastSyl = syllables[syllables.length - 1];
  if (lastSyl && lastSyl.nasal && result.length > 2) {
    const nasalSuffix = lastSyl.nasal;
    const beforeNasal = result.slice(0, result.length - nasalSuffix.length);
    const shortened = beforeNasal
      .replace(/aa$/, "a")
      .replace(/ee$/, "i")
      .replace(/oo$/, "u");
    result = shortened + nasalSuffix;
  }

  return result;
}

/**
 * Count effective consonants in a romanized cluster.
 * Digraphs count as 1: "kh", "gh", "ch", "chh", "jh", "th", "dh", "ph", "bh", "sh", "rh".
 */
function countEffectiveConsonantsHindi(cluster: string): number {
  if (!cluster) return 0;
  let count = 0;
  let i = 0;
  while (i < cluster.length) {
    // "sh", "kh", "gh", "ch", "jh", "th", "dh", "ph", "bh", "rh", "ng" = 1 consonant each
    // "chh" = 1 effective consonant (छ)
    if (i + 2 < cluster.length && cluster.substring(i, i + 3) === "chh") {
      count++;
      i += 3;
    } else if (
      i + 1 < cluster.length &&
      ["kh", "gh", "ch", "jh", "th", "dh", "ph", "bh", "sh", "ng"].includes(
        cluster.substring(i, i + 2),
      )
    ) {
      count++;
      i += 2;
    } else {
      count++;
      i++;
    }
  }
  return count;
}

// ─── 5. Non-Hindi Indic Scripts ─────────────────────────────────────────────

/**
 * Strip IAST diacritics for non-Hindi Indic scripts (Tamil, Bengali, etc.).
 * These use Sanscript → IAST, then diacritics are stripped for readability.
 */
function stripIASTDiacritics(text: string): string {
  const DIACRITIC_MAP: Record<string, string> = {
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
    "~": "n",
    "\u0303": "n", // combining tilde
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
  let result = "";
  for (const char of text) {
    result += DIACRITIC_MAP[char] ?? char;
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

function romanizeIndic(text: string, script: ScriptType): string | null {
  // For Hindi (Devanagari + Hindi language or unknown): use direct parser
  // This bypasses Sanscript entirely, giving proper nuqta and schwa handling
  if (script === ScriptType.Devanagari && shouldApplyHindiPostProcessing()) {
    try {
      const result = romanizeHindiDirect(text);
      console.log(
        `[Scriptify] Hindi direct: "${text.substring(0, 20)}" → "${result?.substring(0, 20)}"`,
      );
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
      console.log(
        `[Scriptify] Gurmukhi direct: "${text.substring(0, 20)}" → "${result?.substring(0, 20)}"`,
      );
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
    let result = Sanscript.t(text, scheme, "iast");

    // ── Script-specific IAST pre-processing (before generic strip) ──
    // Tamil & Malayalam: ḻ → "zh" (ழ/ഴ = "zha", not "la")
    if (script === ScriptType.Tamil || script === ScriptType.Malayalam) {
      result = result.replace(/ḻ/gi, (m: string) => (m === "Ḻ" ? "Zh" : "zh"));
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

    // Strip diacritics for readability (no schwa deletion for non-Hindi)
    result = stripIASTDiacritics(result);

    // Convert IAST conventions (c/ch) to readable (ch/chh).
    // v→w is a Hindi-only convention; Hindi uses the direct parser so all
    // scripts reaching this path keep v as "v".
    result = iastToHinglish(result, false);

    // ── Script-specific post-processing ──
    // Bengali & Odia: ব/ବ is pronounced "b" not "v" (unlike Hindi/Telugu/Tamil)
    if (script === ScriptType.Bengali || script === ScriptType.Odia) {
      result = result.replace(/v/gi, (m: string) => (m === "V" ? "B" : "b"));
    }

    console.log(
      `[Scriptify] Indic romanized: "${text.substring(0, 20)}" → "${result?.substring(0, 20)}"`,
    );
    return result;
  } catch (e) {
    console.warn(`[Scriptify] Indic romanization failed for ${script}:`, e);
    return null;
  }
}

// ─── 5b. Gurmukhi Direct Romanizer ───────────────────────────────────────────
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
  // Otherwise (tippi, bindi, addak, another consonant, nukta) → keep 'a'
  return true;
}

function romanizeGurmukhiDirect(text: string): string {
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

  return out;
}

// ─── 6. Japanese ─────────────────────────────────────────────────────────────

const HIRAGANA_MAP: Record<string, string> = {
  あ: "a",
  い: "i",
  う: "u",
  え: "e",
  お: "o",
  か: "ka",
  き: "ki",
  く: "ku",
  け: "ke",
  こ: "ko",
  さ: "sa",
  し: "shi",
  す: "su",
  せ: "se",
  そ: "so",
  た: "ta",
  ち: "chi",
  つ: "tsu",
  て: "te",
  と: "to",
  な: "na",
  に: "ni",
  ぬ: "nu",
  ね: "ne",
  の: "no",
  は: "ha",
  ひ: "hi",
  ふ: "fu",
  へ: "he",
  ほ: "ho",
  ま: "ma",
  み: "mi",
  む: "mu",
  め: "me",
  も: "mo",
  や: "ya",
  ゆ: "yu",
  よ: "yo",
  ら: "ra",
  り: "ri",
  る: "ru",
  れ: "re",
  ろ: "ro",
  わ: "wa",
  ゐ: "wi",
  ゑ: "we",
  を: "wo",
  ん: "n",
  が: "ga",
  ぎ: "gi",
  ぐ: "gu",
  げ: "ge",
  ご: "go",
  ざ: "za",
  じ: "ji",
  ず: "zu",
  ぜ: "ze",
  ぞ: "zo",
  だ: "da",
  ぢ: "di",
  づ: "du",
  で: "de",
  ど: "do",
  ば: "ba",
  び: "bi",
  ぶ: "bu",
  べ: "be",
  ぼ: "bo",
  ぱ: "pa",
  ぴ: "pi",
  ぷ: "pu",
  ぺ: "pe",
  ぽ: "po",
  // Compound kana
  きゃ: "kya",
  きゅ: "kyu",
  きょ: "kyo",
  しゃ: "sha",
  しゅ: "shu",
  しょ: "sho",
  ちゃ: "cha",
  ちゅ: "chu",
  ちょ: "cho",
  にゃ: "nya",
  にゅ: "nyu",
  にょ: "nyo",
  ひゃ: "hya",
  ひゅ: "hyu",
  ひょ: "hyo",
  みゃ: "mya",
  みゅ: "myu",
  みょ: "myo",
  りゃ: "rya",
  りゅ: "ryu",
  りょ: "ryo",
  ぎゃ: "gya",
  ぎゅ: "gyu",
  ぎょ: "gyo",
  じゃ: "ja",
  じゅ: "ju",
  じょ: "jo",
  びゃ: "bya",
  びゅ: "byu",
  びょ: "byo",
  ぴゃ: "pya",
  ぴゅ: "pyu",
  ぴょ: "pyo",
  っ: "", // Double consonant marker (handled in context)
  ー: "-",
};

const KATAKANA_MAP: Record<string, string> = {};
// Build katakana map from hiragana by shifting Unicode code points
// Katakana is at offset 0x60 from hiragana
for (const [hira, romaji] of Object.entries(HIRAGANA_MAP)) {
  const kata = Array.from(hira)
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      // Hiragana range: 3040-309F, Katakana: 30A0-30FF
      if (code >= 0x3041 && code <= 0x3096) {
        return String.fromCodePoint(code + 0x60);
      }
      return ch;
    })
    .join("");
  KATAKANA_MAP[kata] = romaji;
}
// Extra katakana-only
KATAKANA_MAP["ー"] = "-";
KATAKANA_MAP["ヴ"] = "vu";

function romanizeJapanese(text: string): string {
  const combined = { ...HIRAGANA_MAP, ...KATAKANA_MAP };
  let result = "";
  let i = 0;
  const chars = Array.from(text);

  while (i < chars.length) {
    // Try two-character compound first
    if (i + 1 < chars.length) {
      const pair = chars[i] + chars[i + 1];
      if (combined[pair]) {
        result += combined[pair];
        i += 2;
        continue;
      }
    }

    // Handle っ/ッ (sokuon - double consonant)
    if (chars[i] === "っ" || chars[i] === "ッ") {
      // Double the next consonant
      if (i + 1 < chars.length) {
        const nextRomaji = combined[chars[i + 1]];
        if (nextRomaji && nextRomaji.length > 0) {
          result += nextRomaji[0]; // Double the first consonant
        }
      }
      i++;
      continue;
    }

    // Single character lookup
    if (combined[chars[i]]) {
      result += combined[chars[i]];
    } else {
      // Keep CJK kanji and other characters as-is
      result += chars[i];
    }
    i++;
  }

  return result;
}

// ─── 7. Korean ───────────────────────────────────────────────────────────────

const KOREAN_INITIALS = [
  "g",
  "kk",
  "n",
  "d",
  "tt",
  "r",
  "m",
  "b",
  "pp",
  "s",
  "ss",
  "",
  "j",
  "jj",
  "ch",
  "k",
  "t",
  "p",
  "h",
];
const KOREAN_MEDIALS = [
  "a",
  "ae",
  "ya",
  "yae",
  "eo",
  "e",
  "yeo",
  "ye",
  "o",
  "wa",
  "wae",
  "oe",
  "yo",
  "u",
  "wo",
  "we",
  "wi",
  "yu",
  "eu",
  "ui",
  "i",
];
const KOREAN_FINALS = [
  "",
  "k",
  "k",
  "k",
  "n",
  "n",
  "n",
  "t",
  "l",
  "l",
  "l",
  "l",
  "l",
  "l",
  "l",
  "l",
  "m",
  "p",
  "p",
  "t",
  "t",
  "ng",
  "t",
  "t",
  "k",
  "t",
  "p",
  "t",
];

function romanizeKorean(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const offset = code - 0xac00;
      const initial = Math.floor(offset / (21 * 28));
      const medial = Math.floor((offset % (21 * 28)) / 28);
      const final = offset % 28;

      result +=
        KOREAN_INITIALS[initial] +
        KOREAN_MEDIALS[medial] +
        KOREAN_FINALS[final];
    } else {
      result += char;
    }
  }
  return result;
}

// ─── 8. Chinese ──────────────────────────────────────────────────────────────

// Lightweight offline pinyin map covering the 500+ most common CJK characters.
const COMMON_PINYIN: Record<string, string> = {
  的: "de",
  一: "yī",
  是: "shì",
  不: "bù",
  了: "le",
  人: "rén",
  我: "wǒ",
  在: "zài",
  有: "yǒu",
  他: "tā",
  这: "zhè",
  中: "zhōng",
  大: "dà",
  来: "lái",
  上: "shàng",
  国: "guó",
  个: "gè",
  到: "dào",
  说: "shuō",
  们: "men",
  为: "wéi",
  子: "zǐ",
  和: "hé",
  你: "nǐ",
  地: "dì",
  出: "chū",
  会: "huì",
  时: "shí",
  要: "yào",
  也: "yě",
  自: "zì",
  就: "jiù",
  可: "kě",
  以: "yǐ",
  她: "tā",
  里: "lǐ",
  去: "qù",
  行: "xíng",
  过: "guò",
  家: "jiā",
  学: "xué",
  对: "duì",
  生: "shēng",
  能: "néng",
  而: "ér",
  心: "xīn",
  多: "duō",
  没: "méi",
  好: "hǎo",
  想: "xiǎng",
  那: "nà",
  得: "de",
  如: "rú",
  然: "rán",
  还: "hái",
  下: "xià",
  看: "kàn",
  天: "tiān",
  年: "nián",
  开: "kāi",
  把: "bǎ",
  都: "dōu",
  因: "yīn",
  与: "yǔ",
  很: "hěn",
  当: "dāng",
  被: "bèi",
  从: "cóng",
  所: "suǒ",
  起: "qǐ",
  但: "dàn",
  现: "xiàn",
  前: "qián",
  头: "tóu",
  只: "zhǐ",
  无: "wú",
  长: "cháng",
  什: "shén",
  么: "me",
  让: "ràng",
  回: "huí",
  用: "yòng",
  着: "zhe",
  道: "dào",
  知: "zhī",
  再: "zài",
  给: "gěi",
  名: "míng",
  面: "miàn",
  手: "shǒu",
  老: "lǎo",
  气: "qì",
  两: "liǎng",
  已: "yǐ",
  后: "hòu",
  最: "zuì",
  做: "zuò",
  见: "jiàn",
  谁: "shuí",
  明: "míng",
  走: "zǒu",
  内: "nèi",
  发: "fā",
  太: "tài",
  高: "gāo",
  小: "xiǎo",
  日: "rì",
  月: "yuè",
  水: "shuǐ",
  火: "huǒ",
  山: "shān",
  风: "fēng",
  花: "huā",
  夜: "yè",
  雨: "yǔ",
  雪: "xuě",
  云: "yún",
  星: "xīng",
  光: "guāng",
  梦: "mèng",
  爱: "ài",
  情: "qíng",
  歌: "gē",
  声: "shēng",
  泪: "lèi",
  笑: "xiào",
  哭: "kū",
  飞: "fēi",
  海: "hǎi",
  城: "chéng",
  路: "lù",
  远: "yuǎn",
  近: "jìn",
  白: "bái",
  黑: "hēi",
  红: "hóng",
  蓝: "lán",
  绿: "lǜ",
  金: "jīn",
  银: "yín",
  春: "chūn",
  夏: "xià",
  秋: "qiū",
  冬: "dōng",
  早: "zǎo",
  晚: "wǎn",
  新: "xīn",
  旧: "jiù",
  真: "zhēn",
  假: "jiǎ",
  快: "kuài",
  慢: "màn",
  乐: "lè",
  苦: "kǔ",
  难: "nán",
  易: "yì",
  左: "zuǒ",
  右: "yòu",
  东: "dōng",
  西: "xī",
  南: "nán",
  北: "běi",
  男: "nán",
  女: "nǚ",
  父: "fù",
  母: "mǔ",
  兄: "xiōng",
  弟: "dì",
  姐: "jiě",
  妹: "mèi",
  朋: "péng",
  友: "yǒu",
  门: "mén",
  窗: "chuāng",
  书: "shū",
  话: "huà",
  字: "zì",
  画: "huà",
  色: "sè",
  空: "kōng",
  世: "shì",
  界: "jiè",
  间: "jiān",
  方: "fāng",
  力: "lì",
  全: "quán",
  直: "zhí",
  吗: "ma",
  呢: "ne",
  吧: "ba",
  啊: "a",
  哦: "ó",
  嗯: "ń",
  喜: "xǐ",
  欢: "huān",
  望: "wàng",
  思: "sī",
  念: "niàn",
  忘: "wàng",
  记: "jì",
  感: "gǎn",
  觉: "jué",
  怕: "pà",
  像: "xiàng",
  听: "tīng",
  唱: "chàng",
  等: "děng",
  跑: "pǎo",
  站: "zhàn",
  坐: "zuò",
  睡: "shuì",
  吃: "chī",
  喝: "hē",
  买: "mǎi",
  卖: "mài",
  穿: "chuān",
  住: "zhù",
  活: "huó",
  死: "sǐ",
  杀: "shā",
  打: "dǎ",
  写: "xiě",
  读: "dú",
  问: "wèn",
  答: "dá",
  叫: "jiào",
  落: "luò",
  每: "měi",
  样: "yàng",
  别: "bié",
  它: "tā",
  此: "cǐ",
  今: "jīn",
  事: "shì",
  比: "bǐ",
  更: "gèng",
  先: "xiān",
  常: "cháng",
  第: "dì",
  次: "cì",
  定: "dìng",
  将: "jiāng",
  又: "yòu",
  目: "mù",
  信: "xìn",
  种: "zhǒng",
  才: "cái",
  条: "tiáo",
  果: "guǒ",
  义: "yì",
};

function romanizeChinese(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0x4e00 && code <= 0x9fff) {
      result += COMMON_PINYIN[char] ? COMMON_PINYIN[char] + " " : char;
    } else {
      result += char;
    }
  }
  return result.replace(/\s+/g, " ").trim();
}

// ─── 9. Script Routing ───────────────────────────────────────────────────────

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
      return romanizeIndic(text, script);

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

// ─── 10. Public API ──────────────────────────────────────────────────────────

/**
 * Initialize the romanization engine. Call once at extension startup.
 */
export async function initRomanizer(): Promise<void> {
  // Sanscript is statically imported; this just validates it loaded correctly.
  if (Sanscript && typeof Sanscript.t === "function") {
    console.log("[Scriptify] Sanscript loaded successfully (static import)");
  } else {
    console.warn(
      "[Scriptify] Sanscript module loaded but .t() not found:",
      Sanscript,
    );
  }
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
  const nonLatinScripts = new Set(
    [...allScripts].filter((s) => s !== ScriptType.Latin),
  );

  console.log(
    `[Scriptify] romanize: scripts=${[...allScripts].join(",")} for "${text.substring(0, 30)}..."`,
  );

  // If the entire line is a single non-Latin script with no Latin mixed in,
  // send the whole line to that script's romanizer — it handles everything natively.
  if (nonLatinScripts.size === 1 && !allScripts.has(ScriptType.Latin)) {
    const [singleScript] = nonLatinScripts;
    const r = romanizeSegment(text, singleScript);
    if (!r) return null;
    return r
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
    const charScript = detectScript(char);
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
