// package-lambda-lib — pure helpers for scripts/package-lambda.mjs (T-17, D-73).
//
// Why a separate module: package-lambda.mjs is CI-only by design (it needs the `zip` binary and a
// production-only node_modules, and it aborts fail-closed on a dev machine). Splitting the
// determinism logic out makes it unit-testable anywhere, with Node builtins only — the `package`
// job installs `--prod`, so neither this module nor its caller may ever need a devDependency.
//
// The problem this solves: `actions/checkout` stamps files with the run's time and `fs.cpSync`
// (preserveTimestamps defaults to false) stamps the copies with "now", so the staging tree differed
// on EVERY run even when the content was identical. The deployed ZIP is built by `sam package` from
// that tree (dist/artifact.zip is forensic only), so the timestamps travel through the handoff
// tarball into the artifact bytes -> a new S3 key -> CloudFormation sees a code change -> the Lambda
// is updated even by a docs-only push. Observed on run #12 (`45218559578`, commit `cd65674`):
// `UPDATE_COMPLETE AWS::Lambda::Function` with zero changes under src/ or package.json.
//
// Note on granularity: ZIP entries store DOS timestamps with 2-SECOND resolution, so the fixed
// epoch must be an even number of seconds; comparisons are done at second granularity to stay
// correct on filesystems with coarser mtime precision.
import fs from "node:fs";
import path from "node:path";

/** Fixed mtime (atime and mtime) for every staging entry: 2020-01-01T00:00:00.000Z. */
export const ARTIFACT_EPOCH_MS = Date.UTC(2020, 0, 1, 0, 0, 0);

/**
 * Absolute paths of every entry under `dir` (files and directories, pre-order).
 * Symlinks are returned but never followed.
 */
export function collectEntries(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(p);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Stamp every entry under `dir` with `epochMs` and return how many were stamped.
 * Deepest-first, so no later write can re-stamp a parent directory. Symlinks are skipped on
 * purpose: `fs.utimesSync` would follow them, and their presence is a hard failure of the caller's
 * own symlink assert (D-31) anyway.
 */
export function normalizeMtimes(dir, epochMs = ARTIFACT_EPOCH_MS) {
  const when = new Date(epochMs);
  const entries = collectEntries(dir);
  entries.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  let stamped = 0;
  for (const p of entries) {
    if (fs.lstatSync(p).isSymbolicLink()) continue;
    fs.utimesSync(p, when, when);
    stamped++;
  }
  return stamped;
}

/**
 * Relative POSIX paths of the entries whose mtime is NOT the expected epoch (second granularity).
 * Empty array == the staging is reproducible. This is what makes the caller's assert non-vacuous:
 * a file created after normalization shows up here.
 */
export function findNonNormalized(dir, epochMs = ARTIFACT_EPOCH_MS) {
  const epochSec = Math.floor(epochMs / 1000);
  const bad = [];
  for (const p of collectEntries(dir)) {
    if (fs.lstatSync(p).isSymbolicLink()) continue;
    if (Math.floor(fs.statSync(p).mtimeMs / 1000) !== epochSec) bad.push(toPosix(path.relative(dir, p)));
  }
  return bad;
}

/**
 * Relative POSIX paths of every regular file under `dir`, byte-sorted.
 * Fed to `zip -@` so the forensic archive does not depend on readdir order either.
 */
export function collectSortedRelPaths(dir) {
  const files = [];
  for (const p of collectEntries(dir)) {
    if (fs.lstatSync(p).isFile()) files.push(toPosix(path.relative(dir, p)));
  }
  files.sort();
  return files;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

/**
 * Lockfile cross-check without a YAML parser: js-yaml is a devDependency and this script runs in a
 * `--prod` install, so it must stay zero-dep (text scan by design). Returns the `name@spec` entries
 * that cannot be found in the raw lockfile text.
 *
 * pnpm lockfile v9 QUOTES the keys whose package name starts with a special character, so a scoped
 * dependency appears as `'@scope/name@1.2.3':` while an unscoped one appears as `name@1.2.3:`.
 * Only the bare form used to be checked, which meant every scoped prod dependency failed the assert:
 * a latent defect since T-05 (both prod deps were unscoped) that surfaced with D-68, when
 * `@aws-sdk/*` became the first scoped prod dependency. Both forms are accepted now.
 */
export function findLockfileGaps(lockRaw, dependencies) {
  const missing = [];
  for (const [name, spec] of Object.entries(dependencies ?? {})) {
    const key = `${name}@${spec}`;
    if (!lockRaw.includes(`${key}:`) && !lockRaw.includes(`'${key}':`)) missing.push(key);
  }
  return missing;
}
