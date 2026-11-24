// tests/pipeline/package-lambda.test.js — unit tests for scripts/package-lambda-lib.mjs (T-17, D-73/D-74).
//
// Why these live here and not against the CLI: scripts/package-lambda.mjs is CI-only by design (it
// needs the `zip` binary and a --prod node_modules, and it aborts fail-closed on a dev machine), so
// the determinism logic was split into a zero-dependency module that CAN be tested anywhere.
// Every test uses a throwaway fixture under the OS temp dir: no network, no AWS, no repo writes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ARTIFACT_EPOCH_MS,
  normalizeMtimes,
  findNonNormalized,
  collectSortedRelPaths,
  findLockfileGaps,
} from "../../scripts/package-lambda-lib.mjs";

function withFixture(build, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-lambda-"));
  try {
    build(dir);
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- T-17 / D-73: deterministic mtimes ----------

test("ARTIFACT_EPOCH_MS is a whole, EVEN number of seconds (ZIP stores DOS time with 2 s resolution)", () => {
  assert.equal(ARTIFACT_EPOCH_MS % 1000, 0, "epoch must not carry milliseconds");
  assert.equal((ARTIFACT_EPOCH_MS / 1000) % 2, 0, "an odd second would be rounded by the ZIP format");
});

test("normalizeMtimes stamps every file AND directory, leaving nothing un-normalized", () => {
  withFixture(
    (d) => {
      fs.mkdirSync(path.join(d, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(path.join(d, "node_modules", "pkg", "index.js"), "export default 1;");
      fs.writeFileSync(path.join(d, "package.json"), "{}");
      // deliberately heterogeneous mtimes, as a real checkout + cpSync would leave them
      fs.utimesSync(path.join(d, "package.json"), new Date("2001-05-04T03:02:01Z"), new Date("2001-05-04T03:02:01Z"));
      fs.utimesSync(path.join(d, "node_modules"), new Date("2030-12-31T23:59:58Z"), new Date("2030-12-31T23:59:58Z"));
    },
    (d) => {
      assert.ok(findNonNormalized(d).length > 0, "fixture must start heterogeneous, else the test proves nothing");
      const stamped = normalizeMtimes(d);
      assert.equal(stamped, 4, "package.json + node_modules + node_modules/pkg + pkg/index.js");
      assert.deepEqual(findNonNormalized(d), []);
      for (const rel of ["package.json", "node_modules", "node_modules/pkg", "node_modules/pkg/index.js"]) {
        const ms = fs.statSync(path.join(d, rel)).mtimeMs;
        assert.equal(Math.floor(ms / 1000), ARTIFACT_EPOCH_MS / 1000, `${rel} must sit on the artifact epoch`);
      }
    },
  );
});

test("the normalization assert is NOT vacuous: an entry written afterwards is reported", () => {
  withFixture(
    (d) => {
      fs.mkdirSync(path.join(d, "src"), { recursive: true });
      fs.writeFileSync(path.join(d, "src", "lambda.js"), "export const handler = () => {};");
    },
    (d) => {
      normalizeMtimes(d);
      assert.deepEqual(findNonNormalized(d), []);
      // the real CI hazard: anything written after normalization re-stamps itself AND its parent dir
      fs.writeFileSync(path.join(d, "src", "late.js"), "x");
      const bad = findNonNormalized(d);
      assert.deepEqual(bad.sort(), ["src", "src/late.js"]);
    },
  );
});

test("findNonNormalized compares at second granularity, so a coarse-precision filesystem still passes", () => {
  withFixture(
    (d) => {
      fs.writeFileSync(path.join(d, "f.txt"), "x");
    },
    (d) => {
      normalizeMtimes(d);
      // push mtime 999 ms forward inside the same second: still the same epoch second
      const t = new Date(ARTIFACT_EPOCH_MS + 999);
      fs.utimesSync(path.join(d, "f.txt"), t, t);
      assert.deepEqual(findNonNormalized(d), []);
      // one more millisecond crosses into the next second and MUST be caught
      const t2 = new Date(ARTIFACT_EPOCH_MS + 1000);
      fs.utimesSync(path.join(d, "f.txt"), t2, t2);
      assert.deepEqual(findNonNormalized(d), ["f.txt"]);
    },
  );
});

test("collectSortedRelPaths returns byte-sorted POSIX file paths and no directories", () => {
  withFixture(
    (d) => {
      fs.mkdirSync(path.join(d, "z-dir"), { recursive: true });
      fs.mkdirSync(path.join(d, "@scope", "pkg"), { recursive: true });
      fs.writeFileSync(path.join(d, "z-dir", "b.txt"), "b");
      fs.writeFileSync(path.join(d, "z-dir", "a.txt"), "a");
      fs.writeFileSync(path.join(d, "@scope", "pkg", "package.json"), "{}");
    },
    (d) => {
      assert.deepEqual(collectSortedRelPaths(d), [
        "@scope/pkg/package.json",
        "z-dir/a.txt",
        "z-dir/b.txt",
      ]);
    },
  );
});

// ---------- D-74: lockfile cross-check must accept pnpm v9 quoted scoped keys ----------

// Shape of a real pnpm lockfile v9: unscoped keys are bare, scoped keys are single-quoted.
const LOCKFILE = [
  "lockfileVersion: '9.0'",
  "",
  "packages:",
  "",
  "  '@aws-sdk/client-dynamodb@3.1175.0':",
  "    resolution: {integrity: sha512-AAAA}",
  "",
  "  '@aws-sdk/lib-dynamodb@3.1175.0':",
  "    resolution: {integrity: sha512-BBBB}",
  "",
  "  express@5.3.0:",
  "    resolution: {integrity: sha512-CCCC}",
  "",
  "  serverless-http@4.0.0:",
  "    resolution: {integrity: sha512-DDDD}",
  "",
].join("\n");

test("D-74 regression: a scoped prod dependency pinned in the lockfile is NOT reported missing", () => {
  const deps = { "@aws-sdk/client-dynamodb": "3.1175.0", "@aws-sdk/lib-dynamodb": "3.1175.0" };
  assert.deepEqual(findLockfileGaps(LOCKFILE, deps), []);
  // the defect this test locks down: the bare (unquoted) key form does NOT exist in the lockfile,
  // which is exactly what the pre-D-74 assert searched for and why every scoped dep failed.
  assert.equal(LOCKFILE.includes("@aws-sdk/client-dynamodb@3.1175.0:"), false);
  assert.equal(LOCKFILE.includes("'@aws-sdk/client-dynamodb@3.1175.0':"), true);
});

test("unscoped prod dependencies keep matching through the bare key form", () => {
  assert.deepEqual(findLockfileGaps(LOCKFILE, { express: "5.3.0", "serverless-http": "4.0.0" }), []);
});

test("a pin that is absent from the lockfile IS reported (the check still bites)", () => {
  assert.deepEqual(findLockfileGaps(LOCKFILE, { express: "5.3.1" }), ["express@5.3.1"]);
  assert.deepEqual(findLockfileGaps(LOCKFILE, { "@aws-sdk/client-dynamodb": "3.999.0" }), ["@aws-sdk/client-dynamodb@3.999.0"]);
});

test("a dependency missing altogether is reported, and an empty manifest reports nothing", () => {
  assert.deepEqual(findLockfileGaps(LOCKFILE, { lodash: "4.17.21" }), ["lodash@4.17.21"]);
  assert.deepEqual(findLockfileGaps(LOCKFILE, {}), []);
  assert.deepEqual(findLockfileGaps(LOCKFILE, undefined), []);
});
