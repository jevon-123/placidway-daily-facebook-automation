<#
.SYNOPSIS
  Imports the built workflows into your local n8n and prints their IDs.

.DESCRIPTION
  Run this with n8n STOPPED. It writes straight to n8n's database; a running
  server will not notice the new rows until it restarts.

  Importing does not bring credentials with it - those are created once in the
  UI and then attached to the nodes. That is deliberate on n8n's part: an
  exported workflow should never be able to carry your tokens.

.PARAMETER Provider
  openai (default) or anthropic. Picks which main workflow to import.
  "openai" also covers Gemini, Groq and anything else OpenAI-compatible.
#>
param(
    [ValidateSet('openai', 'anthropic')]
    [string]$Provider = 'openai'
)

$ErrorActionPreference = 'Stop'

$NodeDir = 'C:\Users\jevon\tools\node-v24.22.2-win-x64'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$env:Path = "$NodeDir;$env:Path"

$n8nCmd = Join-Path $NodeDir 'n8n.cmd'
if (-not (Test-Path $n8nCmd)) {
    Write-Host "n8n is not installed yet." -ForegroundColor Red
    exit 1
}

$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'
$env:N8N_DIAGNOSTICS_ENABLED = 'false'

$errorWorkflow = Join-Path $ProjectRoot 'workflow\placidway-error-handler.json'
$mainWorkflow  = Join-Path $ProjectRoot "workflow\placidway-daily-facebook.$Provider.json"

foreach ($f in @($errorWorkflow, $mainWorkflow)) {
    if (-not (Test-Path $f)) {
        Write-Host "Missing $f - run: node scripts\build-workflow.mjs" -ForegroundColor Red
        exit 1
    }
}

# --- what is already there -------------------------------------------------
# list:workflow prints "<id>|<name>" per line. Reusing an existing ID turns the
# import into an update; without it every run of this script would create
# another copy. You will re-import after every build, so this matters.

$nodeExe = Join-Path $NodeDir 'node.exe'

Write-Host "Checking what is already imported..." -ForegroundColor DarkGray
$existing = @{}
foreach ($line in (& $n8nCmd list:workflow 2>$null)) {
    if ($line -match '^([A-Za-z0-9]+)\|(.+)$') {
        $existing[$Matches[2].Trim()] = $Matches[1]
    }
}
if ($existing.Count -gt 0) {
    foreach ($k in $existing.Keys) { Write-Host ("  found  {0}  {1}" -f $existing[$k], $k) -ForegroundColor DarkGray }
} else {
    Write-Host "  nothing imported yet" -ForegroundColor DarkGray
}

$temp = Join-Path $env:TEMP "pw-import-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $temp | Out-Null

try {
    # Error handler first: the main workflow needs its ID.
    foreach ($file in @($errorWorkflow, $mainWorkflow)) {
        # -Encoding UTF8 is load-bearing: without it PowerShell 5.1 reads the
        # file as ANSI and any non-ASCII character in the name fails to match
        # the list above, so the import silently creates a duplicate.
        $name = (Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json).name
        $id = $existing[$name]
        $staged = Join-Path $temp (Split-Path $file -Leaf)

        $prepArgs = @("$ProjectRoot\scripts\prepare-import.mjs", "--file=$file", "--out=$staged")
        if ($id) { $prepArgs += "--id=$id" }
        & $nodeExe @prepArgs

        & $n8nCmd import:workflow --input="$staged" | Out-Null
    }
} finally {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Imported workflows:" -ForegroundColor Green
& $n8nCmd list:workflow

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Copy the ID of 'PlacidWay - Error Handler' from the list above."
Write-Host "  2. Put it in setup\local.env.ps1 as PW_ERROR_WORKFLOW_ID."
Write-Host "  3. Start n8n:  .\setup\start-n8n.ps1"
Write-Host "  4. Create the credentials in the UI (see docs\n8n-setup.md)."
