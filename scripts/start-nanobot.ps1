# Start the local Nanobot gateway for the GETmore workbench.
# Usage: npm run agent
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$homeDir = Join-Path $root ".runtime\nanobot-home"
$agentDir = Join-Path $root "agent"
$env:HOME = $homeDir
$env:USERPROFILE = $homeDir
$env:PYTHONIOENCODING = "utf-8"

$nanobotRoot = if ($env:NANOBOT_ROOT) { $env:NANOBOT_ROOT } else { "D:\code_app\study\merchant-agent\nanobot" }
$python = Join-Path $nanobotRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
  Write-Error "nanobot Python environment not found: $python`nSet NANOBOT_ROOT to your nanobot checkout."
}

# Refresh the Copilot persona / workspace files from the repository copy.
$workspace = Join-Path $homeDir ".nanobot\workspace"
New-Item -ItemType Directory -Force -Path (Join-Path $workspace "data") | Out-Null
Copy-Item (Join-Path $agentDir "workspace\AGENTS.md") $workspace -Force
Copy-Item (Join-Path $agentDir "workspace\SOUL.md") $workspace -Force
Copy-Item (Join-Path $agentDir "workspace\USER.md") $workspace -Force
Copy-Item (Join-Path $agentDir "workspace\data\README.md") (Join-Path $workspace "data") -Force

# Create a config on first run.
$configPath = Join-Path $homeDir ".nanobot\config.json"
if (-not (Test-Path $configPath)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $configPath) | Out-Null
  Copy-Item (Join-Path $agentDir "config.example.json") $configPath
  Write-Warning "Created $configPath from agent/config.example.json."
  Write-Warning "Edit it to set your provider API key (or set DEEPSEEK_API_KEY), then run again."
}

Write-Host "GETmore Copilot • starting Nanobot gateway" -ForegroundColor Cyan
Write-Host "  home    : $homeDir"
Write-Host "  gateway : http://127.0.0.1:8765"
Write-Host "  health  : http://127.0.0.1:18790/health"
Write-Host ""

Set-Location $nanobotRoot
& $python -m nanobot gateway --foreground
