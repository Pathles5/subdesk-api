// Workflow YAML syntax gate (D-42 lesson, 2026-11-22): the first deploy.yml run failed at GitHub
// with a 0-second "workflow file issue" — an unquoted ": " inside a step name made the whole file
// unparseable, and no existing assert parsed workflow files. This test closes that gap: every file
// under .github/workflows must be valid YAML with a jobs map, and pnpm-workspace.yaml must parse.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as yaml from "js-yaml";

test("every workflow file parses as YAML and declares jobs or a name", () => {
  const files = readdirSync(".github/workflows").filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  assert.ok(files.length >= 2, "expected at least deploy.yml and prune.yml");
  for (const f of files) {
    const doc = yaml.load(readFileSync(`.github/workflows/${f}`, "utf8"));
    assert.ok(doc && typeof doc === "object", `${f}: empty or non-mapping root`);
    assert.ok(doc.jobs && Object.keys(doc.jobs).length > 0, `${f}: no jobs declared`);
  }
});

test("pnpm-workspace.yaml parses and keeps the registered D-41 allowBuilds list", () => {
  const ws = yaml.load(readFileSync("pnpm-workspace.yaml", "utf8"));
  assert.deepEqual(ws.allowBuilds, ["puppeteer", "@puppeteer/browsers"]);
  assert.equal(ws.strictDepBuilds, true);
});
