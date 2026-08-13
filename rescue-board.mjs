// Pull the PEPE WICK prize board out of Vercel Blob and print it.
//
// The board lives in exactly one place: blob store `wick-board`
// (store_aGYTctI5mdCs0Snw), file lb.json, 2,356 bytes, written 2026-08-03.
// While that store is SUSPENDED the file is intact but every read 403s, so
// this script cannot work until the store is un-suspended in the dashboard.
//
//   node rescue-board.mjs            print the board, save a local copy
//   node rescue-board.mjs --seed     also seed the git store (needs LB_GH_TOKEN)
//
// It saves out/lb-rescued-<stamp>.json on every successful read. That is the
// point: the reason a suspended store could take the board hostage at all is
// that the only copy was in the store.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));

// .env.local -> process.env (values are never printed)
if (existsSync(join(root, ".env.local"))) {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const TOKEN = (process.env.BLOB_READ_WRITE_TOKEN || "").trim();
if (!TOKEN) { console.error("BLOB_READ_WRITE_TOKEN is not in .env.local"); process.exitCode = 1; }
else await main();

async function main() {
  const { list } = await import("@vercel/blob");

  let blobs;
  try { ({ blobs } = await list({ token: TOKEN })); }
  catch (e) {
    console.error("Could not list the store: " + e.message);
    console.error("If it says suspended, the store is still off — nothing to do here yet.");
    process.exitCode = 2; return;
  }

  console.log("Files in the store:");
  for (const b of blobs) console.log("   " + b.pathname.padEnd(16) + String(b.size).padStart(6) + " bytes   " + b.uploadedAt);
  console.log("");

  // lb.json is the live board; lb-prev.json is the one-deep backup the old
  // Blob-era code kept by hand. Try the live one, fall back to the snapshot.
  const order = ["lb.json", "lb-prev.json"];
  let board = null, from = null;
  for (const name of order) {
    const hit = blobs.find(b => b.pathname === name);
    if (!hit) continue;
    const r = await fetch(hit.downloadUrl || hit.url, { cache: "no-store" });
    if (!r.ok) {
      console.error(name + " -> HTTP " + r.status + (r.status === 403 ? "   (store still suspended)" : ""));
      continue;
    }
    const j = await r.json();
    if (Array.isArray(j) && j.length) { board = j; from = name; break; }
    if (Array.isArray(j)) console.error(name + " read fine but is empty");
  }

  if (!board) {
    console.error("\nCould not read any board file.");
    console.error("A 403 here means the store is STILL SUSPENDED — un-suspend it, then re-run.");
    process.exitCode = 2; return;
  }

  board.sort((a, b) => (b.score || 0) - (a.score || 0));

  // save immediately — never let the only copy live in the store again
  mkdirSync(join(root, "out"), { recursive: true });
  const stamp = (board[0] && board[0].ts) ? String(board[0].ts) : "rescued";
  const out = join(root, "out", "lb-rescued-" + stamp + ".json");
  writeFileSync(out, JSON.stringify(board, null, 2));

  const short = a => String(a || "").slice(0, 6) + "…" + String(a || "").slice(-4);
  const who = e => (e.name && e.name.trim()) ? e.name.trim() : short(e.a);
  const modes = {};
  board.forEach(e => { const m = e.mode || "story"; modes[m] = (modes[m] || 0) + 1; });

  console.log("SOURCE : " + from);
  console.log("SAVED  : " + out);
  console.log("ENTRIES: " + board.length + "   modes: " + JSON.stringify(modes));
  console.log("");
  console.log("=== FULL BOARD (all modes, score order) ===");
  console.log("  #  SCORE      PLAYER           MODE       LV  WALLET");
  board.forEach((e, i) => {
    console.log("  " + String(i + 1).padStart(2) + " " + String(e.score).padStart(9) + "  "
      + who(e).padEnd(16) + " " + String(e.mode || "story").padEnd(10) + " "
      + String(e.level || 1).padStart(2) + "  " + (e.a || ""));
  });

  // the prize view the site uses: daily runs live in their own lane
  const prize = board.filter(e => !String(e.mode || "").startsWith("daily-"));
  console.log("\n=== TOP 10 PRIZE BOARD (what the site shows) ===");
  prize.slice(0, 10).forEach((e, i) => {
    console.log("  " + String(i + 1).padStart(2) + ". " + who(e).padEnd(16)
      + String(e.score).padStart(9) + "   " + (e.mode || "story") + " lv" + (e.level || 1));
  });

  // story and gauntlet are scored on totally different ceilings (300k vs
  // 5k+20k/wave), so a mixed list is not a like-for-like ranking
  for (const m of ["story", "gauntlet"]) {
    const rows = board.filter(e => (e.mode || "story") === m);
    if (!rows.length) continue;
    console.log("\n=== " + m.toUpperCase() + " ONLY ===");
    rows.slice(0, 10).forEach((e, i) =>
      console.log("  " + String(i + 1).padStart(2) + ". " + who(e).padEnd(16) + String(e.score).padStart(9) + "   lv" + (e.level || 1)));
  }

  if (process.argv.includes("--seed")) {
    const ghTok = (process.env.LB_GH_TOKEN || "").trim();
    const repo = (process.env.LB_GH_REPO || "").trim();
    if (!ghTok || !repo) { console.log("\n--seed skipped: LB_GH_TOKEN / LB_GH_REPO not set."); return; }
    const branch = (process.env.LB_GH_BRANCH || "main").trim();
    const h = { authorization: "Bearer " + ghTok, accept: "application/vnd.github+json",
                "x-github-api-version": "2022-11-28", "user-agent": "wick-board-rescue" };
    const cur = await fetch("https://api.github.com/repos/" + repo + "/contents/lb.json?ref=" + branch, { headers: h });
    let sha = null;
    if (cur.status === 200) {
      const j = await cur.json(); sha = j.sha;
      let ex = []; try { ex = JSON.parse(Buffer.from(j.content || "", "base64").toString("utf8")); } catch {}
      if (Array.isArray(ex) && ex.length) { console.log("\n--seed skipped: " + repo + "/lb.json already has " + ex.length + " entries."); return; }
    }
    const put = await fetch("https://api.github.com/repos/" + repo + "/contents/lb.json", {
      method: "PUT", headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify({ message: "rescue: seed board from Blob " + from,
        content: Buffer.from(JSON.stringify(board), "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }) });
    console.log(put.ok ? "\n>> Seeded " + repo + "/lb.json with " + board.length + " entries."
                       : "\n>> Seed failed: HTTP " + put.status);
  }
}
