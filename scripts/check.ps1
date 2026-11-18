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

# --- Project gates once package.json exists (phase 02+) ---
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
            Add-Note "npm run check does not wrap scripts/check.ps1 (allowed, but document it)."
        }
        if ($pkg.type -ne "module") { Add-Note "package.json is not ESM ('type' != 'module'); confirm against phase 00 decision." }
        else { Add-Note "ESM project (type: module) as required by the brief." }
    } catch {
        Add-Fail "package.json is not valid JSON: $($_.Exception.Message)"
    }
} else {
    Add-Note "No package.json yet (expected before phase 02)."
}

# --- CI/CD hygiene once workflows exist (phase 08) ---
$workflowDir = Join-Path $RepoRoot ".github/workflows"
if (Test-Path $workflowDir) {
    $workflows = Get-ChildItem $workflowDir -File -Include *.yml,*.yaml -Recurse
    if ($workflows.Count -eq 0) {
        Add-Note ".github/workflows exists but has no workflow files."
    }
    foreach ($w in $workflows) {
        $wRaw = Get-Content $w.FullName -Raw -Encoding UTF8
        foreach ($secret in @("secrets.AWS_ACCESS_KEY_ID", "secrets.AWS_SECRET_ACCESS_KEY")) {
            if ($wRaw -notmatch [regex]::Escape($secret)) {
                Add-Note ("{0}: no reference to {1} (expected for an AWS deploy workflow)." -f $w.Name, $secret)
            }
        }
        if ($wRaw -match "(?i)(serverless|sls|sam)\s+deploy" -and $wRaw -notmatch "(?i)secrets\.") {
            Add-Fail ("{0}: a deploy step without GitHub secrets - secrets must never be literal (I4)." -f $w.Name)
        }
    }
    Add-Note "Workflows found: $($workflows.Count)."
}

# --- Secret hygiene scan (D-13 / I4) ---
if (-not $SkipSecretScan) {
    $excludeRegex = '\\(\.git|node_modules|dist|build|coverage|\.serverless|\.aws-sam|\.output)\\'
    $exts = @(".md", ".js", ".mjs", ".cjs", ".ts", ".json", ".yml", ".yaml", ".ps1", ".txt", ".example")
    $patterns = @(
        @{ name = "Telegram bot token shape"; regex = '\d{8,10}:AA[A-Za-z0-9_-]{25,}' },
        @{ name = "AWS access key id";        regex = 'AKIA[0-9A-Z]{16}' },
        @{ name = "AWS secret key literal";   regex = '(?i)(aws_)?secret_access_key["'']?\s*[:=]\s*["'']?[A-Za-z0-9/+=]{35,}' },
        @{ name = "Project secret literal";   regex = '(?i)(telegram_bot_token|admin_api_key|telegram_webhook_secret)["'']?\s*[:=]\s*["'']?[A-Za-z0-9_/+=-]{16,}' }
    )
    $candidates = Get-ChildItem $RepoRoot -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object {
            ($exts -contains $_.Extension.ToLower()) -and
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
} else {
    Add-Note "No IaC file yet (template.yaml / serverless.yml) - expected before phase 03."
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
