import { wordlist } from "@scure/bip39/wordlists/english.js";
import { validateMnemonic } from "@scure/bip39";

const BIP39_SET = new Set(wordlist);
const VALID_LENGTHS = [12, 15, 18, 21, 24];

/**
 * Extract only valid BIP39 seed phrases (with correct checksum)
 * and avoid overlapping matches.
 */
export function extractSeedPhrases(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean);
  const found: string[] = [];
  let i = 0;

  while (i < words.length) {
    let matched = false;

    // Prefer longer phrases first
    for (const len of [...VALID_LENGTHS].reverse()) {
      if (i + len > words.length) continue;

      const candidate = words.slice(i, i + len);
      if (!candidate.every((w) => BIP39_SET.has(w))) continue;

      const phrase = candidate.join(" ");

      // ONLY accept phrases with valid checksum
      if (validateMnemonic(phrase, wordlist)) {
        found.push(phrase);
        i += len; // skip these words so we don't create overlaps
        matched = true;
        break;
      }
    }

    if (!matched) i++;
  }

  return found;
}