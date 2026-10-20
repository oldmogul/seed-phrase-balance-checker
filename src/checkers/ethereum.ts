import { ethers } from "ethers";
import { config } from "../config.js";
import { respectRateLimit, sleep } from "../utils/rateLimiter.js";
import { updateBalance } from "../db.js";
import { sendTelegram } from "../notify.js";

let rpcIndex = 0;

function getProvider() {
  const url = config.ethereumRpcs[rpcIndex % config.ethereumRpcs.length];
  rpcIndex++;
  return new ethers.JsonRpcProvider(url);
}

export async function checkEthereumBatch(rows: any[]) {
  if (rows.length === 0) return;

  const provider = getProvider();

  try {
    // Process in smaller batches because public RPCs are strict
    const batchSize = 15;

    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);

      await respectRateLimit();

      const promises = slice.map(async (row) => {
        try {
          const balanceWei = await provider.getBalance(row.address);
          const balance = Number(ethers.formatEther(balanceWei));
          return { row, balance };
        } catch {
          return { row, balance: 0 };
        }
      });

      const results = await Promise.all(promises);

      for (const { row, balance } of results) {
        updateBalance(row.id, balance, balance > 0);

        if (balance > 0) {
          const msg = `🚨 <b>ETHEREUM HIT</b>\nAddress: <code>${row.address}</code>\nBalance: <b>${balance.toFixed(6)} ETH</b>\nPath: ${row.path}`;
          console.log(msg);
          await sendTelegram(msg);
        }
      }

      await sleep(config.sleepBetweenBatchesMs);
    }
  } catch (err: any) {
    console.error("Ethereum batch error:", err.message || err);
    await sleep(config.sleepAfterErrorMs);
  }
}