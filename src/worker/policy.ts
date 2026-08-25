import { randomUUID } from "node:crypto";
import type { RelayJob } from "../shared/contracts.js";

export type PolicyDecision = "allow" | "deny" | "prompt";

interface Ticket {
  requestHash: string;
  expiresAt: number;
  used: boolean;
}

export class PolicyEngine {
  private readonly tickets = new Map<string, Ticket>();

  constructor(private readonly profile = "mostly-unattended") {}

  decide(job: RelayJob): PolicyDecision {
    if (job.toolName === "machine_status" || job.toolName === "file_read") return "allow";
    if (this.profile === "read-only") return "deny";
    return "prompt";
  }

  createApproval(job: RelayJob, ttlMs = 60_000): { ticket: string; expiresAt: number; summary: string } {
    const ticket = randomUUID() + randomUUID();
    const expiresAt = Math.min(Date.parse(job.expiresAt), Date.now() + ttlMs);
    this.tickets.set(ticket, { requestHash: job.requestHash, expiresAt, used: false });
    return {
      ticket,
      expiresAt,
      summary: `Allow ${job.toolName} with request hash ${job.requestHash.slice(0, 12)} on worker ${job.workerId}?`
    };
  }

  consumeApproval(job: RelayJob): boolean {
    const ticketValue = job.approval?.ticket;
    if (!ticketValue) return false;
    const ticket = this.tickets.get(ticketValue);
    if (!ticket || ticket.used || ticket.expiresAt <= Date.now() || ticket.requestHash !== job.requestHash) return false;
    ticket.used = true;
    return true;
  }
}
