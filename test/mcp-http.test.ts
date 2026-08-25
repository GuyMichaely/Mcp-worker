import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { createMachineMcpHandler } from "../src/remote/mcp.js";
import { RelayService } from "../src/remote/relay.js";
import { RelayStore } from "../src/remote/store.js";
import { ToolSpecs } from "../src/shared/contracts.js";

const WORKER_ID = "w";
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

async function lease(store: RelayStore) {
  let job;
  while (!(job = store.lease(WORKER_ID))) await pause();
  return job;
}

async function waitForJob(store: RelayStore) {
  let row: { id: string } | undefined;
  while (!(row = store.db.prepare("SELECT id FROM jobs ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined)) {
    await pause();
  }
  return row.id;
}

type Harness = Awaited<ReturnType<typeof createHarness>>;
const harnesses: Harness[] = [];

async function createHarness(options: { online?: boolean; approve?: boolean } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-http-"));
  const store = new RelayStore(":memory:", directory, 1024 * 1024);
  if (options.online !== false) store.heartbeat(WORKER_ID, "test");
  const relay = new RelayService(store, WORKER_ID, 5_000, 10_000);
  const handler = createMachineMcpHandler(relay, store);
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init))
  });
  const client = new Client(
    { name: "mcp-worker-test", version: "1.0.0" },
    { capabilities: { elicitation: { form: {} } } }
  );
  client.setRequestHandler("elicitation/create", async () =>
    options.approve === false
      ? { action: "decline" }
      : { action: "accept", content: { approve: true } }
  );
  await client.connect(transport);
  const harness = { client, handler, store, directory };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.client.close();
    await harness.handler.close();
    harness.store.close();
    fs.rmSync(harness.directory, { recursive: true, force: true });
  }
});

describe("Streamable HTTP MCP", () => {
  it("initializes and discovers the complete tool catalog", async () => {
    const { client } = await createHarness();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(ToolSpecs.map((tool) => tool.name).sort());
  });

  it("runs a read-only tool through a fake worker", async () => {
    const { client, store } = await createHarness();
    const call = client.callTool({ name: "machine_status", arguments: {} });
    const job = await lease(store);
    expect(job.toolName).toBe("machine_status");
    store.submitReply(job.id, job.leaseToken, {
      kind: "completed",
      requestHash: job.requestHash,
      result: { online: true }
    });
    await expect(call).resolves.toMatchObject({
      structuredContent: { ok: true, result: { online: true } }
    });
  });

  it("accepts an exact-action approval and resumes the mutation", async () => {
    const { client, store } = await createHarness();
    const call = client.callTool({
      name: "fs_write",
      arguments: { path: "C:\\workspace\\a.txt", text: "x", create_parent: false }
    });
    const first = await lease(store);
    const ticket = "a".repeat(64);
    store.submitReply(first.id, first.leaseToken, {
      kind: "approval-required",
      requestHash: first.requestHash,
      ticket,
      summary: "Write a.txt?",
      expiresAt: new Date(Date.now() + 2_000).toISOString()
    });
    const resumed = await lease(store);
    expect(resumed.approval).toEqual({ ticket, accepted: true });
    store.submitReply(resumed.id, resumed.leaseToken, {
      kind: "completed",
      requestHash: resumed.requestHash,
      result: { bytesWritten: 1 }
    });
    await expect(call).resolves.toMatchObject({
      structuredContent: { ok: true, result: { bytesWritten: 1 } }
    });
  });

  it("returns an MCP tool error when exact-action approval is declined", async () => {
    const { client, store } = await createHarness({ approve: false });
    const call = client.callTool({
      name: "fs_write",
      arguments: { path: "C:\\workspace\\a.txt", text: "x", create_parent: false }
    });
    const job = await lease(store);
    store.submitReply(job.id, job.leaseToken, {
      kind: "approval-required",
      requestHash: job.requestHash,
      ticket: "b".repeat(64),
      summary: "Write a.txt?",
      expiresAt: new Date(Date.now() + 2_000).toISOString()
    });
    await expect(call).resolves.toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "APPROVAL_DECLINED" } }
    });
  });

  it("reports an offline worker without creating work", async () => {
    const { client, store } = await createHarness({ online: false });
    const result = await client.callTool({ name: "machine_status", arguments: {} });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: "WORKER_OFFLINE" } }
    });
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM jobs").get()).toEqual({ count: 0 });
  });

  it("cancels queued work when the MCP request is aborted", async () => {
    const { client, store } = await createHarness();
    const controller = new AbortController();
    const call = client.callTool({ name: "machine_status", arguments: {} }, { signal: controller.signal });
    const id = await waitForJob(store);
    controller.abort();
    await expect(call).rejects.toBeDefined();
    expect(store.get(id)?.state).toBe("cancelled");
    expect(store.lease(WORKER_ID)).toBeUndefined();
  });

  it("reads an exported file through the MCP resource template", async () => {
    const { client, store } = await createHarness();
    const bytes = Buffer.from("exported over MCP");
    const id = randomUUID();
    store.appendTransferChunk({
      id,
      workerId: WORKER_ID,
      fileName: "sample.txt",
      mimeType: "text/plain",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      expiresAt: Date.now() + 60_000,
      offset: 0,
      bytes
    });
    const { contents } = await client.readResource({ uri: `machine-file://transfer/${id}/sample.txt` });
    expect(contents).toEqual([{
      uri: `machine-file://transfer/${id}/sample.txt`,
      mimeType: "text/plain",
      blob: bytes.toString("base64")
    }]);
  });
});
