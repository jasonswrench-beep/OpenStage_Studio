// The player's end of the demo-mode hook: a small web server on this computer only (127.0.0.1), with a one-time token.
// The program's hook asks it for the next command and posts back the result (see demo-hook/protocol.ts).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { Command, Envelope, Reply } from "../../demo-hook/protocol.ts";

export class HookServer {
  readonly token = randomBytes(24).toString("base64url");
  port = 0;
  private server: Server | null = null;
  private queue: Envelope[] = [];
  private waiting: { res: ServerResponse; timer: NodeJS.Timeout } | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private seq = 0;
  private closed = false;
  private onFirstContact: (() => void) | null = null;
  readonly contacted: Promise<void>;

  constructor() {
    this.contacted = new Promise((resolve) => (this.onFirstContact = resolve));
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => {
        const address = this.server!.address();
        this.port = typeof address === "object" && address ? address.port : 0;
        resolve();
      });
    });
  }

  /** Send a command to the program and wait for its answer. */
  send<T = unknown>(command: Command, timeoutMs = 15000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The take is over."));
    const seq = ++this.seq;
    const envelope = { ...command, seq } as Envelope;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`The program did not answer "${command.cmd}" within ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      this.pending.set(seq, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.queue.push(envelope);
      this.flush();
    });
  }

  close(): Promise<void> {
    this.closed = true;
    if (this.waiting) {
      clearTimeout(this.waiting.timer);
      this.waiting.res.writeHead(410, cors()).end();
      this.waiting = null;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("The take is over."));
    }
    this.pending.clear();
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private flush() {
    if (!this.waiting || this.queue.length === 0) return;
    const { res, timer } = this.waiting;
    clearTimeout(timer);
    this.waiting = null;
    res.writeHead(200, { ...cors(), "Content-Type": "application/json" }).end(JSON.stringify(this.queue.shift()));
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "OPTIONS") return void res.writeHead(204, cors()).end();
    if (url.searchParams.get("token") !== this.token) return void res.writeHead(403, cors()).end();
    if (this.closed) return void res.writeHead(410, cors()).end();
    if (req.method === "GET" && url.pathname === "/hook/next") {
      this.onFirstContact?.();
      this.onFirstContact = null;
      if (this.waiting) {
        clearTimeout(this.waiting.timer);
        this.waiting.res.writeHead(204, cors()).end();
      }
      const timer = setTimeout(() => {
        if (this.waiting?.res === res) {
          this.waiting = null;
          res.writeHead(204, cors()).end();
        }
      }, 20000);
      this.waiting = { res, timer };
      this.flush();
      return;
    }
    if (req.method === "POST" && url.pathname === "/hook/reply") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy();
      });
      req.on("end", () => {
        res.writeHead(204, cors()).end();
        let reply: Reply;
        try {
          reply = JSON.parse(body) as Reply;
        } catch {
          return;
        }
        const p = this.pending.get(reply.seq);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(reply.seq);
        if (reply.ok) p.resolve(reply.result);
        else p.reject(new Error(reply.error ?? "The program could not do that."));
      });
      return;
    }
    res.writeHead(404, cors()).end();
  }
}

function cors(): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST", "Cache-Control": "no-store" };
}
