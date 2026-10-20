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

const ECPair = ECPairFactory(ecc);

// Create one TronWeb instance
const tronWeb = new TronWeb({
  fullHost: "https://api.trongrid.io",
});

function seedHash(mnemonic: string): string {
  const seed = mnemonicToSeedSync(mnemonic);
  return bytesToHex(sha256(seed));
}

export async function deriveFromMnemonic(mnemonic: string): Promise<string> {
  const seed = mnemonicToSeedSync(mnemonic);
  const hash = seedHash(mnemonic);
  const master = HDKey.fromMasterSeed(seed);

  const accounts = config.accountsPerChain;

  for (let i = 0; i < accounts; i++) {
    // ===== Solana (m/44'/501'/i'/0') =====
    try {
      const solPath = `m/44'/501'/${i}'/0'`;
      const solNode = master.derive(solPath);

      if (solNode.privateKey) {
        const seedBytes = solNode.privateKey.slice(0, 32);
        const kp = await Keypair.fromSeed(seedBytes);
        insertAddress(hash, "solana", kp.publicKey.toBase58(), solPath);
      }
    } catch (e) {
      console.error("Solana derive error:", e);
    }

    // ===== Ethereum (m/44'/60'/0'/0/i) =====
    try {
      const ethPath = `m/44'/60'/0'/0/${i}`;
      const ethNode = master.derive(ethPath);

      if (ethNode.privateKey) {
        const privateKeyHex = "0x" + bytesToHex(ethNode.privateKey);
        const wallet = new Wallet(privateKeyHex);
        insertAddress(hash, "ethereum", wallet.address, ethPath);
      }
    } catch (e) {
      console.error("Ethereum derive error:", e);
    }

    // ===== Tron (m/44'/195'/0'/0/i) =====
    try {
      const tronPath = `m/44'/195'/0'/0/${i}`;
      const tronNode = master.derive(tronPath);

      if (tronNode.privateKey) {
        const privHex = bytesToHex(tronNode.privateKey);
        const addr = tronWeb.address.fromPrivateKey(privHex);
        if (addr) {
          insertAddress(hash, "tron", addr, tronPath);
        }
      }
    } catch (e) {
      console.error("Tron derive error:", e);
    }

    // ===== Bitcoin Legacy (m/44'/0'/0'/0/i) =====
    try {
      const btcLegacyPath = `m/44'/0'/0'/0/${i}`;
      const node = master.derive(btcLegacyPath);

      if (node.privateKey) {
        const keyPair = ECPair.fromPrivateKey(Buffer.from(node.privateKey));
        const payment = bitcoin.payments.p2pkh({
          pubkey: keyPair.publicKey,
          network: bitcoin.networks.bitcoin,
        });

        if (payment.address) {
          insertAddress(hash, "bitcoin-legacy", payment.address, btcLegacyPath);
        }
      }
    } catch (e) {
      console.error("BTC Legacy error:", e);
    }

    // ===== Bitcoin Native SegWit (m/84'/0'/0'/0/i) =====
    try {
      const btcSegwitPath = `m/84'/0'/0'/0/${i}`;
      const node = master.derive(btcSegwitPath);

      if (node.privateKey) {
        const keyPair = ECPair.fromPrivateKey(Buffer.from(node.privateKey));
        const payment = bitcoin.payments.p2wpkh({
          pubkey: keyPair.publicKey,
          network: bitcoin.networks.bitcoin,
        });

        if (payment.address) {
          insertAddress(hash, "bitcoin-segwit", payment.address, btcSegwitPath);
        }
      }
    } catch (e) {
      console.error("BTC SegWit error:", e);
    }
  }

  return hash;
}