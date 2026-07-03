$ErrorActionPreference = "Stop"

$TaskName = "ReportV2"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ServerScript = Join-Path $Root "src\server.js"
$Processes = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ServerScript) }

foreach ($Process in $Processes) {
  Stop-Process -Id $Process.ProcessId -Force
  Write-Host "Stopped process $($Process.ProcessId)"
}

if (!$Processes) { Write-Host "No ReportV2 process found" }
