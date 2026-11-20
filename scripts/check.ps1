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
                $listed = ([regex]::Matches($body, '(?m)^\s*-\s*["'']?([A-Za-z0-9@/_.-]+)')).Count
                if ($listed -gt 0) { Add-Fail "allowBuilds lists $listed dependency build script(s): each requires a registered DECISIONS.md entry AND explicit user OK (I4b / D-30). Reviewer-only checks are not enough (phase-00 debt closed in A-03)." }
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
    @{ from = 4; rel = "docs/human/diagrams/api-flow.mmd";           what = "API flow diagram (Mermaid source)" },
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
