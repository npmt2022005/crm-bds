import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import "./crm-agent.js";

const port = Number(process.env.MERAKI_PORT || 8766);
const host = "127.0.0.1";
const origin = "http://" + host + ":" + port;
const modelEndpoint = "http://127.0.0.1:1234/v1";
const model = process.env.MERAKI_MODEL || "meraki-agent";
const crmAgent = globalThis.createCrmAgent({});
const assetTypes = new Map([
  ["/index.html", "text/html; charset=utf-8"],
  ["/meraki.css", "text/css; charset=utf-8"],
  ["/customer-data.js", "text/javascript; charset=utf-8"],
  ["/escrow-pdf.js", "text/javascript; charset=utf-8"],
  ["/crm-agent.js", "text/javascript; charset=utf-8"],
  ["/project-cover.jpg", "image/jpeg"],
  ["/vendor/jspdf.umd.min.js", "text/javascript; charset=utf-8"],
  ["/vendor/xlsx-0.20.3.full.min.js", "text/javascript; charset=utf-8"],
  ["/vendor/NotoSans-Regular.ttf", "font/ttf"]
]);

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function plan(req, res) {
  if (req.headers.origin !== origin || !req.headers["content-type"]?.startsWith("application/json")) {
    return json(res, 403, { error: "Request must come from the local CRM." });
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 24000) return json(res, 413, { error: "Request is too large." });
  }
  let messages, profile;
  try { ({ messages, profile } = JSON.parse(body)); }
  catch { return json(res, 400, { error: "Invalid request." }); }
  if (!Array.isArray(messages) || !messages.length || messages.length > 10) {
    return json(res, 400, { error: "Invalid messages." });
  }
  const tools = crmAgent.listTools(profile).map((entry) => ({ type: "function", function: entry }));
  if (!tools.length) return json(res, 400, { error: "Unknown Agent." });
  const upstream = await fetch(modelEndpoint + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.1, max_tokens: 700 }),
    signal: AbortSignal.timeout(45000)
  });
  if (!upstream.ok) return json(res, 503, { error: "Local model is unavailable." });
  const result = await upstream.json();
  return json(res, 200, { message: result.choices?.[0]?.message });
}

createServer(async (req, res) => {
  if (req.headers.host !== host + ":" + port) return json(res, 403, { error: "Invalid host." });
  const path = new URL(req.url, origin).pathname;
  try {
    if (req.method === "POST" && path === "/api/agent-plan") return await plan(req, res);
    if (req.method !== "GET") return json(res, 405, { error: "Unsupported request." });
    const asset = path === "/" ? "/index.html" : path;
    if (!assetTypes.has(asset)) return json(res, 404, { error: "Not found." });
    const file = await readFile(new URL("." + asset, import.meta.url));
    res.writeHead(200, { "Content-Type": assetTypes.get(asset), "Cache-Control": "no-cache" });
    res.end(asset === "/index.html" ? file.toString().replace("</head>",
      '<meta name="meraki-local-agent" content="true"></head>') : file);
  } catch {
    if (!res.headersSent) json(res, 503, { error: "Local CRM or model is unavailable." });
    else res.end();
  }
}).listen(port, host, () => console.log("Meraki Land with local AI · " + origin));
