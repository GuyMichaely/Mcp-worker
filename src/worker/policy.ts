import { randomUUID } from "node:crypto";
import type { RelayJob } from "../shared/contracts.js";

interface Ticket { requestHash: string; summary: string; expiresAt: number; used: boolean }

export class PolicyEngine {
  private readonly tickets = new Map<string, Ticket>();

  createApproval(job: RelayJob, summary: string, ttlMs = 60_000) {
    const ticket = randomUUID() + randomUUID();
    const expiresAt = Math.min(Date.parse(job.expiresAt), Date.now() + ttlMs);
    this.tickets.set(ticket, { requestHash: job.requestHash, summary, expiresAt, used: false });
    return { ticket, expiresAt, summary: `Approve this action?\n\n${summary}` };
  }

  consumeApproval(job: RelayJob): string | undefined {
    const ticketValue = job.approval?.ticket;
    if (!ticketValue) return undefined;
    const ticket = this.tickets.get(ticketValue);
    if (!ticket || ticket.used || ticket.expiresAt <= Date.now() || ticket.requestHash !== job.requestHash) return undefined;
    ticket.used = true;
    return ticket.summary;
  }
}
