# Security

This project intentionally exposes powerful local-machine capabilities. Keep local listeners on loopback and review the active policy before leaving the service unattended. The planned worker must initiate outbound HTTPS connections to an authenticated public relay. It must never open an inbound public listener on the Windows machine.

Do not commit `config.json`, SQLite data, worker credentials, Credential Manager exports, or transfer files. The default data directory is outside this repository.

If a strict command cannot run in AppContainer, the server returns an error. It must never retry in policy-only mode unless a separate tool call explicitly requests that mode and policy permits it.

Approvals are exact-action prompts. The model's text is not treated as proof that the user approved an operation; the MCP client must return a successful elicitation response. Missing elicitation support fails closed.
