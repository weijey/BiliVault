import http from "http";

interface Recording {
  timestamp: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export class MockObsidianServer {
  private server: http.Server;
  private recordings: Recording[] = [];
  private failNext = false;
  public port: number;

  constructor(port = 27124) {
    this.port = port;
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, PUT, POST, DELETE, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url || "/";

    if (req.method === "GET" && (url === "/" || url === "")) {
      res.writeHead(200);
      res.end(
        JSON.stringify({ authenticated: true, service: "mock-obsidian" })
      );
      return;
    }

    if (req.method === "GET" && url === "/__recordings") {
      res.writeHead(200);
      res.end(JSON.stringify(this.recordings));
      return;
    }

    if (req.method === "DELETE" && url === "/__recordings") {
      this.recordings = [];
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url === "/__fail-next") {
      this.failNext = true;
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "PUT" && url.startsWith("/vault/")) {
      if (this.failNext) {
        this.failNext = false;
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Simulated failure" }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const headers: Record<string, string> = {};
        Object.entries(req.headers).forEach(([k, v]) => {
          const raw = v as string | string[] | undefined;
          headers[k] = Array.isArray(raw)
            ? raw.join(", ")
            : (raw || "");
        });

        this.recordings.push({
          timestamp: new Date().toISOString(),
          method: req.method || "",
          path: url,
          headers,
          body,
        });

        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(
          `Mock Obsidian listening on port ${this.port}`
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  getRecordings(): Recording[] {
    return [...this.recordings];
  }

  getLastRecording(): Recording | undefined {
    return this.recordings[this.recordings.length - 1];
  }

  clearRecordings(): void {
    this.recordings = [];
  }

  async setFailNext(): Promise<void> {
    this.failNext = true;
  }

  get obsidianUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}
