// Seed the git-backed leaderboard from whatever copy of the board still exists.
//
// WHY: the API was migrated from Vercel Blob to a git file, but the git repo
// (LB_GH_REPO) is empty. The moment LB_GH_TOKEN is set, the board starts
// reading [] and the first submitted score writes a one-row board — silently
// stranding everyone who already scored. Run this ONCE, before or right after
// setting the token, so the board resumes instead of restarting.
//
// SOURCES, best first:
//   1. Vercel Blob lb.json    — the real board (only readable if the store is
//                               no longer suspended)
//   2. out/lb-backup-*.json   — the newest local snapshot
//
// USAGE (from wick-arsenal, with LB_GH_TOKEN + LB_GH_REPO in .env.local):
//   node migrate-board.mjs --dry     show what would be written
//   node migrate-board.mjs           write it
//
// It NEVER overwrites a non-empty board. If lb.json already exists in the repo
// with entries, it stops — re-running must not clobber live scores.
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry");

// .env.local -> process.env (only keys we need, never printed)
if (existsSync(join(root, ".env.local"))) {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const TOKEN = (process.env.LB_GH_TOKEN || "").trim();
const REPO  = (process.env.LB_GH_REPO  || "").trim();
const BRANCH = (process.env.LB_GH_BRANCH || "main").trim();
if (!TOKEN) { console.error("LB_GH_TOKEN is not set (put it in .env.local)"); process.exitCode = 1; }
else if (!/^[^/\s]+\/[^/\s]+$/.test(REPO)) { console.error("LB_GH_REPO must be owner/name — got " + JSON.stringify(REPO)); process.exitCode = 1; }
else await main();

async function main() {
  const gh = (p, init) => fetch("https://api.github.com/repos/" + REPO + p, {
    ...init,
    headers: {
      authorization: "Bearer " + TOKEN,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "wick-board-migrate",
      ...(init && init.headers),
    },
  });

  // --- refuse to clobber ---
  const cur = await gh("/contents/lb.json?ref=" + encodeURIComponent(BRANCH));
  let sha = null;
  if (cur.status === 200) {
    const j = await cur.json();
    sha = j.sha;
    let existing = [];
    try { existing = JSON.parse(Buffer.from(j.content || "", "base64").toString("utf8")); } catch {}
    if (Array.isArray(existing) && existing.length) {
      console.error("REFUSING — " + REPO + "/lb.json already holds " + existing.length + " entries.");
      console.error("Nothing to migrate into; the board is already live.");
      process.exitCode = 2; return;
    }
  } else if (cur.status !== 404) {
    console.error("could not read " + REPO + "/lb.json — HTTP " + cur.status);
    process.exitCode = 1; return;
  }

  // --- source 1: Vercel Blob (only works once the store is un-suspended) ---
  let board = null, source = null;
  const blobTok = (process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  if (blobTok) {
    try {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ token: blobTok, prefix: "lb.json" });
      const hit = blobs.find(b => b.pathname === "lb.json");
      if (hit) {
        const r = await fetch(hit.downloadUrl || hit.url, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j) && j.length) { board = j; source = "Vercel Blob (" + hit.size + " bytes, " + hit.uploadedAt + ")"; }
        } else {
          console.log("Blob read returned " + r.status + " — store still suspended, falling back.");
        }
      }
    } catch (e) { console.log("Blob unavailable (" + e.message + ") — falling back."); }
  }

  // --- source 2: newest local snapshot ---
  if (!board) {
    const dir = join(root, "out");
    const files = existsSync(dir) ? readdirSync(dir).filter(f => /^lb-backup-.*\.json$/.test(f)).sort() : [];
    if (files.length) {
      const f = files[files.length - 1];
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (Array.isArray(j) && j.length) { board = j; source = "local snapshot out/" + f; }
    }
  }

  if (!board) { console.error("No board data found in any source — nothing to migrate."); process.exitCode = 2; return; }

  board.sort((a, b) => (b.score || 0) - (a.score || 0));
  console.log("source : " + source);
  console.log("entries: " + board.length);
  for (const e of board.slice(0, 10)) {
    console.log("   " + String(e.score).padStart(8) + "  " + (e.name || "").padEnd(16) + " " + e.a + "  (" + (e.mode || "story") + ", lv " + (e.level || 1) + ")");
  }
  if (!/Blob/.test(source)) {
    console.log("\n⚠ This is the LOCAL snapshot, not the live board. Any score submitted");
    console.log("  after it was taken is only in the suspended Blob store.");
  }
  if (DRY) { console.log("\n>> DRY RUN — nothing written."); return; }

  const put = await gh("/contents/lb.json", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "migrate: seed leaderboard from " + source,
      content: Buffer.from(JSON.stringify(board), "utf8").toString("base64"),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!put.ok) { console.error("write failed — HTTP " + put.status + " " + (await put.text()).slice(0, 200)); process.exitCode = 1; return; }
  console.log("\n>> Wrote " + board.length + " entries to " + REPO + "/lb.json");
  console.log(">> Verify: curl -s https://wick-arsenal.vercel.app/api/leaderboard");
}
