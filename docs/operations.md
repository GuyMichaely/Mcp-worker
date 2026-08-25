# Operations

## Decisions the owner must supply

The relay machine is an ordinary Windows workstation. It has no public HTTPS listener, reverse proxy, service supervisor, or inbound firewall allowance. The following values cannot be inferred and are intentionally absent:

- public relay domain and access to its DNS records
- ingress through router forwarding, direct IPv6, or another gateway
- an administrator for inbound TCP 443, reverse-proxy installation, and persistent service setup
- OAuth issuer, JWKS URL, audience, required scope, client registration, and redirect URLs
- Windows accounts that will run the relay and worker, including their privilege boundaries
- persistent locations for the relay database, transfer files, logs, and backups
- backup destination, schedule, retention, and restore-test owner
- log retention and monitoring or alert destination
- maximum file, JSON body, and practical MCP request sizes
- deployment source, release approval, and token rotation owner

TLS certificate issuance follows from the domain and ingress choice. Do not create placeholder values for these items.

## Remote setup

1. Install Node 24 and clone the tested repository into a persistent directory.
2. Run `npm install`, `npm run build`, and `npm test`.
3. Set the remote variables from `.env.example` under the chosen service identity.
4. Keep `BIND_HOST=127.0.0.1` when using a reverse proxy.
5. Give the service identity write access only to the chosen database, transfer, and log directories.
6. Put a TLS reverse proxy in front of the Node port. Allow at least 100 seconds for MCP calls and at least 35 seconds for worker polls. Do not buffer streaming responses.
7. Verify `/healthz`, then `/readyz`. A 503 from readiness means the remote service works but the worker heartbeat is stale.
8. Test the public `/mcp` endpoint with MCP Inspector using a valid OAuth token.
9. Add the public `https://<domain>/mcp` URL in ChatGPT developer mode.

The relay report recommends Caddy, but installation and certificate configuration require the domain, ingress choice, and administrator approval.

## Windows worker setup

1. Install Node 24 and .NET 10, then clone the same tested commit.
2. Run `npm install`, `npm run build`, `npm run test:windows`, and `npm run native:build`.
3. Point `WORKER_DATA_DIRECTORY` at the existing per-user data directory if it is not the default `chatgpt-machine-mcp` directory under the user profile.
4. Set `RELAY_URL`, `WORKER_ID`, and `POLL_SECONDS` for the scheduled-task identity.
5. Either set `WORKER_TOKEN` in that identity's environment or run `scripts/store-worker-token.ps1`. The environment value overrides Credential Manager.
6. Test DNS, TCP 443, and `/healthz` from that identity.
7. Run `npm run worker` interactively once and confirm `/readyz` reports the worker online.
8. Install the current-user task without elevation:

```powershell
.\scripts\install-worker-task.ps1 -RepositoryPath (Get-Location).Path
```

The task runs after logon, uses a hidden PowerShell window, restarts after failure, and keeps two bounded relay-worker log files in the worker data directory.

## Update and rollback

Before an update, back up the relay SQLite database and transfer directory, stop the service, and record the currently deployed commit. Install and build the tested commit, start the service, then check both health endpoints. Update the worker after the relay succeeds. Test a read-only tool before a mutation.

For rollback, stop both processes, restore the prior commit and its matching database backup, then restart the relay followed by the worker. Do not open a newer database with older code unless that release states that the schema is backward compatible.

## Backup and restore

Use SQLite's online backup API or stop the relay and copy the database together with its WAL and shared-memory files. Back up the transfer directory if active export links must survive restore. Back up the Windows worker data directory separately because it contains policy configuration and local audit history.

Test restore into a different directory and verify the database can open, the migration tables exist, and a read-only tool call completes.

## Troubleshooting

`WORKER_OFFLINE`: check the task state, DNS, TLS trust, proxy policy, token, and `/healthz` from the worker account.

`INDETERMINATE_EXECUTION`: inspect the target and the local audit record using the correlation ID. Do not repeat the mutation until its effect is known.

`INVALID_APPROVAL`: the ticket expired, was reused, or did not match the exact request.

`TRANSFER_OFFSET_MISMATCH`: a chunk was repeated or skipped. Restart the tool call with a new export ID.

`TRANSFER_HASH_MISMATCH`: the relay did not receive the bytes the worker hashed. Discard the transfer and inspect the route before retrying.
