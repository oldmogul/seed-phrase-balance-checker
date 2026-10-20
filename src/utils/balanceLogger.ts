import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const BALANCE_FILE = path.join(LOG_DIR, "balances-found.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function logBalanceFound(
  chain: string,
  address: string,
  balance: number,
  path: string,
  seedHash?: string
) {
  const line = [
    new Date().toISOString(),
    chain.padEnd(16),
    address,
    balance.toString(),
    path,
    seedHash || "-",
  ].join(" | ") + "\n";

  fs.appendFileSync(BALANCE_FILE, line);
}