// STEP 1 of the WICK MODS II airdrop: close the v1 mint.
//
// This must happen BEFORE the snapshot. While v1 is open a holder can claim
// between the snapshot and the airdrop and get paid twice — once from v1's
// remaining supply, once from v2. Closing freezes the entitlement.
//
// Reversible: setMintOpen(true) puts it back.
//   PRIVATE_KEY=0x... node close-mods-mint.mjs
import { createRequire } from "module";
const ethers = createRequire(import.meta.url)("ethers");

const PK = process.env.PRIVATE_KEY;
if (!PK) { console.error("Set PRIVATE_KEY (the contract owner wallet)."); process.exit(1); }

const MODS = "0x004E6610ff47c6A6510DA446257822B37D26CD73";
const RPC = (process.env.RPC_URL || "https://rpc.pulsechain.com").trim();
const CHAIN = new ethers.Network("pulsechain", 369);
const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { staticNetwork: CHAIN });
const wallet = new ethers.Wallet(PK, provider);

const mods = new ethers.Contract(MODS, [
  "function owner() view returns (address)",
  "function mintOpen() view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function setMintOpen(bool)",
], wallet);

const [owner, open, ts, max] = await Promise.all([mods.owner(), mods.mintOpen(), mods.totalSupply(), mods.MAX_SUPPLY()]);
console.log("wallet   :", wallet.address);
console.log("owner    :", owner);
if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
  console.error("\n✗ that wallet does not own WickMods — nothing done."); process.exit(1);
}
console.log("mintOpen :", open);
console.log("supply   :", ts.toString(), "/", max.toString(), "→", (max - ts).toString(), "undrawn");

if (!open) { console.log("\nalready closed — nothing to do."); process.exit(0); }

console.log("\nclosing…");
const tx = await mods.setMintOpen(false);
console.log("  tx:", tx.hash);
await tx.wait();
console.log("  mintOpen now:", await mods.mintOpen());
console.log("\n✅ v1 closed. NEXT: node snapshot-mods-air.mjs");
