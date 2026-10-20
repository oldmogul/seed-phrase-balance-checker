import { config } from "../config.js";

let requestCount = 0;
let windowStart = Date.now();

export async function respectRateLimit() {
  const now = Date.now();

  // Reset window every 60 seconds
  if (now - windowStart > 60_000) {
    requestCount = 0;
    windowStart = now;
  }

  if (requestCount >= config.maxRequestsPerMinute) {
    const wait = 60_000 - (now - windowStart) + 1000;
    console.log(`Rate limit reached. Sleeping ${Math.round(wait / 1000)}s...`);
    await sleep(wait);
    requestCount = 0;
    windowStart = Date.now();
  }

  requestCount++;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}