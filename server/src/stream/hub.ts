import type { FastifyReply } from 'fastify';

interface Client {
  id: number;
  reply: FastifyReply;
  /** Last world-event sequence this client has seen. */
  eventSeq: number;
  /** True for the map view, which needs agent ids, states and targets. */
  detail: boolean;
}

/**
 * Server-Sent Events fan-out.
 *
 * SSE rather than WebSockets: the stream is strictly server -> client (god
 * commands go over REST), it survives proxies without an upgrade handshake, and
 * the browser reconnects on its own.
 */
export class StreamHub {
  private clients = new Map<number, Client>();
  private nextId = 1;

  get size(): number {
    return this.clients.size;
  }

  add(reply: FastifyReply, eventSeq: number, detail = false): number {
    const id = this.nextId++;
    this.clients.set(id, { id, reply, eventSeq, detail });
    reply.raw.on('close', () => this.remove(id));
    return id;
  }

  remove(id: number): void {
    this.clients.delete(id);
  }

  /** Whether any connected client asked for the detailed agent payload. */
  get wantsDetail(): boolean {
    for (const c of this.clients.values()) if (c.detail) return true;
    return false;
  }

  isDetail(id: number): boolean {
    return this.clients.get(id)?.detail ?? false;
  }

  eventSeqOf(id: number): number {
    return this.clients.get(id)?.eventSeq ?? 0;
  }

  setEventSeq(id: number, seq: number): void {
    const c = this.clients.get(id);
    if (c) c.eventSeq = seq;
  }

  /** Send one named SSE message to a single client. */
  sendTo(id: number, event: string, data: unknown): void {
    const client = this.clients.get(id);
    if (!client) return;
    this.write(client, event, data);
  }

  broadcast(event: string, build: (clientId: number) => unknown): void {
    for (const client of this.clients.values()) {
      this.write(client, event, build(client.id));
    }
  }

  private write(client: Client, event: string, data: unknown): void {
    try {
      client.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Broken pipe — the close handler may not have fired yet.
      this.remove(client.id);
    }
  }

  /** Comment line that keeps idle proxies from closing the connection. */
  heartbeat(): void {
    for (const client of this.clients.values()) {
      try {
        client.reply.raw.write(': ping\n\n');
      } catch {
        this.remove(client.id);
      }
    }
  }

  closeAll(): void {
    for (const client of this.clients.values()) {
      try {
        client.reply.raw.end();
      } catch {
        /* already gone */
      }
    }
    this.clients.clear();
  }
}
