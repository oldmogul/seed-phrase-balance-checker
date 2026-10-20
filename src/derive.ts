import fs from "fs";
import path from "path";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Keypair } from "@solana/web3.js";
import { Wallet } from "ethers";
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { TronWeb } from "tronweb";
import { config } from "./config.js";
import { insertAddress } from "./db.js";
import { log } from "./utils/logger.js";

const ECPair = ECPairFactory(ecc);

const tronWeb = new TronWeb({
  fullHost: "https://api.trongrid.io",
});

const LOG_DIR = path.join(process.cwd(), "logs");
const DERIVATION_LOG = path.join(LOG_DIR, "derived-addresses.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logDerivedAddresses(
  seedHash: string,
  addresses: { chain: string; path: string; address: string }[]
) {
  const lines: string[] = [];
  lines.push("=".repeat(100));
  lines.push(`Seed Hash : ${seedHash}`);
  lines.push(`Time      : ${new Date().toISOString()}`);
  lines.push(`Total     : ${addresses.length} addresses`);
  lines.push("-".repeat(100));

  for (const item of addresses) {
    lines.push(
      `${item.chain.padEnd(20)} | ${item.path.padEnd(28)} | ${item.address}`
    );
  }
  lines.push("");
  fs.appendFileSync(DERIVATION_LOG, lines.join("\n"));
}

function seedHash(mnemonic: string): string {
  const seed = mnemonicToSeedSync(mnemonic);
  return bytesToHex(sha256(seed));
}

function getSolanaPaths(index: number): string[] {
  return [
    `m/44'/501'/${index}'/0'`,
    `m/44'/501'/${index}'`,
    `m/501'/${index}'/0'/0'`,
    `m/44'/501'/${index}'/0'/0'`,
  ];
}

function getEthereumPaths(index: number): string[] {
  return [
    `m/44'/60'/0'/0/${index}`,
    `m/44'/60'/0'/${index}`,
    `m/44'/60'/1'/0/${index}`,
  ];
}

function getTronPaths(index: number): string[] {
  return [
    `m/44'/195'/0'/0/${index}`,
    `m/44'/195'/${index}'/0/0`,
    `m/44'/195'/0'/${index}`,
  ];
}

function getBitcoinPaths(index: number): { path: string; type: string }[] {
  return [
    { path: `m/44'/0'/0'/0/${index}`, type: "bitcoin-legacy" },
    { path: `m/49'/0'/0'/0/${index}`, type: "bitcoin-nested" },
    { path: `m/84'/0'/0'/0/${index}`, type: "bitcoin-segwit" },
    { path: `m/86'/0'/0'/0/${index}`, type: "bitcoin-taproot" },
  ];
}

export async function deriveFromMnemonic(mnemonic: string): Promise<string> {
  const seed = mnemonicToSeedSync(mnemonic);
  const hash = seedHash(mnemonic);
  const master = HDKey.fromMasterSeed(seed);
  const accounts = config.accountsPerChain;

  const derived: { chain: string; path: string; address: string }[] = [];

  for (let i = 0; i < accounts; i++) {
    // Solana
    for (const solPath of getSolanaPaths(i)) {
      try {
        const node = master.derive(solPath);
        if (!node.privateKey) continue;

        const seedBytes = node.privateKey.slice(0, 32);
        const kp = await Keypair.fromSeed(seedBytes);
        const address = kp.publicKey.toBase58();

        insertAddress(hash, "solana", address, solPath);
        derived.push({ chain: "solana", path: solPath, address });
        log(`[DERIVE] ${hash.slice(0, 8)} | solana           | ${solPath.padEnd(26)} | ${address}`);
      } catch {}
    }

    // Ethereum
    for (const ethPath of getEthereumPaths(i)) {
      try {
        const node = master.derive(ethPath);
        if (!node.privateKey) continue;

        const privateKeyHex = "0x" + bytesToHex(node.privateKey);
        const wallet = new Wallet(privateKeyHex);

        insertAddress(hash, "ethereum", wallet.address, ethPath);
        derived.push({ chain: "ethereum", path: ethPath, address: wallet.address });
        log(`[DERIVE] ${hash.slice(0, 8)} | ethereum         | ${ethPath.padEnd(26)} | ${wallet.address}`);
      } catch {}
    }

    // Tron
    for (const tronPath of getTronPaths(i)) {
      try {
        const node = master.derive(tronPath);
        if (!node.privateKey) continue;

        const privHex = bytesToHex(node.privateKey);
        const addr = tronWeb.address.fromPrivateKey(privHex);
        if (!addr) continue;

        insertAddress(hash, "tron", addr, tronPath);
        derived.push({ chain: "tron", path: tronPath, address: addr });
        log(`[DERIVE] ${hash.slice(0, 8)} | tron             | ${tronPath.padEnd(26)} | ${addr}`);
      } catch {}
    }

    // Bitcoin
    for (const btc of getBitcoinPaths(i)) {
      try {
        const node = master.derive(btc.path);
        if (!node.privateKey) continue;

        const keyPair = ECPair.fromPrivateKey(Buffer.from(node.privateKey));
        let address: string | undefined;

        if (btc.type === "bitcoin-legacy") {
          address = bitcoin.payments.p2pkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).address;
        } else if (btc.type === "bitcoin-nested") {
          address = bitcoin.payments.p2sh({
            redeem: bitcoin.payments.p2wpkh({
              pubkey: keyPair.publicKey,
              network: bitcoin.networks.bitcoin,
            }),
            network: bitcoin.networks.bitcoin,
          }).address;
        } else if (btc.type === "bitcoin-segwit") {
          address = bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).address;
        } else if (btc.type === "bitcoin-taproot") {
          try {
            address = bitcoin.payments.p2tr({
              pubkey: keyPair.publicKey.slice(1, 33),
              network: bitcoin.networks.bitcoin,
            }).address;
          } catch {}
        }

        if (address) {
          insertAddress(hash, btc.type, address, btc.path);
          derived.push({ chain: btc.type, path: btc.path, address });
          log(`[DERIVE] ${hash.slice(0, 8)} | ${btc.type.padEnd(16)} | ${btc.path.padEnd(26)} | ${address}`);
        }
      } catch {}
    }
  }

  log(`[DERIVE] Finished seed ${hash.slice(0, 8)}... → ${derived.length} addresses`);
  logDerivedAddresses(hash, derived);

  return hash;
}