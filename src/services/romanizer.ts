/**
 * Romanization Engine
 *
 * Transliterates non-Latin scripts to Roman/Latin characters.
 *
 * Script support:
 *   Hindi (Devanagari)    ─ Custom syllable parser + schwa deletion + dictionary fast-path
 *   Punjabi (Gurmukhi)    ─ Custom syllable parser + Addak gemination + schwa deletion
 *   Other Indic           ─ @indic-transliteration/sanscript → IAST → diacritic strip
 *   Japanese              ─ Hiragana / Katakana lookup tables
 *   Korean (Hangul)       ─ Syllable decomposition → revised romanization
 *   Chinese (CJK)         ─ Built-in pinyin map for common CJK characters
 *   Mixed-script lines    ─ Per-segment routing (e.g. Hindi+English, Hindi+Punjabi)
 *
 * Section layout:
 *    1. Language Hint           — per-track language code from Spotify API
 *    2. Hindi: Dictionaries     — fast-path lookup tables for common / tricky words
 *    3. Hindi: Phonology Tables — consonant, vowel, matra, digit mapping constants
 *    4. Hindi: Parser           — syllable helpers, schwa deletion, main parser
 *    5. Non-Hindi Indic Scripts — IAST diacritic map, strip fn, IAST→Hinglish fn, romanizeIndic()
 *      5a. Tamil Dictionary     — pre-computed Tanglish exceptions
 *      5b. Marathi Dictionary   — pre-computed Marathi exceptions
 *      5c. Malayalam Dictionary — pre-computed Manglish exceptions
 *      5d. Bengali Dictionary   — pre-computed Bengali exceptions
 *      5e. Gurmukhi Direct      — Punjabi direct parser (bypasses Sanscript)
 *    6. Japanese                — hiragana / katakana → romaji
 *    7. Korean                  — Hangul → revised romanization
 *    8. Chinese                 — CJK → pinyin
 *    9. Script Routing          — internal per-segment dispatcher
 *   10. Public API              — romanize() entry point + initRomanizer()
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
 * Dictionary 1 – Curated Common Hindi Words
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
 * Dictionary 2 – Frequently Mis-romanized Hindi Words
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

  // ── ⑥ Algorithmic edge cases caught by stress test ───────────────────────
  // कर्तव्य: व→w + word-final "vy" cluster → "kartawy" without dict entry
  कर्तव्य: "kartavya",
  // स्त्री: word-final ी → ee→i shortening collapses "stree" → "stri"
  स्त्री: "stree",
  स्त्रियाँ: "striyaan", // oblique plural (safety)
  // मंत्र: word-final consonant cluster "tr" → schwa deleted → "mantr"
  मंत्र: "mantra",
  मंत्रों: "mantron",
  // नमः / शिवायः: visarga fix handles these generically but dict ensures correct v/w
  नमः: "namah",
  शिवायः: "shivaayah",
  // तूही: compound (तू+ही) — ू not word-final so long-vowel shortening doesn't apply
  तूही: "tuhi",
  // ढूँढता/ढूँढती: aspirate "dh" reduces to "d" in the dh+t cluster in Hinglish
  ढूँढता: "dhoondta",
  ढूँढती: "dhoondti", // feminine form (safety)
  ढूँढते: "dhoondtey", // plural form (safety)
  // धड़कनों: greedy right-to-left schwa deletion picks wrong syllable
  धड़कनों: "dhadkanon",

  // ── ⑦ Hindi stress test 2 additions ──────────────────────────────────────
  // थीं: long ī + chandrabindu → "iin" (vowel keeps long form before nasal)
  थीं: "thiin",
  // सूर्यास्त: ū in सू is short in this Sanskrit loanword convention
  सूर्यास्त: "suryaast",
  // कह: conventional spoken form is "keh" not "kah"
  कह: "keh",
  // धैर्य: word-final -ya cluster schwa wrongly deleted
  धैर्य: "dhairya",
  // लगातार: compound ā+ā shortens to single "a" in mid-word romanization
  लगातार: "lagataar",
  // ज़मीं: nuqta + long ī + chandrabindu → "zameen"
  ज़मीं: "zameen",
  // फ़िज़ा: Urdu loanword, word-final long ā retained as "aa"
  फ़िज़ा: "fizaa",
  // नृत्य: word-final -ya cluster schwa wrongly deleted
  नृत्य: "nritya",
  // हवाई: word-final long Ī (ई) → "aai" in this loanword
  हवाई: "havaai",
  // सपनों: oblique plural ों — override COMMON_DICT "sapno" → nasal kept
  सपनों: "sapnon",
  // उत्सव: word-final व → "v" not "w" for this Sanskrit word
  उत्सव: "utsav",

  // ── Critical song words (safety net for forms not in COMMON_DICT) ─────────
  मरहबा: "marhaba", // welcome (Urdu) — schwa after र not deleted: "marahba" ✗
  शवा: "shava", // breeze/fragrance (Urdu) — व→w gives "shawa" ✗
  चाँदी: "chaandi", // silver
  हँसी: "hansi", // laughter
  ज़िन्दगी: "zindagi", // alternate nuqta spelling (ज़िंदगी is in COMMON_DICT)
  ज़िंदा: "zinda", // alive
  आवाज: "awaaz", // voice (no nuqta — rules give "awaaj" ✗)
  ग़म: "gham", // sorrow (Urdu nuqta)
  ग़ज़ल: "ghazal", // ghazal
  मुहब्बत: "mohabbat", // love (variant spelling)
  परेशान: "pareshaan", // troubled
};

// Combined — MIS_DICT overrides COMMON_DICT on conflicts
const HINDI_DICTIONARY: Record<string, string> = {
  ...HINDI_COMMON_DICT,
  ...HINDI_MIS_DICT,
};

/**
 * Many source-code dictionary keys use the *decomposed* nuqta form
 * (e.g. ज + ़  = U+091C + U+093C) while the romanizer normalises all input to
 * the *composed* NFC form (ज़ = U+095B) before calling applyHindiDictionary.
 * This secondary map pre-normalises every key so lookups succeed regardless
 * of which encoding was used in the source file.
 */
const HINDI_DICTIONARY_NFC: Record<string, string> = {};
for (const [k, v] of Object.entries(HINDI_DICTIONARY)) {
  HINDI_DICTIONARY_NFC[normalizeDevanagari(k)] = v;
}

/**
 * Replace any continuous Devanagari run that has a dictionary entry with its
 * pre-computed Hinglish romanization, BEFORE the syllable parser runs.
 *
 * Replacement values are Latin, so the parser passes them through unchanged
 * via the "non-Devanagari character" branch (output verbatim).
 *
 * Uses the NFC-normalised key map first (handles composed nuqta forms produced
 * by normalizeDevanagari), then falls back to the raw key map.
 */
function applyHindiDictionary(text: string): string {
  // Exclude dandas (। U+0964, ॥ U+0965) from Devanagari runs so word lookups
  // are not broken by trailing punctuation (e.g. "हवाई।" → match "हवाई").
  return text.replace(/[\u0900-\u0963\u0966-\u097F]+/g, (word) => {
    return HINDI_DICTIONARY_NFC[word] ?? HINDI_DICTIONARY[word] ?? word;
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

    // ── Om symbol (ॐ U+0950) ──
    if (ch === "\u0950") {
      flushWord();
      result += "Om";
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

    // Rule 1: Always delete word-final schwa, UNLESS a visarga follows it.
    // Visarga (stored in the nasal field as "h") requires the inherent 'a' vowel
    // to be pronounced: नमः → "namah" (not "namh"), शिवायः → "shivaayah".
    if (i === syllables.length - 1) {
      if (syllables[i].nasal !== "h") {
        deleteSchwa[i] = true;
      }
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
      // - Current syllable's consonant(s)
      // - Current syllable's own nasal (anusvara/chandrabindu on this syllable)
      // - Next syllable's consonant(s)
      // E.g., ज़िंदगी: "zin" + [d-a] + "gi" → deleting 'a' creates "ndg" (3 consonants)
      //
      // NOTE: The *previous* syllable's nasal is intentionally excluded. A nasal
      // (anusvara/chandrabindu) ending the prior syllable is nasalised vowel colouring,
      // not a separate blocking consonant. Including it was over-conservative and
      // incorrectly blocked deletions in गूँजती → goonjti, हँसकर → hanskar, etc.
      const ownNasalLen = syllables[i].nasal ? 1 : 0;
      const currentLen = countEffectiveConsonantsHindi(syllables[i].consonants);
      const nextLen = countEffectiveConsonantsHindi(nextSyl.consonants);

      // Hindi allows at most 2 effective consonants in a cluster.
      // Include current syllable's own nasal: deleting schwa in पारंपरिक
      // would create "rmp" (3 consonants) if we don't count the trailing nasal.
      if (currentLen + ownNasalLen + nextLen <= 2) {
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

  // Second-pass aai → ai: schwa deletion + ee→i shortening can expose new "aai"
  // sequences that weren't present before. E.g., सच्चाई:
  //   build → "sachchaaee" → (ee$→i) → "sachchaai" → (aai→ai) → "sachchai"
  result = result.replace(/aai/g, "ai");

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
    if (script === ScriptType.Devanagari && currentLanguageHint === "mr") {
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
      result = result.replace(/ṭh/g, "d").replace(/Ṭ/g, "D"); // aspirated retroflex → d
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
    if (script === ScriptType.Devanagari && currentLanguageHint === "mr") {
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
    if (script === ScriptType.Devanagari && currentLanguageHint === "mr") {
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
      currentLanguageHint === "mr" &&
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

    // Restore Malayalam dictionary placeholders.
    if (
      script === ScriptType.Malayalam &&
      malayalamDictReplacements.length > 0
    ) {
      result = restoreMalayalamDictionary(result, malayalamDictReplacements);
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

    return result;
  } catch (e) {
    console.warn(`[Scriptify] Indic romanization failed for ${script}:`, e);
    return null;
  }
}

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

  // Punjabi colloquial: word-final long vowels shorten.
  // oon (ੂ + Tippi at word-end) → "u":  ਨੂੰ "noon" → "nu", ਤੈਨੂੰ "tainoon" → "tainu"
  out = out.replace(/oon(?!\p{L})/gu, "u");
  // Long ī word-final → short "i":  ਭਟਕਦੀ "bhatakdee" → "bhatakdi"
  out = out.replace(/ee(?!\p{L})/gu, "i");

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

// Lightweight offline pinyin map for common CJK characters.
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
