import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Runtime } from "./runtime.js";

type NativeResponse<T> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
};

export class NativeClient {
  constructor(private readonly runtime: Runtime) {}

  helperPath(): string {
    const configured = this.runtime.config.paths.nativeHelper;
    const candidates = [
      configured,
      path.resolve("packages", "windows-worker", "native", "ChatGptMachine.Native", "bin", "Release", "net10.0-windows", "win-x64", "publish", "ChatGptMachine.Native.exe"),
      path.resolve("packages", "windows-worker", "native", "ChatGptMachine.Native", "bin", "Release", "net10.0-windows", "ChatGptMachine.Native.dll"),
      path.resolve("native", "ChatGptMachine.Native", "bin", "Release", "net10.0-windows", "win-x64", "publish", "ChatGptMachine.Native.exe"),
      path.resolve("native", "ChatGptMachine.Native", "bin", "Release", "net10.0-windows", "ChatGptMachine.Native.dll"),
      path.resolve("native", "ChatGptMachine.Native", "bin", "Release", "net10.0-windows", "ChatGptMachine.Native.exe"),
      path.resolve("native", "ChatGptMachine.Native", "bin", "Debug", "net10.0-windows", "ChatGptMachine.Native.dll"),
      path.resolve("native", "ChatGptMachine.Native", "bin", "Debug", "net10.0-windows", "ChatGptMachine.Native.exe")
    ].filter((candidate): candidate is string => Boolean(candidate));
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
      throw new Error("The Windows native helper is not built. Run npm run native:build or set paths.nativeHelper.");
    }
    return found;
  }

  call<T>(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
    const id = crypto.randomUUID();
    const helper = this.helperPath();
    const command = helper.toLowerCase().endsWith(".dll") ? "dotnet" : helper;
    const commandArguments = helper.toLowerCase().endsWith(".dll") ? [helper] : [];
    return new Promise((resolve, reject) => {
      const child = spawn(command, commandArguments, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: sanitizedEnvironment()
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Native helper timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data: string) => { stdout += data; });
      child.stderr.on("data", (data: string) => { stderr += data; });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", () => {
        clearTimeout(timer);
        try {
          const line = stdout.trim().split(/\r?\n/).at(-1);
          if (!line) throw new Error(stderr || "Native helper returned no response.");
          const response = JSON.parse(line) as NativeResponse<T>;
          if (!response.ok) throw new Error(`${response.error?.code ?? "NATIVE_ERROR"}: ${response.error?.message ?? "Native operation failed"}`);
          resolve(response.result as T);
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
}

export function sanitizedEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const blocked = /(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value !== undefined && !blocked.test(key))
  ) as NodeJS.ProcessEnv;
  return { ...environment, ...extra };
}
