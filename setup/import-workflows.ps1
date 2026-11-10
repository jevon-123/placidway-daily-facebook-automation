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

$NodeDir = 'C:\Users\jevon\tools\node-v26.13.0-win-x64'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$env:Path = "$NodeDir;$env:Path"

$n8nCmd = Join-Path $NodeDir 'n8n.cmd'
if (-not (Test-Path $n8nCmd)) {
    Write-Host "n8n is not installed yet." -ForegroundColor Red
    exit 1
}

$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'
$env:N8N_RUNNERS_ENABLED = 'true'
$env:N8N_DIAGNOSTICS_ENABLED = 'false'

$errorWorkflow = Join-Path $ProjectRoot 'workflow\placidway-error-handler.json'
$mainWorkflow  = Join-Path $ProjectRoot "workflow\placidway-daily-facebook.$Provider.json"

foreach ($f in @($errorWorkflow, $mainWorkflow)) {
    if (-not (Test-Path $f)) {
        Write-Host "Missing $f - run: node scripts\build-workflow.mjs" -ForegroundColor Red
        exit 1
    }
}

# Error handler first: the main workflow needs its ID.
Write-Host "Importing the error handler..." -ForegroundColor Cyan
& $n8nCmd import:workflow --input="$errorWorkflow"

Write-Host "Importing the main workflow ($Provider)..." -ForegroundColor Cyan
& $n8nCmd import:workflow --input="$mainWorkflow"

Write-Host ""
Write-Host "Imported workflows:" -ForegroundColor Green
& $n8nCmd list:workflow

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Copy the ID of 'PlacidWay - Error Handler' from the list above."
Write-Host "  2. Put it in setup\local.env.ps1 as PW_ERROR_WORKFLOW_ID."
Write-Host "  3. Start n8n:  .\setup\start-n8n.ps1"
Write-Host "  4. Create the credentials in the UI (see docs\n8n-setup.md)."
