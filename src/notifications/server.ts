import { StorageError } from "../storage/types";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { eventBodyLimitBytes, eventRequestTimeoutMs } from "../config/push";
import { parseDetectionEvent } from "./parsers";
import { DetectionEvent } from "./types";

export function createEventUpdateServer(options: {
  secret: string;
  receive(event: DetectionEvent): Promise<void>;
  isReady(): boolean;
}): http.Server {
  if (!options.secret) throw new Error("EVENT_UPDATE_SECRET is required");
  const expected = Buffer.from(options.secret);
  const server = http.createServer(async (request, response) => {
    const reply = (status: number, result: string) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: result }));
    };
    if (request.url === "/health/live" && request.method === "GET") { reply(200, "alive"); return; }
    if (request.url === "/health" && request.method === "GET") {
      reply(options.isReady() ? 200 : 503, options.isReady() ? "ready" : "unavailable");
      return;
    }
    if (request.url !== "/event-update") { reply(404, "not-found"); return; }
    if (request.method !== "POST") { reply(405, "method-not-allowed"); return; }
    const header = request.headers["x-event-update-secret"];
    const actual = Buffer.from(typeof header === "string" ? header : "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      reply(401, "unauthorized"); return;
    }
    if (!options.isReady()) { reply(503, "unavailable"); return; }
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      reply(415, "unsupported-media-type"); return;
    }
    let event: DetectionEvent;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > eventBodyLimitBytes) { reply(413, "body-too-large"); return; }
        chunks.push(bytes);
      }
      event = parseDetectionEvent(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      reply(400, "invalid-event"); return;
    }
    try {
      await options.receive(event);
      reply(200, "accepted");
    } catch (error) {
      if (error instanceof StorageError && error.code === "reconciliation-required") { reply(409, error.code); return; }
      reply(503, "delivery-failed");
    }
  });
  server.requestTimeout = eventRequestTimeoutMs;
  server.headersTimeout = eventRequestTimeoutMs;
  return server;
}
