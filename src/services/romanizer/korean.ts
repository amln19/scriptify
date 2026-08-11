/** Korean Hangul romanizer with liaison and palatalization handling. */

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

interface KoreanSyllable {
  initial: number;
  medial: number;
  final: number;
  initialOverride?: string;
}

type KoreanToken = KoreanSyllable | string;

function isKoreanSyllable(token: KoreanToken): token is KoreanSyllable {
  return typeof token !== "string";
}

/**
 * Return the onset sound when a final consonant is followed by a vowel-initial
 * syllable. This covers the common liaison cases while leaving complex final
 * clusters conservative rather than inventing an incorrect reading.
 */
function getKoreanLiaisonInitial(final: number, medial: number): string | null {
  switch (final) {
    case 1: // ㄱ
      return "g";
    case 2: // ㄲ
      return "kk";
    case 4: // ㄴ
      return "n";
    case 7: // ㄷ
      return medial === 20 ? "j" : "d";
    case 8: // ㄹ
      return "r";
    case 16: // ㅁ
      return "m";
    case 17: // ㅂ
      return "b";
    case 19: // ㅅ
      return "s";
    case 20: // ㅆ
      return "ss";
    case 21: // ㅇ
      return "ng";
    case 22: // ㅈ
      return "j";
    case 23: // ㅊ
      return "ch";
    case 24: // ㅋ
      return "k";
    case 25: // ㅌ
      return medial === 20 ? "ch" : "t";
    case 26: // ㅍ
      return "p";
    case 27: // ㅎ is silent before a vowel in common forms (좋아 → joa)
      return "";
    default:
      return null;
  }
}

export function romanizeKorean(text: string): string {
  const tokens: KoreanToken[] = [];

  // Canonically decomposed Hangul Jamo composes into the same syllables as NFC
  // input. Without this, equivalent NFD lyrics were detected as Korean but
  // passed through untouched.
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const offset = code - 0xac00;
      tokens.push({
        initial: Math.floor(offset / (21 * 28)),
        medial: Math.floor((offset % (21 * 28)) / 28),
        final: offset % 28,
      });
    } else {
      tokens.push(char);
    }
  }

  // A final consonant before a vowel-initial syllable is realized as that next
  // syllable's onset. Handle this before rendering so 한국어, 같이, and 먹어요
  // become Hangugeo, Gachi, and Meogeoyo.
  for (let i = 0; i + 1 < tokens.length; i++) {
    const current = tokens[i];
    const next = tokens[i + 1];
    if (
      !isKoreanSyllable(current) ||
      !isKoreanSyllable(next) ||
      current.final === 0 ||
      next.initial !== 11 // silent ㅇ
    ) {
      continue;
    }
    const liaison = getKoreanLiaisonInitial(current.final, next.medial);
    if (liaison === null) continue;
    current.final = 0;
    next.initialOverride = liaison;
  }

  return tokens
    .map((token) => {
      if (!isKoreanSyllable(token)) return token;
      return (
        (token.initialOverride ?? KOREAN_INITIALS[token.initial]) +
        KOREAN_MEDIALS[token.medial] +
        KOREAN_FINALS[token.final]
      );
    })
    .join("");
}
