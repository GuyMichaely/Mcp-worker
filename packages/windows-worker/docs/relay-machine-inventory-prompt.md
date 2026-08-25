# Relay and MCP machine inventory prompt

Give the following prompt to an agent that has read-only terminal access to the intended relay/MCP machine.

```text
Inspect this machine for deployment of a private, single-user ChatGPT MCP server and HTTPS relay. The MCP server and relay API will run on this same machine. Do not install, upgrade, reconfigure, restart, expose ports, or create files. Use read-only commands only.

Return a concise Markdown report. Do not reveal secret values, full environment dumps, private keys, access tokens, cookies, cloud metadata credentials, usernames, home-directory names, private IP addresses, or unrelated tenant/account identifiers. You may report whether a secret or setting exists.

Collect:

1. Operating system, version, kernel, CPU architecture, virtualization or cloud environment if safely identifiable, CPU count, RAM, persistent disk filesystem, and free disk space.
2. Whether the current account has sudo, administrator, or service-management privileges. Do not invoke an elevation prompt.
3. Installed versions and executable locations for Node.js, npm or pnpm, Git, Docker, Docker Compose, systemd, nginx, Caddy, Apache, SQLite, PostgreSQL clients, and Redis clients. Mark missing items.
4. Whether the machine can run a persistent Node service and which supervisor is already used, such as systemd, Docker Compose, Kubernetes, PM2, or a hosting-platform process definition.
5. Existing listeners and firewall policy relevant to TCP 80 and 443. Do not disclose unrelated listeners. State whether inbound public HTTPS is known to reach this machine.
6. Whether a public DNS name already points to the service and how TLS certificates are currently terminated or renewed. Redact the exact hostname if it is sensitive, but say whether one is available.
7. Reverse-proxy request timeout, streaming, buffering, body-size, and WebSocket settings relevant to Streamable HTTP MCP and 20-to-30-second worker long polling.
8. Outbound HTTPS connectivity to developers.openai.com, chatgpt.com, github.com, and registry.npmjs.org.
9. Proxy variables or system proxy configuration. Report presence only unless the proxy URL is explicitly safe to share.
10. Available persistent secret storage, backup mechanism, log collection, service monitoring, and certificate automation.
11. Hosting constraints such as ephemeral filesystems, process sleep, maximum request duration, platform port requirements, deployment source, or immutable images.
12. Recommended deployment method using what is already installed. Clearly separate observed facts from recommendations.

End with a section titled "Missing decisions" listing anything the project owner must supply, such as a domain, DNS access, OAuth identity choice, service account, or firewall permission.
```
