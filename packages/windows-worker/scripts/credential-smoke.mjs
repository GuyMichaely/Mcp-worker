import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
        const line = stdout.trim().split(/\r?\n/).at(-1);
        if (!line) throw new Error(stderr || "Native helper returned no response.");
        const response = JSON.parse(line);
        if (!response.ok) throw new Error(response.error?.message ?? (stderr || "Native helper failed."));
        resolve(response.result);
      } catch (error) { reject(error); }
    });
    child.stdin.end(`${JSON.stringify({ id: crypto.randomUUID(), method, params })}\n`);
  });
}

const result = await call("credential.test", {});
if (!result.available || !result.round_trip || typeof result.user !== "string" || result.user.length === 0) {
  throw new Error(`Credential Manager round trip failed: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify({ credential_manager: "ok", user: result.user }));
