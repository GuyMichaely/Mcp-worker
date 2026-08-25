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

  call<T>(method: string, params: Record<string, unknown>, timeoutMs = 60_000, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error("CANCELLED: Native helper call was cancelled."));
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
      let finished = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error);
      };
      const abort = () => {
        child.kill();
        fail(new Error("CANCELLED: Native helper call was cancelled."));
      };
      const timer = setTimeout(() => {
        child.kill();
        fail(new Error(`Native helper timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data: string) => { stdout += data; });
      child.stderr.on("data", (data: string) => { stderr += data; });
      child.on("error", (error) => fail(error));
      child.on("exit", () => {
        if (finished) return;
        try {
          const line = stdout.trim().split(/\r?\n/).at(-1);
          if (!line) throw new Error(stderr || "Native helper returned no response.");
          const response = JSON.parse(line) as NativeResponse<T>;
          if (!response.ok) throw new Error(`${response.error?.code ?? "NATIVE_ERROR"}: ${response.error?.message ?? "Native operation failed"}`);
          finished = true;
          cleanup();
          resolve(response.result as T);
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Native helper response could not be parsed."));
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
