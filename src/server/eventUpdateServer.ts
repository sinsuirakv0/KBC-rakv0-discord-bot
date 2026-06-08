import { Client } from "discord.js";
import http from "node:http";
import { notifyScheduleUpdate } from "../monitor/checkEvents";

const MAX_BODY_BYTES = 128 * 1024;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const expected = process.env.EVENT_UPDATE_SECRET;
  if (!expected) return true;
  const actual = req.headers["x-event-update-secret"];
  return typeof actual === "string" && actual === expected;
}

export function startEventUpdateServer(client: Client): void {
  const port = Number(process.env.PORT ?? process.env.EVENT_UPDATE_PORT ?? 3000);

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    if (req.method !== "POST" || req.url !== "/event-update") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }

    if (!isAuthorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }

    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      await notifyScheduleUpdate(client, payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[event-update-server] request failed:", message);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: message }));
    }
  });

  server.listen(port, () => {
    console.log(`event-update server listening on :${port}`);
  });
}
