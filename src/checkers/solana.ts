import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "../config.js";
import { respectRateLimit, sleep } from "../utils/rateLimiter.js";
import { updateBalance } from "../db.js";
import { sendTelegram } from "../notify.js";

let rpcIndex = 0;

function getConnection() {
  const url = config.solanaRpcs[rpcIndex % config.solanaRpcs.length];
  rpcIndex++;
  return new Connection(url, "confirmed");
}

export async function checkSolanaBatch(rows: any[]) {
  if (rows.length === 0) return;

  const connection = getConnection();
  const pubkeys = rows.map((r) => new PublicKey(r.address));

  try {
    await respectRateLimit();

    // Solana supports up to 100 accounts per getMultipleAccounts
    const batchSize = 50;
    for (let i = 0; i < pubkeys.length; i += batchSize) {
      const slice = pubkeys.slice(i, i + batchSize);
      const sliceRows = rows.slice(i, i + batchSize);

      await respectRateLimit();
      const accounts = await connection.getMultipleAccountsInfo(slice);

      for (let j = 0; j < accounts.length; j++) {
        const acc = accounts[j];
        const row = sliceRows[j];
        const balance = acc ? Number(acc.lamports) / LAMPORTS_PER_SOL : 0;

        updateBalance(row.id, balance, balance > 0);

        if (balance > 0) {
          const msg = `🚨 <b>SOLANA HIT</b>\nAddress: <code>${row.address}</code>\nBalance: <b>${balance.toFixed(6)} SOL</b>\nPath: ${row.path}`;
          console.log(msg);
          await sendTelegram(msg);
        }
      }

      await sleep(config.sleepBetweenBatchesMs);
    }
  } catch (err: any) {
    console.error("Solana batch error:", err.message || err);
    await sleep(config.sleepAfterErrorMs);
  }
}