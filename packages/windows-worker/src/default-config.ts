import path from "node:path";
import type { AppConfig, PolicyRule, Profile } from "./schema.js";
import { DEFAULT_ADMIN_PORT, defaultWorkspaceDirectory } from "./constants.js";

function workspaceRules(workspace: string): PolicyRule[] {
  return [
    {
      id: "workspace-read-write",
      description: "Read and change files in pluginworkspace.",
      subjects: [{ kind: "path", value: workspace }],
      capabilities: ["fs.read", "fs.create", "fs.write", "transfer.import", "transfer.export"],
      decision: "allow"
    },
    {
      id: "workspace-delete-confirm",
      description: "Ask before deleting files in pluginworkspace.",
      subjects: [{ kind: "path", value: workspace }],
      capabilities: ["fs.delete"],
      decision: "prompt"
    }
  ];
}

function inspectionRules(): PolicyRule[] {
  return [{
    id: "service-inspection",
    description: "Allow service status and policy inspection.",
    capabilities: ["machine.status", "policy.inspect"],
    decision: "allow"
  }];
}

function profiles(workspace: string): Record<string, Profile> {
  const basics = [
    path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "notepad.exe"),
    path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "calc.exe"),
    path.join(process.env.WINDIR ?? "C:\\Windows", "explorer.exe")
  ];

  return {
    "confirm-all": {
      description: "Ask before every data-accessing or effectful action.",
      defaultDecision: "prompt",
      processMode: "strict",
      rules: inspectionRules()
    },
    "confirm-mutations": {
      description: "Allow reads and ask before changes, execution, transfers, and desktop control.",
      defaultDecision: "deny",
      processMode: "strict",
      rules: [
        ...inspectionRules(),
        {
          id: "workspace-read",
          description: "Allow workspace reads.",
          subjects: [{ kind: "path", value: workspace }],
          capabilities: ["fs.read"],
          decision: "allow"
        },
        {
          id: "mutations-confirm",
          description: "Ask before mutations and execution.",
          capabilities: [
            "fs.create", "fs.write", "fs.delete", "process.execute.sandboxed",
            "process.execute.unsandboxed", "process.network", "desktop.observe",
            "desktop.control", "clipboard.read", "clipboard.write",
            "transfer.import", "transfer.export"
          ],
          decision: "prompt"
        }
      ]
    },
    "mostly-unattended": {
      description: "Allow workspace work and approved desktop apps. Ask for deletes and sandbox bypass.",
      defaultDecision: "deny",
      processMode: "strict",
      rules: [
        ...inspectionRules(),
        ...workspaceRules(workspace),
        {
          id: "sandboxed-processes",
          description: "Allow commands in the strict sandbox.",
          capabilities: ["process.execute.sandboxed", "process.network"],
          decision: "allow"
        },
        {
          id: "sandbox-bypass-confirm",
          description: "Ask before running with current-user authority.",
          capabilities: ["process.execute.unsandboxed"],
          decision: "prompt"
        },
        {
          id: "windows-basics",
          description: "Allow desktop observation and control for Notepad, Calculator, and Explorer.",
          subjects: basics.map((value) => ({ kind: "executable" as const, value })),
          capabilities: ["desktop.observe", "desktop.control"],
          decision: "allow"
        }
      ]
    },
    yolo: {
      description: "Allow all actions with current-user authority and no server-generated prompts.",
      defaultDecision: "allow",
      processMode: "policy-only",
      rules: inspectionRules()
    }
  };
}

export function createDefaultConfig(): AppConfig {
  const workspace = path.resolve(defaultWorkspaceDirectory());
  return {
    version: 1,
    activeProfile: "mostly-unattended",
    service: { host: "127.0.0.1", port: 47320, requireBearerToken: false },
    admin: { enabled: true, host: "127.0.0.1", port: DEFAULT_ADMIN_PORT },
    paths: { workspace },
    limits: {
      maxReadBytes: 1_048_576,
      maxProcessOutputBytes: 268_435_456,
      maxTransferBytes: 268_435_456,
      defaultProcessTimeoutMs: 300_000,
      transferChunkBytes: 1_048_576
    },
    profiles: profiles(workspace)
  };
}
