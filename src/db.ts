import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "checker.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seed_hash TEXT NOT NULL,
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    path TEXT NOT NULL,
    last_balance REAL DEFAULT 0,
    last_checked INTEGER DEFAULT 0,
    has_balance INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 0,
    UNIQUE(chain, address)
  );

  CREATE INDEX IF NOT EXISTS idx_priority ON addresses(priority DESC, last_checked ASC);
  CREATE INDEX IF NOT EXISTS idx_chain ON addresses(chain);
`);

export function insertAddress(
  seedHash: string,
  chain: string,
  address: string,
  path: string
) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO addresses (seed_hash, chain, address, path)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(seedHash, chain, address, path);
}

export function getNextBatch(chain: string, limit = 30) {
  return db
    .prepare(
      `
    SELECT id, address, path, last_balance, priority
    FROM addresses
    WHERE chain = ?
    ORDER BY priority DESC, last_checked ASC
    LIMIT ?
  `
    )
    .all(chain, limit) as any[];
}

export function updateBalance(
  id: number,
  balance: number,
  hasBalance: boolean
) {
  db.prepare(
    `
    UPDATE addresses
    SET last_balance = ?, has_balance = ?, last_checked = ?, priority = ?
    WHERE id = ?
  `
  ).run(
    balance,
    hasBalance ? 1 : 0,
    Date.now(),
    hasBalance ? 100 : 0,
    id
  );
}