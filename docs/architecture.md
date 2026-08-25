# Architecture

## Trust boundaries

ChatGPT connects to the public `/mcp` endpoint with an OAuth access token. The remote service verifies issuer, audience, scope, and signature through the configured JWKS endpoint. A hashed development token is available only when explicitly configured.

The Windows worker uses a separate bearer credential. It can call only `/worker/v1/*`. The worker opens outbound HTTPS connections and accepts no inbound internet connection. Its admin and development MCP listeners remain loopback-only.

## Call path

1. ChatGPT calls a tool through `/mcp`.
2. The remote service validates the request against the catalog generated from the real Windows MCP registrations.
3. The relay writes a queued SQLite job with a UUID, worker ID, request hash, expiry, and correlation ID.
4. The worker leases the job through a bounded long poll and validates it again.
5. The existing Windows runtime evaluates local policy.
6. An allowed action executes. A denied action fails. A prompted action returns without executing.
7. For a prompt, the worker creates an opaque ticket bound to the request hash and exact local summary.
8. The MCP server asks through ChatGPT elicitation. Cancellation, decline, timeout, or unsupported elicitation fails closed.
9. Acceptance queues the same job with the opaque ticket. The worker consumes it once and only for the stored summary.
10. The relay stores the result and returns it to the MCP call.

The relay correlation ID is attached to the local audit record. The local audit ID remains independently unique because the approval attempt and resumed execution are separate records.

## Job safety

Read-only jobs can return to the queue after a lost lease. A mutation with an expired lease becomes `indeterminate`; the relay does not retry it. An identical duplicate result is accepted, while a conflicting result is rejected.

Queued and approval-pending work can be cancelled. Cancellation after a mutation lease begins is reported as indeterminate because the effect may already exist.

## Files

`file_import` gives the worker a ChatGPT-authorized download URL and an allowed local destination. The worker streams the file directly to a temporary local path, verifies an optional hash, and renames it into place.

`file_export` copies an allowed local file into the worker's expiring transfer area. The outbound client uploads it to the relay in 1 MiB chunks. The relay checks worker ownership, offsets, maximum size, expiry, and SHA-256 before marking it ready. ChatGPT receives a `machine-file://` resource link, and the MCP resource reader returns the verified bytes. Expired transfer rows and files are removed during transfer activity.

## Processes and desktop state

One long-running worker process owns interactive process sessions. A worker restart loses those in-memory sessions; subsequent session calls return an unknown-session error instead of claiming they remain alive.

Desktop tools use the included .NET helper. The helper reports locked or non-interactive desktop failures through structured local tool errors.

## Storage

The relay uses Node's built-in SQLite driver in WAL mode and a persistent transfer directory. The Windows worker keeps its configuration, audit SQLite database, transfers, trash, logs, and runtime files in its per-user data directory.

The initial relay design assumes one service process. Running several relay processes requires a shared database and a different leasing design.
