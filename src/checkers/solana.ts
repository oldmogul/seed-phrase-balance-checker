import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "../config.js";
import { respectRateLimit, sleep } from "../utils/rateLimiter.js";
import { updateBalance } from "../db.js";
import { sendTelegram } from "../notify.js";
import { RpcRotator } from "../utils/rpcRotator.js";
import { log } from "../utils/logger.js";
import { logBalanceFound } from "../utils/balanceLogger.js";

const rotator = new RpcRotator(config.solanaRpcs);

function getConnection() {
  const url = rotator.getNext();
  const connection = new Connection(url, "confirmed");
  return { connection, url };
}

export async function checkSolanaBatch(rows: any[]) {
  if (rows.length === 0) return;

  const batchSize = 15;

  for (let i = 0; i < rows.length; i += batchSize) {
    const sliceRows = rows.slice(i, i + batchSize);
    const pubkeys = sliceRows.map((r) => new PublicKey(r.address));
    const { connection, url } = getConnection();

    try {
      await respectRateLimit();
      const accounts = await connection.getMultipleAccountsInfo(pubkeys);
      rotator.reportSuccess(url);

      for (let j = 0; j < accounts.length; j++) {
        const acc = accounts[j];
        const row = sliceRows[j];
        const balance = acc ? Number(acc.lamports) / LAMPORTS_PER_SOL : 0;

        log(
          `[SCAN] solana           ${row.address} ${
            balance > 0 ? `BALANCE=${balance.toFixed(6)}` : ""
          }`
        );

        updateBalance(row.id, balance, balance > 0);

        if (balance > 0) {
          logBalanceFound("solana", row.address, balance, row.path);
          const msg = `🚨 <b>SOLANA HIT</b>\nAddress: <code>${row.address}</code>\nBalance: <b>${balance.toFixed(6)} SOL</b>\nPath: ${row.path}`;
          log(msg);
          await sendTelegram(msg);
        }
      }
    } catch (err: any) {
      const message = err?.message || String(err);
      if (message.includes("429") || message.includes("Too Many Requests")) {
        rotator.report429(url);
        log(`[429] solana switching away from ${url}`);
      } else {
        log(`Solana batch error: ${message}`);
      }
      await sleep(config.sleepAfterErrorMs);
    }

    await sleep(config.sleepBetweenBatchesMs);
  }
}