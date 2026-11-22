// Gate: a workflow step must not reference a variable it only exported to $GITHUB_ENV.
//
// Why (2026-11-22, phase 04): `load-deploy-config` writes `SAM_BUCKET=$ARTIFACTS_BUCKET` into
// $GITHUB_ENV (correct: that feeds the NEXT steps) and then logged `bucket=$SAM_BUCKET` inside the
// SAME step. $GITHUB_ENV is not sourced into the current shell, so with `set -euo pipefail` that
// reference is an unbound variable and the step aborts — a failure that exists only on the runner,
// invisible to every local gate that merely parses YAML. Caught by simulating the step under bash.
//
// Rule enforced: if a step exports KEY to $GITHUB_ENV, any later use of $KEY / ${KEY} in that same
// step must be preceded by a local assignment `KEY=` in that step.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as yaml from "js-yaml";

const WORKFLOW_DIR = ".github/workflows";

// Text of every `run:` block, per step, with the step's display name for the error message.
function runBlocks(doc) {
  const blocks = [];
  for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
    for (const [i, step] of (job.steps ?? []).entries()) {
      if (typeof step?.run === "string") {
        blocks.push({ where: `${jobId}#${i} ${step.name ?? "(unnamed)"}`, script: step.run });
      }
    }
  }
  return blocks;
}

// Variables exported to $GITHUB_ENV by a script: `echo "K=..." >> "$GITHUB_ENV"` or
// `{ echo "K=..."; } >> "$GITHUB_ENV"`.
function exportedKeys(script) {
  const keys = new Set();
  for (const m of script.matchAll(/echo\s+"?([A-Z_][A-Z0-9_]*)=/g)) keys.add(m[1]);
  return [...keys];
}

// Locally assigned variables: plain `NAME=value` at the start of a line (also inside { } blocks),
// PLUS every key of any file the script sources (`set -a; . infra/deployment.env`) — without this
// the rule would flag variables that ARE defined in the current shell and drown the real offender.
function assignedKeys(script) {
  const keys = new Set();
  for (const m of script.matchAll(/^\s*([A-Z_][A-Z0-9_]*)=/gm)) keys.add(m[1]);
  // Keys defined by sourcing a file, e.g. `set -a; . infra/deployment.env; set +a` or
  // `source infra/deployment.env`. Scanned line-wise because the marker can sit after `;` and the
  // shell options can sit before it: a single flat regex kept missing the real workflow form.
  for (const line of script.split(/\r?\n/)) {
    const sm = line.match(/(?:^|[;&|]\s*)(?:set\s+\S+\s*;\s*)?(?:\.\s+|source\s+)["']?([\w./-]+)["']?/);
    if (!sm) continue;
    try {
      for (const k of readFileSync(sm[1], "utf8").matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)) keys.add(k[1]);
    } catch {
      // Sourced file not readable from here: treat nothing as defined, so the rule stays
      // fail-closed (it reports and a human looks) instead of silently approving.
    }
  }
  return keys;
}

function references(script, key) {
  return new RegExp(`\\$\\{?${key}\\b`).test(script);
}

test("workflows parse and this gate is not vacuous (control)", () => {
  const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml"));
  assert.ok(files.length >= 2, "expected deploy.yml and prune.yml");

  // Control 1 — a synthetic offender must be reported: BAZ is exported to $GITHUB_ENV and then
  // referenced in the same step, where only FOO is defined (locally) and none of the sourced keys.
  const offender = [
    "set -euo pipefail",
    "FOO=bar",
    "{",
    '  echo "BAZ=$FOO"',
    '} >> "$GITHUB_ENV"',
    'echo "using $BAZ now"',
  ].join("\n");
  assert.ok(exportedKeys(offender).includes("BAZ"), "export detection must see BAZ");
  assert.ok(!assignedKeys(offender).has("BAZ"), "BAZ must not count as defined in-step");

  // Control 2 — the same shape with a locally defined name must NOT be reported (this is what the
  // first version of the gate got wrong for AWS_REGION/STACK_NAME, sourced from infra/deployment.env).
  const fine = [
    "set -a; . infra/deployment.env; set +a",
    "{",
    '  echo "AWS_REGION=$AWS_REGION"',
    '} >> "$GITHUB_ENV"',
    'echo "region is $AWS_REGION"',
  ].join("\n");
  assert.ok(exportedKeys(fine).includes("AWS_REGION"), "export detection must see AWS_REGION");
  assert.ok(assignedKeys(fine).has("AWS_REGION"), "sourced keys must count as defined in-step");
});

test("no step uses a variable it only exported to $GITHUB_ENV", () => {
  const offenders = [];
  for (const f of readdirSync(WORKFLOW_DIR).filter((x) => x.endsWith(".yml"))) {
    const doc = yaml.load(readFileSync(`${WORKFLOW_DIR}/${f}`, "utf8"));
    for (const { where, script } of runBlocks(doc)) {
      for (const key of exportedKeys(script)) {
        if (!references(script, key)) continue;
        // Defined in the current shell (local assignment, or a key of a sourced file) => the
        // reference is fine. This check was missing in the first version of the gate, which
        // produced ten false positives while hiding the single real offender.
        if (assignedKeys(script).has(key)) continue;
        offenders.push(`${f}: ${where} references $${key}, exported to $GITHUB_ENV but never defined in this step`);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `unbound-in-step variables (${offenders.length}):\n - ${offenders.join("\n - ")}`
  );
});
