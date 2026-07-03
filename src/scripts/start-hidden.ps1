$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ServerScript = Join-Path $Root "src\server.js"
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$LogsDir = Join-Path $Root "logs"
if (!(Test-Path $LogsDir)) { New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null }

$Existing = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ServerScript) }

if ($Existing) {
  Write-Host "ReportV2 already running: $($Existing.ProcessId -join ', ')"
  exit 0
}

$Stdout = Join-Path $LogsDir "process-stdout.log"
$Stderr = Join-Path $LogsDir "process-stderr.log"
Start-Process -FilePath $Node `
  -ArgumentList "`"$ServerScript`"" `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $Stdout `
  -RedirectStandardError $Stderr

Write-Host "ReportV2 started from $Root"
