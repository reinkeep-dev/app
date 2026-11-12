// Turns the tested TypeScript engine into plain JavaScript the browser can import.
// The site's "Try the Gate" runs the SAME evaluate() that the tests cover, not a separate copy of the rules.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site", "engine");
mkdirSync(out, { recursive: true });

for (const name of ["policy"]) {
  const ts = readFileSync(join(root, "engine", `${name}.ts`), "utf8");
  writeFileSync(join(out, `${name}.js`), stripTypeScriptTypes(ts, { mode: "strip" }));
  console.log(`built site/engine/${name}.js`);
}
