import { ethers } from "ethers";
import { config } from "../config.js";
import { respectRateLimit, sleep } from "../utils/rateLimiter.js";
import { updateBalance } from "../db.js";
import { sendTelegram } from "../notify.js";

let rpcIndex = 0;

function getProvider() {
  const url = config.ethereumRpcs[rpcIndex % config.ethereumRpcs.length];
  rpcIndex++;

  // staticNetwork: true → prevents endless "failed to detect network" retries
  return new ethers.JsonRpcProvider(url, 1, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
}

export async function checkEthereumBatch(rows: any[]) {
  if (rows.length === 0) return;

  const batchSize = 10; // keep small for free RPCs

  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const provider = getProvider();

    try {
      await respectRateLimit();

      const results = await Promise.all(
        slice.map(async (row) => {
          try {
            // Add a timeout so it can't hang forever
            const balanceWei = await Promise.race([
              provider.getBalance(row.address),
              sleep(8000).then(() => {
                throw new Error("RPC timeout");
              }),
            ]);

            const balance = Number(ethers.formatEther(balanceWei as bigint));
            return { row, balance };
          } catch {
            return { row, balance: 0 };
          }
        })
      );

      for (const { row, balance } of results) {
        updateBalance(row.id, balance, balance > 0);

        if (balance > 0) {
          const msg = `🚨 <b>ETHEREUM HIT</b>\nAddress: <code>${row.address}</code>\nBalance: <b>${balance.toFixed(6)} ETH</b>\nPath: ${row.path}`;
          console.log(msg);
          await sendTelegram(msg);
        }
      }
    } catch (err: any) {
      console.error("Ethereum batch error:", err.message || err);
      await sleep(config.sleepAfterErrorMs);
    }

    // Always sleep between batches
    await sleep(config.sleepBetweenBatchesMs);
  }
}