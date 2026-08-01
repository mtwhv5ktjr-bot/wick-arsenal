// LIVE QA — simulate every user-facing transaction against the DEPLOYED contracts.
//
//   node qa-live.mjs
//
// Nothing is signed and nothing is spent: every write is an eth_call from a funded
// address, so the node executes the real contract code and reports exactly what a
// wallet would get. This catches what the ganache suites cannot — the front end's
// actual arguments meeting the actual bytecode on mainnet.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const root = dirname(fileURLToPath(import.meta.url));
const ethers = createRequire(import.meta.url)("ethers");
const sandbox = src => { const w = {}; new Function("window", src)(w); return w; };
const cfg  = sandbox(readFileSync(join(root, "web", "config.js"), "utf8")).WICK_CFG;
const ABIS = sandbox(readFileSync(join(root, "web", "abi.js"), "utf8")).WICK_ABI;

const RPC = process.env.RPC_URL || cfg.rpcRead || cfg.chain.rpc;
const CHAIN = new ethers.Network(cfg.chain.name, cfg.chain.id);
const p = new ethers.JsonRpcProvider(RPC, CHAIN, { staticNetwork: CHAIN });

// a funded mainnet address to simulate from — never signed with, only used as
// msg.sender so balance/ownership requires resolve the way a real user's would
const WHALE = process.env.QA_FROM || "0x2641036636982D55FDdCA6D970Ee4B5D3a26BBab";

let pass = 0, fail = 0; const problems = [];
const ok   = (c, m, extra="") => { if (c) { pass++; console.log("  ✓", m, extra); } else { fail++; problems.push(m); console.log("  ✗", m, extra); } };
const pls  = w => Number(ethers.formatEther(w)).toLocaleString("en-US");

// Simulate a state-changing call. expect: "ok" or a substring of the expected revert.
async function sim(label, contractAddr, iface, fn, args, value, expect) {
  let outcome, detail = "";
  try {
    const data = iface.encodeFunctionData(fn, args);
    const r = await p.call({ to: contractAddr, from: WHALE, value: value || 0n, data });
    outcome = "ok";
    try { const d = iface.decodeFunctionResult(fn, r); if (d.length) detail = "-> " + d.map(String).join(","); } catch {}
  } catch (e) {
    outcome = "revert";
    detail = (e.reason || e.shortMessage || e.message || "").replace(/execution reverted:?\s*/i, "").slice(0, 70);
  }
  if (expect === "ok") ok(outcome === "ok", label, outcome === "ok" ? detail : "UNEXPECTED REVERT: " + detail);
  else ok(outcome === "revert" && detail.toLowerCase().includes(expect.toLowerCase()),
          label, outcome === "revert" ? `(reverted: ${detail})` : "DID NOT REVERT — expected " + expect);
}

console.log(`LIVE QA · chain ${cfg.chain.id} · ${RPC}`);
console.log(`simulating as ${WHALE} (${pls(await p.getBalance(WHALE))} PLS)\n`);

/* ─────────────────────────── ADVERTISE ─────────────────────────── */
console.log("── ADVERTISE (billboards " + cfg.billboards + ")");
{
  const I = new ethers.Interface(ABIS.billboards);
  const bb = new ethers.Contract(cfg.billboards, ABIS.billboards, p);
  const day = Number(await bb.todayId());
  const dayPrice = await bb.PRICE_DAY(), excPrice = await bb.PRICE_EXCLUSIVE();
  const [taken, excTaken] = await bb.daySlots(day);
  console.log(`  today=${day} sold=${taken}/8 exclusiveTaken=${excTaken} · day=${pls(dayPrice)} exclusive=${pls(excPrice)} PLS`);

  const A = [day, false, "WICK QA", "testing the tab", "wick.pics", 0x7cf9a5, 0n];
  await sim("rotation ad at the exact price",        cfg.billboards, I, "buy", A, dayPrice, "ok");
  await sim("exclusive takeover at exact price",     cfg.billboards, I, "buy", [day, true, "WICK QA", "t", "wick.pics", 0x7cf9a5, 0n], excPrice, "ok");
  await sim("underpaid rotation is refused",         cfg.billboards, I, "buy", A, dayPrice - 1n, "a day costs");
  await sim("OVERPAID rotation is refused (== not >=)", cfg.billboards, I, "buy", A, dayPrice + 1n, "a day costs");
  await sim("yesterday is refused",                  cfg.billboards, I, "buy", [day - 1, false, "WICK QA", "t", "u", 0, 0n], dayPrice, "day already over");
  await sim("more than 60 days ahead is refused",    cfg.billboards, I, "buy", [day + 61, false, "WICK QA", "t", "u", 0, 0n], dayPrice, "60 days");
  await sim("empty name is refused",                 cfg.billboards, I, "buy", [day, false, "", "t", "u", 0, 0n], dayPrice, "name 1-20");
  await sim("21-char name is refused",               cfg.billboards, I, "buy", [day, false, "x".repeat(21), "t", "u", 0, 0n], dayPrice, "name 1-20");
  await sim("29-char tag is refused",                cfg.billboards, I, "buy", [day, false, "WICK QA", "x".repeat(29), "u", 0, 0n], dayPrice, "tag <=28");
  await sim("33-char url is refused",                cfg.billboards, I, "buy", [day, false, "WICK QA", "t", "x".repeat(33), 0, 0n], dayPrice, "url <=32");
  // the renderer + API read path
  const ads = await bb.adsOf(day);
  ok(Array.isArray(ads[0]), "adsOf(today) returns the renderer arrays", `(${ads[0].length} ads today)`);
}

/* ─────────────────────────── MINT ─────────────────────────── */
console.log("\n── MINT (guns " + cfg.guns + ")");
{
  const I = new ethers.Interface(ABIS.guns);
  const g = new ethers.Contract(cfg.guns, ABIS.guns, p);
  const [minted, total, open, price] = await Promise.all([g.publicMinted(), g.totalSupply(), g.mintOpen(), g.mintPrice()]);
  console.log(`  publicMinted=${minted}/100 totalSupply=${total} mintOpen=${open} price=${pls(price)} PLS`);
  ok(Number(total) === 101, "supply is the full 101");
  ok(Number(minted) === 100, "public mint is sold out");
  await sim("minting past sellout is refused", cfg.guns, I, "mint", [1], price, "sold out");
  ok(Number(await g.gunTypeOf(1)) === 16, "gun #1 is the Tangential Reaper (type 16)");
  const uri = await g.tokenURI(2);
  ok(uri.startsWith("data:application/json;base64,"), "tokenURI still renders on-chain");
}

/* ─────────────────────────── MARKET v2 ─────────────────────────── */
console.log("\n── MARKET v2 (" + cfg.market + ")");
{
  const I = new ethers.Interface(ABIS.market);
  const m = new ethers.Contract(cfg.market, ABIS.market, p);
  const bid = ethers.parseEther("1000");
  await sim("collection offer (any gun)",   cfg.market, I, "makeOffer", [0, 0], bid, "ok");
  await sim("TIER offer — ANY Marksman",    cfg.market, I, "makeOffer", [0, 4], bid, "ok");
  await sim("token offer on gun #42",       cfg.market, I, "makeOffer", [42, 0], bid, "ok");
  await sim("token AND tier is refused",    cfg.market, I, "makeOffer", [42, 4], bid, "not both");
  await sim("zero-value offer is refused",  cfg.market, I, "makeOffer", [0, 0], 0n, "no value");
  await sim("buying an unlisted gun fails", cfg.market, I, "buy", [42], ethers.parseEther("1"), "not listed");
  ok(Number(await m.feeBps()) === 1500, "royalty is 15%");
  ok((await m.nft()).toLowerCase() === cfg.guns.toLowerCase(), "bound to the live guns contract");
}

/* ─────────────────────────── MARKET v1 (legacy) ─────────────────────────── */
console.log("\n── MARKET v1 legacy (" + cfg.marketOld + ")");
{
  const I = new ethers.Interface(ABIS.marketOld);
  const m = new ethers.Contract(cfg.marketOld, ABIS.marketOld, p);
  const guns = new ethers.Contract(cfg.guns, ABIS.guns, p);
  // Every legacy row the SITE would show must actually be purchasable: seller still
  // owns it AND the old market still holds approval. A row failing that is a BUY
  // button that can only revert.
  const rows = [];
  for (let id = 1; id <= 101; id++) {
    const [seller, price] = await m.getListing(id);
    if (price === 0n) continue;
    const owner = await guns.ownerOf(id).catch(() => null);
    const ownsIt = owner && owner.toLowerCase() === seller.toLowerCase();
    const [appr, all] = await Promise.all([
      guns.getApproved(id).catch(() => ethers.ZeroAddress),
      guns.isApprovedForAll(seller, cfg.marketOld).catch(() => false)]);
    const approved = all || appr.toLowerCase() === cfg.marketOld.toLowerCase();
    rows.push({ id, seller, price, ownsIt, approved });
  }
  const shown = rows.filter(r => r.ownsIt && r.approved);
  console.log(`  ${rows.length} rows · ${rows.filter(r => !r.ownsIt).length} stale · ${rows.filter(r => r.ownsIt && !r.approved).length} unapproved · ${shown.length} shown by the site`);
  ok(shown.length > 0, "the site still shows buyable legacy listings", `(${shown.length})`);
  for (const r of rows.filter(x => x.ownsIt && !x.approved))
    console.log(`     note: #${r.id} is owned by its lister but NOT approved — correctly hidden`);

  // simulate a real purchase on the cheapest one this address can actually afford
  const bal = await p.getBalance(WHALE);
  const target = shown.filter(r => r.price < bal).sort((a, b) => (a.price < b.price ? -1 : 1))[0];
  if (target) {
    console.log(`  simulating a real buy of legacy #${target.id} @ ${pls(target.price)} PLS`);
    await sim(`buying legacy #${target.id} still works`, cfg.marketOld, I, "buy", [target.id], target.price, "ok");
    await sim(`underpaying legacy #${target.id} fails`,  cfg.marketOld, I, "buy", [target.id], target.price - 1n, "underpaid");
  } else console.log("  (no legacy listing within the simulating balance — purchase path not exercised)");
  // an open legacy offer must still be reclaimable BY ITS OWN BIDDER
  const n = Number(await m.offersCount());
  let refunded = 0;
  for (let i = 0; i < n; i++) {
    const o = await m.getOffer(i);
    if (!o.open) continue;
    try {
      await p.call({ to: cfg.marketOld, from: o.bidder, data: I.encodeFunctionData("cancelOffer", [i]) });
      refunded++;
    } catch (e) { ok(false, `legacy offer #${i} reclaimable by ${o.bidder}`, e.reason || e.message); }
  }
  ok(refunded > 0, `all ${refunded} open legacy offers are reclaimable by their bidders`);
}

/* ─────────────────────────── APPROVALS ─────────────────────────── */
console.log("\n── APPROVALS");
{
  const guns = new ethers.Contract(cfg.guns, ABIS.guns, p);
  const m = new ethers.Contract(cfg.marketOld, ABIS.marketOld, p);
  // v2 is a brand-new contract: nobody has approved it yet, so every seller's first
  // LIST needs a fresh setApprovalForAll. Confirm the site is right to prompt.
  const sellers = new Set();
  for (let id = 1; id <= 101 && sellers.size < 4; id++) {
    const [s, price] = await m.getListing(id);
    if (price > 0n) sellers.add(s);
  }
  for (const s of sellers) {
    const [onOld, onNew] = await Promise.all([
      guns.isApprovedForAll(s, cfg.marketOld), guns.isApprovedForAll(s, cfg.market)]);
    console.log(`  ${s}  v1=${onOld ? "approved" : "no"}  v2=${onNew ? "approved" : "NOT YET"}`);
  }
  ok(true, "approval state sampled (v2 is new — sellers re-approve on first LIST)");
}

/* ─────────────────────────── APIs ─────────────────────────── */
console.log("\n── PRODUCTION APIs");
{
  const base = process.env.QA_SITE || "https://mint.wick.pics";
  try {
    const r = await fetch(base + "/api/billboards"); const j = await r.json();
    ok(r.status === 200 && j.ok === true, "GET /api/billboards", `(day ${j.day}, ${(j.ads||[]).length} ads)`);
  } catch (e) { ok(false, "GET /api/billboards", e.message); }
  try {
    const r = await fetch(base + "/api/leaderboard"); const j = await r.json();
    ok(r.status === 200 && j.ok === true, "GET /api/leaderboard", `(${(j.top||[]).length} entries)`);
  } catch (e) { ok(false, "GET /api/leaderboard", e.message); }
  try {
    const r = await fetch(base + "/api/verify", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "0x0000000000000000000000000000000000000001", message: "bad", signature: "0x00" }) });
    ok(r.status >= 400 || (await r.json()).ok === false, "POST /api/verify rejects a bad signature", "(status " + r.status + ")");
  } catch (e) { ok(false, "POST /api/verify", e.message); }
  for (const f of ["/abi.js", "/config.js", "/gunart.js", "/ethers.min.js"]) {
    try { const r = await fetch(base + f); ok(r.status === 200, "static " + f, "(" + r.status + ")"); }
    catch (e) { ok(false, "static " + f, e.message); }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (problems.length) { console.log("--- needs attention ---"); problems.forEach(x => console.log("  · " + x)); }
process.exit(fail ? 1 : 0);
