// check-no-node.mjs — Store-Bauart (Spec 8): kein Node-Modul in src/ (ohne src/vendor).
// Das Plugin laeuft auch auf dem Handy (isDesktopOnly: false); `fs`, `path`, `zlib`, `crypto`,
// `node:*` und `Buffer` gibt es dort nicht. Vendorte Kit-Dateien prueft ihr eigener Eintrag.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] ?? "src";
const SKIP = join(ROOT, "vendor");
// import ... from 'fs' | import 'fs' | require('fs') | import('fs'), auch 'fs/promises', 'path/posix'
const MODULE = /(?:from|import|require)\s*\(?\s*['"](?:fs|path|zlib|crypto)(?:\/[\w./-]*)?['"]/;
const NODE_PREFIX = /['"]node:/;
const BUFFER = /\bBuffer\./;

const hits = [];

function walk(dir) {
  if (dir === SKIP) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(p)) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (MODULE.test(line) || NODE_PREFIX.test(line) || BUFFER.test(line)) {
          hits.push(`${p}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
}

try {
  walk(ROOT);
} catch (err) {
  console.error(`check-no-node: ${ROOT} nicht lesbar: ${err.message}`);
  process.exit(2);
}

if (hits.length > 0) {
  console.error("check-no-node: FEHLER — Node-Module in src/ (ohne src/vendor):");
  for (const h of hits) console.error(`  ${h}`);
  console.error("Das Plugin ist nicht desktop-only; fs/path/zlib/crypto/node:/Buffer gibt es am Handy nicht.");
  process.exit(1);
}
console.log("check-no-node: OK — kein Node-Modul in src/ (ohne src/vendor)");
