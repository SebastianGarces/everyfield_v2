import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// A capture endpoint only. No SMTP client, forwarding code, or external fetch.
const [port, file] = process.argv.slice(2);
const messages = [];
const keys = new Map();
createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && request.url === "/messages") {
    response.end(JSON.stringify(messages));
    return;
  }
  if (request.method !== "POST" || request.url !== "/emails") {
    response.writeHead(404).end("{}");
    return;
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 5_000_000) {
      response.writeHead(413).end("{}");
      return;
    }
  }
  try {
    const email = JSON.parse(body);
    const key = request.headers["idempotency-key"];
    let id = key && keys.get(key);
    if (!id) {
      id = randomUUID();
      const row = { id, ...email };
      messages.push(row);
      appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
      if (key) keys.set(key, id);
    }
    response.end(JSON.stringify({ id }));
  } catch {
    response.writeHead(400).end(JSON.stringify({ message: "Invalid JSON" }));
  }
}).listen(Number(port), "127.0.0.1");
