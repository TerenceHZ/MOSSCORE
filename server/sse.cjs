'use strict';

class SseHub {
  constructor() {
    this.clients = new Set();
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.write(': keepalive\n\n');
        } catch {
          this.clients.delete(client);
        }
      }
    }, 15_000);
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();
  }

  get size() {
    return this.clients.size;
  }

  add(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    this.send(res, 'hello', { at: Date.now(), server: '550C' });

    const cleanup = () => {
      this.clients.delete(res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
  }

  send(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.clients.delete(res);
    }
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  close() {
    clearInterval(this.heartbeat);
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // Ignore a socket that is already gone.
      }
    }
    this.clients.clear();
  }
}

module.exports = { SseHub };
