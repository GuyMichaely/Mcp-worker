# ChatGPT Machine Worker

A Windows machine-control service intended to let ChatGPT work with local files, programs, and the interactive desktop. It implements the machine tools itself and does not proxy requests to Codex or another model.

The local capability and policy code exists. The public MCP relay and outbound worker connection are the next implementation phase. See [the cloud-agent handoff](docs/cloud-agent-handoff.md).

## Planned architecture

The system has three participants:

1. ChatGPT connects to a public Streamable HTTP MCP endpoint over HTTPS.
2. One remote machine runs both the MCP server and the relay API.
3. This Windows machine runs a worker that polls the relay over outbound HTTPS, executes approved jobs, and returns results.

The local machine will not accept inbound Internet connections. HTTPS provides transport security; the project does not add application-layer payload encryption.

## Existing local capabilities

- File listing, metadata, bounded reads, recursive search, atomic writes, exact-text replacements, directory creation, copying, moving, recoverable deletion, permanent deletion, and file transfer support.
- Waiting and interactive current-user processes, plus strict AppContainer process execution. Strict failures never fall back to unsandboxed execution.
- Window discovery, screenshots, focus, click, drag, scroll, Unicode typing, key chords, approved app launch, and clipboard text access.
- Four visible policy profiles: `confirm-all`, `confirm-mutations`, `mostly-unattended`, and `yolo`.
- SQLite audit history and a loopback-only admin page with configuration editing and profile switching.
- Generic Windows Credential Manager and current-user DPAPI support that the worker can use for relay credentials.

## Build and test

Requirements are Node.js 24+ and the .NET 10 SDK. The published native helper is self-contained, so a packaged build does not require a separate .NET runtime.

```powershell
npm install
npm run build
npm run native:publish
npm test
npm run smoke:native
```

`smoke:native` verifies the interactive desktop, Credential Manager, an allowed AppContainer workspace write, and a denied read outside that workspace.

## Local setup

```powershell
npm run setup
npm run build
npm start
```

Setup creates:

- `C:\Users\<you>\chatgpt-machine-mcp\config.json`
- `C:\Users\<you>\chatgpt-machine-mcp\state.sqlite3`
- `C:\Users\<you>\projects\pluginworkspace`

Until the worker transport is implemented, the existing loopback MCP endpoint remains available for local testing at `http://127.0.0.1:47320/mcp`. The admin page is `http://127.0.0.1:47321/`.

## Default authority

`mostly-unattended` is active initially. It permits file work inside `pluginworkspace`, strict sandboxed commands, network access for strict commands, and desktop control of Notepad, Calculator, and Explorer. It prompts before deletes and current-user execution. Everything else is denied unless added to `config.json` or allowed in the local admin page.

The `yolo` profile removes server-generated policy prompts and selects policy-only process execution. It remains a named, inspectable configuration choice.

## Security boundaries and current limitations

- The MCP and admin listeners bind only to `127.0.0.1`.
- Child processes do not receive environment variables whose names look like credentials, tokens, passwords, or API keys.
- AppContainer ACL grants are limited to the declared workspace.
- Interactive long-running process sessions require policy-only mode. Strict mode supports wait-for-completion commands and fails closed for interactive sessions.
- Desktop control works only in the logged-in, unlocked interactive session.
- Screenshot coordinates expire after 30 seconds and are rejected if the window moved or resized.
- No tool requests elevation. Actions run as the logged-in user or in the stricter AppContainer.
