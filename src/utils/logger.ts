import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile() {
  return path.join(LOG_DIR, "checker.log");
}

function rotateIfNeeded() {
  const file = getLogFile();
  if (!fs.existsSync(file)) return;

  const stats = fs.statSync(file);
  if (stats.size < MAX_SIZE) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const newName = path.join(LOG_DIR, `checker-${timestamp}.log`);
  fs.renameSync(file, newName);
  console.log(`[Logger] Rotated log → ${newName}`);
}

export function log(message: string) {
  rotateIfNeeded();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(getLogFile(), line);
  console.log(message);
}