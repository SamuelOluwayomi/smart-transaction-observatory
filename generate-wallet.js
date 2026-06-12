/* eslint-disable @typescript-eslint/no-require-imports */

const { Keypair } = require("@solana/web3.js");
const fs = require("fs");

const keypair = Keypair.generate();
const secret = JSON.stringify(Array.from(keypair.secretKey));

fs.writeFileSync("bounty-wallet.json", secret);

console.log("=================================");
console.log("Public Key:", keypair.publicKey.toString());
console.log("Private Key (for .env):", secret);
console.log("=================================");
console.log("Saved to bounty-wallet.json");
