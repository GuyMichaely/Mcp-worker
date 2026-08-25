# Owner setup checklist

This checklist covers the deployment choices and machine preparation that cannot be inferred from the repository. Do not invent placeholder production values. Keep the worker private and outbound-only.

## 1. Confirm ChatGPT-side MCP access

Before configuring public infrastructure, confirm that the ChatGPT account or workspace you intend to use exposes developer mode and custom MCP app creation with the actions you need. Product availability changes independently of this repository.

If your ChatGPT product offers a supported secure MCP tunnel for private servers and you prefer not to expose the relay publicly, evaluate that before committing to DNS and reverse-proxy work. The current repository deployment path assumes a public HTTPS relay.

## 2. Prepare the Windows worker machine

Install:

- Git
- Node.js 24
- .NET 10 SDK

Clone the repository and select the tested commit or branch supplied for deployment. Then run:

```powershell
npm ci
npm run build
npm run test:windows
npm run native:build
```

Do not install the scheduled task until the selected commit has passed the repository's Windows CI job.

Choose the Windows account that will own the worker. The scheduled task, Credential Manager entry, worker data directory, policy, and audit history should all belong to this same account.

Choose a persistent worker data directory. The default is the `chatgpt-machine-mcp` directory under the current user's profile.

## 3. Create the worker relay credential

Generate one high-entropy token. The relay stores only its SHA-256 hash; the Windows worker stores the original token in Credential Manager or receives it from its environment.

Example PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$workerToken = [Convert]::ToBase64String($bytes)
$workerHash = [Convert]::ToHexString(
  [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($workerToken))
).ToLowerInvariant()

$workerToken
$workerHash
```

Treat `$workerToken` as a secret. Use `$workerHash` as `WORKER_TOKEN_SHA256` on the relay.

After `npm run native:build`, store the token under the same Windows identity that will run the worker:

```powershell
.\scripts\store-worker-token.ps1 -RepositoryPath (Get-Location).Path
```

The script prompts for the token securely and writes it to Windows Credential Manager.

## 4. Choose relay storage and service identity

Choose persistent paths for:

- relay SQLite database
- transfer files
- service logs
- backups

Choose the OS account that will run the relay and grant it write access only to those locations.

Keep `BIND_HOST=127.0.0.1` when a local reverse proxy terminates TLS.

## 5. Choose how ChatGPT reaches the relay

For the repository's public HTTPS deployment path, provide:

- public hostname, for example `mcp.example.com`
- DNS control for that hostname
- an ingress path to TCP 443
- a TLS reverse proxy such as Caddy

The proxy must support streaming responses, avoid response buffering, allow MCP requests for at least 100 seconds, and allow worker polls for at least 35 seconds.

Do not expose the Windows worker's local MCP or admin listeners. Only the relay is public.

## 6. Configure OAuth/OIDC

Choose an OAuth/OIDC provider that can issue JWT access tokens and provide:

- issuer URL
- JWKS URL
- audience
- required MCP scope
- client registration
- redirect URLs required by ChatGPT
- refresh-token or equivalent offline access if the ChatGPT integration requires persistent authorization

These become `OAUTH_ISSUER`, `OAUTH_JWKS_URI`, `OAUTH_AUDIENCE`, and `OAUTH_REQUIRED_SCOPE` on the relay.

## 7. Assemble relay configuration

Use `.env.example` as the field inventory. Production values include:

```text
BIND_HOST=127.0.0.1
PORT=8787
PUBLIC_BASE_URL=https://<public-hostname>
REMOTE_DB_PATH=<persistent sqlite path>
REMOTE_TRANSFER_DIR=<persistent transfer path>
WORKER_ID=primary-windows
WORKER_TOKEN_SHA256=<sha256 from step 3>
OAUTH_ISSUER=<issuer>
OAUTH_AUDIENCE=<audience>
OAUTH_JWKS_URI=<jwks url>
OAUTH_REQUIRED_SCOPE=<scope>
```

Leave `MCP_DEV_TOKEN_SHA256` unset in production.

## 8. First integration sequence

After the relay configuration is complete:

1. Start the relay locally and verify `/healthz`.
2. Put the TLS ingress in front of it and verify public `/healthz`.
3. Configure the worker with `RELAY_URL`, `WORKER_ID`, `WORKER_DATA_DIRECTORY`, and `POLL_SECONDS`.
4. Run `npm run worker` interactively under the intended Windows account.
5. Verify `/readyz` reports the worker online.
6. Test the public MCP endpoint with a valid OAuth token.
7. Add the MCP endpoint to ChatGPT and scan its tools.
8. Test a read-only operation before any mutation.
9. Install the scheduled task only after the interactive path works.

Record the exact deployed commit before installing the service and task.
