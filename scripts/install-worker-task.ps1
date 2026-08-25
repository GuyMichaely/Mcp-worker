param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryPath,
  [string]$TaskName = "McpWorker"
)

$ErrorActionPreference = "Stop"
$resolvedRepository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$entry = Join-Path $resolvedRepository "dist\src\worker\client.js"
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw "Build the worker first. Missing: $entry"
}

$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $entry + '"') -WorkingDirectory $resolvedRepository
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Outbound-only MCP Windows worker" -Force
Write-Output "Installed current-user scheduled task: $TaskName"
