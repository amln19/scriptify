/** Hindi Devanagari romanization: dictionaries, phonology, and parser. */

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
export function romanizeHindiDirect(text: string): string {
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
