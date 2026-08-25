import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Runtime } from "./runtime.js";
import { writeConfigAtomic } from "./config.js";

const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ChatGPT Machine MCP</title><style>
body{font:15px system-ui;margin:2rem auto;max-width:980px;padding:0 1rem;background:#101215;color:#e9edf1}button,select,textarea{font:inherit}button,select{padding:.55rem .8rem}textarea{width:100%;min-height:440px;background:#171a1f;color:#e9edf1;border:1px solid #424954;padding:.8rem;box-sizing:border-box}header{display:flex;gap:1rem;align-items:center;justify-content:space-between}.row{display:flex;gap:.6rem;align-items:center}pre{white-space:pre-wrap}.ok{color:#7bd88f}.error{color:#ff6b6b}</style></head>
<body><header><div><h1>ChatGPT Machine MCP</h1><p>Local configuration and audit viewer</p></div><div class="row"><select id="profile"></select><button id="activate">Activate</button></div></header>
<p id="status"></p><h2>Configuration</h2><textarea id="config" spellcheck="false"></textarea><p><button id="save">Validate and save</button></p>
<h2>Recent activity</h2><button id="refresh">Refresh</button><pre id="audit"></pre>
<script>
const q=s=>document.querySelector(s); async function api(url,init){const r=await fetch(url,init);const j=await r.json();if(!r.ok)throw new Error(j.error||r.statusText);return j}
async function load(){try{const c=await api('/api/config');q('#config').value=JSON.stringify(c,null,2);q('#profile').innerHTML=Object.keys(c.profiles).map(p=>'<option '+(p===c.activeProfile?'selected':'')+'>'+p+'</option>').join('');q('#audit').textContent=JSON.stringify(await api('/api/audit?limit=100'),null,2);q('#status').textContent='Ready';q('#status').className='ok'}catch(e){q('#status').textContent=e.message;q('#status').className='error'}}
q('#save').onclick=async()=>{try{await api('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:q('#config').value});await load()}catch(e){alert(e.message)}};
q('#activate').onclick=async()=>{try{await api('/api/profile',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({profile:q('#profile').value})});await load()}catch(e){alert(e.message)}};
q('#refresh').onclick=load;load();
</script></body></html>`;

function isLocalRequest(request: Request, port: number): boolean {
  const remote = request.socket.remoteAddress ?? "";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const host = (request.header("host") ?? "").toLowerCase();
  const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const origin = request.header("origin");
  const originAllowed = !origin || [...expectedHosts].some((value) => origin.toLowerCase() === `http://${value}`);
  return loopback && expectedHosts.has(host) && originAllowed;
}

export function startAdminServer(runtime: Runtime): { close: () => Promise<void> } | undefined {
  if (!runtime.config.admin.enabled) return undefined;
  const app = createMcpExpressApp({ host: runtime.config.admin.host });
  app.use((request: Request, response: Response, next) => {
    if (!isLocalRequest(request, runtime.config.admin.port)) {
      response.status(403).json({ error: "Admin access is limited to this machine." });
      return;
    }
    next();
  });
  app.get("/", (_request: Request, response: Response) => response.type("html").send(ADMIN_HTML));
  app.get("/api/config", (_request: Request, response: Response) => response.json(runtime.config));
  app.put("/api/config", (request: Request, response: Response) => {
    try {
      runtime.config = writeConfigAtomic(runtime.paths, request.body);
      response.json(runtime.config);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.put("/api/profile", (request: Request, response: Response) => {
    try {
      const profile = String((request.body as { profile?: unknown }).profile ?? "");
      if (!(profile in runtime.config.profiles)) throw new Error(`Unknown profile: ${profile}`);
      runtime.config = writeConfigAtomic(runtime.paths, { ...runtime.config, activeProfile: profile });
      response.json({ activeProfile: profile });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get("/api/audit", (request: Request, response: Response) => {
    response.json(runtime.audit.recent(Number(request.query.limit ?? 100)));
  });
  const listener = app.listen(runtime.config.admin.port, runtime.config.admin.host);
  return { close: () => new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())) };
}
