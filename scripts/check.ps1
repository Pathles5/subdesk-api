# check.ps1 - Documentation + hygiene gate for the SubDesk API harness (no external dependencies).
# Validates:
#   * harness documents present (constitution, AGENTS.md, PROMPT.md, DECISIONS.md, INDEX.md, docs/harness/*)
#   * constitution keeps the cost-$0 invariant (I2 / D-11) and the security invariant (I4 / D-13)
#   * current phase (from INDEX.md) has spec.md with acceptance criteria and scope, plus tasks.md
#   * project gates exist once package.json is there (lint / test / check)
#   * if CI workflows exist, they use GitHub secrets instead of literals
#   * secret hygiene: no bot token, AWS access key or literal secret value in versionable text files
# Exit 0 = pass, exit 1 = fail.
# Usage: powershell -File scripts/check.ps1 [-Phase 00] [-RepoRoot D:\path] [-SkipSecretScan]

param(
    [string]$Phase = "",
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$SkipSecretScan
)

$ErrorActionPreference = "Stop"
$failures = @()
$notes = @()

function Add-Fail([string]$msg) { $script:failures += $msg }
function Add-Note([string]$msg) { $script:notes += $msg }

# Splits a GitHub Actions workflow into its job blocks (jobs live at 2-space indent under `jobs:`)
# WITHOUT a YAML dependency - check.ps1 must stay dependency-free (AGENTS §6). Full-line comments are
# dropped so a comment can neither satisfy nor trigger a security assert.
# Returns objects with .Id and .Body (the job's own lines, comment-free).
function Get-JobBlocks([string]$text) {
    $result = New-Object System.Collections.Generic.List[object]
    $lines = $text -split "`r?`n"
    $inJobs = $false
    $curId = $null
    $curBody = New-Object System.Collections.Generic.List[string]
    foreach ($ln in $lines) {
        if ($ln -match '^jobs:\s*$') { $inJobs = $true; continue }
        # A zero-indent key ends the jobs mapping.
        if ($inJobs -and $ln -match '^[A-Za-z0-9_-]+:') {
            if ($null -ne $curId) { $result.Add([pscustomobject]@{ Id = $curId; Body = ($curBody -join "`n") }) }
            $inJobs = $false; $curId = $null
        }
        if (-not $inJobs) { continue }
        # 2-space key = a new job.
        if ($ln -match '^  [A-Za-z0-9_."-]+:\s*$') {
            if ($null -ne $curId) { $result.Add([pscustomobject]@{ Id = $curId; Body = ($curBody -join "`n") }) }
            $curId = ($ln.Trim() -replace ':$', '')
            $curBody = New-Object System.Collections.Generic.List[string]
            continue
        }
        if ($null -eq $curId) { continue }
        if ($ln -match '^\s*#') { continue }   # comment line: cannot prove anything
        $curBody.Add($ln)
    }
    if ($null -ne $curId) { $result.Add([pscustomobject]@{ Id = $curId; Body = ($curBody -join "`n") }) }
    return $result
}

# --- Required harness documents ---
$constitutionPath = Join-Path $RepoRoot "docs/specs/constitution.md"
$decisionsPath    = Join-Path $RepoRoot "DECISIONS.md"
$indexPath        = Join-Path $RepoRoot "docs/specs/INDEX.md"
$agentsPath       = Join-Path $RepoRoot "AGENTS.md"
$promptPath       = Join-Path $RepoRoot "PROMPT.md"

foreach ($pair in @(
    @{ label = "Constitution: docs/specs/constitution.md"; path = $constitutionPath },
    @{ label = "Decisions log: DECISIONS.md";              path = $decisionsPath },
    @{ label = "Spec index: docs/specs/INDEX.md";          path = $indexPath },
    @{ label = "Harness instructions: AGENTS.md";          path = $agentsPath },
    @{ label = "Product brief: PROMPT.md";                 path = $promptPath }
)) {
    if (-not (Test-Path $pair.path)) {
        Add-Fail "Missing harness document: $($pair.label)"
    } else {
        Add-Note "$($pair.label) found."
    }
}

foreach ($template in @("tasks-format.md", "reviewer-checklist.md", "implementer-prompt-template.md")) {
    $t = Join-Path $RepoRoot "docs/harness/$template"
    if (-not (Test-Path $t)) { Add-Fail "Missing harness template: docs/harness/$template" }
}

# --- Constitution invariants (mechanical enforcement of D-11 and D-13) ---
if (Test-Path $constitutionPath) {
    $constitutionRaw = Get-Content $constitutionPath -Raw -Encoding UTF8
    if ($constitutionRaw -notmatch '(?i)coste\s*\$?\s*0|zero[- ]cost|free[- ]tier') {
        Add-Fail 'Constitution lacks the cost-$0 invariant (I2 / D-11). Restoring it is mandatory.'
    } else {
        Add-Note 'Cost-$0 invariant (D-11) present in constitution.'
    }
    if ($constitutionRaw -notmatch "(?i)x-api-key|ADMIN_API_KEY") {
        Add-Fail "Constitution lacks the security invariant (I4: x-api-key / ADMIN_API_KEY)."
    } else {
        Add-Note "Security invariant (I4) present in constitution."
    }
    if ($constitutionRaw -notmatch "(?i)spec-first|verify-after") {
        Add-Fail "Constitution lacks the SDD process invariant (I6)."
    } else {
        Add-Note "SDD process invariant (I6) present in constitution."
    }
}

# --- Parse INDEX.md phase table to find the current phase ---
$currentPhase = $null
$currentPhaseState = $null
$completedStates = @("verified", "approved", "done")
$knownStates = @("draft", "spec", "tasks", "implement", "verify", "decided", "approved", "verified", "done", "waiting", "-")
if (Test-Path $indexPath) {
    $rows = Get-Content $indexPath -Encoding UTF8 | Where-Object { $_ -match '^\s*\|\s*\d+\s*\|' }
    foreach ($row in $rows) {
        $cells = ($row.TrimStart() -replace '^\|', '' -replace '\|$', '') -split '\|'
        if ($cells.Count -lt 3) { continue }
        $id = $cells[0].Trim()
        $state = $cells[2].Trim().ToLower()
        # Dash / empty cell means "not started yet": alias of draft.
        if ($state -match '^[-\u2013\u2014]*$') { $state = "draft" }
        if ($knownStates -notcontains $state) {
            Add-Fail "INDEX.md phase $id has unknown state '$state' (allowed: $($knownStates -join ', '))."
        }
        if (-not $Phase) {
            if ($completedStates -notcontains $state -and -not $currentPhase) {
                $currentPhase = $id
                $currentPhaseState = $state
                Add-Note "Current phase: $id, state: $state"
            }
        } elseif ($id -eq $Phase) {
            $currentPhase = $id
            $currentPhaseState = $state
            Add-Note "Current phase (forced): $id, state: $state"
        }
    }
    if (-not $currentPhase) {
        if ($Phase) { $currentPhase = $Phase; Add-Note "Current phase (forced): $Phase (not found in INDEX)" }
        else { Add-Note "No active phase found - all phases appear completed." }
    }
}

# --- Current phase spec and tasks ---
if ($currentPhase) {
    $specDir = Get-ChildItem (Join-Path $RepoRoot "docs/specs") -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match ("^" + $currentPhase + "-") }
    $specPath = $null
    if ($specDir) {
        $candidate = Join-Path $specDir[0].FullName "spec.md"
        if (Test-Path $candidate) { $specPath = $candidate }
    }
    if (-not $specPath) {
        Add-Fail "Phase $currentPhase has no spec: docs/specs/$currentPhase-<name>/spec.md"
    } else {
        Add-Note ("Spec found: " + ($specPath.Substring($RepoRoot.Length + 1)))
        $specContent = Get-Content $specPath -Raw -Encoding UTF8
        if ($specContent -notmatch "(?i)criterios\s+de\s+aceptac") {
            Add-Fail "Spec of phase $currentPhase lacks a 'Criterios de aceptacion' section with verifiable criteria."
        } else {
            Add-Note "Spec contains acceptance criteria."
        }
        if ($specContent -notmatch "(?i)(^|\n)#+.*alcance|fuera\s+de\s+alcance") {
            Add-Fail "Spec of phase $currentPhase lacks scope definition ('Alcance' / 'Fuera de alcance')."
        } else {
            Add-Note "Spec defines scope."
        }
        $tasksPath = Join-Path $specDir[0].FullName "tasks.md"
        if (-not (Test-Path $tasksPath)) {
            Add-Fail "Phase $currentPhase has no tasks.md (format: docs/harness/tasks-format.md)."
        } else {
            $tasksRaw = Get-Content $tasksPath -Raw -Encoding UTF8
            if ($tasksRaw -notmatch "(?i)\|\s*T-\d+\s*\|") {
                Add-Fail "tasks.md of phase $currentPhase has no T-xx rows in the assignment table."
            } else {
                Add-Note "tasks.md uses the T-xx assignment table format."
            }
        }
    }
}

# --- Supply-chain asserts (constitution I4b, decision D-30; active from phase 02) ---
$pkgPath = Join-Path $RepoRoot "package.json"
if (Test-Path $pkgPath) {
    try {
        $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($needed in @("lint", "test", "check")) {
            $has = $pkg.PSObject.Properties.Name -contains "scripts" -and
                   $pkg.scripts.PSObject.Properties.Name -contains $needed
            if (-not $has) {
                Add-Fail "package.json lacks the '$needed' script (AGENTS.md section 6 requires lint/test/check)."
            }
        }
        if ($pkg.scripts -and $pkg.scripts.check -notmatch "check\.ps1") {
            Add-Note "pnpm run check does not wrap scripts/check.ps1 (allowed, but document it)."
        }
        if ($pkg.type -ne "module") { Add-Note "package.json is not ESM ('type' != 'module'); confirm against phase 00 decision." }
        else { Add-Note "ESM project (type: module) as required by the brief." }

        # engines.node is mandatory once package.json exists (I7, closing phase-00 debt in phase 02 A-03).
        $engNode = "$($pkg.engines.node)"
        if ($engNode -notmatch "\d") {
            Add-Fail "package.json engines.node missing: the Node contract (I7 / D-28) must be pinned in the manifest."
        } else {
            Add-Note "engines.node pinned: $engNode."
        }

        # pnpm is the only allowed package manager (I4b).
        $pm = "$($pkg.packageManager)"
        if ($pm -notmatch '^pnpm@\d+\.\d+\.\d+$') {
            Add-Fail "package.json packageManager must pin an exact pnpm version (got '$pm'); npm/yarn are forbidden (I4b / D-30)."
        } else {
            Add-Note "packageManager pinned: $pm."
        }
        foreach ($alien in @("package-lock.json", "yarn.lock", "bun.lockb", "npm-shrinkwrap.json")) {
            if (Test-Path (Join-Path $RepoRoot $alien)) {
                Add-Fail "Lockfile of another package manager committed: $alien (I4b / D-30)."
            }
        }
        if (-not (Test-Path (Join-Path $RepoRoot "pnpm-lock.yaml"))) {
            Add-Fail "Missing pnpm-lock.yaml: dependencies are not pinned by a frozen lockfile (I4b)."
        }
        $wsPath = Join-Path $RepoRoot "pnpm-workspace.yaml"
        if (-not (Test-Path $wsPath)) {
            Add-Fail "Missing pnpm-workspace.yaml: supply-chain settings (ignoreScripts, strictDepBuilds) must live there (I4b)."
        } else {
            $ws = Get-Content $wsPath -Raw -Encoding UTF8
            foreach ($setting in @("ignoreScripts", "strictDepBuilds", "allowBuilds", "minimumReleaseAge", "trustPolicy", "blockExoticSubdeps", "verifyStoreIntegrity", "verifyDepsBeforeRun", "enablePrePostScripts")) {
                if ($ws -notmatch "(?m)^\s*$setting\s*:") {
                    Add-Fail "pnpm-workspace.yaml lacks '$setting' (I4b / D-30)."
                }
            }
            if ($ws -match "(?i)dangerouslyAllowAllBuilds\s*:\s*true") {
                Add-Fail "pnpm-workspace.yaml enables dangerouslyAllowAllBuilds: dependency scripts would run (I4b)."
            }
            foreach ($entry in ([regex]::Matches($ws, '(?mi)^\s*allowBuilds\s*:([\s\S]*?)(\r?\n\S|\z)'))) {
                $body = $entry.Groups[1].Value
                $listed = [regex]::Matches($body, "(?m)^\s*-\s*[`"']?([A-Za-z0-9@/_.-]+)[`"']?") | ForEach-Object { $_.Groups[1].Value }
                $registered = @('puppeteer', '@puppeteer/browsers')   # D-41 exception list (user OK 2026-11-20)
                foreach ($pkgBuild in $listed) {
                    if ($registered -notcontains $pkgBuild) {
                        Add-Fail "allowBuilds entry '$pkgBuild' is not registered: adding a dependency build script requires a DECISIONS.md entry AND explicit user OK (I4b / D-30; D-41 is the only registered exception)."
                    }
                }
                if (@($listed).Count -gt 0) { Add-Note "allowBuilds: $(@($listed) -join ', ') - registered under D-41." }
            }
            if ($ws -match "(?mi)^\s*allowBuilds\s*:\s*\[\s*[^\]\s]") {
                Add-Fail "allowBuilds is non-empty (inline form): each entry requires a registered DECISIONS.md entry AND explicit user OK (I4b / D-30)."
            }
            if ($ws -match "(?mi)^\s*patchedDependencies\s*:\s*(?!\s*$)\S") {
                Add-Fail "patchedDependencies declared in pnpm-workspace.yaml: patches alter dependency code and require a registered decision + explicit user OK (I4b / D-30)."
            }
            if ($ws -match "(?i)^\s*pnpmfile\s*:") { Add-Fail "pnpmfile declared: it can execute code during resolution; requires a registered decision (I4b)." }
        }
        foreach ($depKey in @("dependencies", "devDependencies", "optionalDependencies")) {
            if ($pkg.$depKey) {
                foreach ($p in $pkg.$depKey.PSObject.Properties) {
                    if ($p.Value -match '^(git|github|http|file|link|workspace|npm):|\.tar\.gz|^[^/]+@.*:') {
                        Add-Fail "Exotic dependency spec '$($p.Name)@$($p.Value)' in $depKey (I4b): requires an explicit registered decision."
                    }
                }
            }
        }
        if ($pkg.PSObject.Properties.Name -contains "scripts") {
            foreach ($p in $pkg.scripts.PSObject.Properties) {
                if ($p.Value -match '(?i)\b(npm|yarn|npx)\s+(install|ci|add|run|exec|dlx)\b') {
                    Add-Fail "script '$($p.Name)' calls $($matches[1]): package manager commands must use pnpm (I4b / D-30)."
                }
            }
        }
    } catch {
        Add-Fail "package.json is not valid JSON: $($_.Exception.Message)"
    }
} else {
    Add-Note "No package.json yet (expected before phase 02)."
}

# --- CI/CD hygiene once workflows exist (D-42 pipelines-first + D-43 OIDC; rewritten 2026-11-22) ---
$workflowDir = Join-Path $RepoRoot ".github/workflows"
if (Test-Path $workflowDir) {
    $workflows = Get-ChildItem $workflowDir -File -Include *.yml,*.yaml -Recurse
    if ($workflows.Count -eq 0) {
        Add-Note ".github/workflows exists but has no workflow files."
    }
    foreach ($w in $workflows) {
        $wRaw = Get-Content $w.FullName -Raw -Encoding UTF8
        # D-43: long-lived AWS keys are forbidden in workflows - OIDC role assumption only.
        foreach ($keySecret in @("secrets.AWS_ACCESS_KEY_ID", "secrets.AWS_SECRET_ACCESS_KEY", "aws-access-key-id", "awsSecretAccessKey")) {
            if ($wRaw -match [regex]::Escape($keySecret)) {
                Add-Fail ("{0}: references '{1}' - long-lived AWS credentials in CI are forbidden; use GitHub OIDC + role-to-assume (D-43/I4)." -f $w.Name, $keySecret)
            }
        }
        if ($wRaw -match "(?i)configure-aws-credentials") {
            if ($wRaw -notmatch "(?i)role-to-assume") {
                Add-Fail ("{0}: configure-aws-credentials without role-to-assume (OIDC) - misconfigured auth (D-43)." -f $w.Name)
            }
            if ($wRaw -notmatch "(?i)id-token:\s*write") {
                Add-Fail ("{0}: OIDC credential step without 'id-token: write' permission - the job cannot mint a token (D-43)." -f $w.Name)
            }
        }
        # D-42/D-43/D-48: every job that can change AWS state MUST run inside a GitHub environment.
        # Since D-48 that environment is NOT a human-approval gate (the user decided NO required
        # reviewers): a job-level `environment:` is what (a) scopes the app secrets (spec 04 §5.4) and
        # (b) mints the OIDC `sub` claim that the trust of SubDeskCiDeployRole demands via
        # StringEquals. Since D-50 the claim this repo emits is the IMMUTABLE form
        # (repo:OWNER@OWNER_ID/REPO@REPO_ID:environment:dev) - without the job environment there are
        # simply no AWS credentials, so the invariant is still fail-closed. Checked PER JOB: a
        # file-level match elsewhere would prove nothing (the pre-D-48 assert only grepped the file).
        #
        # Audited 2026-11-22 with two throwaway workflows, because the assert's wording was false in
        # one of them: GitHub DOES accept a top-level `environment:` and applies it to jobs without
        # their own, so this check is STRICTER than GitHub on purpose - this repo pins the environment
        # per job so that "which job can reach AWS" is readable job by job (and reviewable by
        # Get-JobBlocks). The top-level form is therefore forbidden outright, see the next assert.
        $awsMutate = "(?i)(sam\s+deploy|sam\s+package|sam\s+delete|create-change-set|execute-change-set|delete-stack|cloudformation\s+deploy)"
        if ($wRaw -match "(?m)^environment:") {
            Add-Fail ("{0}: 'environment:' declared at WORKFLOW level - this repo pins it per job instead (spec 04 §5.1/§5.4, D-42/D-48): a top-level default makes 'which job can reach AWS' unreadable and lets a future job inherit AWS credentials silently." -f $w.Name)
        }
        foreach ($jb in (Get-JobBlocks $wRaw)) {
            if ($jb.Body -match $awsMutate) {
                if ($jb.Body -notmatch "(?m)^    environment:") {
                    Add-Fail ("{0}: job '{1}' mutates AWS state without a job-level 'environment:' - per-job secret scope and per-job OIDC claim binding (spec 04 §5.1/§5.4, D-42/D-43/D-48/D-50) are not auditable." -f $w.Name, $jb.Id)
                }
            }
            # D-31, re-anchored 2026-11-22: the previous form was '(?i)^\s*...sam\s+build\b' matched
            # with -match, and in .NET '^' without (?m) anchors ONLY at the start of the whole file -
            # so the assert could never fire on a real workflow and had silently rotted. Detection is
            # now per job and per COMMAND: step names and comments legitimately contain the words
            # "sam build" precisely to state that it is not used ("no sam build is ever invoked"),
            # so key lines (name/description/label/id) are excluded before matching.
            $cmdText = (($jb.Body -split "`r?`n") | Where-Object { $_ -notmatch '^\s*(-\s+)?(name|description|label|id)\s*:' }) -join "`n"
            if ($cmdText -match "(?i)\bsam\s+build\b") {
                Add-Fail ("{0}: job '{1}' invokes 'sam build' - forbidden in CI and gates (D-31); packaging is scripts/package-lambda.mjs staging." -f $w.Name, $jb.Id)
            }
            # D-53 / closure of A-03.5: this repo keeps ZERO muted failures. A step with
            # continue-on-error turns a real regression (policy drift, a permission pulled) into a
            # yellow step - the exact signal we committed to surfacing. The tagging step's flag was
            # retired once run #4 proved the call can succeed, so any future use needs a written
            # justification in an amendment: surfaced here as an explicit note for the reviewer.
            $muted = @([regex]::Matches($jb.Body, '(?m)^\s*continue-on-error:\s*true\s*(#.*)?$'))
            if ($muted.Count -gt 0) {
                Add-Note ("{0}: job '{1}' mutes {2} failure(s) with continue-on-error - verify it is justified in a spec amendment (A-03.5 was closed with zero muted failures, D-53)." -f $w.Name, $jb.Id, $muted.Count)
            }
        }
        # D-31 moved into the per-job command check above (it was unmatchable where it stood).
    }
    Add-Note "Workflows found: $($workflows.Count)."
}

# --- OIDC trust audit (D-50/A-05): both audited copies must pin the IMMUTABLE sub claim ---
# GitHub mints immutable subject claims (repo:OWNER@OWNER_ID/REPO@REPO_ID:...) for repositories
# created, renamed or transferred after 2026-07-15. A trust policy written in the legacy name-only
# form then fails with "Not authorized to perform sts:AssumeRoleWithWebIdentity" - which is exactly
# what cost runs #2 and #3 of Fase 04, because the two audited copies of the trust JSON (the CLI
# script and bootstrap-oidc.md) both carried the legacy value. This assert keeps them honest:
#   1. the script must declare GITHUB_SUB_PREFIX in immutable form and build the trust from it;
#   2. the script must NOT build the sub condition from the legacy owner/repo variable;
#   3. the audited JSON in bootstrap-oidc.md must contain the SAME concrete value the script yields.
$bootstrapSh = Join-Path $RepoRoot "docs/specs/04-pipeline/bootstrap-oidc-cli.sh"
$bootstrapMd = Join-Path $RepoRoot "docs/specs/04-pipeline/bootstrap-oidc.md"
if ((Test-Path $bootstrapSh) -and (Test-Path $bootstrapMd)) {
    $shRaw = Get-Content $bootstrapSh -Raw -Encoding UTF8
    $mdRaw = Get-Content $bootstrapMd -Raw -Encoding UTF8
    $prefixMatch = [regex]::Match($shRaw, '(?m)^GITHUB_SUB_PREFIX="([^"/]+@[0-9]+/[^"/]+@[0-9]+)"')
    $envMatch = [regex]::Match($shRaw, '(?m)^GITHUB_ENVIRONMENT="([^"]+)"')
    $legacyMatch = [regex]::Match($shRaw, '(?m)^GITHUB_ORG_REPO="([^"]+)"')
    if (-not $prefixMatch.Success) {
        Add-Fail "OIDC trust: bootstrap-oidc-cli.sh lacks GITHUB_SUB_PREFIX in immutable form (owner@OWNER_ID/repo@REPO_ID). Since D-50 a legacy name-only sub does not match the claim GitHub mints for this repo."
    } elseif (-not $envMatch.Success) {
        Add-Fail "OIDC trust: bootstrap-oidc-cli.sh lacks GITHUB_ENVIRONMENT - the sub condition cannot be audited."
    } else {
        $prefix = $prefixMatch.Groups[1].Value
        $envName = $envMatch.Groups[1].Value
        $immutableSub = "repo:${prefix}:environment:${envName}"
        # (1) the trust heredoc must compose sub from the immutable prefix.
        $shNeedle = '"$ISSUER:sub": "repo:$GITHUB_SUB_PREFIX:environment:$GITHUB_ENVIRONMENT"'
        if (-not $shRaw.Contains($shNeedle)) {
            Add-Fail ("OIDC trust: the sub condition in bootstrap-oidc-cli.sh is not built from GITHUB_SUB_PREFIX - expected the literal {0}." -f $shNeedle)
        }
        # (2) and must not be the legacy variable form (the regression that broke runs #2/#3).
        if ($shRaw.Contains('"$ISSUER:sub": "repo:$GITHUB_ORG_REPO')) {
            Add-Fail "OIDC trust: bootstrap-oidc-cli.sh pins the LEGACY name-only sub claim (repo:$($legacyMatch.Groups[1].Value):...). That never matches an immutable-claim repo (D-50)."
        }
        # (3) the audited JSON copies must agree with the script, byte for byte on this value.
        # Only JSON-key occurrences count (`...:sub": "<value>"`): prose that QUOTES the legacy
        # form in order to declare it wrong is legitimate documentation, not a second source of truth.
        if (-not $mdRaw.Contains($immutableSub)) {
            Add-Fail ("OIDC trust: bootstrap-oidc.md does not carry the sub claim the script produces ({0}) - the two audited copies diverged." -f $immutableSub)
        }
        $auditedDiverged = @()
        foreach ($mm in [regex]::Matches($mdRaw, '"token\.actions\.githubusercontent\.com:sub":\s*"([^"]+)"')) {
            if ($mm.Groups[1].Value -ne $immutableSub) { $auditedDiverged += $mm.Groups[1].Value }
        }
        if ($auditedDiverged.Count -gt 0) {
            $divergentList = ($auditedDiverged | Sort-Object -Unique | Select-Object -First 2) -join ', '
            Add-Fail ("OIDC trust: bootstrap-oidc.md audits a sub value that is not the script's (" + $divergentList + ") - the two audited copies diverged (D-50).")
        }
        Add-Note ("OIDC trust: immutable sub pinned in both audited copies ({0})." -f $immutableSub)
    }
}

# --- Secret hygiene scan (D-13 / I4) ---
if (-not $SkipSecretScan) {
    # Cross-platform exclusion (Windows \ and Linux /): node_modules etc. must never be scanned
    # (the runner verify job has full trees; a Windows-only pattern made the scan slow AND noisy on Linux).
    $excludeRegex = '[\\/](\.git|node_modules|dist|packaged\.yaml|artifacts|build|coverage|\.serverless|\.aws-sam|\.output)([\\/]|$)'
    $exts = @(".md", ".js", ".mjs", ".cjs", ".ts", ".json", ".yml", ".yaml", ".ps1", ".txt", ".example", ".mmd", ".html", ".graphql")
    $patterns = @(
        @{ name = "Telegram bot token shape"; regex = '\d{8,10}:AA[A-Za-z0-9_-]{25,}' },
        @{ name = "AWS access key id";        regex = 'AKIA[0-9A-Z]{16}' },
        @{ name = "AWS secret key literal";   regex = '(?i)(aws_)?secret_access_key["'']?\s*[:=]\s*["'']?[A-Za-z0-9/+=]{35,}' },
        @{ name = "Project secret literal";   regex = '(?i)(telegram_bot_token|admin_api_key|telegram_webhook_secret)["'']?\s*[:=]\s*["'']?[A-Za-z0-9_/+=-]{16,}' }
    )
    $candidates = Get-ChildItem $RepoRoot -File -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object {
            (($exts -contains $_.Extension.ToLower()) -or ($_.Name -in @(".npmrc", ".nvmrc", "pnpm-workspace.yaml", ".gitignore"))) -and
            ($_.FullName -notmatch $excludeRegex) -and
            ($_.Name -notin @("check.ps1")) -and
            ($_.Length -lt 400KB)
        }
    $hits = 0
    foreach ($f in $candidates) {
        $content = Get-Content $f.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if (-not $content) { continue }
        foreach ($p in $patterns) {
            if ($content -match $p.regex) {
                $rel = $f.FullName.Substring($RepoRoot.Length + 1)
                Add-Fail "Secret hygiene: $rel matches '$($p.name)'. Use a placeholder like <TELEGRAM_BOT_TOKEN>."
                $hits++
            }
        }
    }
    if ($hits -eq 0) { Add-Note "Secret hygiene: no token/key patterns in $($candidates.Count) scanned text files." }

    foreach ($envFile in @(".env", ".env.local", ".env.production")) {
        if (Test-Path (Join-Path $RepoRoot $envFile)) {
            Add-Note "$envFile exists locally: it must stay out of git (.gitignore) and out of any deploy artifact."
        }
    }
}

# --- IaC asserts (constitution I7, active from phase 03 when a template exists) ---
$cfnFiles = @()
foreach ($candidate in @("template.yaml", "template.yml", "serverless.yml")) {
    $p = Join-Path $RepoRoot $candidate
    if (Test-Path $p) { $cfnFiles += $p }
}
$infraDir = Join-Path $RepoRoot "infra"
if (Test-Path $infraDir) {
    $cfnFiles += Get-ChildItem $infraDir -File -Recurse -Include *.yaml,*.yml,*.template -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
}
if ($cfnFiles.Count -gt 0) {
    Add-Note "IaC files found: $((($cfnFiles | ForEach-Object { Split-Path $_ -Leaf }) -join ', '))."
    $iacRaw = ($cfnFiles | ForEach-Object { Get-Content $_ -Raw -Encoding UTF8 }) -join "`n"

    $tableCount  = ([regex]::Matches($iacRaw, '(?mi)Type:\s*"?(AWS::DynamoDB::Table|AWS::Serverless::SimpleTable|DynamoDB::Table|SimpleTable)"?\s*$')).Count
    $fnCount     = ([regex]::Matches($iacRaw, '(?mi)Type:\s*"?(AWS::Serverless::Function|AWS::Lambda::Function|Function)"?\s*$')).Count
    $urlCount    = ([regex]::Matches($iacRaw, '(?mi)Type:\s*"?(AWS::Lambda::Url|Url)"?\s*$')).Count + ([regex]::Matches($iacRaw, '(?m)^\s*FunctionUrlConfig:')).Count

    if ($tableCount -ne 1) { Add-Fail "IaC asserts: expected exactly 1 DynamoDB table (I1/I2), found $tableCount." }
    if ($fnCount -gt 1) { Add-Fail "IaC asserts: $fnCount Lambda functions declared - the architecture is 1 function + internal router (D-27/I1)." }
    if ($tableCount -eq 1) {
        if ($iacRaw -match 'BillingMode:\s*"?(PAY_PER_REQUEST|ON_DEMAND)"?') {
            Add-Fail "IaC asserts: table is PAY_PER_REQUEST - constitution I2 (D-26) requires PROVISIONED <= 25/25."
        } elseif ($iacRaw -notmatch 'BillingMode:\s*"?PROVISIONED"?') {
            Add-Fail "IaC asserts: table lacks an explicit 'BillingMode: PROVISIONED'."
        }
        foreach ($cap in @('ReadCapacityUnits', 'WriteCapacityUnits')) {
            foreach ($m in [regex]::Matches($iacRaw, ("(?i)\b$cap\s*[:=]\s*(\d+)"))) {
                if ([int]$m.Groups[1].Value -gt 25) {
                    Add-Fail "IaC asserts: $cap = $($m.Groups[1].Value) exceeds the 25-unit free-tier franchise (I2)."
                }
            }
        }
        foreach ($forbidden in @(
            @{ pattern = 'AWS::ApplicationAutoScaling::';            label = "auto scaling of provisioned capacity (I2/D-26)" },
            @{ pattern = 'GlobalSecondaryIndexes|LocalSecondaryIndexes'; label = "secondary indexes (I2)" },
            @{ pattern = 'StreamSpecification';                      label = "DynamoDB Streams (I2)" },
            @{ pattern = 'PointInTimeRecoverySpecification';         label = "PITR (I2)" },
            @{ pattern = 'AWS::ApiGatewayV2::|AWS::Serverless::HttpApi|Type:\s*HttpApi'; label = "API Gateway after D-27 (Function URL only)" },
            @{ pattern = 'ProvisionedConcurrencyConfig|ProvisionedConcurrency'; label = "provisioned concurrency is billable (I2)" }
        )) {
            if ($iacRaw -match $forbidden.pattern) {
                Add-Fail "IaC asserts: forbidden construct found - $($forbidden.label)."
            }
        }
    }
    if ($urlCount -lt 1) { Add-Fail "IaC asserts: no Function URL declared (D-27 expects exactly one public endpoint)." }
    if ($urlCount -gt 1) { Add-Fail "IaC asserts: $urlCount function URLs declared - the architecture is 1 function + internal router (D-27/I1)." }
    foreach ($m in [regex]::Matches($iacRaw, '(?i)\bMemorySize\s*[:=]\s*(\d+)')) {
        if ([int]$m.Groups[1].Value -gt 256) {
            Add-Fail "IaC asserts: MemorySize = $($m.Groups[1].Value) MB exceeds the 128-256 MB limit (I2)."
        }
    }
    if ($iacRaw -notmatch '(?i)Transform:.*(Serverless|AWS::Serverless)') {
        Add-Note "IaC: SAM transform not detected in the scanned files (expected if using SAM syntax)."
    }
    if ($iacRaw -match 'arn:aws:iam::\*|Resource:\s*"?\*"') { Add-Fail "IaC asserts: wildcard IAM resource/policy detected (I4 least privilege)." }
    # Single-region rule (I7) - REWRITTEN 2026-11-22 for D-54: the expected region is NO LONGER a
    # literal inside this script. It is read from infra/deployment.env, the single source of truth of
    # the deployment target, and every other region literal in the repo's executable artefacts (IaC,
    # workflows, the bootstrap script) must equal it. That is what makes "deploy in any region" safe:
    # a half migration (env file moved, role policy or workflow left behind) fails the gate instead of
    # failing a deploy. Before this, the same assert hardcoded us-east-1 and only scanned IaC files, so
    # a real edit of AWS_REGION in deploy.yml passed with [PASS] while breaking the pipeline.
    $deployEnv = Join-Path $RepoRoot "infra/deployment.env"
    # Workflow files are scanned too (they are where the region is actually applied at deploy time).
    $execScan = @()
    if (Test-Path $workflowDir) {
        $execScan = @(Get-ChildItem $workflowDir -File -Include *.yml,*.yaml -Recurse | ForEach-Object { $_.FullName })
    }
    if (-not (Test-Path $deployEnv)) {
        Add-Fail "Region asserts: infra/deployment.env is missing - since D-54 it is the single source of truth for AWS_REGION/STACK_NAME/ARTIFACTS_BUCKET and the gate requires it."
    } else {
        $envMap = @{}
        foreach ($line in (Get-Content $deployEnv -Encoding UTF8)) {
            if ($line -match '^\s*#') { continue }
            $kv = $line -split '=', 2
            if ($kv.Length -eq 2) { $envMap[$kv[0].Trim()] = $kv[1].Trim() }
        }
        $expectedRegion = $envMap['AWS_REGION']
        if (-not $expectedRegion) { Add-Fail "Region asserts: infra/deployment.env declares no AWS_REGION." }
        else {
            Write-Verbose ("Region asserts: source of truth AWS_REGION={0}" -f $expectedRegion)
            $scanTargets = @($cfnFiles) + @($execScan)
            $bootstrapForRegion = Join-Path $RepoRoot "docs/specs/04-pipeline/bootstrap-oidc-cli.sh"
            if (Test-Path $bootstrapForRegion) { $scanTargets += $bootstrapForRegion }
            $offenders = @()
            foreach ($f in $scanTargets) {
                $raw = Get-Content $f -Raw -Encoding UTF8
                $lits = [regex]::Matches($raw, '\b([a-z]{2}-(?:east|west|north|south|central)-\d)\b') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
                $bad = @($lits | Where-Object { $_ -ne $expectedRegion })
                if ($bad.Count -gt 0) { $offenders += ("{0}: {1}" -f (Split-Path $f -Leaf), ($bad -join ', ')) }
            }
            if ($offenders.Count -gt 0) {
                Add-Fail ("Region asserts: region literal(s) other than the declared {0} found in {1} - the target is set once in infra/deployment.env (D-54); a partial region migration must fail the gate, not the deploy." -f $expectedRegion, ($offenders -join ' | '))
            } else {
                Add-Note ("Region asserts: every region literal in IaC, workflows and the bootstrap script equals infra/deployment.env ({0})." -f $expectedRegion)
            }
            # The executor must not hardcode a region at all: it reads it from the source of truth.
            foreach ($f in @($execScan)) {
                $raw = Get-Content $f -Raw -Encoding UTF8
                $m = [regex]::Match($raw, '(?m)^\s*AWS_REGION:\s*(\S+)\s*(#.*)?$')
                if ($m.Success -and $m.Groups[1].Value -notmatch '\$\{\{') {
                    Add-Fail ("Region asserts: {0} hardcodes AWS_REGION: {1} - load it from infra/deployment.env (D-54) so one edit moves the deployment." -f (Split-Path $f -Leaf), $m.Groups[1].Value)
                }
            }
            # The artifacts bucket name must carry the region: S3 names are a GLOBAL namespace, so a
            # second region cannot reuse the first one's bucket (this is what the run #4 bucket taught).
            $bucket = $envMap['ARTIFACTS_BUCKET']
            if ($bucket -and $expectedRegion) {
                $regionToken = ($expectedRegion -replace '-', '')
                if ($bucket -notlike "*$regionToken*") {
                    Add-Fail ("Region asserts: ARTIFACTS_BUCKET '{0}' does not carry the region token '{1}' - S3 bucket names are global, so per-region deployments need per-region names (D-54)." -f $bucket, $regionToken)
                } else {
                    Add-Note ("Region asserts: artifacts bucket is region-scoped ({0})." -f $bucket)
                }
            }
        }
    }
} else {
    Add-Note "No IaC template yet (template.yaml) - expected before phase 03."
}

# --- Documentation for humans asserts (constitution I8, decision D-32) ---
$docIndex = Join-Path $RepoRoot "docs/human/README.md"
if (-not (Test-Path $docIndex)) {
    Add-Fail "I8: missing docs/human/README.md (index of the human documentation with the freshness table)."
}

[int]$curPhaseNum = 0
if ($currentPhase) { [int]::TryParse($currentPhase, [ref]$curPhaseNum) | Out-Null }
$lastClosedNum = 0
if (Test-Path $indexPath) {
    foreach ($row in (Get-Content $indexPath -Encoding UTF8 | Where-Object { $_ -match '^\s*\|\s*\d+\s*\|' })) {
        $cells = ($row.TrimStart() -replace '^\|', '' -replace '\|$', '') -split '\|'
        if ($cells.Count -lt 3) { continue }
        $st = $cells[2].Trim().ToLower()
        $num = 0
        if ([int]::TryParse($cells[0].Trim(), [ref]$num) -and ($completedStates -contains $st) -and $num -gt $lastClosedNum) { $lastClosedNum = $num }
    }
}

# required human-doc artefact -> phase from which it is mandatory
$docRequired = @(
    @{ from = 0; rel = "docs/human/technical/architecture.md";       what = "technical architecture" },
    @{ from = 1; rel = "docs/api/openapi.yaml";                      what = "OpenAPI contract" },
    @{ from = 1; rel = "docs/human/functional/api.md";               what = "functional API documentation" },
    @{ from = 1; rel = "docs/human/technical/data-model.md";         what = "data model documentation" },
    @{ from = 2; rel = "README.md";                                  what = "root README" },
    @{ from = 2; rel = "CHANGELOG.md";                               what = "changelog" },
    @{ from = 2; rel = "docs/human/technical/operations.md";         what = "operations documentation" },
    @{ from = 3; rel = "docs/human/runbook.md";                      what = "runbook" },
    @{ from = 3; rel = "docs/human/diagrams/deployment.mmd";         what = "deployment diagram (Mermaid source)" },
    @{ from = 3; rel = "docs/human/diagrams/component.mmd";          what = "component diagram (Mermaid source)" },
    @{ from = 5; rel = "docs/human/diagrams/api-flow.mmd";           what = "API flow diagram (Mermaid source)" },
    @{ from = 9; rel = "docs/human/functional/product.md";           what = "functional product documentation" },
    @{ from = 9; rel = "docs/human/technical/decisions-summary.md";  what = "human-readable decisions summary" }
)

$docsChecked = 0
foreach ($doc in $docRequired) {
    if ($curPhaseNum -lt $doc.from) { continue }
    $p = Join-Path $RepoRoot $doc.rel
    if (-not (Test-Path $p)) {
        Add-Fail ("I8: required documentation missing since phase {0:D2}: {1} ({2})." -f $doc.from, $doc.rel, $doc.what)
        continue
    }
    $docsChecked++
    $raw = Get-Content $p -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($raw -notmatch "(?i)actualizado:\s*fase\s*(\d+)") {
        Add-Fail ("I8: {0} lacks the 'Actualizado: fase NN' freshness marker." -f $doc.rel)
    } else {
        $marker = [int]$matches[1]
        if ($marker -lt $lastClosedNum) {
            Add-Fail ("I8: {0} is stale: marked as updated in phase {1:D2}, but phase {2:D2} is already closed. Update the docs before closing this one." -f $doc.rel, $marker, $lastClosedNum)
        }
        if ($raw -notmatch "\d{4}-\d{2}-\d{2}") {
            Add-Note ("I8: {0} has a phase marker without an ISO date next to it." -f $doc.rel)
        }
    }
    if ($raw -cmatch "\bTODO\b" -or $raw -match "(?i)\b(WIP|pendiente de redactar)\b") {
        Add-Note ("I8: {0} still contains a TODO/WIP placeholder." -f $doc.rel)
    }
}
if ($docsChecked -gt 0) { Add-Note "I8: $docsChecked required human-documentation artefact(s) present and fresh (last closed phase: $lastClosedNum)." }

# Root README must teach the real, runnable commands once it exists.
$readmePath = Join-Path $RepoRoot "README.md"
if (Test-Path $readmePath) {
    $readmeRaw = Get-Content $readmePath -Raw -Encoding UTF8
    foreach ($cmd in @("pnpm install --frozen-lockfile", "pnpm run lint", "pnpm test", "pnpm run dev")) {
        if ($readmeRaw -notmatch [regex]::Escape($cmd)) {
            Add-Fail "I8: README.md does not document the runnable command '$cmd'."
        }
    }
    if ((Test-Path $workflowDir) -and ($readmeRaw -notmatch "(?i)setWebhook")) {
        Add-Fail "I8: README.md lacks the exact setWebhook curl although CI workflows exist (phase 08 gate)."
    }
}

# OpenAPI contract shape, once it exists (drift itself is caught by the contract test).
$openapiPath = Join-Path $RepoRoot "docs/api/openapi.yaml"
if (Test-Path $openapiPath) {
    $oaRaw = Get-Content $openapiPath -Raw -Encoding UTF8
    if ($oaRaw -notmatch "(?m)^openapi:\s*3\.\d") { Add-Fail "I8: docs/api/openapi.yaml is not OpenAPI 3.x (I8d)." }
    if ($oaRaw -notmatch "(?m)^\s*info:") { Add-Fail "I8: openapi.yaml lacks an 'info' block (title + version)." }
    $pathCount = ([regex]::Matches($oaRaw, '(?m)^\s{2}/[A-Za-z0-9{}/._-]+:\s*$')).Count
    if ($pathCount -lt 3) {
        Add-Fail ("I8: openapi.yaml declares {0} path(s); the contract has 4 endpoints over 3 paths (I3)." -f $pathCount)
    } else {
        Add-Note "I8: openapi.yaml declares $pathCount path(s)."
    }
    if ($curPhaseNum -ge 2 -and -not (Test-Path (Join-Path $RepoRoot "tests/contract"))) {
        Add-Fail "I8: no tests/contract/ directory: the code-vs-openapi drift test is mandatory from phase 02 (I8b.4)."
    }
}

# --- Report ---
Write-Host ""
Write-Host "=== SubDesk API harness check ==="
foreach ($n in $notes) { Write-Host " [info]  $n" }
if ($failures.Count -eq 0) {
    Write-Host " [PASS]  Documentation and hygiene gate OK."
    exit 0
} else {
    foreach ($f in $failures) { Write-Host " [FAIL]  $f" -ForegroundColor Red }
    Write-Host " [FAIL]  $($failures.Count) failure(s). Fix before closing the phase." -ForegroundColor Red
    exit 1
}
