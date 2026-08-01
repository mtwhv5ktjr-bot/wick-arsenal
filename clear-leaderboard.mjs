// Reset the WICK global leaderboard (Vercel Blob lb.json) to empty.
// Backs up the current board first so this is reversible, then writes [].
//   node clear-leaderboard.mjs
import { list, put } from "@vercel/blob";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(fileURLToPath(import.meta.url));
// load the blob token from .env.local (never printed)
const env = readFileSync(join(root, ".env.local"), "utf8");
const token = (env.match(/BLOB_READ_WRITE_TOKEN\s*=\s*"?([^"\r\n]+)"?/) || [])[1];
if (!token) { console.error("BLOB_READ_WRITE_TOKEN not found in .env.local"); process.exit(1); }

const PATH = "lb.json";

// read current board
let current = [];
try {
  const { blobs } = await list({ prefix: PATH, limit: 1, token });
  if (blobs.length) {
    const r = await fetch(blobs[0].url + "?v=" + Date.now(), { cache: "no-store" });
    if (r.ok) current = await r.json();
  }
} catch (e) { console.warn("could not read current board:", e.message); }

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(root, "out", "lb-backup-" + stamp + ".json");
writeFileSync(backup, JSON.stringify(current, null, 2));
console.log("backed up " + current.length + " entr" + (current.length === 1 ? "y" : "ies") + " -> " + backup);
if (current.length) console.log("  (was: " + current.slice(0, 10).map(e => e.a.slice(0, 8) + "…:" + e.score + " " + (e.mode || "?")).join(", ") + (current.length > 10 ? " …" : "") + ")");

// clear
await put(PATH, "[]", {
  access: "public", addRandomSuffix: false, allowOverwrite: true,
  contentType: "application/json", cacheControlMaxAge: 0, token,
});
console.log("✓ leaderboard cleared (lb.json = []).");
console.log("  restore anytime with:  the backup file above, re-put to lb.json.");
