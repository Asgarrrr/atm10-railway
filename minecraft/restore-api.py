#!/usr/bin/env python3
"""Tiny HTTP API that lets the Discord bot trigger player inventory restores."""
import glob
import http.server
import json
import os
import subprocess

PORT = int(os.environ.get("RESTORE_API_PORT", "8081"))
BACKUP_DIR = os.environ.get("BACKUP_DIR", "/data/backups")


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[restore-api] {self.address_string()} — {fmt % args}", flush=True)

    def _json(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/backups":
            files = sorted(glob.glob(f"{BACKUP_DIR}/*.tar.gz"))
            backups = [os.path.basename(f)[:-7] for f in files]
            self._json(200, {"backups": backups})
        elif self.path == "/health":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/restore":
            self._json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON"})
            return

        player = body.get("player", "").strip()
        backup = body.get("backup", "").strip()

        if not player:
            self._json(400, {"error": "champ 'player' requis"})
            return

        cmd = ["/usr/local/bin/mc-restore", player]
        if backup:
            cmd.append(backup)

        result = subprocess.run(cmd, capture_output=True, text=True)
        output = (result.stdout + result.stderr).strip()
        ok = result.returncode == 0
        self._json(200 if ok else 500, {"success": ok, "output": output})


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[restore-api] Listening on :{PORT}", flush=True)
    server.serve_forever()
