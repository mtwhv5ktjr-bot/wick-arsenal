// Find marketplace listings whose seller no longer owns the gun.
//
//   node stale-listings.mjs
//
// The deployed v1 market stores a listing against a token id and only clears it on a
// market BUY. Any other way the gun moves — a plain transfer, or a sale through the
// offers pool — leaves the row behind. While someone else holds the gun the row is
// inert (buy() reverts on "stale listing"), and the site hides it. But it is not gone:
// if the original seller ever reacquires that gun, the row goes live again at the old
// price and anyone can take it.
//
// This lists every such row so the affected sellers can cancel(id) themselves. Only
// the seller can cancel — nobody else, including the contract owner, can clear it.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const root = dirname(fileURLToPath(import.meta.url));
const ethers = createRequire(import.meta.url)("ethers");
const sandbox = src => { const w = {}; new Function("window", src)(w); return w; };
const cfg = sandbox(readFileSync(join(root, "web", "config.js"), "utf8")).WICK_CFG;
const ABIS = sandbox(readFileSync(join(root, "web", "abi.js"), "utf8")).WICK_ABI;

const RPC = process.env.RPC_URL || cfg.rpcRead || cfg.chain.rpc;
const CHAIN = new ethers.Network(cfg.chain.name, cfg.chain.id);
const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { staticNetwork: CHAIN });

const guns = new ethers.Contract(cfg.guns, ABIS.guns, provider);
const MAX = Number(await guns.MAX_SUPPLY());
const pls = w => Number(ethers.formatEther(w)).toLocaleString("en-US");

// After a market upgrade BOTH venues matter: the old contract keeps its listings and
// keeps holding escrowed offers, and only the original bidder/seller can release them.
const venues = [{ label: "CURRENT market", addr: cfg.market, abi: ABIS.market }];
if (cfg.marketOld && ABIS.marketOld)
  venues.push({ label: "LEGACY market (superseded)", addr: cfg.marketOld, abi: ABIS.marketOld, legacy: true });

console.log(`guns ${cfg.guns} · ids 1..${MAX} · via ${RPC}`);
const todo = {};   // address -> list of actions only that address can perform

for (const v of venues) {
  const m = new ethers.Contract(v.addr, v.abi, provider);
  console.log(`\n=== ${v.label} — ${v.addr} ===`);

  // ---- listings ----
  const rows = [];
  for (let id = 1; id <= MAX; id++) {
    const [seller, price] = await m.getListing(id);
    if (price === 0n) continue;
    let owner = null;
    try { owner = await guns.ownerOf(id); } catch {}
    rows.push({ id, seller, price, owner, stale: !owner || owner.toLowerCase() !== seller.toLowerCase() });
  }
  console.log(`${rows.length} listing rows` + (rows.length ? `, ${rows.filter(r => r.stale).length} stale` : ""));
  for (const r of rows) {
    console.log(`  ${r.stale ? "STALE " : "  ok  "} #${String(r.id).padStart(3)}  ${pls(r.price).padStart(12)} PLS  by ${r.seller}`);
    if (r.stale) console.log(`           now owned by ${r.owner || "(unminted/burned)"}`);
    // On a superseded venue EVERY row is a liability: the site no longer shows it,
    // but the contract still honours buy() if the seller kept the gun and the old
    // approval, so it can be sniped at a price nobody is watching any more.
    if (v.legacy || r.stale) (todo[r.seller] ??= []).push(`cancel listing #${r.id} (${pls(r.price)} PLS)`);
  }

  // ---- escrowed offers ----
  let open = 0, escrow = 0n;
  const n = Number(await m.offersCount());
  for (let i = 0; i < n; i++) {
    const o = await m.getOffer(i);
    if (!o.open) continue;
    open++; escrow += o.amount;
    console.log(`  OFFER #${i}  ${pls(o.amount).padStart(12)} PLS escrowed by ${o.bidder}` +
                (o.tokenId === 0n ? "  (any gun)" : `  (gun #${o.tokenId})`));
    if (v.legacy) (todo[o.bidder] ??= []).push(`cancelOffer #${i} to reclaim ${pls(o.amount)} PLS`);
  }
  console.log(`${n} offers ever, ${open} still open, ${pls(escrow)} PLS escrowed` +
              (v.legacy && escrow > 0n ? "   <-- STRANDED once the site stops showing this venue" : ""));
}

const owners = Object.keys(todo);
if (owners.length) {
  console.log("\n--- WHO NEEDS TO DO WHAT ------------------------------------------");
  console.log("Only the original bidder/seller can clear their own row. Nobody else,");
  console.log("including the contract owner, can do it for them.\n");
  for (const addr of owners) {
    console.log("  " + addr);
    for (const act of todo[addr]) console.log("      · " + act);
  }
}
process.exit(0);
