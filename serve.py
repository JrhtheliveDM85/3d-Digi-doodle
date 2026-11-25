#!/usr/bin/env python3
"""Tiny local server for Clay Blocks.

Run:  python3 serve.py
Then open the address it prints (http://127.0.0.1:8000).

A server is needed (not just opening the file) because the app installs a
service worker and loads JavaScript modules. Browsers only allow that over
http or https, not file://.

The server listens on this computer only.
"""
import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", "8000"))
HOST = "127.0.0.1"

EXTRA_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".3mf": "model/3mf",
    ".stl": "model/stl",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Ask the browser to re-check files when it can reach this server.
        # The service worker still serves the cached copy when offline.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class Server(socketserver.TCPServer):
    allow_reuse_address = True


for ext, ctype in EXTRA_TYPES.items():
    Handler.extensions_map[ext] = ctype

os.chdir(os.path.dirname(os.path.abspath(__file__)))

try:
    httpd = Server((HOST, PORT), Handler)
except OSError:
    print(f"Port {PORT} is already in use.")
    print("Close the other Clay Blocks window, or run:  PORT=8001 python3 serve.py")
    raise SystemExit(1)

with httpd:
    print(f"Clay Blocks is running.  Open:  http://{HOST}:{PORT}")
    print("This address works on this computer only.")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
