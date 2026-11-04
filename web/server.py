#!/usr/bin/env python3
"""MOSS CORE web server.

Serves the page and proxies the public Binance / Alternative.me endpoints so
the browser does not run into their missing CORS headers.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.parse import urlparse, parse_qs, unquote
import json
import os
import sys

PORT = int(os.environ.get("MOSS_PORT", "8787"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, body, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self, url):
        req = Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept": "application/json",
        })
        try:
            with urlopen(req, timeout=30) as r:
                data = r.read()
                self._send(r.status, data, r.headers.get("Content-Type", "application/json"))
        except Exception as e:
            msg = json.dumps({"error": str(e)}).encode()
            self._send(502, msg)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/binance":
            path = parse_qs(parsed.query).get("path", [""])[0]
            if not path.startswith("/"):
                self._send(400, b'{"error":"missing path"}')
                return
            self._proxy("https://fapi.binance.com" + unquote(path))
            return
        if parsed.path == "/api/fng":
            self._proxy("https://api.alternative.me/fng/?limit=2")
            return
        super().do_GET()


if __name__ == "__main__":
    print(f"MOSS CORE Web: http://127.0.0.1:{PORT}")
    print("Press Ctrl+C to stop.")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
