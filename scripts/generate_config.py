#!/usr/bin/env python3
"""
Genera plei-config.json — el "cerebro remoto" de Plei.

Fuentes:
  InnerTube clients  → yt-dlp yt_dlp/extractor/youtube/_base.py
  bgutils requestKey → hardcodeado (sin fuente upstream automática aún)

Uso:
  python generate_config.py --out plei-config.json
  python generate_config.py --ytdlp /tmp/ytdlp/_base.py --out plei-config.json
"""

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
import datetime

YTDLP_BASE_URL = (
    "https://raw.githubusercontent.com/yt-dlp/yt-dlp"
    "/master/yt_dlp/extractor/youtube/_base.py"
)

# Mapeo de nombres yt-dlp → Plei (yt-dlp usa minúsculas con guión bajo)
# Los no presentes en yt-dlp usan fallback
YTDLP_KEY_MAP = {
    "android_vr": "ANDROID_VR",
    "ios": "IOS",
    "tv": "TVHTML5",
    "tv_simply": "TVHTML5_SIMPLY",
}

# Clientes que usa Plei con sus clientId y fallback values actuales
PLEI_CLIENTS = {
    "ANDROID_VR":                     {"clientId": 28, "ytdlp_key": "android_vr",  "fallback_version": "1.65.10"},
    "ANDROID_TESTSUITE":              {"clientId": 30, "ytdlp_key": None,           "fallback_version": "1.9"},
    "IOS":                            {"clientId": 5,  "ytdlp_key": "ios",          "fallback_version": "20.11.6"},
    "TVHTML5":                        {"clientId": 7,  "ytdlp_key": "tv",           "fallback_version": "7.20260311.12.00"},
    "TVHTML5_SIMPLY":                 {"clientId": 74, "ytdlp_key": "tv_simply",    "fallback_version": "1.0"},
    "TVHTML5_SIMPLY_EMBEDDED_PLAYER": {"clientId": 85, "ytdlp_key": None,           "fallback_version": "2.0"},
}

# Versiones anti-SABR para ANDROID_VR (clientes más viejos que YouTube no bloquea)
ANDROID_VR_SABR_FALLBACKS = ["1.57.2", "1.56.21"]

# Valores sin fuente upstream automática → actualizar manualmente cuando cambien
BGUTILS_REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"
WORKER_URL = "https://plei-proxy.xincontacto2.workers.dev/proxy?url="
MIN_APP_VERSION = 1
CANARY_VIDEO_ID = "jNQXAC9IVRw"   # "Me at the zoo" — primer video de YouTube, siempre existe


# ── Comparación de versiones (R3) ─────────────────────────────────────────────

def _tv_date(ver: str) -> int:
    """Extrae la parte YYYYMMDD de 'N.YYYYMMDD.HH.MM'. Retorna 0 si no parsea."""
    parts = ver.split(".")
    if len(parts) >= 2 and len(parts[1]) == 8 and parts[1].isdigit():
        return int(parts[1])
    return 0

def _semver_tuple(ver: str):
    """Convierte 'M.m.p' en (M, m, p). Retorna (0,0,0) si no parsea."""
    try:
        parts = [int(x) for x in ver.split(".")]
        while len(parts) < 3:
            parts.append(0)
        return tuple(parts[:3])
    except ValueError:
        return (0, 0, 0)

def version_is_older(new_ver: str, current_ver: str, client_name: str) -> bool:
    """True si new_ver es más vieja que current_ver → rechazar la regresión."""
    if not current_ver or current_ver == new_ver:
        return False
    if client_name in ("TVHTML5", "TVHTML5_SIMPLY", "TVHTML5_SIMPLY_EMBEDDED_PLAYER"):
        new_d, cur_d = _tv_date(new_ver), _tv_date(current_ver)
        if new_d > 0 and cur_d > 0:
            return new_d < cur_d
    else:
        return _semver_tuple(new_ver) < _semver_tuple(current_ver)
    return False


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_url(url: str, description: str) -> str | None:
    try:
        print(f"Descargando {description}...", file=sys.stderr)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            content = r.read().decode("utf-8", errors="replace")
        print(f"  Descargado ({len(content)} chars)", file=sys.stderr)
        return content
    except Exception as e:
        print(f"  [ERROR] No se pudo descargar {description}: {e}", file=sys.stderr)
        return None


# ── Parseo de _base.py ────────────────────────────────────────────────────────

def extract_client_block(base_py: str, client_name: str) -> str | None:
    """Extrae el bloque dict de un cliente en _INNERTUBE_CLIENTS."""
    m = re.search(rf"""['"]{re.escape(client_name)}['"]\s*:\s*\{{""", base_py)
    if not m:
        return None
    start = m.end() - 1
    depth = 0
    i = start
    in_str = False
    str_char = ""
    while i < len(base_py):
        c = base_py[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == str_char:
                in_str = False
        else:
            if c in ('"', "'"):
                in_str = True
                str_char = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return base_py[start : i + 1]
        i += 1
    return None


def extract_client_version(base_py: str, ytdlp_key: str, fallback: str,
                           current_ver: str = "") -> str:
    """Extrae clientVersion de INNERTUBE_CLIENTS usando la key de yt-dlp.
    Si la versión nueva es más vieja que current_ver, conserva current_ver (R3)."""
    block = extract_client_block(base_py, ytdlp_key)
    if not block:
        print(f"  [WARN] {ytdlp_key}: bloque no encontrado → fallback {fallback}", file=sys.stderr)
        return fallback
    m = re.search(r"""['"]clientVersion['"]\s*:\s*['"]([^'"]+)['"]""", block)
    if not m:
        print(f"  [WARN] {ytdlp_key}: clientVersion no encontrado → fallback {fallback}", file=sys.stderr)
        return fallback
    version = m.group(1)
    if current_ver and version_is_older(version, current_ver, ytdlp_key):
        print(f"  [WARN R3] {ytdlp_key}: regresión detectada {version} < {current_ver} → conservando {current_ver}", file=sys.stderr)
        return current_ver
    print(f"  [OK] {ytdlp_key}: {version}", file=sys.stderr)
    return version


# ── Construcción del config ───────────────────────────────────────────────────

def build_config(base_py: str | None, existing_clients: dict | None = None) -> dict:
    clients = {}
    for name, meta in PLEI_CLIENTS.items():
        fallback = meta["fallback_version"]
        ytdlp_key = meta.get("ytdlp_key")
        # R3: versión actual del JSON existente (para detectar regresiones)
        existing_entry = (existing_clients or {}).get(name, {})
        current_ver = existing_entry.get("version") or (
            existing_entry.get("versions", [None])[0] if "versions" in existing_entry else ""
        ) or ""
        if base_py and ytdlp_key:
            version = extract_client_version(base_py, ytdlp_key, fallback, current_ver)
        else:
            version = fallback
            if not ytdlp_key:
                print(f"  [INFO] {name}: sin fuente yt-dlp → usando fallback {fallback}", file=sys.stderr)

        if name == "ANDROID_VR":
            # Lista de versiones: primary (yt-dlp) + fallbacks anti-SABR
            versions = [version] + [v for v in ANDROID_VR_SABR_FALLBACKS if v != version]
            clients[name] = {"clientId": meta["clientId"], "versions": versions}
        else:
            clients[name] = {"clientId": meta["clientId"], "version": version}

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "generatedAt": now,
        "innerTubeClients": clients,
        "bgutils": {"requestKey": BGUTILS_REQUEST_KEY},
        "workerUrl": WORKER_URL,
        "minAppVersion": MIN_APP_VERSION,
        "canaryVideoId": CANARY_VIDEO_ID,
    }


def compute_version(config: dict) -> str:
    """Versión determinística = SHA256 de las partes que YouTube puede cambiar."""
    key_parts = json.dumps(
        {"innerTubeClients": config["innerTubeClients"], "bgutils": config["bgutils"]},
        sort_keys=True,
    )
    fingerprint = hashlib.sha256(key_parts.encode()).hexdigest()[:8]
    return f"plei-config-{fingerprint}"


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Genera plei-config.json")
    parser.add_argument("--ytdlp", default=None, help="Ruta local a _base.py de yt-dlp")
    parser.add_argument("--out", required=True, help="Ruta de salida para plei-config.json")
    args = parser.parse_args()

    # Leer JSON existente: preservar auto-update y detectar regresiones (R3)
    existing_apk_url   = ""
    existing_apk_sha   = ""
    existing_min_ver   = MIN_APP_VERSION
    existing_clients   = None
    if os.path.exists(args.out):
        try:
            with open(args.out, encoding="utf-8") as f:
                existing = json.load(f)
            existing_apk_url   = existing.get("apkUrl", "")
            existing_apk_sha   = existing.get("apkSha256", "")
            existing_min_ver   = existing.get("minAppVersion", MIN_APP_VERSION)
            existing_clients   = existing.get("innerTubeClients")
            print(f"Preservando auto-update: minAppVersion={existing_min_ver} apkUrl={'(set)' if existing_apk_url else '(empty)'}", file=sys.stderr)
        except Exception as e:
            print(f"No se pudo leer config existente: {e}", file=sys.stderr)

    # Obtener _base.py
    if args.ytdlp:
        print(f"Leyendo {args.ytdlp}...", file=sys.stderr)
        with open(args.ytdlp, encoding="utf-8") as f:
            base_py = f.read()
    else:
        base_py = fetch_url(YTDLP_BASE_URL, "yt-dlp _base.py")

    print("\nExtrayendo versiones de clientes InnerTube...", file=sys.stderr)
    config = build_config(base_py, existing_clients)
    config["version"] = compute_version(config)

    # Restaurar campos de auto-update preservados
    config["minAppVersion"] = existing_min_ver
    config["apkUrl"]        = existing_apk_url
    config["apkSha256"]     = existing_apk_sha

    # sort_keys para determinismo → sin commits spurious si el contenido no cambia
    output = json.dumps(config, indent=2, sort_keys=True, ensure_ascii=False) + "\n"

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(output)

    print(f"\nEscrito: {args.out}", file=sys.stderr)
    print(f"  version: {config['version']}", file=sys.stderr)
    for name, data in config["innerTubeClients"].items():
        v = data.get("versions", [data.get("version")])[0] if "versions" in data else data.get("version")
        print(f"  {name}: {v}", file=sys.stderr)


if __name__ == "__main__":
    main()
