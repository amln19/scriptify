/** Japanese kana-to-romaji romanizer. */

// ─── 6. Japanese ─────────────────────────────────────────────────────────────

const HIRAGANA_MAP: Record<string, string> = {
  ぁ: "a",
  あ: "a",
  ぃ: "i",
  い: "i",
  ぅ: "u",
  う: "u",
  ぇ: "e",
  え: "e",
  ぉ: "o",
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
  // Modern loanword combinations
  うぃ: "wi",
  うぇ: "we",
  うぉ: "wo",
  しぇ: "she",
  じぇ: "je",
  ちぇ: "che",
  てぃ: "ti",
  でぃ: "di",
  とぅ: "tu",
  どぅ: "du",
  つぁ: "tsa",
  つぃ: "tsi",
  つぇ: "tse",
  つぉ: "tso",
  ふぁ: "fa",
  ふぃ: "fi",
  ふぇ: "fe",
  ふぉ: "fo",
  ゔ: "vu",
  ゔぁ: "va",
  ゔぃ: "vi",
  ゔぇ: "ve",
  ゔぉ: "vo",
  っ: "", // Double consonant marker (handled in context)
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
KATAKANA_MAP["ヴ"] = "vu";

function getLastRomanizedVowel(text: string): string {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i].toLowerCase();
    if (ch === "a" || ch === "e" || ch === "i" || ch === "o" || ch === "u") {
      return ch;
    }
    if (/[a-z]/i.test(ch)) return "";
  }
  return "";
}

export function romanizeJapanese(text: string): string {
  const combined = { ...HIRAGANA_MAP, ...KATAKANA_MAP };
  let result = "";
  let i = 0;
  const chars = Array.from(text);

  while (i < chars.length) {
    // Prolonged sound mark: repeat the preceding romanized vowel rather than
    // emitting punctuation (スーパー → suupaa).
    if (chars[i] === "ー") {
      result += getLastRomanizedVowel(result);
      i++;
      continue;
    }

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
