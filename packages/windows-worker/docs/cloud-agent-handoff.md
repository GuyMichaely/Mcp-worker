# Cloud-agent implementation handoff

Copy the prompt below into the cloud coding agent. Give it this repository and, when available, the report produced by [the relay-machine inventory prompt](relay-machine-inventory-prompt.md).

```text
Build the next phase of this repository into a working three-part system that lets ChatGPT operate an authorized Windows machine through a proper MCP plugin.

Read the entire repository before changing it. Read docs/local-worker-inventory.md and the relay-machine inventory report supplied by the user. Check the current official OpenAI documentation for plugin MCP servers, Streamable HTTP, ChatGPT developer-mode connection, authentication, elicitation, tool annotations, resources, and file transfer before making protocol choices:

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/auth

Do not bridge to Codex, call another model, or use the OpenAI API to execute tools. Do not use OpenAI Secure MCP Tunnel or tunnel-client. The project must implement its own MCP server, relay protocol, local worker, and tools.

Architecture and fixed decisions

1. ChatGPT is the MCP client.
2. One public remote machine runs both the standards-compliant MCP server and the relay API. They may be modules in one Node.js service and one deployment unit.
3. The existing Windows machine runs the local Node.js worker and .NET helper. It initiates outbound HTTPS requests to the remote service and accepts no inbound Internet connections.
4. Use normal HTTPS/TLS on both network paths. Do not add application-layer encryption for job payloads or files.
5. This is initially a private, single-user system with one Windows worker, but use an explicit worker ID and avoid assumptions that make a second worker impossible.
6. Keep local configuration and SQLite state under the existing per-user data directory. Keep the initial authorized workspace named pluginworkspace.
7. The relay deployment target has not been inspected unless a separate machine report is attached. Do not claim that ports, DNS, TLS, Docker, systemd, or a reverse proxy exist without evidence. Keep deployment configuration portable until that report resolves the choice.

Current repository

The existing TypeScript and .NET code already implements file CRUD, searches, transfers, process execution, interactive process sessions, AppContainer execution, desktop observation and control, clipboard access, policy profiles, exact-action approvals, SQLite auditing, an admin page, and MCP tool definitions. Reuse it. Separate tool contracts and execution from the current loopback MCP transport instead of rewriting the Windows functionality.

The worker runs on Windows 11 Enterprise with Node 24 and .NET 10. Docker is absent. Symantec blocks OpenAI tunnel-client and locally compiled Go executables, so keep the worker implementation in Node.js, TypeScript, PowerShell, and the existing .NET helper. Full details are in docs/local-worker-inventory.md.

Remote MCP service requirements

- Expose a proper Streamable HTTP MCP endpoint, normally `/mcp`, compatible with ChatGPT developer mode and MCP Inspector.
- Provide initialization, stable server instructions, tool discovery, tool calls, resources, and required server-to-client messages.
- Keep the complete tool catalog and schemas on the remote service so ChatGPT can discover tools while the worker is offline. Generate remote and local definitions from shared contracts to prevent drift.
- Translate each machine tool call into a durable relay job and wait for its result. Return a structured `WORKER_OFFLINE`, timeout, cancellation, or indeterminate-execution error when appropriate.
- Expose `/healthz` and `/readyz`. Readiness should distinguish the remote service being healthy from the Windows worker being online.
- Bind the application to loopback or the hosting platform's required internal interface. Terminate public TLS through the deployment environment or an existing reverse proxy.
- Authenticate ChatGPT using a method ChatGPT actually supports. For private data and write actions, follow the current MCP OAuth 2.1 contract and OpenAI guidance. Do not rely on a custom header that ChatGPT cannot send. Keep OAuth identity and deployment details configurable because the relay machine inventory may reveal an existing identity provider.
- Authenticate the Windows worker separately with a high-entropy bearer credential over HTTPS. Store only a suitable verifier or secret reference remotely. Do not log it.
- Do not expose worker polling, result, upload, or administrative endpoints anonymously.

Relay protocol requirements

- Use versioned HTTPS endpoints, such as `/worker/v1/poll`, `/worker/v1/jobs/{id}/result`, `/worker/v1/jobs/{id}/events`, `/worker/v1/transfers/...`, and `/worker/v1/heartbeat`. The exact shape may change if a cleaner design tests better.
- Prefer a 20-to-30-second long poll so it works through ordinary HTTPS proxies. Reconnect immediately after a job or timeout with bounded exponential backoff and jitter on failures.
- Give every job a UUID, worker ID, tool name, validated arguments, creation and expiry times, attempt number, request hash, lease token, and state.
- Model queued, leased, approval-pending, completed, failed, expired, cancelled, and indeterminate states. Validate legal transitions transactionally.
- Use SQLite in WAL mode on the remote machine for the initial single-service deployment. Do not add Redis or another service without evidence that the target requires it.
- Deduplicate submitted results and resume requests. Never blindly retry a mutating operation if the relay lost contact after execution may have started. Report an indeterminate outcome that requires inspection. Read-only operations may use a bounded retry policy.
- Propagate cancellation when ChatGPT ends a call or the MCP deadline expires. Expired work must not execute later.
- Apply explicit request, result, file, and log size limits. Preserve the existing 1 MiB transfer chunk size unless tests show a reason to change it.
- Use correlation IDs across the MCP request, relay job, local audit record, and logs. Redact credentials and secret-shaped child-process environment values.

Windows worker requirements

- Add a worker command that connects only to the configured HTTPS relay URL, authenticates, heartbeats, long-polls, validates jobs against shared schemas, and dispatches them to the existing local handlers.
- Reuse the generic native Credential Manager or DPAPI helper for the worker credential. Support an environment-variable override for unattended deployment without printing the value.
- Keep the loopback admin page. The loopback MCP endpoint may remain as a development and test mode, but production remote operation must not depend on it.
- Add a current-user scheduled-task installer for the finished worker. It must run without elevation, hide the background window, restart after failure, and write bounded logs under the existing data directory.
- Detect locked or non-interactive desktop sessions and return a clear error for desktop tools.
- Do not weaken the existing file policy, AppContainer boundary, environment-secret filtering, process limits, or audit behavior.

Approval design

Preserve trusted, exact-action approval through the real ChatGPT MCP session:

1. The worker evaluates its local policy before execution.
2. `allow` executes and `deny` returns immediately.
3. For `prompt`, the worker returns an approval request containing an opaque ticket, exact human-readable summary, request hash, and short expiry. It does not execute yet.
4. The remote MCP server uses MCP elicitation through ChatGPT to ask the user. If elicitation is unsupported, cancelled, declined, or times out, fail closed.
5. After acceptance, the relay queues a resume message containing the approval ticket. The authenticated worker verifies that the ticket is unexpired and bound to the exact stored request before executing once.

The user is willing to trust the authenticated ChatGPT browser interaction delivered through the MCP connection. Do not treat ordinary model text or a tool argument saying "approved" as proof of approval. Keep accurate MCP destructive, read-only, and open-world annotations so ChatGPT can also apply its host confirmation behavior.

Files and long-running operations

- Preserve file import and export. The public MCP server must be able to return expiring MCP resources backed by content obtained from the worker. Transfer chunks travel over HTTPS without extra encryption.
- Enforce ownership, expiry, maximum size, MIME type handling, cleanup, and path policy at the worker. Do not allow the remote service to choose arbitrary local paths outside a policy-authorized tool request.
- Preserve interactive process start, stdin, output polling, and stop operations. Worker restart should mark lost sessions clearly rather than pretending they still exist.

Testing and acceptance

- Keep existing tests passing.
- Add unit tests for relay state transitions, authentication, schemas, expiry, lease validation, deduplication, approval binding, retries, and redaction.
- Add an end-to-end test with a real remote MCP server, an in-process fake Windows worker, MCP initialization, tool discovery, a read-only call, an approved mutation, a declined mutation, worker-offline behavior, cancellation, and a file transfer.
- Test the remote endpoint with MCP Inspector.
- Verify that no local production listener binds beyond loopback.
- Verify that a worker credential cannot call `/mcp`, an MCP user token cannot call worker endpoints, expired jobs do not execute, and duplicate mutation results do not repeat execution.
- Provide setup, development, deployment, update, rollback, backup, and troubleshooting documentation for both machines.
- Provide `.env.example` files containing names and safe placeholders only. Never commit real credentials or machine-specific secrets.
- Add database migrations and versioned shared protocol types.
- Use dummy Git authorship already configured in this repository. Make focused commits and leave the working tree clean.

Work autonomously through implementation and tests. If the relay-machine report leaves a deployment choice unresolved, complete the portable application and document the exact missing deployment decision instead of inventing machine capabilities.
```
