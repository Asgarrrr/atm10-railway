#!/usr/bin/env python3
"""Tiny HTTP API that lets the Discord bot trigger backups, profiles, and restores."""
import http.server
import json
import os
import subprocess
import urllib.parse
from datetime import datetime, timezone

PORT = int(os.environ.get("RESTORE_API_PORT", "8081"))


def get_backup_dir() -> str:
    return os.environ.get("BACKUP_DIR", "/data/backups")


def get_data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def get_world_dir() -> str:
    return os.path.join(get_data_dir(), "world")


def list_backups() -> list[str]:
    d = get_backup_dir()
    if not os.path.isdir(d):
        return []
    return sorted(f[:-7] for f in os.listdir(d) if f.endswith(".tar.gz"))


def run_command(cmd: list[str]) -> tuple[bool, str]:
    result = subprocess.run(cmd, capture_output=True, text=True)
    output = (result.stdout + result.stderr).strip()
    return result.returncode == 0, output


def load_json(path: str, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def isoformat_or_none(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    ts = os.path.getmtime(path)
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def as_int(value) -> int:
    return value if isinstance(value, int) else 0


def total_distance_cm(custom: dict) -> int:
    return sum(
        as_int(value)
        for key, value in custom.items()
        if isinstance(key, str) and key.endswith("_one_cm") and key != "minecraft:fall_one_cm"
    )


def count_completed_advancements(advancements: dict) -> int:
    return sum(
        1
        for value in advancements.values()
        if isinstance(value, dict) and value.get("done") is True
    )


def resolve_player(player_name: str) -> tuple[str, str]:
    usercache_path = os.path.join(get_data_dir(), "usercache.json")
    usercache = load_json(usercache_path, [])

    if not isinstance(usercache, list):
        raise ValueError("usercache.json invalide.")

    wanted = player_name.casefold()
    for entry in usercache:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        uuid = entry.get("uuid")
        if isinstance(name, str) and isinstance(uuid, str) and name.casefold() == wanted:
            return name, uuid

    raise ValueError(f"Joueur '{player_name}' introuvable dans usercache.json.")


def build_profile(player_name: str) -> dict:
    name, uuid = resolve_player(player_name)

    world_dir = get_world_dir()
    stats_path = os.path.join(world_dir, "stats", f"{uuid}.json")
    advancements_path = os.path.join(world_dir, "advancements", f"{uuid}.json")
    playerdata_path = os.path.join(world_dir, "playerdata", f"{uuid}.dat")

    stats_doc = load_json(stats_path, {})
    stats_root = stats_doc.get("stats", {}) if isinstance(stats_doc, dict) else {}
    custom = stats_root.get("minecraft:custom", {}) if isinstance(stats_root, dict) else {}
    mined = stats_root.get("minecraft:mined", {}) if isinstance(stats_root, dict) else {}
    advancements = load_json(advancements_path, {})

    if not isinstance(custom, dict):
        custom = {}
    if not isinstance(mined, dict):
        mined = {}
    if not isinstance(advancements, dict):
        advancements = {}

    return {
        "name": name,
        "uuid": uuid,
        "last_saved_at": isoformat_or_none(playerdata_path) or isoformat_or_none(stats_path),
        "stats": {
            "play_time_ticks": as_int(custom.get("minecraft:play_time")),
            "deaths": as_int(custom.get("minecraft:deaths")),
            "mob_kills": as_int(custom.get("minecraft:mob_kills")),
            "player_kills": as_int(custom.get("minecraft:player_kills")),
            "jumps": as_int(custom.get("minecraft:jump")),
            "distance_cm": total_distance_cm(custom),
            "blocks_mined": sum(as_int(v) for v in mined.values()),
            "completed_advancements": count_completed_advancements(advancements),
        },
    }


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
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/backups":
            backups = list_backups()
            self._json(200, {"backups": backups, "dir": get_backup_dir()})
        elif parsed.path == "/profile":
            player = (urllib.parse.parse_qs(parsed.query).get("player", [""])[0] or "").strip()
            if not player:
                self._json(400, {"error": "paramètre 'player' requis"})
                return

            try:
                self._json(200, {"profile": build_profile(player)})
            except ValueError as err:
                self._json(404, {"error": str(err)})
            except json.JSONDecodeError:
                self._json(500, {"error": "Impossible de lire les données du joueur."})
        elif parsed.path == "/health":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/backup":
            backups_before = list_backups()
            ok, output = run_command(["/usr/local/bin/mc-backup"])
            backups_after = list_backups()
            latest = backups_after[-1] if backups_after else None

            if ok and latest:
                self._json(200, {"success": True, "output": output, "backup": latest})
            else:
                self._json(
                    500,
                    {
                        "success": False,
                        "output": output or "Aucune archive de backup n'a été créée.",
                        "backup": latest,
                        "backups_before": backups_before,
                        "backups_after": backups_after,
                    },
                )
            return

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

        ok, output = run_command(cmd)
        self._json(200 if ok else 500, {"success": ok, "output": output})


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[restore-api] Listening on :{PORT}, backup dir: {get_backup_dir()}", flush=True)
    server.serve_forever()
