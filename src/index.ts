import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { deriveFromMnemonic } from "./derive.js";
import { getNextBatch } from "./db.js";
import { checkSolanaBatch } from "./checkers/solana.js";
import { checkEthereumBatch } from "./checkers/ethereum.js";
import { checkTronBatch } from "./checkers/tron.js";
import { checkBitcoinBatch } from "./checkers/bitcoin.js";
import { config } from "./config.js";
import { sleep } from "./utils/rateLimiter.js";
import { sendTelegram } from "./notify.js";

const INCOMING = path.join(process.cwd(), "incoming");
const PROCESSED = path.join(process.cwd(), "processed");

if (!fs.existsSync(INCOMING)) fs.mkdirSync(INCOMING, { recursive: true });
if (!fs.existsSync(PROCESSED)) fs.mkdirSync(PROCESSED, { recursive: true });

console.log("Multi-chain balance checker started");
console.log("Drop large seed JSON files into the /incoming folder");

// ---------- Hot loading of huge JSON files ----------
async function processSeedFile(filePath: string) {
  console.log(`Processing new seed file: ${filePath}`);

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    let seeds: string[] = [];

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      seeds = parsed;
    } else if (parsed.seeds && Array.isArray(parsed.seeds)) {
      seeds = parsed.seeds;
    } else {
      console.error("Invalid JSON format. Expected array of strings or { seeds: [] }");
      return;
    }

    console.log(`Found ${seeds.length} seeds. Deriving addresses...`);

    let processed = 0;

    for (const mnemonic of seeds) {
      if (typeof mnemonic !== "string" || mnemonic.trim().split(/\s+/).length < 12) {
        continue;
      }

      try {
        // IMPORTANT: await because deriveFromMnemonic is now async
        await deriveFromMnemonic(mnemonic.trim());
        processed++;

        if (processed % 50 === 0) {
          console.log(`Derived ${processed}/${seeds.length}`);
        }
      } catch (err) {
        console.error("Derive error for one seed:", err);
      }
    }

    console.log(`Finished deriving ${processed} seeds from ${path.basename(filePath)}`);

    // Move file to processed
    const dest = path.join(PROCESSED, path.basename(filePath));
    fs.renameSync(filePath, dest);

    await sendTelegram(`✅ Imported ${processed} seeds from ${path.basename(filePath)}`);
  } catch (err: any) {
    console.error("Failed to process seed file:", err.message || err);
  }
}

// Watch for new files
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
    if (filePath.endsWith(".json")) {
      try {
        await processSeedFile(filePath);
      } catch (err) {
        console.error("Error while processing file:", err);
      }
    }
  });

// ---------- Main checker loop ----------
async function runCheckerCycle() {
  const chains = [
    { name: "solana", fn: checkSolanaBatch },
    { name: "ethereum", fn: checkEthereumBatch },
    { name: "tron", fn: checkTronBatch },
    { name: "bitcoin-legacy", fn: checkBitcoinBatch },
    { name: "bitcoin-segwit", fn: checkBitcoinBatch },
  ];

  for (const chain of chains) {
    console.log(`\n=== Checking ${chain.name} ===`);

    while (true) {
      const batch = getNextBatch(chain.name, 40);

      if (batch.length === 0) break;

      console.log(`Processing ${batch.length} ${chain.name} addresses...`);

      try {
        await chain.fn(batch);
      } catch (err) {
        console.error(`Error checking ${chain.name}:`, err);
        await sleep(config.sleepAfterErrorMs);
      }

      await sleep(config.sleepBetweenBatchesMs);
    }
  }
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