$TaskName = "ReportV2"
$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
  $Info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Task: $($Task.State)"
  Write-Host "LastRunTime: $($Info.LastRunTime)"
  Write-Host "LastTaskResult: $($Info.LastTaskResult)"
} else {
  Write-Host "Task ReportV2 is not installed"
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ServerScript = Join-Path $Root "src\server.js"
$Processes = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ServerScript) }

if ($Processes) {
  $Processes | ForEach-Object { Write-Host "Running PID: $($_.ProcessId)" }
} else {
  Write-Host "No ReportV2 node process found"
}
