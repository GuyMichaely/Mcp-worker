# Mcp-worker

A private, single-user bridge from ChatGPT to an authorized Windows worker.

The remote Node service exposes a Streamable HTTP MCP endpoint and a durable HTTPS relay. The Windows worker makes outbound-only HTTPS requests, evaluates local policy, and dispatches authorized tools.

## Status

This repository contains the portable first implementation:

- shared, versioned relay contracts and tool schemas
- SQLite/WAL durable jobs with leases, expiry, deduplicated results, cancellation, and approval binding
- separate OAuth access-token and worker-token verification
- Streamable HTTP MCP endpoint, health/readiness endpoints, and versioned worker API
- outbound-only Windows worker with long polling, bounded backoff, path policy, and exact-action approval tickets
- unit and integration tests
- setup, deployment, update, rollback, backup, and troubleshooting notes

Machine-specific public ingress, DNS, TLS, and OAuth identity-provider settings are deliberately configuration, not assumptions.

## Quick start

```powershell
Copy-Item .env.example .env
npm install
npm test
npm run build
npm run remote
```

In another terminal:

```powershell
npm run worker
```

See [docs/architecture.md](docs/architecture.md) and [docs/operations.md](docs/operations.md).
