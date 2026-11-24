// tests/pipeline/artifact-asserts.test.js — LOCAL replica of the static asserts that
// scripts/package-lambda.mjs enforces in CI (D-78).
//
// Why this file exists: the packaging asserts cannot run on a dev machine — the script needs the
// `zip` binary and a production-only node_modules, and aborts fail-closed otherwise — so until now
// a green local gate run did NOT cover them. Run #13 (`45502655048`) proved the gap: the six local
// gates were green and the CI `package` job went red on a comment that merely mentioned
// process.env. Everything replicated here is pure text/JSON reading: no zip binary, no --prod
// install, no network, no AWS, no cost (I2).
//
// Rule that comes out of it: any assert that only CI can run must have a local replica here, or
// "green locally" keeps meaning less than it appears to.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findLockfileGaps, readsProcessEnv } from "../../scripts/package-lambda-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const pkg = JSON.parse(read("package.json"));

test("package.json is ESM, which package-lambda requires of the artifact", () => {
  assert.equal(pkg.type, "module");
});

test("every production dependency is an exact pin (I4b: no ranges in the deployed artifact)", () => {
  const loose = Object.entries(pkg.dependencies ?? {}).filter(([, spec]) => !/^\d+\.\d+\.\d+$/.test(spec));
  assert.deepEqual(loose, [], `non-exact prod pins would fail the CI packaging assert: ${JSON.stringify(loose)}`);
});

test("every production dependency has an exact entry in pnpm-lock.yaml, scoped keys included (D-74)", () => {
  assert.deepEqual(findLockfileGaps(read("pnpm-lock.yaml"), pkg.dependencies), []);
});

test("src/lambda.js does not READ process.env, comments excluded (D-17 single reader, D-78)", () => {
  // This is the assert that reddened run #13. ESLint's no-process-env already covers real reads
  // (and ignores comments); this replica keeps the packaging script and the local suite in agreement.
  assert.equal(readsProcessEnv(read("src/lambda.js")), false);
});

test("src/lambda.js exists and exports the Lambda handler the template points at", () => {
  assert.match(read("src/lambda.js"), /export const handler\b/);
});

test("src/config.js is the only module of src/ that reads process.env (D-17, whole-tree sweep)", () => {
  // Non-vacuity control: the detector MUST fire on config.js, otherwise the sweep below proves
  // nothing (same discipline as every other assert in this repo: positive AND negative).
  assert.equal(readsProcessEnv(read("src/config.js")), true, "config.js really reads process.env");

  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js") && path.relative(ROOT, p) !== path.join("src", "config.js")) {
        if (readsProcessEnv(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(ROOT, p).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  assert.deepEqual(offenders, [], "modules reading process.env outside src/config.js");
});
