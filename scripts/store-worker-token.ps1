param([string]$RepositoryPath = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$base = Join-Path $repository "packages\windows-worker\native\ChatGptMachine.Native\bin\Release\net10.0-windows"
$exe = Join-Path $base "win-x64\publish\ChatGptMachine.Native.exe"
$dll = Join-Path $base "ChatGptMachine.Native.dll"
if (Test-Path -LiteralPath $exe -PathType Leaf) {
  $command = $exe
  $arguments = @()
} elseif (Test-Path -LiteralPath $dll -PathType Leaf) {
  $command = (Get-Command dotnet.exe -ErrorAction Stop).Source
  $arguments = @($dll)
} else {
  throw "Build or publish the native helper before storing the worker token."
}

$secure = Read-Host "Worker relay token" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($plain.Length -lt 32) { throw "The worker token must contain at least 32 characters." }
  $request = @{ id = [guid]::NewGuid().ToString(); method = "credential.store"; params = @{ secret = $plain } } | ConvertTo-Json -Compress
  $responseText = $request | & $command @arguments
  $response = $responseText | Select-Object -Last 1 | ConvertFrom-Json
  if (-not $response.ok) { throw $response.error.message }
  Write-Output "Stored the worker token in Windows Credential Manager for the current user."
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $plain = $null
  $request = $null
}
