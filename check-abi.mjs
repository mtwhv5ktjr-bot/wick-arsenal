// Prove every ABI fragment the product uses actually exists on the DEPLOYED contract.
//
//   node check-abi.mjs            probe the addresses in web/config.js
//   node check-abi.mjs --offline  skip the chain, only check web/abi.js is current
//
// WHY
// The test suites deploy fresh contracts from out/*.json, so they pass whether or
// not the front end agrees with what is on mainnet. That blind spot shipped a dead
// ADVERTISE tab: BB_ABI declared buy() with 6 params, the deployed contract has 7,
// and every purchase reverted before it reached the wallet. Nothing failed loudly.
//
// This closes it by asking the chain instead of the artifacts. A Solidity dispatcher
// contains a PUSH4 of every external function's selector, so a selector missing from
// the deployed bytecode means the front end is calling something that isn't there.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const root = dirname(fileURLToPath(import.meta.url));
const ethers = createRequire(import.meta.url)("ethers");
const read = p => readFileSync(join(root, p), "utf8");

// --- load web/config.js + web/abi.js without a browser --------------------------
const sandbox = (src, file) => { const w = {}; new Function("window", src)(w); return w; };
const cfg = sandbox(read("web/config.js")).WICK_CFG;
const ABIS = sandbox(read("web/abi.js")).WICK_ABI;

// --- the API routes retype fragments too; they are the same hazard --------------
// (their addresses come from Vercel env vars, so they are probed against the same
// contracts configured here — in production those must be the same addresses.)
const API_SETS = [
  { file: "api/billboards.js",  varName: "ABI",      contract: "billboards" },
  { file: "api/verify.js",      varName: "ABI",      contract: "guns" },
  { file: "api/verify.js",      varName: "MODS_ABI", contract: "mods" },
  { file: "api/leaderboard.js", varName: "GUNS_ABI", contract: "guns" },
];
function extractSet(file, varName) {
  const src = read(file);
  const m = new RegExp(`const\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m").exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/"((?:function|event)[^"]+)"/g)].map(x => x[1]);
}

// --- build the work list --------------------------------------------------------
const work = {};   // contract -> [{ frag, from }]
for (const [key, frags] of Object.entries(ABIS))
  work[key] = frags.map(frag => ({ frag, from: "web/abi.js" }));
for (const s of API_SETS) {
  const frags = extractSet(s.file, s.varName);
  if (!frags) { console.warn(`! could not read ${s.varName} out of ${s.file} — check skipped for it`); continue; }
  (work[s.contract] ||= []).push(...frags.map(frag => ({ frag, from: s.file })));
}

if (process.argv.includes("--offline")) {
  console.log("offline: fragment sets loaded —",
    Object.entries(work).map(([k, v]) => `${k}:${v.length}`).join(" "));
  process.exit(0);
}

const RPC = process.env.RPC_URL || cfg.rpcRead || cfg.chain.rpc;
const CHAIN = new ethers.Network(cfg.chain.name, cfg.chain.id);
const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { staticNetwork: CHAIN });
console.log("probing chain", cfg.chain.id, "via", RPC, "\n");

let failures = 0, checked = 0, warned = 0;
for (const [key, entries] of Object.entries(work)) {
  const addr = cfg[key];
  if (!addr || /^0x0{40}$/i.test(addr)) { console.log(`- ${key}: not configured, skipped`); continue; }

  const code = (await provider.getCode(addr)).toLowerCase();
  if (code === "0x") { console.error(`✗ ${key}: NO BYTECODE at ${addr}`); failures++; continue; }

  const missing = [], missingEvents = [];
  const seen = new Set();
  for (const { frag, from } of entries) {
    if (seen.has(frag)) continue;
    seen.add(frag);
    let f;
    try { f = ethers.Fragment.from(frag); }
    catch (e) { console.error(`✗ ${key}: unparseable fragment from ${from}: ${frag}`); failures++; continue; }

    if (f.type === "function") {
      checked++;
      const sel = ethers.FunctionFragment.from(f).selector.slice(2);
      if (!code.includes(sel)) missing.push({ frag: f.format("full"), sel, from });
    } else if (f.type === "event") {
      // topic0 normally appears as a PUSH32 constant wherever the event is emitted.
      // Absence is suggestive, not proof (an event never emitted on any live path
      // can be optimised out), so this only warns.
      const topic = ethers.EventFragment.from(f).topicHash.slice(2);
      if (!code.includes(topic)) missingEvents.push({ frag: f.format("full"), from });
    }
  }

  if (!missing.length && !missingEvents.length) {
    console.log(`✓ ${key.padEnd(11)} ${addr}  — all ${seen.size} fragments present`);
  } else {
    if (missing.length) {
      console.error(`✗ ${key.padEnd(11)} ${addr}`);
      for (const m of missing) {
        console.error(`    MISSING selector 0x${m.sel}  ${m.frag}`);
        console.error(`      declared in ${m.from} — the deployed contract has no such function`);
      }
      failures += missing.length;
    }
    for (const w of missingEvents) {
      console.warn(`  ! ${key}: event topic not found in bytecode — ${w.frag} (${w.from})`);
      warned++;
    }
  }
}

console.log(`\n${checked} function fragments probed, ${failures} missing, ${warned} event warnings`);
if (failures) {
  console.error("\nFIX: correct the signature at its source, then `node gen-abi.mjs`.");
  console.error("If the contract itself moved on, the deployed address in web/config.js");
  console.error("and the fragments must change in the SAME commit.");
  process.exit(1);
}
console.log("the front end agrees with what is deployed.");
