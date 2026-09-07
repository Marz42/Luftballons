"""Remote Config whitelist filter (IMPLEMENTATION §23 / SPEC §26, §29).

Allowed root keys only. Forbidden execution-driving keys are never stored or
returned — even if present in a stored JSON blob.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models.remote_config import ACTIVE_KEY, RemoteConfigRow, utc_now

logger = logging.getLogger("luftballons.remote_config")

ALLOWED_ROOT_KEYS = frozenset(
    {"schemaVersion", "modules", "minRuntimeVersion", "features"}
)

# Explicit deny-list (and any similar keys) — never round-trip.
FORBIDDEN_KEYS = frozenset(
    {
        "script",
        "javascript",
        "selector",
        "url",
        "request",
        "command",
        "action",
        "xpath",
        "html",
        "cookie",
        "cookies",
        "eval",
        "code",
    }
)

DEFAULT_MODULE_IDS = (
    "youtube.channel.basic",
    "youtube.subtitle.multilang",
)

DEFAULT_CONFIG: dict[str, Any] = {
    "schemaVersion": 1,
    "modules": {
        "youtube.channel.basic": {"enabled": True},
        "youtube.subtitle.multilang": {"enabled": True},
    },
}


def _is_forbidden_key(key: str) -> bool:
    lowered = key.lower()
    if lowered in FORBIDDEN_KEYS:
        return True
    # Similar keys: anything containing forbidden tokens as whole segments.
    for bad in ("script", "javascript", "selector", "xpath", "eval"):
        if bad in lowered:
            return True
    return False


def sanitize_config_payload(
    raw: Any,
    *,
    warn: bool = True,
) -> dict[str, Any]:
    """Whitelist-filter a config object. Unknown root keys dropped; forbidden
    keys never kept. Module entries must have boolean ``enabled``.
    """
    if not isinstance(raw, dict):
        if warn:
            logger.warning("remote_config: payload is not an object; using defaults")
        return dict(DEFAULT_CONFIG)

    out: dict[str, Any] = {"schemaVersion": 1, "modules": {}}

    for key in raw:
        if _is_forbidden_key(str(key)):
            if warn:
                logger.warning(
                    "remote_config: dropping forbidden key %r",
                    key,
                )
            continue
        if key not in ALLOWED_ROOT_KEYS:
            if warn:
                logger.warning("remote_config: dropping unknown root key %r", key)
            continue

    schema_version = raw.get("schemaVersion", 1)
    if schema_version != 1:
        if warn:
            logger.warning(
                "remote_config: unsupported schemaVersion %r; forcing 1",
                schema_version,
            )
    out["schemaVersion"] = 1

    modules_in = raw.get("modules", {})
    modules_out: dict[str, dict[str, bool]] = {}
    if isinstance(modules_in, dict):
        for mod_id, entry in modules_in.items():
            if not isinstance(mod_id, str) or not mod_id:
                continue
            if _is_forbidden_key(mod_id):
                if warn:
                    logger.warning(
                        "remote_config: dropping forbidden module id %r",
                        mod_id,
                    )
                continue
            if not isinstance(entry, dict):
                if warn:
                    logger.warning(
                        "remote_config: dropping bad module entry %r",
                        mod_id,
                    )
                continue
            # Drop forbidden keys inside module entry.
            clean_entry: dict[str, bool] = {}
            for ek, ev in entry.items():
                if _is_forbidden_key(str(ek)) or ek not in ("enabled", "killSwitch"):
                    if warn and (
                        _is_forbidden_key(str(ek))
                        or ek not in ("enabled", "killSwitch")
                    ):
                        logger.warning(
                            "remote_config: dropping module field %r.%r",
                            mod_id,
                            ek,
                        )
                    continue
                if ek == "enabled" and isinstance(ev, bool):
                    clean_entry["enabled"] = ev
                elif ek == "killSwitch" and isinstance(ev, bool):
                    clean_entry["killSwitch"] = ev
            if "enabled" not in clean_entry:
                # Default enabled if only killSwitch provided, else skip.
                if "killSwitch" in clean_entry:
                    clean_entry["enabled"] = not clean_entry["killSwitch"]
                else:
                    continue
            modules_out[mod_id] = clean_entry
    else:
        if warn:
            logger.warning("remote_config: modules is not an object; empty")

    out["modules"] = modules_out

    if "minRuntimeVersion" in raw and "minRuntimeVersion" in ALLOWED_ROOT_KEYS:
        mrv = raw["minRuntimeVersion"]
        if isinstance(mrv, str):
            out["minRuntimeVersion"] = mrv
        elif warn:
            logger.warning("remote_config: dropping non-string minRuntimeVersion")

    if "features" in raw:
        feats = raw["features"]
        if isinstance(feats, dict):
            clean_feats: dict[str, bool] = {}
            for fk, fv in feats.items():
                if not isinstance(fk, str) or _is_forbidden_key(fk):
                    if warn:
                        logger.warning(
                            "remote_config: dropping feature key %r",
                            fk,
                        )
                    continue
                if isinstance(fv, bool):
                    clean_feats[fk] = fv
                elif warn:
                    logger.warning(
                        "remote_config: dropping non-bool feature %r",
                        fk,
                    )
            out["features"] = clean_feats
        elif warn:
            logger.warning("remote_config: features is not an object; dropped")

    return out


def get_active_config(session: Session) -> tuple[dict[str, Any], int]:
    """Return (sanitized payload, revision). Missing row → defaults / revision 0."""
    row = session.get(RemoteConfigRow, ACTIVE_KEY)
    if row is None:
        return dict(DEFAULT_CONFIG), 0
    try:
        raw = json.loads(row.payload_json)
    except json.JSONDecodeError:
        logger.warning("remote_config: corrupt JSON in DB; using defaults")
        return dict(DEFAULT_CONFIG), row.revision
    return sanitize_config_payload(raw), row.revision


def save_active_config(
    session: Session,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    """Sanitize + persist. Increments revision. Returns (payload, revision)."""
    clean = sanitize_config_payload(payload)
    row = session.get(RemoteConfigRow, ACTIVE_KEY)
    encoded = json.dumps(clean, ensure_ascii=False, separators=(",", ":"))
    if row is None:
        row = RemoteConfigRow(
            key=ACTIVE_KEY,
            payload_json=encoded,
            updated_at=utc_now(),
            revision=1,
        )
        session.add(row)
    else:
        row.payload_json = encoded
        row.updated_at = utc_now()
        row.revision = int(row.revision) + 1
    session.flush()
    return clean, row.revision


def merge_module_flags(
    session: Session,
    module_id: str,
    *,
    enabled: bool,
    kill_switch: bool | None = None,
) -> tuple[dict[str, Any], int]:
    payload, _rev = get_active_config(session)
    modules = dict(payload.get("modules") or {})
    entry: dict[str, bool] = {"enabled": enabled}
    if kill_switch is True:
        entry["killSwitch"] = True
        entry["enabled"] = False
    elif kill_switch is False:
        entry["killSwitch"] = False
    modules[module_id] = entry
    payload["modules"] = modules
    return save_active_config(session, payload)


def modules_for_admin(session: Session) -> list[dict[str, Any]]:
    """List known modules with effective flags (defaults: enabled)."""
    payload, revision = get_active_config(session)
    modules = payload.get("modules") or {}
    ids = list(dict.fromkeys([*DEFAULT_MODULE_IDS, *modules.keys()]))
    rows: list[dict[str, Any]] = []
    for mid in ids:
        entry = modules.get(mid) or {"enabled": True}
        rows.append(
            {
                "id": mid,
                "enabled": bool(entry.get("enabled", True)),
                "killSwitch": bool(entry.get("killSwitch", False)),
                "revision": revision,
            }
        )
    return rows
