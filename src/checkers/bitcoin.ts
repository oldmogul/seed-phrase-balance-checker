import { config } from "../config.js";
import { respectRateLimit, sleep } from "../utils/rateLimiter.js";
import { updateBalance } from "../db.js";
import { sendTelegram } from "../notify.js";
import { log } from "../utils/logger.js";
import { logBalanceFound } from "../utils/balanceLogger.js";

async function getBtcBalance(address: string): Promise<number> {
  try {
    await respectRateLimit();
    const res = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!res.ok) return 0;
    const data = await res.json();
    const funded = data.chain_stats?.funded_txo_sum || 0;
    const spent = data.chain_stats?.spent_txo_sum || 0;
    return (funded - spent) / 1e8;
  } catch {
    return 0;
  }
}

export async function checkBitcoinBatch(rows: any[]) {
  if (rows.length === 0) return;

  for (const row of rows) {
    const balance = await getBtcBalance(row.address);

    log(
      `[SCAN] bitcoin          ${row.address} ${
        balance > 0 ? `BALANCE=${balance.toFixed(8)}` : ""
      }`
    );

    updateBalance(row.id, balance, balance > 0);

    if (balance > 0) {
      logBalanceFound("bitcoin", row.address, balance, row.path);
      const msg = `🚨 <b>BITCOIN HIT</b>\nAddress: <code>${row.address}</code>\nBalance: <b>${balance.toFixed(8)} BTC</b>\nPath: ${row.path}`;
      log(msg);
      await sendTelegram(msg);
    }

    await sleep(config.sleepBetweenBatchesMs);
  }
}