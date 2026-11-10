<#
.SYNOPSIS
  Creates setup/local.env.ps1 from a template, for the values that must not be
  committed.

.DESCRIPTION
  Run once. It refuses to overwrite an existing file, so your filled-in values
  are safe. local.env.ps1 is gitignored.
#>

$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'local.env.ps1'

if (Test-Path $target) {
    Write-Host "setup/local.env.ps1 already exists - not touching it." -ForegroundColor Yellow
    Write-Host "Open it and fill in whatever is still empty:" -ForegroundColor Yellow
    Write-Host "  notepad `"$target`"" -ForegroundColor Cyan
    exit 0
}

$template = @'
# Secrets and per-machine settings for the PlacidWay automation.
#
# This file is gitignored. Never commit it, never paste its contents into a
# screenshot or a chat.
#
# setup/start-n8n.ps1 dot-sources this file before launching n8n.

# --- LLM -------------------------------------------------------------------
# Gemini key from https://aistudio.google.com -> Get API key.
# Only used by scripts/dry-run.mjs. Inside n8n the key lives in a credential,
# not here, so you can leave this empty if you only run the workflow.
$env:GEMINI_API_KEY = ""

# --- Google Sheet ----------------------------------------------------------
# The ID from the spreadsheet URL:
# docs.google.com/spreadsheets/d/<THIS_PART>/edit
$env:PW_SHEET_ID = ""

# --- Facebook --------------------------------------------------------------
# Numeric ID of YOUR test Page. Never a PlacidWay Page.
$env:PW_FB_PAGE_ID = ""

# --- Telegram --------------------------------------------------------------
# Chat that receives drafts for approval and failure alerts.
$env:PW_TELEGRAM_CHAT_ID = ""

# --- n8n -------------------------------------------------------------------
# Workflow ID of the imported error handler. Fill this in after importing.
$env:PW_ERROR_WORKFLOW_ID = ""

# --- overrides -------------------------------------------------------------
# Uncomment to go live. Start in simulate and watch a few runs first.
# $env:PW_PUBLISH_MODE = "publish"
# $env:PW_REVIEW_MODE = "auto"
'@

Set-Content -Path $target -Value $template -Encoding utf8
Write-Host "Created setup/local.env.ps1" -ForegroundColor Green
Write-Host ""
Write-Host "Open it and fill in the values as you collect them:" -ForegroundColor Cyan
Write-Host "  notepad `"$target`"" -ForegroundColor Cyan
Write-Host ""
Write-Host "You do not need them all at once. n8n starts fine with blanks." -ForegroundColor DarkGray
