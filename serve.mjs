// Dev static server for the WICK Arsenal web app (serves ./web).
import http from "http";
import { readFile, writeFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "web");
const PORT = process.env.PORT || 8097;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json", ".png":"image/png" };

http.createServer(async (req, res) => {
  // dev-only screenshot sink (mirrors the game's /shot)
  if (req.method === "POST" && req.url.split("?")[0] === "/shot") {
    let body = ""; req.on("data", c => { body += c; if (body.length > 12e6) req.destroy(); });
    req.on("end", async () => { const m = /^data:image\/png;base64,(.+)$/.exec(body);
      if (!m) { res.writeHead(400); res.end("bad"); return; }
      await writeFile(join(HERE, "shot.png"), Buffer.from(m[1], "base64"));
      res.writeHead(200, { "Access-Control-Allow-Origin": "*" }); res.end("ok"); });
    return;
  }
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  try {
    const data = await readFile(join(ROOT, p));
    res.writeHead(200, { "Content-Type": MIME[extname(p).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(PORT, () => console.log("WICK Arsenal web on http://localhost:" + PORT));
