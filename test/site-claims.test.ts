// Numbers the website states about the API must match the API itself. The site said "16 MCP tools" for a day after
// token_autopsy was taken down (2026-11-18); this keeps the count honest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleMcp } from "../api/src/mcp.ts";

const listTools = async (): Promise<string[]> => {
  const req = new Request("https://gate.test/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const res = await handleMcp(req, async () => new Response("{}"));
  return (await res.json()).result.tools.map((t: { name: string }) => t.name);
};

test("the MCP tool count on the website and roadmap is the real one", async () => {
  const n = (await listTools()).length;
  const agents = readFileSync(new URL("../site-family/src/sections/agents-section.tsx", import.meta.url), "utf8");
  assert.match(agents, new RegExp(`big: '${n}', small: 'MCP tools'`));
  const roadmap = JSON.parse(readFileSync(new URL("../site/data/roadmap.json", import.meta.url), "utf8")) as { title: string; text: string }[];
  const mcp = roadmap.find((x) => x.title === "Remote MCP and agent discovery")!;
  assert.match(mcp.text, new RegExp(`with ${n} tools`));
});

test("nothing taken down is still listed as live", () => {
  const roadmap = JSON.parse(readFileSync(new URL("../site/data/roadmap.json", import.meta.url), "utf8")) as { state: string; title: string; text: string }[];
  for (const x of roadmap.filter((r) => r.state === "live")) assert.doesNotMatch(`${x.title} ${x.text}`, /autopsy/i, x.title);
});
