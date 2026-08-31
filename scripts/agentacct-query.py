#!/usr/bin/env python3
"""Read the versioned local agentacct API without exposing its bearer token or raw session ids."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import stat
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def fail(message: str, code: int = 2) -> None:
    print(json.dumps({"status": "unavailable", "detail": message}, separators=(",", ":")))
    raise SystemExit(code)


def discovery_candidates() -> list[Path]:
    state = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
    managed_store = os.environ.get("AGENTACCT_STORE_DIR")
    return [
        *([Path(managed_store) / "local-api.json"] if managed_store else []),
        state / "agentacct" / "state" / "local-api.json",
        Path.home() / ".agent-sentinel-global" / "state" / "local-api.json",
    ]


def load_discovery() -> dict[str, Any]:
    candidates = [path for path in discovery_candidates() if path.is_file()]
    if len(candidates) != 1:
        fail("expected exactly one agentacct discovery file")
    path = candidates[0]
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        fail("agentacct discovery file permissions are broader than 0600")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        fail("agentacct discovery file is unreadable")
    if value.get("schema") != "agentacct.local-api-discovery.v1" or value.get("host") not in {"127.0.0.1", "localhost", "::1"}:
        fail("agentacct discovery contract is incompatible")
    if not isinstance(value.get("port"), int) or not 1 <= value["port"] <= 65535 or not isinstance(value.get("token"), str) or len(value["token"]) < 16:
        fail("agentacct discovery values are invalid")
    return value


def get(discovery: dict[str, Any], route: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    query = "?" + urlencode(params) if params else ""
    url = f"http://{discovery['host']}:{discovery['port']}{route}{query}"
    request = Request(url, headers={"Authorization": f"Bearer {discovery['token']}"})
    try:
        with urlopen(request, timeout=3) as response:  # noqa: S310 - host is validated loopback
            value = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError):
        fail("agentacct local API query failed")
    if not isinstance(value, dict):
        fail("agentacct local API returned an incompatible payload")
    return value


def session_digest(key: bytes, agent: str, session_id: str) -> str:
    return hmac.new(key, f"{agent}\0{session_id}".encode(), hashlib.sha256).hexdigest()[:20]


def bounded_text(value: Any, limit: int = 120) -> str | None:
    return value if isinstance(value, str) and len(value) <= limit else None


def bounded_number(value: Any) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None


def summarize(detail: dict[str, Any], expected_version: str) -> dict[str, Any]:
    session = detail.get("session") if isinstance(detail.get("session"), dict) else detail
    usage = session.get("usage") if isinstance(session.get("usage"), dict) else {}
    work = session.get("work") if isinstance(session.get("work"), dict) else {}
    items = work.get("items") if isinstance(work.get("items"), list) else []
    checks = sum(len(item.get("checks", [])) for item in items if isinstance(item, dict) and isinstance(item.get("checks"), list))
    models = session.get("observed_models") if isinstance(session.get("observed_models"), list) else []
    return {
        "schemaVersion": 1,
        "source": "agentacct-v1-session",
        "version": expected_version,
        "status": bounded_text(session.get("status")),
        "lastActivityAt": bounded_text(session.get("last_activity_at")),
        "instrumentationState": bounded_text(session.get("instrumentation_state")),
        "usageTokens": bounded_number(usage.get("total_tokens")),
        "usageConfidence": bounded_text(usage.get("usage_confidence")),
        "estimatedCost": bounded_number(usage.get("estimated_cost_usd")),
        "costConfidence": bounded_text(usage.get("cost_confidence")),
        "workItemCount": len(items),
        "machineCheckCount": checks,
        "models": [value for value in (bounded_text(item.get("model")) if isinstance(item, dict) else bounded_text(item) for item in models[:20]) if value],
    }


def main() -> None:
    if len(sys.argv) != 5 or sys.argv[1] != "session-hash":
        fail("usage: agentacct-query.py session-hash <agent> <hash> <key-file>")
    agent, expected_hash, key_file = sys.argv[2:]
    if not agent.replace("-", "").isalnum() or len(expected_hash) != 20 or any(char not in "0123456789abcdef" for char in expected_hash):
        fail("invalid correlation input")
    try:
        key_text = Path(key_file).read_text(encoding="utf-8").strip()
        key = bytes.fromhex(key_text)
    except (OSError, ValueError):
        fail("telemetry identity key is unavailable")
    if len(key) != 32:
        fail("telemetry identity key is invalid")
    discovery = load_discovery()
    version = get(discovery, "/v1/version")
    installed = bounded_text(version.get("version"))
    if version.get("schema") != "agentacct.v1-version.v1" or not installed:
        fail("agentacct version handshake is incompatible")
    matches: list[tuple[str, str]] = []
    offset = 0
    while offset < 5000:
        page = get(discovery, "/v1/sessions", {"roots_only": "false", "limit": 500, "offset": offset})
        rows = page.get("sessions") if isinstance(page.get("sessions"), list) else page.get("data") if isinstance(page.get("data"), list) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            client = bounded_text(row.get("client"))
            session_id = row.get("client_session_id")
            if client == agent and isinstance(session_id, str) and hmac.compare_digest(session_digest(key, agent, session_id), expected_hash):
                matches.append((client, session_id))
        if not page.get("truncated"):
            break
        offset += len(rows)
        if not rows:
            break
    if len(matches) != 1:
        print(json.dumps({"status": "ambiguous" if matches else "unlinked", "matchCount": len(matches)}, separators=(",", ":")))
        raise SystemExit(3)
    client, session_id = matches[0]
    detail = get(discovery, "/v1/session", {"client": client, "session_id": session_id})
    print(json.dumps({"status": "exact_session", "evidence": summarize(detail, installed)}, separators=(",", ":")))


if __name__ == "__main__":
    main()
