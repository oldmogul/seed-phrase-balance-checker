import { wordlist } from "@scure/bip39/wordlists/english.js";
import { validateMnemonic } from "@scure/bip39";

const BIP39_SET = new Set(wordlist);
const VALID_LENGTHS = [12, 15, 18, 21, 24];

/**
 * Extract possible seed phrases from any text
 */
export function extractSeedPhrases(text: string): string[] {
  // Normalize text
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean);
  const found = new Set<string>();

  for (const len of VALID_LENGTHS) {
    for (let i = 0; i <= words.length - len; i++) {
      const candidate = words.slice(i, i + len);

      // All words must be in BIP39 wordlist
      if (candidate.every((w) => BIP39_SET.has(w))) {
        const phrase = candidate.join(" ");

        // Validate with wordlist (required in newer @scure/bip39)
        if (validateMnemonic(phrase, wordlist)) {
          found.add(phrase);
        } else {
          // Still keep possible candidates (some tools ignore checksum)
          found.add(phrase);
        }
      }
    }
  }

  return Array.from(found);
}