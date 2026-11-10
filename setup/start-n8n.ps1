<#
.SYNOPSIS
  Starts n8n with every environment variable this project needs.

.DESCRIPTION
  Secrets are NOT in this file. Put them in setup/local.env.ps1, which is
  gitignored. Run setup/make-local-env.ps1 once to create it from the template.

.PARAMETER Tunnel
  Starts n8n with a public tunnel URL. You need this for approval mode: the
  reviewer's Telegram message contains a resume link, and a link to
  http://localhost:5678 is useless on a phone. Do not use it for anything
  other than a demo - it exposes your local n8n to the internet.

.EXAMPLE
  .\setup\start-n8n.ps1
  .\setup\start-n8n.ps1 -Tunnel
#>
param(
    [switch]$Tunnel
)

$ErrorActionPreference = 'Stop'

$NodeDir = 'C:\Users\jevon\tools\node-v24.22.2-win-x64'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$env:Path = "$NodeDir;$env:Path"

$n8nCmd = Join-Path $NodeDir 'n8n.cmd'
if (-not (Test-Path $n8nCmd)) {
    Write-Host "n8n is not installed. Run:" -ForegroundColor Red
    Write-Host "  & '$NodeDir\npm.cmd' install -g n8n" -ForegroundColor Yellow
    exit 1
}

# --- n8n's own settings ----------------------------------------------------

# The Config node reads every setting through $env. n8n blocks that by default,
# and without this the workflow silently falls back to its built-in defaults.
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'

# Code nodes run in task runners in n8n 2.x. Without this you get a deprecation
# warning on every execution.
$env:N8N_RUNNERS_ENABLED = 'true'

# Over plain http on localhost the secure-cookie flag blocks the login form.
$env:N8N_SECURE_COOKIE = 'false'

$env:GENERIC_TIMEZONE = 'Asia/Jakarta'
$env:N8N_DIAGNOSTICS_ENABLED = 'false'

# --- project defaults ------------------------------------------------------
# Safe out of the box: builds and logs the post, never calls Facebook.

if (-not $env:PW_PUBLISH_MODE)          { $env:PW_PUBLISH_MODE = 'simulate' }
if (-not $env:PW_REVIEW_MODE)           { $env:PW_REVIEW_MODE = 'approval' }
if (-not $env:PW_ALLOW_PRICE_MENTION)   { $env:PW_ALLOW_PRICE_MENTION = 'false' }
if (-not $env:PW_MAX_CHARS)             { $env:PW_MAX_CHARS = '500' }
if (-not $env:PW_MAX_ATTEMPTS)          { $env:PW_MAX_ATTEMPTS = '3' }
if (-not $env:PW_CRAWL_DELAY_SECONDS)   { $env:PW_CRAWL_DELAY_SECONDS = '3' }
if (-not $env:PW_CANDIDATE_LIMIT)       { $env:PW_CANDIDATE_LIMIT = '40' }
if (-not $env:PW_MIN_BODY_LENGTH)       { $env:PW_MIN_BODY_LENGTH = '400' }
if (-not $env:PW_SCHEDULE_OFFSET_MINUTES) { $env:PW_SCHEDULE_OFFSET_MINUTES = '60' }
if (-not $env:PW_FB_GRAPH_VERSION)      { $env:PW_FB_GRAPH_VERSION = 'v21.0' }
if (-not $env:PW_USER_AGENT)            { $env:PW_USER_AGENT = 'PlacidWayContentBot/1.0 (take-home assessment demo)' }

# Gemini free tier, via its OpenAI-compatible endpoint.
# flash-lite because free-tier quota is per model and it is the most forgiving.
if (-not $env:PW_LLM_BASE_URL) { $env:PW_LLM_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' }
if (-not $env:PW_MODEL)        { $env:PW_MODEL = 'gemini-3.1-flash-lite' }
# Reasoning models spend the output budget thinking before they write.
if (-not $env:PW_MAX_OUTPUT_TOKENS)     { $env:PW_MAX_OUTPUT_TOKENS = '4000' }
if (-not $env:PW_LLM_REASONING_EFFORT)  { $env:PW_LLM_REASONING_EFFORT = 'none' }

# --- secrets ---------------------------------------------------------------

$localEnv = Join-Path $PSScriptRoot 'local.env.ps1'
if (Test-Path $localEnv) {
    Write-Host "loading secrets from setup/local.env.ps1" -ForegroundColor DarkGray
    . $localEnv
} else {
    Write-Host "No setup/local.env.ps1 found." -ForegroundColor Yellow
    Write-Host "Run .\setup\make-local-env.ps1 to create it, then fill it in." -ForegroundColor Yellow
    Write-Host "n8n will still start; the workflow just cannot reach Sheets or Facebook yet." -ForegroundColor Yellow
}

# --- report ----------------------------------------------------------------

function Show-Setting($name, $value, $secret = $false) {
    if (-not $value) {
        Write-Host ("  {0,-26} (not set)" -f $name) -ForegroundColor DarkYellow
    } elseif ($secret) {
        Write-Host ("  {0,-26} set ({1} chars)" -f $name, $value.Length) -ForegroundColor DarkGreen
    } else {
        Write-Host ("  {0,-26} {1}" -f $name, $value) -ForegroundColor DarkGreen
    }
}

Write-Host ""
Write-Host "PlacidWay automation - n8n" -ForegroundColor Cyan
Write-Host "--------------------------" -ForegroundColor Cyan
Show-Setting 'PW_PUBLISH_MODE'  $env:PW_PUBLISH_MODE
Show-Setting 'PW_REVIEW_MODE'   $env:PW_REVIEW_MODE
Show-Setting 'PW_MODEL'         $env:PW_MODEL
Show-Setting 'PW_SHEET_ID'      $env:PW_SHEET_ID
Show-Setting 'PW_FB_PAGE_ID'    $env:PW_FB_PAGE_ID
Show-Setting 'PW_TELEGRAM_CHAT_ID' $env:PW_TELEGRAM_CHAT_ID
Show-Setting 'PW_ERROR_WORKFLOW_ID' $env:PW_ERROR_WORKFLOW_ID
Write-Host ""

if ($Tunnel) {
    Write-Host "Starting with a PUBLIC tunnel. Approval links will work on a phone." -ForegroundColor Yellow
    Write-Host "Anyone with the tunnel URL can reach this n8n. Stop it when you are done." -ForegroundColor Yellow
    Write-Host ""
    & $n8nCmd start --tunnel
} else {
    Write-Host "Open http://localhost:5678 once it finishes starting." -ForegroundColor Cyan
    Write-Host "For approval links that work on a phone, restart with: .\setup\start-n8n.ps1 -Tunnel" -ForegroundColor DarkGray
    Write-Host ""
    & $n8nCmd start
}
