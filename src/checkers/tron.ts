import { TronWeb } from "tronweb";   // ← MUST be named import
import { config } from "../config.js";
import { respectRateLimit, sleep } from "../utils/rateLimiter.js";
import { updateBalance } from "../db.js";
import { sendTelegram } from "../notify.js";

let hostIndex = 0;

function getTronWeb() {
  const fullHost = config.tronFullHosts[hostIndex % config.tronFullHosts.length];
  hostIndex++;
  return new TronWeb({ fullHost });
}

export async function checkTronBatch(rows: any[]) {
  if (rows.length === 0) return;

  const tronWeb = getTronWeb();

  try {
    const batchSize = 10;

    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);

      for (const row of slice) {
        await respectRateLimit();

        try {
          const account = await tronWeb.trx.getAccount(row.address);
          const balance = account.balance ? account.balance / 1_000_000 : 0; // SUN → TRX

          updateBalance(row.id, balance, balance > 0);

          if (balance > 0) {
            const msg = `🚨 <b>TRON HIT</b>\nAddress: <code>${row.address}</code>\nBalance: <b>${balance.toFixed(4)} TRX</b>\nPath: ${row.path}`;
            console.log(msg);
            await sendTelegram(msg);
          }
        } catch (err: any) {
          // Account does not exist → balance 0
          updateBalance(row.id, 0, false);
        }
      }

      await sleep(config.sleepBetweenBatchesMs);
    }
  } catch (err: any) {
    console.error("Tron batch error:", err.message || err);
    await sleep(config.sleepAfterErrorMs);
  }
}