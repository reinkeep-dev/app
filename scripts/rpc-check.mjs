// Checks what an RPC endpoint allows for reading launches, WITHOUT ever printing the endpoint (it may hold a key).
// Run in your own terminal:   RPC_URL='https://your-endpoint' node reinkeep/scripts/rpc-check.mjs
// It reads only public chain data and prints, for each look-back size, whether eth_getLogs and eth_getBlockReceipts
// were answered or refused (and the refusal message with any URL removed).
const url = process.env.RPC_URL;
if (!url || !/^https:\/\//.test(url)) {
  console.error("Set RPC_URL to your https endpoint first, e.g.  RPC_URL='https://...' node reinkeep/scripts/rpc-check.mjs");
  process.exit(1);
}
const LAUNCHER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
const TOPIC = "0xdcacba5e347ae7abd91cb519eb877af8fa7774e347b85dd3ddcd24a2ba8cdf37";
const hex = (n) => "0x" + n.toString(16);
const scrub = (s) => String(s).replace(/https?:\/\/\S+/g, "<url>").slice(0, 140);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, params) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "reinkeep-rpc-check/0.1" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { return `HTTP ${r.status}: ${scrub(text)}`; }
    if (j.error) return `REFUSED (HTTP ${r.status}): ${scrub(j.error.message)}`;
    return Array.isArray(j.result) ? `ok, ${j.result.length} items` : "ok";
  } catch (e) {
    return `network error: ${scrub(e.message)}`;
  }
}

const head = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) }).then((r) => r.json()).catch(() => null);
const n = head && head.result ? parseInt(head.result, 16) : null;
if (n === null) { console.error("Could not read the newest block from this endpoint."); process.exit(1); }
console.log(`newest block ${n}`);
// ~9.6 blocks a second on Robinhood Chain: 10 blocks ~1 s, 128 ~13 s, 600 ~1 min, 3000 ~5 min, 20000 ~35 min
for (const back of [10, 128, 600, 3000, 20000]) {
  await wait(1500);
  const logs = await call("eth_getLogs", [{ address: LAUNCHER, topics: [TOPIC], fromBlock: hex(n - back), toBlock: hex(n) }]);
  await wait(1500);
  const receipts = await call("eth_getBlockReceipts", [hex(n - back)]);
  console.log(`${String(back).padStart(6)} blocks back | getLogs: ${logs} | receipts of that block: ${receipts}`);
}
