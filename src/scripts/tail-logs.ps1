$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$LogsDir = Join-Path $Root "logs"
if (!(Test-Path $LogsDir)) {
  Write-Host "No logs directory found"
  exit 0
}

$Latest = Get-ChildItem $LogsDir -Filter "*.jsonl" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$Latest) {
  Write-Host "No JSONL logs found"
  exit 0
}

Write-Host "Tailing $($Latest.FullName)"
Get-Content $Latest.FullName -Tail 100 -Wait
