# Local worker machine inventory

Collected on August 24, 2026. Hostname, domain membership, usernames, IP addresses, and secrets are intentionally omitted.

## Operating environment

- Microsoft Windows 11 Enterprise, version `10.0.26200`, build `26200`, 64-bit.
- VMware virtual machine, model `VMware20,1`.
- Intel Xeon Gold 6342 CPU at 2.80 GHz, 4 cores and 4 logical processors.
- 20 GiB RAM.
- NTFS system drive with about 19.5 GiB free when inventoried.
- Eastern Standard Time Windows time-zone identifier.
- The normal user session is not elevated.
- Windows PowerShell 5.1 is installed. PowerShell 7 is not installed.
- WSL default version is 2. Docker is not installed.

## Development runtimes

- Node.js `v24.19.0` at `C:\Program Files\nodejs\node.exe`.
- npm `12.0.2`.
- .NET SDK `10.0.300` at `C:\Program Files\dotnet\sdk`.
- Git for Windows `2.55.0` installed in the current user's profile.
- The repository already has `node_modules`, compiled TypeScript output, and a published self-contained native helper.

## Network and endpoint controls

- Outbound TCP 443 tests to `api.openai.com` and `github.com` succeeded.
- An HTTPS fetch to `registry.npmjs.org` returned HTTP 200.
- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` are not configured in the process environment.
- Symantec Endpoint Protection `14.3.12167.10000.105` is active.
- Windows Defender Antivirus is stopped.
- Effective AppLocker collections are mostly not configured; one collection is in audit-only mode.
- OpenAI's unsigned tunnel client and freshly compiled Go executables fail before startup with Windows status `0xC0000022`. Do not depend on Go executables on this worker.
- Node.js, the local .NET helper, Git, and normal PowerShell scripts run successfully.

Once the relay has a domain, test the actual route from this worker with:

```powershell
Resolve-DnsName relay.example.com
Test-NetConnection relay.example.com -Port 443
node -e "fetch('https://relay.example.com/healthz').then(async r => { console.log(r.status); console.log(await r.text()) }).catch(e => { console.error(e); process.exit(1) })"
```

Replace `relay.example.com` with the real host. Do not put credentials in the command line or shell history.

## Current local service

- Repository: `C:\Users\E-guy.michaely\projects\rsidev\mcp`.
- Runtime data: `C:\Users\E-guy.michaely\chatgpt-machine-mcp`.
- Allowed initial workspace: `C:\Users\E-guy.michaely\projects\pluginworkspace`.
- Active profile: `mostly-unattended`.
- Loopback MCP endpoint: `127.0.0.1:47320`.
- Loopback admin page: `127.0.0.1:47321`.
- Bearer authentication on the loopback MCP endpoint is disabled because it is local-only.
- A Node process was serving both loopback ports during inventory. No startup scheduled task was installed.
- The configuration and SQLite audit database already exist.

## Existing code worth reusing

- TypeScript MCP tool definitions and handlers for files, processes, desktop control, clipboard access, transfers, policy inspection, and machine status.
- A .NET 10 Windows helper for AppContainer execution, desktop automation, clipboard access, Credential Manager, and DPAPI.
- Policy profiles, exact path checks, structured tool results, audit records, and a loopback admin UI.
- Vitest coverage for configuration, path policy, and authorization policy.

The worker implementation should reuse these capabilities after separating tool contracts, policy evaluation, approval state, and execution from the current in-process MCP server transport.
