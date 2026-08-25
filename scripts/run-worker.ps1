param(
  [Parameter(Mandatory = $true)][string]$RepositoryPath,
  [int64]$MaximumLogBytes = 10485760
)

$ErrorActionPreference = "Stop"
$repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$entry = Join-Path $repository "dist\src\worker\client.js"
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Missing built worker: $entry" }
$dataDirectory = if ($env:WORKER_DATA_DIRECTORY) { $env:WORKER_DATA_DIRECTORY } else { Join-Path $env:USERPROFILE "chatgpt-machine-mcp" }
$logDirectory = Join-Path $dataDirectory "logs"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$log = Join-Path $logDirectory "relay-worker.log"
$previous = "$log.1"
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -ge $MaximumLogBytes) {
  Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $log -Destination $previous
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
Push-Location $repository
try { & $node $entry *>> $log; exit $LASTEXITCODE }
finally { Pop-Location }
