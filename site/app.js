import { evaluate, defaultPolicy, ROBINHOOD_CHAIN, USDG_ROBINHOOD } from "./engine/policy.js";

const $ = (id) => document.getElementById(id);
const KNOWN = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x000000000000000000000000000000000000dEaD";
const ETH_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const NOW = 1_700_000_000_000; // fixed so the same inputs always give the same receipt

const WORD = { allow: "ALLOW", approve: "REVIEW", deny: "BLOCK" };
const KEY = { allow: "allow", approve: "review", deny: "block" };
const WHY = {
  allow: "Inside every rule. Safe to sign.",
  approve: "A human decides once before this is signed.",
  deny: "Never reaches the signer.",
};

const json = (url) => fetch(url).then((r) => r.json());
let plain = {};

function buildRequest() {
  const amount = BigInt(Math.round(Number($("in-amount").value) * 1e6));
  const moved = $("in-moved").checked;
  const wrong = $("in-chain").value === "wrong";
  const payee = $("in-payee").value;
  return {
    network: wrong ? "eip155:1" : ROBINHOOD_CHAIN,
    asset: wrong ? ETH_USDC : USDG_ROBINHOOD,
    amount: amount.toString(),
    decimals: 6,
    payTo: payee === "stranger" ? STRANGER : KNOWN.replace(/1/g, payee === "new" ? "2" : "1"),
    resourceUrl: ($("in-http").checked ? "http" : "https") + "://api.example-vendor.com/data",
    validForSeconds: 60,
    quotedAmount: moved ? (amount * 100n / 108n).toString() : undefined,
    now: NOW,
  };
}

function buildPolicy() {
  return { ...defaultPolicy, perPaymentUsd: Number($("in-limit").value), allowPayTo: [KNOWN] };
}

async function sha(text) {
  if (!crypto.subtle) return "n/a";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let run = 0;
async function update() {
  $("out-limit").textContent = "$" + Number($("in-limit").value).toFixed(2);
  $("out-amount").textContent = "$" + Number($("in-amount").value).toFixed(2);
  const req = buildRequest();
  const res = evaluate(req, buildPolicy(), []);
  const k = KEY[res.verdict];
  $("verdict").dataset.v = k;
  $("verdict-word").textContent = WORD[res.verdict];
  $("verdict-why").textContent = WHY[res.verdict];
  const ul = $("reasons");
  ul.replaceChildren();
  if (!res.reasons.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = "No rule fired.";
    ul.append(li);
  }
  for (const code of res.reasons) {
    const li = document.createElement("li");
    const c = document.createElement("code");
    c.textContent = code;
    const s = document.createElement("span");
    s.textContent = plain[code] || "";
    li.append(c, s);
    ul.append(li);
  }
  const body = JSON.stringify(req, null, 2);
  $("json-out").textContent = body;
  const my = ++run;
  const h = await sha(body + res.verdict + res.reasons.join(","));
  if (my === run) $("receipt").textContent = "rk_" + h.slice(0, 8);
}

function renderRules(rules) {
  const ul = $("rule-list");
  rules.forEach((r, i) => {
    const li = document.createElement("li");
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = String(i + 1).padStart(2, "0");
    const head = document.createElement("div");
    const code = document.createElement("code");
    code.textContent = r.code;
    const k = document.createElement("span");
    k.className = "k k--" + r.kind;
    k.textContent = r.kind === "deny" ? "blocks" : "asks a human";
    head.append(code, k);
    const p = document.createElement("p");
    p.textContent = r.plain;
    li.append(n, head, p);
    ul.append(li);
  });
}

function renderRoadmap(items) {
  const label = { live: "Live", building: "Building", next: "Next" };
  const cls = { live: "tag--live", building: "tag--build", next: "tag--build" };
  const ul = $("roadmap");
  for (const it of items) {
    const li = document.createElement("li");
    const t = document.createElement("p");
    t.className = "tag " + cls[it.state];
    t.textContent = label[it.state];
    const d = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = it.title;
    const p = document.createElement("p");
    p.textContent = it.text;
    d.append(b, p);
    li.append(t, d);
    ul.append(li);
  }
}

const TABS = {
  signer: {
    note: "Wrap the function that signs. A blocked payment never gets a signature, whatever the agent asks.",
    code: "import { guardedSign } from './src/sign.ts'\n\nconst out = await guardedSign(paymentRequest, () => realSigner(paymentRequest), paths)\n// out.signed is false on BLOCK or REVIEW. The signer function never runs.",
  },
  mcp: {
    note: "Gives the agent check tools. It advises only: an agent that skips the call is not stopped. No approve tool is exposed.",
    code: "node src/mcp-stdio.ts\n\n# tools: guard_check, guard_risk, guard_status",
  },
  cli: {
    note: "Ask from a terminal or a script. Exit code 0 is ALLOW, 2 is REVIEW, 3 is BLOCK.",
    code: "node src/cli.ts check --request '<json>'\nnode src/cli.ts verify    # is the audit log intact?",
  },
};

function setupTabs() {
  const buttons = document.querySelectorAll("[data-tab]");
  const show = (b) => {
    buttons.forEach((x) => {
      const on = x === b;
      x.setAttribute("aria-selected", on);
      x.tabIndex = on ? 0 : -1;
    });
    $("panel").setAttribute("aria-labelledby", b.id);
    $("panel-note").textContent = TABS[b.dataset.tab].note;
    $("panel-code").textContent = TABS[b.dataset.tab].code;
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => show(b));
    b.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const n = buttons[(i + d + buttons.length) % buttons.length];
      n.focus();
      show(n);
    });
  });
  show(buttons[0]);
}

function reveal() {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) { els.forEach((e) => e.classList.add("in")); return; }
  els.forEach((e) => e.classList.add("pre"));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  els.forEach((e) => io.observe(e));
}

async function main() {
  const [rules, limits, roadmap] = await Promise.all([json("data/rules.json"), json("data/limits.json"), json("data/roadmap.json")]);
  plain = Object.fromEntries(rules.map((r) => [r.code, r.plain]));
  renderRules(rules);
  renderRoadmap(roadmap);
  const ul = $("limit-list");
  for (const t of limits) { const li = document.createElement("li"); li.textContent = t; ul.append(li); }
  setupTabs();
  $("gate-form").addEventListener("input", update);
  await update();
  reveal();
}
main();
