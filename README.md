# Mcp-worker

Mcp-worker lets ChatGPT operate one policy-controlled Windows machine through a public MCP server and an outbound-only worker connection.

The repository contains three parts:

- `src/remote`: the Streamable HTTP MCP server and durable relay API
- `src/worker`: the outbound worker client and exact-action approval bridge
- `packages/windows-worker`: the complete Windows tool, policy, audit, desktop, clipboard, process, transfer, admin, and .NET helper implementation

The remote server advertises the complete 31-tool catalog even when the worker is offline. Tool execution remains subject to the worker's local policy. Prompt decisions use MCP elicitation and a short-lived ticket bound to the exact request.

## What works

- OAuth-protected `/mcp` and separately authenticated worker endpoints
- SQLite jobs, leases, expiry, deduplicated results, cancellation, and indeterminate mutation handling
- file CRUD and search, process execution and interactive sessions, desktop and clipboard tools
- AppContainer execution through the included .NET 10 helper
- file import and chunked file export through expiring MCP resources
- local SQLite audit records with relay correlation IDs
- current-user scheduled-task scripts with hidden execution, restart behavior, and bounded logs
- Linux relay tests, Windows worker tests, native-helper builds, and Credential Manager smoke verification in CI

## Local verification

```powershell
npm ci
npm run build
npm test
npm run test:windows
npm run native:build
```

Copy `.env.example` into the environment of each process before starting it. Run the remote service with `npm run remote` and the Windows client with `npm run worker`.

Public deployment still requires choices that cannot be inferred from this repository: domain and DNS control, ingress, administrator support, OAuth registration, the service account, persistent directories, backup and log policy, alerting, and size limits. See [docs/owner-setup-checklist.md](docs/owner-setup-checklist.md) and [docs/operations.md](docs/operations.md).

## Documentation

- [Owner setup checklist](docs/owner-setup-checklist.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Setup, deployment, backup, rollback, and owner decisions](docs/operations.md)
- [Original worker inventory](packages/windows-worker/docs/local-worker-inventory.md)
