# Architecture

## Trust boundaries

ChatGPT connects to the public MCP endpoint with an OAuth access token. The remote service checks that token before MCP dispatch.

The Windows worker uses a separate bearer credential. That credential can call only the worker API. An MCP access token cannot call the worker API.

The worker opens outbound HTTPS connections. Production mode does not require a non-loopback listener on Windows.

## Call path

1. ChatGPT calls a machine tool through `/mcp`.
2. The remote service validates the tool arguments from the shared schema.
3. The relay writes a queued SQLite job.
4. The worker leases the job through a 25-second poll.
5. The worker validates the same schema and evaluates local policy.
6. Allowed work runs once. Denied work fails.
7. Prompted work returns an opaque approval ticket and exact request hash.
8. The MCP handler asks through form elicitation. A missing, declined, cancelled, or timed-out answer fails closed.
9. An accepted ticket returns to the worker. The worker checks its local ticket before one execution.
10. The relay stores the result and returns it to the MCP call.

## Job safety

Read-only jobs can return to the queue after a lost lease. A mutation with an expired lease becomes `indeterminate`. The relay does not retry it.

The result endpoint accepts an identical duplicate. It rejects a different second result.

Every approval ticket has one request hash and one expiry. The worker consumes it once.

## Storage

The relay uses Node's built-in SQLite driver in WAL mode. The initial design assumes one remote service process. Before running more than one process, replace the polling and transaction assumptions with a shared database design.

The worker keeps approval tickets in memory. A worker restart clears them and fails pending approvals closed. The existing Windows implementation can replace this class with its SQLite-backed approval and audit components.

## Tool adapters

The included worker implements machine status, UTF-8 file read, atomic UTF-8 file write, and shell-free process execution. The next integration step is to connect the existing Windows handlers for desktop control, clipboard access, transfers, interactive sessions, AppContainer execution, and the local audit database. Keep the shared contract as the transport boundary.
