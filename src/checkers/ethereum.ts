import { ethers } from "ethers";
import { config } from "../config.js";
import { respectRateLimit, sleep } from "../utils/rateLimiter.js";
import { updateBalance } from "../db.js";
import { sendTelegram } from "../notify.js";
import { RpcRotator } from "../utils/rpcRotator.js";

const rotator = new RpcRotator(config.ethereumRpcs);

function getProvider() {
  const url = rotator.getNext();
  const provider = new ethers.JsonRpcProvider(url, 1, {
    staticNetwork: true,
  });
  return { provider, url };
}

export async function checkEthereumBatch(rows: any[]) {
  if (rows.length === 0) return;

  const batchSize = 10; // keep small for free Ethereum RPCs

  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const { provider, url } = getProvider();

    try {
      await respectRateLimit();

      const results = await Promise.all(
        slice.map(async (row) => {
          try {
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

      rotator.reportSuccess(url);

      for (const { row, balance } of results) {
        updateBalance(row.id, balance, balance > 0);

        if (balance > 0) {
          const msg = `🚨 <b>ETHEREUM HIT</b>\nAddress: <code>${row.address}</code>\nBalance: <b>${balance.toFixed(6)} ETH</b>\nPath: ${row.path}`;
          console.log(msg);
          await sendTelegram(msg);
        }
      }
    } catch (err: any) {
      const message = err?.message || String(err);

      if (message.includes("429") || message.includes("Too Many Requests")) {
        rotator.report429(url);
        console.log(`[ethereum] 429 on ${url} → switching endpoint`);
      } else {
        console.error("Ethereum batch error:", message);
      }

      await sleep(config.sleepAfterErrorMs);
    }

    await sleep(config.sleepBetweenBatchesMs);
  }
}