// docs:diagrams — export every docs/human/diagrams/*.mmd to .svg with @mermaid-js/mermaid-cli (D-33/D-41, no CDN: I8d).
// The SVG is a derived artefact: the .mmd is the versioned source (docs/human/README "Regla de frescura" 5).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = "docs/human/diagrams";
const files = readdirSync(dir).filter((f) => f.endsWith(".mmd"));
if (files.length === 0) {
  console.error("docs:diagrams: no .mmd sources found in " + dir);
  process.exit(1);
}

const mmdc = join("node_modules", ".bin", process.platform === "win32" ? "mmdc.cmd" : "mmdc");
let failures = 0;
for (const file of files) {
  const out = file.replace(/\.mmd$/, ".svg");
  const code = await new Promise((resolve) => {
    const child = spawn(mmdc, ["-i", join(dir, file), "-o", join(dir, out), "--quiet"], { shell: true });
    child.on("exit", resolve);
  });
  if (code === 0) console.log(`exported ${file} -> ${out}`);
  else {
    console.error(`FAILED ${file} (mmdc exit ${code})`);
    failures++;
  }
}
process.exit(failures ? 1 : 0);
