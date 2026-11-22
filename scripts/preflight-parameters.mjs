// Pre-flight of deploy-time parameters, BEFORE any CloudFormation call.
//
// Why this exists (spec 04 A-06 / D-52): CloudFormation validates Parameters one at a time, so a
// non-compliant GitHub environment secret costs one whole pipeline run PER parameter, with a red
// deploy and zero resources each time (runs #4 proved it with WebhookSecretParam's ^\S{16,}$).
// This script checks every NoEcho parameter of template.yaml against its own AllowedPattern in a
// single pass and fails listing ONLY the parameter name, the secret name and the rule - never a
// value, a length, a prefix or a hash.
//
// The patterns are PARSED from template.yaml (single source of truth: the contract that CFN itself
// enforces), not duplicated here. Dependency-free by construction: the deploy job has no
// node_modules (it never runs pnpm install), so this file may only use Node builtins.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(REPO_ROOT, 'template.yaml');

// Which GitHub environment secret feeds which template parameter (deploy.yml's --parameter-overrides).
// Exported so the test can assert COMPLETE coverage: a future NoEcho parameter that is not bound
// here fails the gate instead of being silently unchecked at deploy time.
export const PARAMETER_BINDINGS = [
  { param: 'TelegramBotTokenParam', secret: 'TELEGRAM_BOT_TOKEN' },
  { param: 'AdminApiKeyParam', secret: 'ADMIN_API_KEY' },
  { param: 'WebhookSecretParam', secret: 'TELEGRAM_WEBHOOK_SECRET' },
];
const BINDINGS = PARAMETER_BINDINGS;

// Minimal, deliberate YAML scrape: a parameter block runs until the next top-level key, and the
// only fields we need are NoEcho and AllowedPattern. Not a YAML parser on purpose (no deps in CI).
export function readAllowedPatterns(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^Parameters:\s*$/.test(l));
  if (start < 0) throw new Error('template.yaml: no Parameters block');
  const out = {};
  let current = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[A-Za-z0-9]/.test(line)) break; // next top-level section
    const paramMatch = line.match(/^ {2}([A-Za-z0-9]+):\s*$/);
    if (paramMatch) {
      current = paramMatch[1];
      out[current] = { pattern: null, noEcho: false };
      continue;
    }
    if (!current) continue;
    const patternMatch = line.match(/^\s{4}AllowedPattern:\s*'([^']+)'|^\s{4}AllowedPattern:\s*"([^"]+)"|^\s{4}AllowedPattern:\s*(\S.*)$/);
    if (patternMatch) out[current].pattern = (patternMatch[1] ?? patternMatch[2] ?? patternMatch[3]).trim();
    if (/^\s{4}NoEcho:\s*true\s*$/.test(line)) out[current].noEcho = true;
  }
  return out;
}

export function evaluate(values, patterns) {
  const results = [];
  for (const { param, secret } of BINDINGS) {
    const rule = patterns[param];
    if (!rule || !rule.pattern) {
      results.push({ param, secret, status: 'CONFIG', detail: 'template.yaml declares no AllowedPattern' });
      continue;
    }
    const raw = values[secret];
    if (raw === undefined || raw === '') {
      // A missing secret name is a different fault than a bad value: say so, still without leaking.
      results.push({ param, secret, status: 'MISSING', detail: 'secret is absent or empty' });
      continue;
    }
    const re = new RegExp(rule.pattern);
    results.push({
      param,
      secret,
      status: re.test(raw) ? 'OK' : 'BAD',
      detail: re.test(raw) ? undefined : `must match ${rule.pattern}`,
    });
  }
  return results;
}

// The only output contract: parameter/secret NAMES + the rule. Never value, length, prefix or hash.
function report(results) {
  for (const r of results) {
    if (r.status === 'OK') {
      process.stdout.write(`preflight: ${r.param} (${r.secret}) OK\n`);
    } else {
      process.stdout.write(`preflight: ${r.param} (${r.secret}) ${r.status} - ${r.detail}\n`);
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const patterns = readAllowedPatterns(readFileSync(TEMPLATE, 'utf8'));
  const values = Object.fromEntries(BINDINGS.map(({ secret }) => [secret, process.env[secret]]));
  const results = evaluate(values, patterns);
  report(results);
  const bad = results.filter((r) => r.status !== 'OK');
  if (bad.length > 0) {
    process.stderr.write(
      `preflight FAILED: ${bad.length} parameter(s) would be rejected by CloudFormation ` +
        `(${bad.map((b) => b.param).join(', ')}). Fix the GitHub environment secrets - ` +
        'nothing was sent to AWS.\n'
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('preflight: all deploy-time parameters match the template contract\n');
  }
}
