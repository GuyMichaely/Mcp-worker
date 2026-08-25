# Operations

## Required decisions

Supply these before public deployment:

- a public domain and DNS owner
- the ingress method
- an OAuth 2.1 authorization server, audience, scope, and redirect registration
- a worker credential and rotation procedure
- an administrator for firewall, TLS, and persistent-service setup
- backup and log-retention destinations

The inspected relay machine has Node.js but no public HTTPS listener, reverse proxy, or service supervisor. Inbound HTTPS is blocked. Do not expose the Node process directly until an administrator configures ingress and TLS.

## Remote setup

1. Install Node 24.
2. Copy the repository to a persistent directory.
3. Run `npm install`, `npm test`, and `npm run build`.
4. Create the data directory and restrict it to the service identity.
5. Set the variables from `.env.example`.
6. Bind Node to `127.0.0.1`.
7. Put a TLS reverse proxy in front of it. Allow at least 90 seconds for MCP calls and 35 seconds for worker polls. Disable response buffering for streaming responses.
8. Run `GET /healthz` and `GET /readyz`.
9. Test `/mcp` with MCP Inspector.
10. Add the public `https://.../mcp` URL in ChatGPT developer mode.

The OAuth provider must publish its authorization metadata. The MCP service publishes protected-resource metadata at `/.well-known/oauth-protected-resource`.

## Worker setup

1. Install Node 24 and .NET 10 on the Windows worker.
2. Build the repository.
3. Set `RELAY_URL`, `WORKER_ID`, `WORKER_TOKEN`, `WORKSPACE_ROOT`, and `WORKER_PROFILE` for the scheduled-task identity.
4. Test DNS, TCP 443, and `/healthz` from that identity.
5. Run `npm run worker` interactively once.
6. Run `scripts/install-worker-task.ps1` without elevation.
7. Confirm heartbeats through `/readyz`.

Store the worker token in Windows Credential Manager or protect it with DPAPI for unattended use. The environment variable is an override. Do not put the token in a command line, task argument, log, or committed file.

## Update and rollback

For an update:

1. Back up the SQLite file.
2. Stop the remote service.
3. Install the tested commit and run the build.
4. Start the service and check both health endpoints.
5. Update the worker.
6. Check a read-only tool before a mutation.

For rollback, stop the service, restore the previous code and matching database backup, then restart. Do not open a newer SQLite file with older code unless that release documents backward-compatible migrations.

## Backup

Back up the remote SQLite database and its WAL files while the service is stopped, or use SQLite's online backup API. Test a restore on another path. The Windows worker's existing data directory needs a separate backup that includes its configuration and audit database.

## Troubleshooting

`/healthz` fails: the remote process or reverse proxy is down.

`/readyz` returns 503: the remote process works, but the worker heartbeat is stale.

`WORKER_OFFLINE`: check the scheduled task, DNS, TLS trust, proxy policy, and worker token.

`INDETERMINATE_EXECUTION`: inspect the target machine and local audit record. Do not repeat the mutation until its effect is known.

`INVALID_APPROVAL`: the ticket expired, was reused, or does not match the request.
