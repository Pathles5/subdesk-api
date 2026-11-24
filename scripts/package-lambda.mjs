// package-lambda — deterministic Lambda artifact staging for SubDesk API (phase 04, runbook §2.5).
// Purpose (D3 hazard, fresh-eyes 2026-11-22): the deploy artifact MUST be built by explicit staging,
// never by `sam package` filtering that honors .gitignore (node_modules is git-ignored -> a naive
// package would upload a ZIP WITHOUT dependencies). This script builds dist/lambda/ containing only
// src/, a production-trimmed package.json and a FLAT production node_modules, then zips it and
// HARD-ASSERTS the content before anything can be uploaded.
//
// Contract with CI (deploy.yml `package` job):
//   1. runs on ubuntu-latest (needs the `zip` CLI; refuses to guess alternatives)
//   2. the checkout is freshly installed with:
//        pnpm install --prod --frozen-lockfile --config.nodeLinker=hoisted
//      (if devDeps leak into node_modules, asserts below abort the build — fail-closed by design)
//   3. node scripts/package-lambda.mjs  ->  dist/lambda/**  +  dist/artifact.zip
//   4. template.yaml CodeUri points at dist/lambda (staging IS the artifact; no .samignore magic)
//
// Constitution refs: I2 (zip <= 45 MB direct limit), I4 (no .env in artifact), D-30/D-31 (flat tree,
// zero symlinks), I4b (prod deps exactly the package.json pins, nothing exotic).
//
// Byte-reproducibility (T-17 / D-73): the ZIP that actually gets deployed is the one `sam package`
// builds from dist/lambda (dist/artifact.zip is FORENSIC only — deploy.yml uploads it for post-mortem
// and never sends it to S3 as code). So what makes a push a no-op for CloudFormation is the staging
// tree being byte-stable, and the dominant source of drift was timestamps: actions/checkout stamps
// files with the run's time and fs.cpSync stamps copies with "now". Every entry of dist/lambda is
// therefore normalized to a fixed epoch before the asserts run, and an assert verifies the
// normalization actually took effect (fail-closed). Consequence: a docs-only push produces the same
// artifact hash, `sam package` emits the same template, `sam deploy` finds no changes and
// --no-fail-on-empty-changeset (deploy.yml) keeps the run green without touching the Lambda.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ARTIFACT_EPOCH_MS, normalizeMtimes, findNonNormalized, collectSortedRelPaths, findLockfileGaps } from "./package-lambda-lib.mjs";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "lambda");
const ZIP = path.join(DIST, "artifact.zip");
const MIN_ZIP_BYTES = 250 * 1024; // spike evidence ~1 MB; floor guards against an empty tree
const MAX_ZIP_BYTES = 45 * 1024 * 1024; // CFN direct-upload limit is 50 MB; leave margin

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const note = (m) => notes.push(m);

// ---------- pre-flight ----------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
if (pkg.type !== "module") fail("package.json is not ESM (type: module)");
for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+$/.test(spec)) fail(`prod dependency ${name}@${spec} is not an exact pin (I4b)`);
}
const srcDir = path.join(ROOT, "src");
const nmDir = path.join(ROOT, "node_modules");
if (!fs.existsSync(srcDir)) fail("src/ missing in cwd");
if (!fs.existsSync(nmDir)) fail("node_modules missing: run pnpm install --prod --frozen-lockfile first");
// linker sanity: hoisted means REAL dirs at top level, not symlinks into .pnpm (cpSync would
// silently materialize a linked tree and ship a bloated ZIP — guard the SOURCE before copying).
for (const name of Object.keys(pkg.dependencies ?? {})) {
  const p = path.join(nmDir, name);
  if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) fail(`${name} is a symlink in node_modules: linker is NOT hoisted (use --config.nodeLinker=hoisted)`);
}

// ---------- clean staging ----------
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

fs.cpSync(srcDir, path.join(STAGE, "src"), { recursive: true });
fs.cpSync(nmDir, path.join(STAGE, "node_modules"), { recursive: true });

// trimmed package.json: runtime manifest only
fs.writeFileSync(
  path.join(STAGE, "package.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, description: pkg.description ?? "SubDesk API runtime", type: "module", engines: pkg.engines, dependencies: pkg.dependencies },
    null,
    2,
  ) + "\n",
);

// ---------- deterministic mtimes (T-17 / D-73) ----------
// Runs AFTER every write into the staging tree and BEFORE the asserts, so nothing can re-stamp an
// entry once it has been normalized. `sam package` reads these mtimes when it builds the deployed
// ZIP, and the handoff tarball preserves them (tar -czf/-xzf keep mtimes).
const stamped = normalizeMtimes(STAGE);

// ---------- hard asserts (fail-closed) ----------
const prodNames = Object.keys(pkg.dependencies ?? {});
for (const name of prodNames) {
  const pj = path.join(STAGE, "node_modules", name, "package.json");
  if (!fs.existsSync(pj)) {
    fail(`prod dependency ${name} missing from staging node_modules`);
    continue;
  }
  const stagedVersion = JSON.parse(fs.readFileSync(pj, "utf8")).version;
  if (stagedVersion !== pkg.dependencies[name]) fail(`${name} staged at ${stagedVersion}, expected exact pin ${pkg.dependencies[name]}`);
}
for (const dev of Object.keys(pkg.devDependencies ?? {})) {
  if (fs.existsSync(path.join(STAGE, "node_modules", dev))) fail(`devDependency ${dev} leaked into the artifact (prod install required)`);
}
// lockfile cross-check (text scan; js-yaml is a devDep and this job runs --prod — keep zero deps here)
const lockRaw = fs.readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
// NOTE: the key FORM matters here — pnpm lockfile v9 quotes scoped keys. See findLockfileGaps (D-74).
for (const key of findLockfileGaps(lockRaw, pkg.dependencies)) {
  fail(`${key} not found as an exact entry in pnpm-lock.yaml (neither the bare nor the YAML-quoted key form)`);
}
// no env files anywhere in staging
const envHits = [];
const walk = (dir, onVisit) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, onVisit);
    else onVisit(p, e);
  }
};
walk(STAGE, (p) => {
  const base = path.basename(p);
  if (base === ".env" || base.startsWith(".env.")) envHits.push(p);
});
if (envHits.length) fail(`.env file(s) reached the staging: ${envHits.join(", ")}`);
// handler sanity: src/lambda.js exists and does not read process.env directly (D-17 single reader)
const lambdaJs = path.join(STAGE, "src", "lambda.js");
if (!fs.existsSync(lambdaJs)) fail("src/lambda.js missing (Handler: src/lambda.handler)");
else if (/process\.env/.test(fs.readFileSync(lambdaJs, "utf8"))) fail("src/lambda.js touches process.env (must be config.js only — D-17)");
// symlink sweep (D-31 invariant): the ZIP must not contain reparse points
const links = [];
walk(STAGE, (_p, e) => {
  if (e.isSymbolicLink()) links.push(path.relative(STAGE, _p));
});
if (links.length) fail(`symlinks found in staging (Lambda ZIP cannot contain them): ${links.slice(0, 5).join(", ")}${links.length > 5 ? "…" : ""}`);

// mtime normalization took effect (T-17 / D-73): without this check the normalization above would
// be a promise, not a guarantee. Negative is demonstrable — create a file after normalizeMtimes and
// this returns it (see tests/pipeline/package-lambda.test.js).
const notNormalized = findNonNormalized(STAGE);
if (notNormalized.length) {
  fail(`staging mtimes are NOT normalized to ${new Date(ARTIFACT_EPOCH_MS).toISOString()}: ${notNormalized.length} entry/entries, e.g. ${notNormalized.slice(0, 3).join(", ")} - the artifact would not be byte-reproducible and every push would re-deploy the Lambda`);
} else {
  note(`staging mtimes normalized to ${new Date(ARTIFACT_EPOCH_MS).toISOString()} across ${stamped} entries (byte-reproducible artifact)`);
}

// ---------- zip (FORENSIC copy: the deployed ZIP is the one `sam package` builds from STAGE) ----------
if (!failures.length) {
  // Sorted file list fed through stdin instead of `zip -r .`, so the archive does not depend on
  // readdir order either, plus `-X` to drop the extra attributes (uid/gid) that differ per runner.
  const zipEntries = collectSortedRelPaths(STAGE);
  if (!zipEntries.length) fail("staging contains no files: nothing to archive");
  else if (zipEntries.some((p) => p.includes("\n"))) fail("staging contains a filename with a newline: it cannot be fed to `zip -@` safely");
  else {
    fs.rmSync(ZIP, { force: true });
    const z = spawnSync("zip", ["-q", "-X", ZIP, "-@"], { cwd: STAGE, encoding: "utf8", input: zipEntries.join("\n") + "\n" });
    if (z.status !== 0) fail(`zip CLI failed (runner must provide it; this tool is CI-only by design): ${z.stderr ?? z.error ?? "unknown"}`);
    else {
      const size = fs.statSync(ZIP).size;
      if (size < MIN_ZIP_BYTES) fail(`artifact.zip suspiciously small: ${size} B < ${MIN_ZIP_BYTES} B floor`);
      if (size > MAX_ZIP_BYTES) fail(`artifact.zip exceeds 45 MB direct-upload guard: ${size} B`);
      else note(`artifact.zip ${Math.round(size / 1024)} KB from ${zipEntries.length} sorted entries (limits: floor 250 KB / guard 45 MB)`);
    }
  }
}

// ---------- report ----------
for (const n of notes) console.log("OK   " + n);
for (const f of failures) console.error("FAIL " + f);
if (failures.length) {
  console.error(`\npackage-lambda: ${failures.length} assert(s) failed — deploy MUST NOT proceed (runbook §2.5).`);
  process.exit(1);
}
console.log(`\npackage-lambda: staging dist/lambda/ + dist/artifact.zip listos (${prodNames.length} paq. prod: ${prodNames.join(", ")}).`);
