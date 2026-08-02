// Build the WICK MODS II airdrop list from LIVE chain state.
//   node snapshot-mods-air.mjs            -> writes out/mods-air-plan.json
//
// Entitlement follows the GUN (3 per gun, v1's own rule), so we read
// gunMintsUsed for every gun and pay the CURRENT owner of any gun that never
// used its full three. Types come from v1's remaining pool, so the airdrop is
// literally the mods that were left undrawn — same rarity mix, nothing invented.
import { writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const root = dirname(fileURLToPath(import.meta.url));
const ethers = createRequire(import.meta.url)("ethers");

const RPC   = process.env.RPC_URL || "https://rpc-pulsechain.g4mm4.io";
const GUNS  = "0x188848DdB42fA8Ca2EB05649c944e05dfA2158FD";
const MODS1 = "0x004E6610ff47c6A6510DA446257822B37D26CD73";
const CHAIN = new ethers.Network("pulsechain", 369);
const p = new ethers.JsonRpcProvider(RPC, CHAIN, { staticNetwork: CHAIN, batchMaxCount: 20 });

const guns = new ethers.Contract(GUNS, [
  "function totalSupply() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function gunTypeOf(uint256) view returns (uint8)",
], p);
const mods = new ethers.Contract(MODS1, [
  "function gunMintsUsed(uint256) view returns (uint8)",
  "function poolLeft() view returns (uint16[7])",
  "function totalSupply() view returns (uint256)",
  "function mintOpen() view returns (bool)",
], p);

const NAMES = ["-", "LASER SIGHT", "HOLLOW POINTS", "HAIR TRIGGER", "LONG BARREL", "AP ROUNDS", "DRAGONS BREATH"];
const MINTS_PER_GUN = 3;

const block = await p.getBlockNumber();
const open  = await mods.mintOpen();
const n     = Number(await guns.totalSupply());

// v1 must be CLOSED before snapshotting, or the numbers move under us
if (open) {
  console.error("\n  ✗ v1 mint is still OPEN — close it first (setMintOpen(false)),");
  console.error("    otherwise a holder can claim between this snapshot and the airdrop");
  console.error("    and end up paid twice.\n");
  process.exit(1);
}

console.log("snapshot @ block " + block + " · v1 mint closed ✓\n");

const used  = await Promise.all(Array.from({ length: n }, (_, i) => mods.gunMintsUsed(i + 1).then(Number)));
const owner = await Promise.all(Array.from({ length: n }, (_, i) => guns.ownerOf(i + 1).then(a => a.toLowerCase())));
const gtype = await Promise.all(Array.from({ length: n }, (_, i) => guns.gunTypeOf(i + 1).then(Number).catch(() => 0)));

// owed, per gun, in gun-id order — the same order v1 would have served
const owed = [];
for (let i = 0; i < n; i++) {
  const free = MINTS_PER_GUN - used[i];
  for (let k = 0; k < free; k++) owed.push({ gunId: i + 1, gunType: gtype[i], to: owner[i] });
}

// the exact undrawn types left in v1
const pool = (await mods.poolLeft()).map(Number);
const bag = [];
for (let t = 1; t <= 6; t++) for (let k = 0; k < pool[t]; k++) bag.push(t);
// rarest first, so if supply runs short the commons are what go missing
bag.sort((a, b) => b - a);

const supply = bag.length;
const short  = Math.max(0, owed.length - supply);

const plan = [];
for (let i = 0; i < Math.min(owed.length, supply); i++) plan.push({ ...owed[i], type: bag[i] });

const byWallet = {};
for (const r of plan) (byWallet[r.to] ||= []).push(r.type);

console.log("owed (3/gun, unclaimed) :", owed.length);
console.log("undrawn v1 supply       :", supply);
console.log("SHORT                   :", short, short ? "← last guns by id miss out" : "");
console.log("\nallocation:");
for (const [w, types] of Object.entries(byWallet)) {
  const c = {}; types.forEach(t => c[NAMES[t]] = (c[NAMES[t]] || 0) + 1);
  console.log("  " + w + "  " + String(types.length).padStart(2) + "  " +
    Object.entries(c).map(([k, v]) => v + "x " + k).join(", "));
}
if (short) {
  console.log("\n  unfilled (no supply left):");
  owed.slice(supply).forEach(o => console.log("    gun #" + o.gunId + " → " + o.to));
}

const out = {
  block, snapshotAt: new Date().toISOString(), guns: n,
  owed: owed.length, supply, short,
  to:    plan.map(r => r.to),
  types: plan.map(r => r.type),
  detail: plan,
};
writeFileSync(join(root, "out", "mods-air-plan.json"), JSON.stringify(out, null, 2));
console.log("\nwrote out/mods-air-plan.json  (" + plan.length + " mods, cap for deploy = " + plan.length + ")");
