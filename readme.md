# Multi-Chain Seed Phrase Balance Checker

Long-running TypeScript script that:

- Accepts seed phrases from JSON, PDF, TXT, CSV files
- Derives addresses for **Solana, Tron, Ethereum, Bitcoin (Legacy + SegWit)**
- Checks balances using free public endpoints
- Runs forever on a VPS
- Uses **batching** + **parallel chain workers**
- Sends Telegram notification only when a balance is found

## Features

- Hot-loading of new seed files while the script is running
- Auto-detection of BIP39 seed phrases from many file formats
- Parallel checking of different blockchains
- Request batching (especially Solana & Ethereum)
- Strict rate limiting / sleeps to stay on free plans
- SQLite for progress tracking
- Telegram alerts

## Project Structure
