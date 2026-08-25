import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Runtime } from "./runtime.js";
import { NativeClient } from "./native-client.js";
import { asMcpResult } from "./mcp-result.js";
import { evaluatePolicy } from "./policy.js";
import { success } from "./tool-result.js";

type WindowInfo = {
  window_id: string;
  title: string;
  process_id: number;
  executable: string;
  visible: boolean;
  minimized: boolean;
  bounds: { x: number; y: number; width: number; height: number };
};

export function registerDesktopTools(server: McpServer, runtime: Runtime): void {
  const native = new NativeClient(runtime);

  async function windowInfo(windowId: string): Promise<WindowInfo> {
    return native.call<WindowInfo>("desktop.window_info", { window_id: windowId });
  }

  async function withWindowPolicy<T>(
    tool: string,
    capability: "desktop.observe" | "desktop.control",
    windowId: string,
    summary: (window: WindowInfo) => string,
    operation: (window: WindowInfo) => Promise<T>
  ) {
    const window = await windowInfo(windowId);
    return runtime.authorized(server, {
      tool,
      capability,
      subject: { kind: "executable", value: window.executable }
    }, summary(window), () => operation(window));
  }

  server.registerTool("desktop_status", {
    title: "Desktop status",
    description: "Report whether an unlocked interactive Windows desktop and the native helper are available.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => asMcpResult(await runtime.authorized(server, {
    tool: "desktop_status", capability: "machine.status", subject: { kind: "special", value: "desktop://session" }
  }, "Check interactive desktop status", async () => native.call("desktop.status", {}))));

  server.registerTool("desktop_list_windows", {
    title: "List approved windows",
    description: "List visible top-level windows whose owning applications have desktop-observe permission.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => {
    const windows = await native.call<WindowInfo[]>("desktop.list_windows", {});
    const approved = windows.filter((window) => evaluatePolicy(runtime.config, {
      tool: "desktop_list_windows",
      capability: "desktop.observe",
      subject: { kind: "executable", value: window.executable }
    }).decision === "allow");
    return asMcpResult(success({ windows: approved }));
  });

  server.registerTool("desktop_capture", {
    title: "Capture window or desktop",
    description: "Capture an approved window, or the whole desktop when desktop://session is allowed. Returns a PNG image and frame ID.",
    inputSchema: { window_id: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ window_id }) => {
    if (window_id) {
      const result = await withWindowPolicy("desktop_capture", "desktop.observe", window_id,
        (window) => `Capture window '${window.title}' from ${window.executable}`,
        async () => native.call<{ png_base64: string; frame_id: string; width: number; height: number }>("desktop.capture", { window_id }));
      if (!result.ok || !result.data) return asMcpResult(result);
      return {
        content: [
          { type: "image" as const, data: result.data.png_base64, mimeType: "image/png" },
          { type: "text" as const, text: `Captured frame ${result.data.frame_id}. Audit ID: ${result.audit_id}` }
        ]
      };
    }
    const result = await runtime.authorized(server, {
      tool: "desktop_capture", capability: "desktop.observe", subject: { kind: "special", value: "desktop://session" }
    }, "Capture the complete desktop session", async () => native.call<{ png_base64: string; frame_id: string; width: number; height: number }>("desktop.capture", {}));
    if (!result.ok || !result.data) return asMcpResult(result);
    return {
      content: [
        { type: "image" as const, data: result.data.png_base64, mimeType: "image/png" },
        { type: "text" as const, text: `Captured frame ${result.data.frame_id}. Audit ID: ${result.audit_id}` }
      ]
    };
  });

  server.registerTool("desktop_focus", {
    title: "Focus window",
    description: "Bring an approved window to the foreground.",
    inputSchema: { window_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ window_id }) => asMcpResult(await withWindowPolicy("desktop_focus", "desktop.control", window_id,
    (window) => `Focus window '${window.title}' from ${window.executable}`,
    async () => native.call("desktop.focus", { window_id }))));

  server.registerTool("desktop_click", {
    title: "Click desktop",
    description: "Click an approved window at coordinates from a recent captured frame.",
    inputSchema: {
      window_id: z.string(), frame_id: z.string(), x: z.number().int(), y: z.number().int(),
      button: z.enum(["left", "right", "middle"]).default("left"), clicks: z.number().int().min(1).max(3).default(1)
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async (args) => asMcpResult(await withWindowPolicy("desktop_click", "desktop.control", args.window_id,
    (window) => `Click ${args.button} at (${args.x}, ${args.y}) in '${window.title}'`,
    async () => native.call("desktop.click", args))));

  server.registerTool("desktop_scroll", {
    title: "Scroll window",
    description: "Scroll an approved window at coordinates from a recent captured frame.",
    inputSchema: {
      window_id: z.string(), frame_id: z.string(), x: z.number().int(), y: z.number().int(),
      delta: z.number().int().min(-12000).max(12000)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async (args) => asMcpResult(await withWindowPolicy("desktop_scroll", "desktop.control", args.window_id,
    (window) => `Scroll '${window.title}' by ${args.delta}`,
    async () => native.call("desktop.scroll", args))));

  server.registerTool("desktop_drag", {
    title: "Drag in window",
    description: "Drag between two coordinates in an approved window using a recent captured frame.",
    inputSchema: {
      window_id: z.string(), frame_id: z.string(), start_x: z.number().int(), start_y: z.number().int(),
      end_x: z.number().int(), end_y: z.number().int(), duration_ms: z.number().int().min(50).max(5000).default(400)
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async (args) => asMcpResult(await withWindowPolicy("desktop_drag", "desktop.control", args.window_id,
    (window) => `Drag in '${window.title}' from (${args.start_x}, ${args.start_y}) to (${args.end_x}, ${args.end_y})`,
    async () => native.call("desktop.drag", args, args.duration_ms + 10_000))));

  server.registerTool("desktop_type", {
    title: "Type text",
    description: "Focus an approved window and type Unicode text using Windows input injection.",
    inputSchema: { window_id: z.string(), text: z.string(), interval_ms: z.number().int().min(0).max(1000).default(0) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async (args) => asMcpResult(await withWindowPolicy("desktop_type", "desktop.control", args.window_id,
    (window) => `Type ${args.text.length} characters into '${window.title}'`,
    async () => native.call("desktop.type", args, Math.max(60_000, args.text.length * args.interval_ms + 10_000)))));

  server.registerTool("desktop_key", {
    title: "Send key chord",
    description: "Focus an approved window and send a key chord such as CTRL+S or ALT+F4.",
    inputSchema: { window_id: z.string(), keys: z.array(z.string().min(1)).min(1).max(8) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async (args) => asMcpResult(await withWindowPolicy("desktop_key", "desktop.control", args.window_id,
    (window) => `Send ${args.keys.join("+")} to '${window.title}'`,
    async () => native.call("desktop.key", args))));

  server.registerTool("clipboard_read", {
    title: "Read clipboard",
    description: "Read text from the global Windows clipboard when clipboard://session is allowed.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => asMcpResult(await runtime.authorized(server, {
    tool: "clipboard_read", capability: "clipboard.read", subject: { kind: "special", value: "clipboard://session" }
  }, "Read the global Windows clipboard", async () => native.call("clipboard.read", {}))));

  server.registerTool("clipboard_write", {
    title: "Write clipboard",
    description: "Replace text in the global Windows clipboard when clipboard://session is allowed.",
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  }, async ({ text }) => asMcpResult(await runtime.authorized(server, {
    tool: "clipboard_write", capability: "clipboard.write", subject: { kind: "special", value: "clipboard://session" }
  }, `Write ${text.length} characters to the global Windows clipboard`, async () => native.call("clipboard.write", { text }))));

  server.registerTool("desktop_launch", {
    title: "Launch desktop application",
    description: "Launch an application whose executable has desktop-control permission.",
    inputSchema: { executable: z.string().min(1), args: z.array(z.string()).default([]) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ executable, args }) => {
    const resolved = path.resolve(executable);
    return asMcpResult(await runtime.authorized(server, {
      tool: "desktop_launch", capability: "desktop.control", subject: { kind: "executable", value: resolved }
    }, `Launch desktop application ${resolved}`, async () => native.call("desktop.launch", { executable: resolved, args })));
  });
}
