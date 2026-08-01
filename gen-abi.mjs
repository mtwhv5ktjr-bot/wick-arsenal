// Generate web/abi.js from the compiled artifacts in out/.
//
//   node gen-abi.mjs          write web/abi.js
//   node gen-abi.mjs --check  fail if web/abi.js is stale (for CI / pre-deploy)
//
// WHY THIS EXISTS
// The front end used to retype every contract signature by hand. Twice in two days
// that produced a live-breaking mismatch: the market v1/v2 offer signatures, and a
// billboards buy() that was missing its `logo` argument, which killed the ADVERTISE
// tab outright. The compiler already knows every signature — so generate, don't type.
//
// Pair this with check-abi.mjs, which proves the emitted fragments actually exist on
// the DEPLOYED bytecode. Generation alone cannot catch an artifact that has moved
// ahead of what is deployed — see the market note below.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const root = dirname(fileURLToPath(import.meta.url));
const ethers = createRequire(import.meta.url)("ethers");
const load = n => JSON.parse(readFileSync(join(root, "out", n + ".json"), "utf8"));

// ===========================================================================
// THE v1 -> v2 MARKET SWITCH. Flip this to true IN THE SAME COMMIT that points
// web/config.js at the newly deployed v2 address (deploy-market.mjs patches that
// address for you). Flipping one without the other is precisely the mismatch that
// broke the marketplace once already — `node check-abi.mjs` will catch it either
// way, so run that before deploying the site.
const MARKET_IS_V2 = true;   // v2 deployed 2026-08-01 at cfg.market; cfg.marketOld holds v1
// ===========================================================================

// ---------------------------------------------------------------------------
// THE LEGACY v1 MARKET (cfg.marketOld). Kept because v1 does not stop existing when
// v2 ships: it still holds escrowed offers and listing rows, and only the original
// bidder/seller can clear them. A front end that wants to let people reclaim from
// the old venue needs these signatures — there is no artifact for v1 anywhere, so
// this block is the only record of them.
//
// While MARKET_IS_V2 is false these are also used AS the live market ABI.
//
// contracts/WickMarket.sol in this repo is the UNSHIPPED v2 (2-arg makeOffer with
// a gunType tier, 5-word getOffer). The market actually deployed at cfg.market is
// v1: 1-arg makeOffer, 4-word getOffer. v1's source is in no public repo, so there
// is no artifact to generate from — these hand-written fragments ARE the record of
// what is deployed.
//
// Generating this contract from out/WickMarket.json would silently reintroduce the
// exact v1/v2 mismatch this whole file exists to prevent. Do not "fix" it by adding
// market to the generated list. If v2 ever ships, delete this block, move market to
// GENERATED below, and change the address in web/config.js IN THE SAME COMMIT.
// check-abi.mjs will tell you the moment the pin stops matching the chain.
// ---------------------------------------------------------------------------
const PINNED = {
  // emitted as `market` while MARKET_IS_V2 is false, otherwise as `marketOld` so a
  // reclaim path can still talk to v1 (and so check-abi.mjs keeps probing it).
  [MARKET_IS_V2 ? "marketOld" : "market"]: [
    "function list(uint256 id, uint256 price)",
    "function cancel(uint256 id)",
    "function buy(uint256 id) payable",
    "function getListing(uint256 id) view returns (address seller, uint256 price)",
    "function feeBps() view returns (uint96)",
    "function makeOffer(uint256 tokenId) payable returns (uint256)",
    "function cancelOffer(uint256 id)",
    "function acceptOffer(uint256 id, uint256 tokenId)",
    "function offersCount() view returns (uint256)",
    "function getOffer(uint256 id) view returns (address bidder, uint256 amount, uint256 tokenId, bool open)",
    "function burnPending() view returns (uint256)",
    "function burnPool(uint256 minOut)",
    "event Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price)",
    "event OfferAccepted(uint256 indexed offerId, uint256 indexed tokenId, address indexed seller, address bidder, uint256 amount)",
  ],
};

// key in window.WICK_ABI  ->  artifact in out/
const GENERATED = {
  guns:        "WickGuns",
  mods:        "WickMods",
  modsMarket:  "WickModsMarket",
  billboards:  "WickBillboards",
  // v2 ships from the artifact like everything else; v1 has no source to generate from
  ...(MARKET_IS_V2 ? { market: "WickMarket" } : {}),
};

const fragmentsOf = artifact => {
  const iface = new ethers.Interface(load(artifact).abi);
  return iface.fragments
    .filter(f => f.type === "function" || f.type === "event")
    .map(f => f.format("full"))
    .sort();
};

const body = {};
for (const [key, artifact] of Object.entries(GENERATED)) body[key] = fragmentsOf(artifact);
for (const [key, frags] of Object.entries(PINNED)) if (!(key in body)) body[key] = frags;

const banner = `// GENERATED by gen-abi.mjs — DO NOT EDIT BY HAND.
// Regenerate:  node gen-abi.mjs      Verify against chain:  node check-abi.mjs
//
// ${Object.keys(GENERATED).join(", ")} come straight from the compiler output in out/.
// market is PINNED to the deployed v1 signatures — see the long note in gen-abi.mjs
// before touching it.
`;

const out = banner + "window.WICK_ABI = " + JSON.stringify(body, null, 2) + ";\n";

const dest = join(root, "web", "abi.js");
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(dest, "utf8"); } catch {}
  // Compare CONTENT, not bytes: this repo has core.autocrlf=true, so git hands back
  // CRLF on a Windows checkout while we generate LF. A byte-exact compare fails on
  // every fresh clone and says "stale" when nothing has actually drifted.
  const norm = s => s.replace(/\r\n/g, "\n");
  if (norm(current) !== norm(out)) {
    console.error("✗ web/abi.js is STALE — the artifacts in out/ no longer match it.");
    console.error("  Run: node gen-abi.mjs   (then redeploy the site)");
    process.exit(1);
  }
  console.log("✓ web/abi.js is up to date with out/*.json");
  process.exit(0);
}

writeFileSync(dest, out);
for (const [k, v] of Object.entries(body)) {
  const tag = k in GENERATED ? "from out/" + GENERATED[k] + ".json" : "PINNED (deployed v1)";
  console.log("  " + k.padEnd(12) + String(v.length).padStart(3) + " fragments   " + tag);
}
console.log("\nwrote web/abi.js (" + out.length + " bytes)");
console.log("next: node check-abi.mjs   — proves these exist on the deployed contracts");
