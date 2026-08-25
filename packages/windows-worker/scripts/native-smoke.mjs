import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-machine-native-smoke-"));
const allowed = path.join(root, "allowed");
fs.mkdirSync(allowed);
fs.writeFileSync(path.join(root, "secret.txt"), "must-not-cross-sandbox-boundary", "utf8");

const published = path.resolve("native/ChatGptMachine.Native/bin/Release/net10.0-windows/win-x64/publish/ChatGptMachine.Native.exe");
const dll = path.resolve("native/ChatGptMachine.Native/bin/Release/net10.0-windows/ChatGptMachine.Native.dll");
const command = fs.existsSync(published) ? published : "dotnet";
const commandArgs = fs.existsSync(published) ? [] : [dll];

function call(method, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.once("error", reject);
    child.once("exit", () => {
      try {
        const response = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
        if (!response.ok) throw new Error(response.error?.message ?? stderr);
        resolve(response.result);
      } catch (error) { reject(error); }
    });
    child.stdin.end(`${JSON.stringify({ id: crypto.randomUUID(), method, params })}\n`);
  });
}

try {
  const status = await call("desktop.status", {});
  if (!status.interactive) throw new Error("No interactive desktop was detected.");
  const credential = await call("credential.test", {});
  if (!credential.available) throw new Error("Windows Credential Manager is unavailable.");
  const common = { cwd: allowed, environment: {}, timeout_ms: 30_000, network: false, read_write_paths: [allowed], stdin: "" };
  const allowedResult = await call("process.run", { ...common, executable: "cmd.exe", args: ["/d", "/s", "/c", "echo sandbox-ok>created.txt && type created.txt"] });
  if (allowedResult.exit_code !== 0 || !allowedResult.stdout.includes("sandbox-ok") || !fs.existsSync(path.join(allowed, "created.txt"))) {
    throw new Error(`AppContainer could not write its allowed workspace: ${JSON.stringify(allowedResult)}`);
  }
  const deniedResult = await call("process.run", { ...common, executable: "cmd.exe", args: ["/d", "/s", "/c", "type ..\\secret.txt"] });
  if (deniedResult.exit_code === 0 || deniedResult.stdout.includes("must-not-cross-sandbox-boundary")) {
    throw new Error(`AppContainer crossed its declared filesystem boundary: ${JSON.stringify(deniedResult)}`);
  }
  console.log(JSON.stringify({ desktop: "ok", credential_manager: "ok", appcontainer_workspace: "ok", appcontainer_boundary: "ok" }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
