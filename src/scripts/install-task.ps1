$ErrorActionPreference = "Stop"

$TaskName = "ReportV2"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$StartScript = Join-Path $PSScriptRoot "start-hidden.ps1"
$Pwsh = (Get-Command powershell.exe).Source
$Action = New-ScheduledTaskAction -Execute $Pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 365)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Write-Host "Installed task $TaskName for user $env:USERNAME"
Start-ScheduledTask -TaskName $TaskName
Write-Host "Started task $TaskName"
