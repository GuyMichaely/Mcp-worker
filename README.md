# Mcp-worker

Mcp-worker connects ChatGPT to one authorized Windows worker.

A remote Node service exposes the Streamable HTTP MCP endpoint and a durable HTTPS relay. The Windows worker makes outbound HTTPS requests. It does not accept inbound internet connections.

## Current scope

The first implementation includes:

- shared tool and relay schemas
- SQLite jobs with leases, expiry, result deduplication, cancellation, and approval binding
- separate OAuth access-token and worker-token checks
- health, readiness, MCP, heartbeat, polling, result, and cancellation endpoints
- a Windows worker with path checks, process limits, secret filtering, and bounded retry
- MCP elicitation for exact-action approval
- tests and operating instructions

DNS, TLS ingress, and the OAuth provider are not configured in code. The relay machine inventory shows that those choices still need an owner and machine setup.

## Run it

```powershell
Copy-Item .env.example .env
npm install
npm test
npm run build
npm run remote
```

Start the worker in another terminal:

```powershell
npm run worker
```

Read [the architecture](docs/architecture.md) before changing the protocol. Use [the operations guide](docs/operations.md) for setup and recovery.
