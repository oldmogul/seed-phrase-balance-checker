import dotenv from "dotenv";
dotenv.config();

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  accountsPerChain: Number(process.env.ACCOUNTS_PER_CHAIN || 3),

  maxRequestsPerMinute: Number(process.env.MAX_REQUESTS_PER_MINUTE || 20),
  sleepBetweenBatchesMs: Number(process.env.SLEEP_BETWEEN_BATCHES_MS || 12000),
  sleepAfterErrorMs: Number(process.env.SLEEP_AFTER_ERROR_MS || 30000),
  sleepAfterFullCycleMs: Number(process.env.SLEEP_AFTER_FULL_CYCLE_MS || 600000),

  // Free public endpoints (rotate)
  solanaRpcs: [
    "https://api.mainnet-beta.solana.com",
    "https://solana-mainnet.g.alchemy.com/v2/demo",
    // add more free ones
  ],
  ethereumRpcs: [
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://ethereum.publicnode.com",
  ],
  tronFullHosts: [
    "https://api.trongrid.io",
    "https://api.tronstack.io",
  ],
};