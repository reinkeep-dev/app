// HTML for the two small pages (/r/{id}, /status). Server-rendered, no script. Every value that is not a fixed string
// of ours goes through esc(), including values that came out of a stored receipt.
export const esc = (v: unknown): string =>
  String(v).replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c]!);

export const SITE_URL = "https://reinkeep-site.reinkeep.workers.dev";

// Light page in the site's colours (#F7F6F3 paper, #1A1A1A ink). Readable at 375px, no external font or file.
const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#F7F6F3;color:#1A1A1A;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
a{color:#1A1A1A;text-underline-offset:3px}
h1{font-size:15px;font-weight:600;margin:0 0 20px;letter-spacing:.02em}
h2{font-size:13px;font-weight:600;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:#5A5A55}
.verdict{font-size:56px;font-weight:700;line-height:1.05;margin:0 0 4px;letter-spacing:-.02em}
.ALLOW{color:#1F6F43}.REVIEW{color:#8A5A00}.BLOCK{color:#A12A2A}
.ok{color:#1F6F43}.bad{color:#A12A2A}
.muted{color:#5A5A55}
ul{padding-left:20px;margin:0}li{margin:6px 0}
dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}
dt{color:#5A5A55}dd{margin:0;overflow-wrap:anywhere}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;overflow-wrap:anywhere}
footer{margin-top:36px;padding-top:16px;border-top:1px solid #DAD8D1;font-size:14px}
@media (max-width:420px){dl{grid-template-columns:1fr}dt{margin-top:6px}}
`;

export function page(title: string, body: string, status = 200, extra: Record<string, string> = {}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      // No script and no outside resources are ever needed here, so none are allowed.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      ...extra,
    },
  });
}

export const short = (addr: string): string => (/^0x[0-9a-fA-F]{40}$/.test(addr) ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr.length > 24 ? `${addr.slice(0, 22)}…` : addr);
