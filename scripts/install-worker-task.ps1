param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryPath,
  [string]$TaskName = "McpWorker"
)

$ErrorActionPreference = "Stop"
$resolvedRepository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$entry = Join-Path $resolvedRepository "dist\src\worker\client.js"
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw "Build the worker first. Missing: $entry"
}

$runner = Join-Path $resolvedRepository "scripts\run-worker.ps1"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runner + '" -RepositoryPath "' + $resolvedRepository + '"'
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $resolvedRepository
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Outbound-only MCP Windows worker" -Force
Write-Output "Installed current-user scheduled task: $TaskName"
