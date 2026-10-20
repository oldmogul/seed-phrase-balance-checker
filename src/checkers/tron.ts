import { TronWeb } from "tronweb";
import { config } from "../config.js";
import { respectRateLimit, sleep } from "../utils/rateLimiter.js";
import { updateBalance } from "../db.js";
import { sendTelegram } from "../notify.js";
import { log } from "../utils/logger.js";
import { logBalanceFound } from "../utils/balanceLogger.js";

let hostIndex = 0;

function getTronWeb() {
  const fullHost =
    config.tronFullHosts[hostIndex % config.tronFullHosts.length];
  hostIndex++;
  return new TronWeb({ fullHost });
}

export async function checkTronBatch(rows: any[]) {
  if (rows.length === 0) return;

  const tronWeb = getTronWeb();
  const batchSize = 8;

  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);

    for (const row of slice) {
      await respectRateLimit();

      try {
        const account = await tronWeb.trx.getAccount(row.address);
        const balance = account.balance ? account.balance / 1_000_000 : 0;

        log(
          `[SCAN] tron             ${row.address} ${
            balance > 0 ? `BALANCE=${balance.toFixed(4)}` : ""
          }`
        );

        updateBalance(row.id, balance, balance > 0);

        if (balance > 0) {
          logBalanceFound("tron", row.address, balance, row.path);
          const msg = `🚨 <b>TRON HIT</b>\nAddress: <code>${row.address}</code>\nBalance: <b>${balance.toFixed(4)} TRX</b>\nPath: ${row.path}`;
          log(msg);
          await sendTelegram(msg);
        }
      } catch {
        updateBalance(row.id, 0, false);
        log(`[SCAN] tron             ${row.address} (no account)`);
      }
    }

    await sleep(config.sleepBetweenBatchesMs);
  }
}