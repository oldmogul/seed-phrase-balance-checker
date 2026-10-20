import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import * as pdfParseModule from "pdf-parse";
import { deriveFromMnemonic } from "./derive.js";
import { getNextBatch } from "./db.js";
import { checkSolanaBatch } from "./checkers/solana.js";
import { checkEthereumBatch } from "./checkers/ethereum.js";
import { checkTronBatch } from "./checkers/tron.js";
import { checkBitcoinBatch } from "./checkers/bitcoin.js";
import { config } from "./config.js";
import { sleep } from "./utils/rateLimiter.js";
import { sendTelegram } from "./notify.js";
import { extractSeedPhrases } from "./utils/seedExtractor.js";

// Fix for pdf-parse TypeScript import issue
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

const INCOMING = path.join(process.cwd(), "incoming");
const PROCESSED = path.join(process.cwd(), "processed");

if (!fs.existsSync(INCOMING)) fs.mkdirSync(INCOMING, { recursive: true });
if (!fs.existsSync(PROCESSED)) fs.mkdirSync(PROCESSED, { recursive: true });

console.log("Multi-chain balance checker started");
console.log("Drop JSON / PDF / TXT / CSV files into the /incoming folder");

// ---------- Process any file and auto-detect seed phrases ----------
async function processSeedFile(filePath: string) {
  console.log(`\nProcessing file: ${filePath}`);

  try {
    const ext = path.extname(filePath).toLowerCase();
    let textContent = "";

    // ===== Read file content based on type =====
    if (ext === ".json") {
      const raw = fs.readFileSync(filePath, "utf8");
      try {
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          textContent = parsed.join("\n");
        } else if (parsed.seeds && Array.isArray(parsed.seeds)) {
          textContent = parsed.seeds.join("\n");
        } else {
          textContent = raw;
        }
      } catch {
        textContent = raw;
      }
    } else if (ext === ".pdf") {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      textContent = pdfData?.text || "";
    } else {
      // .txt, .csv, .md, .log, or any other text file
      textContent = fs.readFileSync(filePath, "utf8");
    }

    // ===== Extract seed phrases from the text =====
    const seeds = extractSeedPhrases(textContent);

    if (seeds.length === 0) {
      console.log(`No valid seed phrases found in ${path.basename(filePath)}`);
      const dest = path.join(PROCESSED, path.basename(filePath));
      fs.renameSync(filePath, dest);
      return;
    }

    console.log(`Found ${seeds.length} seed phrase(s). Deriving addresses...`);

    let processed = 0;

    for (const mnemonic of seeds) {
      try {
        await deriveFromMnemonic(mnemonic);
        processed++;

        if (processed % 20 === 0 || processed === seeds.length) {
          console.log(`Derived ${processed}/${seeds.length}`);
        }
      } catch (err) {
        console.error("Derive error for one seed:", err);
      }
    }

    console.log(
      `Finished deriving ${processed} seeds from ${path.basename(filePath)}`
    );

    // Move file to processed
    const dest = path.join(PROCESSED, path.basename(filePath));
    fs.renameSync(filePath, dest);

    await sendTelegram(
      `✅ Processed <b>${path.basename(filePath)}</b>\nFound & derived: <b>${processed}</b> seed(s)`
    );
  } catch (err: any) {
    console.error("Failed to process file:", err.message || err);
  }
}

// ---------- Watch for new files ----------
const allowedExtensions = [".json", ".pdf", ".txt", ".csv", ".md", ".log"];

chokidar
  .watch(INCOMING, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  })
  .on("add", async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();

    if (allowedExtensions.includes(ext)) {
      try {
        await processSeedFile(filePath);
      } catch (err) {
        console.error("Error while processing file:", err);
      }
    }
  });

// ---------- Main checker loop (PARALLEL) ----------
async function runCheckerCycle() {
  const chains = [
    { name: "solana", fn: checkSolanaBatch },
    { name: "ethereum", fn: checkEthereumBatch },
    { name: "tron", fn: checkTronBatch },
    { name: "bitcoin-legacy", fn: checkBitcoinBatch },
    { name: "bitcoin-segwit", fn: checkBitcoinBatch },
  ];

  console.log("\n=== Starting parallel chain workers ===");

  // Run all chains at the same time
  await Promise.all(
    chains.map(async (chain) => {
      console.log(`[${chain.name}] worker started`);

      while (true) {
        const batch = getNextBatch(chain.name, 40);

        if (batch.length === 0) {
          console.log(`[${chain.name}] no more addresses in this cycle`);
          break;
        }

        console.log(`[${chain.name}] processing ${batch.length} addresses`);

        try {
          await chain.fn(batch); // already uses batching inside
        } catch (err) {
          console.error(`[${chain.name}] error:`, err);
          await sleep(config.sleepAfterErrorMs);
        }

        // Respect rate limits between batches
        await sleep(config.sleepBetweenBatchesMs);
      }

      console.log(`[${chain.name}] worker finished this cycle`);
    })
  );
}

async function main() {
  try {
    await sendTelegram("🚀 Multi-chain balance checker started");
  } catch (err) {
    console.log("Telegram notification failed (continuing anyway)");
  }

  while (true) {
    try {
      console.log("\n----- Starting full cycle -----");
      await runCheckerCycle();
      console.log("Full cycle finished. Sleeping before next cycle...");
      await sleep(config.sleepAfterFullCycleMs);
    } catch (err: any) {
      console.error("Main loop error:", err);
      await sleep(config.sleepAfterErrorMs);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error in main:", err);
  process.exit(1);
});