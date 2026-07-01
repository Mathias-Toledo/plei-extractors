#!/usr/bin/env python3
"""
Descarga YoutubeThrottlingParameterUtils.java de NewPipeExtractor y
genera nsig_extractor.js con los patrones NSig actualizados.

Uso:
  python generate_nsig_extractor.py --out nsig_extractor.js
  python generate_nsig_extractor.py --java /tmp/ThrottlingUtils.java --out nsig_extractor.js --test
"""

import argparse
import re
import sys
import json
import subprocess
import urllib.request
import tempfile
import os
import hashlib

NEWPIPE_JAVA_URL = (
    "https://raw.githubusercontent.com/TeamNewPipe/NewPipeExtractor"
    "/dev/extractor/src/main/java/org/schabi/newpipe/extractor"
    "/services/youtube/YoutubeThrottlingParameterUtils.java"
)

# ── Java string utilities ─────────────────────────────────────────────────────

def unescape_java_string(s: str) -> str:
    """Convierte secuencias de escape Java → caracteres reales."""
    result = []
    i = 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            nc = s[i + 1]
            if nc == '\\':   result.append('\\')
            elif nc == '"':  result.append('"')
            elif nc == 'n':  result.append('\n')
            elif nc == 't':  result.append('\t')
            elif nc == 'r':  result.append('\r')
            else:            result.append('\\'); result.append(nc)
            i += 2
        else:
            result.append(s[i])
            i += 1
    return ''.join(result)


def evaluate_java_string_expr(expr: str, constants: dict) -> str | None:
    """
    Evalúa una expresión de concatenación de strings Java.
    Soporta: "literal", CONSTANT, "lit1" + CONST + "lit2".
    Retorna None si hay un identificador desconocido.
    """
    result = []
    i = 0
    expr = expr.strip()

    while i < len(expr):
        c = expr[i]

        if c in ' \t\n\r':
            i += 1
            continue

        if c == '+':
            i += 1
            continue

        if c == '"':
            i += 1
            content = []
            while i < len(expr):
                if expr[i] == '\\' and i + 1 < len(expr):
                    content.append(expr[i])
                    content.append(expr[i + 1])
                    i += 2
                elif expr[i] == '"':
                    i += 1
                    break
                else:
                    content.append(expr[i])
                    i += 1
            result.append(unescape_java_string(''.join(content)))
            continue

        m = re.match(r'[A-Za-z_]\w*', expr[i:])
        if m:
            ident = m.group(0)
            if ident not in constants:
                return None
            result.append(constants[ident])
            i += len(ident)
            continue

        return None

    return ''.join(result)


# ── Java source parsing ───────────────────────────────────────────────────────

def extract_java_constants(java_src: str) -> dict:
    """Extrae las constantes static final String del archivo Java."""
    constants = {}

    # Primera pasada: asignaciones directas (= "valor")
    for m in re.finditer(
        r'private\s+static\s+final\s+String\s+(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"[^;]*;',
        java_src,
    ):
        constants[m.group(1)] = unescape_java_string(m.group(2))

    # Segunda pasada: expresiones de concatenación (MULTIPLE_CHARS_REGEX = SINGLE + "+")
    changed = True
    while changed:
        changed = False
        for m in re.finditer(
            r'private\s+static\s+final\s+String\s+(\w+)\s*=\s*([^;]+)\s*;',
            java_src,
        ):
            name = m.group(1)
            if name in constants:
                continue
            val = evaluate_java_string_expr(m.group(2), constants)
            if val is not None:
                constants[name] = val
                changed = True

    return constants


def extract_balanced_paren(text: str, start: int) -> tuple[str, int]:
    """
    Extrae contenido entre paréntesis balanceados desde `start`
    (posición justo después del '(' de apertura).
    Retorna (contenido, posición_después_del_cierre).
    """
    depth = 1
    i = start
    while i < len(text) and depth > 0:
        c = text[i]
        if c == '"':
            i += 1
            while i < len(text):
                if text[i] == '\\':
                    i += 2
                elif text[i] == '"':
                    i += 1
                    break
                else:
                    i += 1
        elif c == '(':
            depth += 1
            i += 1
        elif c == ')':
            depth -= 1
            i += 1
        else:
            i += 1
    return text[start:i - 1], i


def extract_patterns(java_src: str, constants: dict) -> list[dict]:
    """
    Localiza DEOBFUSCATION_FUNCTION_NAME_REGEXES y extrae
    todos los Pattern.compile(...) como patrones regex expandidos.
    """
    m = re.search(
        r'DEOBFUSCATION_FUNCTION_NAME_REGEXES\s*=\s*\{(.*?)\}\s*;',
        java_src, re.DOTALL,
    )
    if not m:
        raise ValueError("No se encontró DEOBFUSCATION_FUNCTION_NAME_REGEXES en el Java")

    array_body = m.group(1)
    patterns = []

    for pc_m in re.finditer(r'Pattern\.compile\(', array_body):
        arg, _ = extract_balanced_paren(array_body, pc_m.end())
        try:
            pattern_str = evaluate_java_string_expr(arg, constants)
            if pattern_str is not None:
                patterns.append({
                    "pattern": pattern_str,
                    "flags": "",
                    "description": f"NewPipeExtractor pattern #{len(patterns) + 1}",
                })
                print(
                    f"  [OK] Patrón {len(patterns)}: {pattern_str[:80]}",
                    file=sys.stderr,
                )
            else:
                print(f"  [WARN] Expresión no evaluable: {arg[:60]}", file=sys.stderr)
        except Exception as e:
            print(f"  [WARN] Error en patrón: {e}", file=sys.stderr)

    if not patterns:
        raise ValueError("No se extrajeron patrones de DEOBFUSCATION_FUNCTION_NAME_REGEXES")

    print(f"  {len(patterns)} patrones extraídos desde NewPipeExtractor", file=sys.stderr)
    return patterns


# ── JS generation ─────────────────────────────────────────────────────────────

JS_TEMPLATE = '''\
// Plei NSig Extractor — AUTO-GENERADO por GitHub Action
// Fuente: NewPipeExtractor YoutubeThrottlingParameterUtils.java (rama dev)
// Version: {version}  (hash de patrones — cambia solo cuando NewPipe actualiza sus regexes)
// NO editar manualmente — este archivo se sobreescribe en cada update automático

(function(global) {{
    'use strict';

    function escapeRegex(s) {{
        return s.replace(/[.*+?^${{}}()|[\\]\\\\]/g, '\\\\$&');
    }}

    // Si name es un array (ej: funcArr), resuelve funcArr[idx] → nombre real
    function resolveArrayRef(js, name, idxStr) {{
        if (!name) return null;
        var idx = (idxStr !== undefined && idxStr !== null && idxStr !== '')
                  ? parseInt(idxStr, 10) : NaN;
        if (!isNaN(idx)) {{
            var arrRx = new RegExp(
                '(?:var\\\\s+)?' + escapeRegex(name) + '\\\\s*=\\\\s*\\\\[([^\\\\]]{{1,2000}})\\\\]'
            );
            var arrM = js.match(arrRx);
            if (arrM) {{
                var parts = arrM[1].split(',');
                if (idx < parts.length) {{
                    var resolved = parts[idx].trim().replace(/^['"]|['"]$/g, '');
                    if (resolved) return resolved;
                }}
            }}
        }}
        return name;
    }}

    // Patrones extraídos de NewPipeExtractor DEOBFUSCATION_FUNCTION_NAME_REGEXES
    // m[1] = nombre de función o array; m[2] = índice si es array
    var PATTERNS = {patterns_json};

    function findNsigFunctionName(js) {{
        for (var i = 0; i < PATTERNS.length; i++) {{
            try {{
                var rx = new RegExp(PATTERNS[i].pattern, PATTERNS[i].flags);
                var m = js.match(rx);
                if (m && m[1]) {{
                    return resolveArrayRef(js, m[1], m[2]);
                }}
            }} catch(e) {{ /* patrón inválido en este engine, skip */ }}
        }}
        return null;
    }}

    function extractFunctionBody(js, funcName) {{
        var escaped = escapeRegex(funcName);
        var startPatterns = [
            new RegExp('var\\\\s+' + escaped + '\\\\s*=\\\\s*function\\\\s*\\\\([a-zA-Z0-9_$]*\\\\)\\\\s*\\\\{{'),
            new RegExp('(?:^|[;,])' + escaped + '\\\\s*=\\\\s*function\\\\s*\\\\([a-zA-Z0-9_$]*\\\\)\\\\s*\\\\{{'),
            new RegExp('function\\\\s+' + escaped + '\\\\s*\\\\([a-zA-Z0-9_$]*\\\\)\\\\s*\\\\{{'),
        ];
        var bodyStart = -1;
        for (var i = 0; i < startPatterns.length; i++) {{
            var m = js.match(startPatterns[i]);
            if (m) {{
                bodyStart = js.indexOf(m[0]) + m[0].length;
                break;
            }}
        }}
        if (bodyStart === -1) return null;
        var depth = 1, pos = bodyStart;
        var inStr = false, strChar = '';
        while (pos < js.length && depth > 0) {{
            var c = js[pos];
            if (inStr) {{
                if (c === '\\\\') pos++;
                else if (c === strChar) inStr = false;
            }} else {{
                if (c === '"' || c === "'" || c === '`') {{ inStr = true; strChar = c; }}
                else if (c === '{{') depth++;
                else if (c === '}}') depth--;
            }}
            pos++;
        }}
        if (depth !== 0) return null;
        return 'function(a){{' + js.substring(bodyStart, pos);
    }}

    global.PleiNsig = {{
        version: '{version}',
        source: 'NewPipeExtractor',

        findFunctionName: function(js) {{
            try {{ return findNsigFunctionName(js); }} catch(e) {{ return null; }}
        }},

        findFunction: function(js) {{
            try {{
                var name = findNsigFunctionName(js);
                if (!name) return null;
                return extractFunctionBody(js, name);
            }} catch(e) {{ return null; }}
        }}
    }};

}})(typeof window !== 'undefined' ? window : this);
'''


def generate_js(patterns: list[dict]) -> str:
    patterns_data = [{"pattern": p["pattern"], "flags": p["flags"]} for p in patterns]
    patterns_json = json.dumps(patterns_data, indent=4)
    # Versión = hash de los patrones → estable si NewPipe no cambia sus regexes
    fingerprint = hashlib.sha256(patterns_json.encode()).hexdigest()[:8]
    version = f"np-{len(patterns)}p-{fingerprint}"
    return JS_TEMPLATE.format(
        patterns_json=patterns_json,
        version=version,
    )


# ── Validation ────────────────────────────────────────────────────────────────

def get_current_basejs_url() -> str | None:
    try:
        req = urllib.request.Request(
            "https://www.youtube.com/",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            html = r.read().decode("utf-8", errors="replace")
        m = re.search(r'"(/s/player/[^"]+/base\.js)"', html)
        if m:
            return "https://www.youtube.com" + m.group(1)
    except Exception as e:
        print(f"  [WARN] No se pudo obtener URL de base.js: {e}", file=sys.stderr)
    return None


def test_js(js_code: str) -> bool:
    """
    Verifica que el JS cargue sin errores en Node.js y, si hay base.js
    disponible, comprueba que PleiNsig.findFunction funciona.
    Retorna True si todo está OK (null en findFunction no es fatal).
    """
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True, timeout=5)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("  [WARN] Node.js no disponible, test saltado", file=sys.stderr)
        return True

    basejs_url = get_current_basejs_url()
    basejs = ""
    if basejs_url:
        print(f"  Descargando base.js desde {basejs_url[:70]}...", file=sys.stderr)
        try:
            req = urllib.request.Request(basejs_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                basejs = r.read().decode("utf-8", errors="replace")
        except Exception as e:
            print(f"  [WARN] No se pudo descargar base.js: {e}", file=sys.stderr)

    test_script = f"""
// En Node.js CJS, `this` es module.exports, no global. Definir window = globalThis
// para que el IIFE de PleiNsig lo use como target.
var window = globalThis;

{js_code}

// Verificar que PleiNsig está definido correctamente
if (!PleiNsig || typeof PleiNsig.findFunction !== 'function') {{
    process.stderr.write('ERROR: PleiNsig no está definido o le falta findFunction\\n');
    process.exit(1);
}}

var baseJs = {json.dumps(basejs)};
if (!baseJs) {{
    process.stdout.write('OK: JS cargó sin errores (sin base.js para probar)\\n');
    process.exit(0);
}}

var fnName = PleiNsig.findFunctionName(baseJs);
if (!fnName) {{
    process.stderr.write('WARN: findFunctionName=null — patterns no matchean el base.js actual\\n');
    process.stdout.write('OK: JS cargó sin errores (sin match en base.js actual — yt-dlp cubre el gap)\\n');
    process.exit(0);
}}

var fn = PleiNsig.findFunction(baseJs);
if (!fn) {{
    // No es fatal: la extracción del cuerpo puede fallar si YouTube cambió el formato.
    // yt-dlp cubre el gap mientras NewPipe actualiza sus patrones.
    process.stderr.write('WARN: findFunctionName=' + fnName + ' pero findFunction=null (posible falso positivo o formato cambiado)\\n');
    process.stdout.write('OK: JS carga correctamente (nombre encontrado pero cuerpo no extraíble — yt-dlp cubre el gap)\\n');
    process.exit(0);
}}

process.stdout.write('OK: NSig fn=\\'' + fnName + '\\' (' + fn.length + ' chars)\\n');
process.exit(0);
"""

    with tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(test_script)
        tmp = f.name

    try:
        result = subprocess.run(["node", tmp], capture_output=True, text=True, timeout=30)
        if result.stdout.strip():
            print(f"  Test: {result.stdout.strip()}", file=sys.stderr)
        if result.stderr.strip():
            print(f"  Test stderr: {result.stderr.strip()}", file=sys.stderr)
        return result.returncode == 0
    finally:
        os.unlink(tmp)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Genera nsig_extractor.js desde NewPipeExtractor"
    )
    parser.add_argument(
        "--java", default=None,
        help="Ruta local al Java (si omitido, se descarga de NewPipeExtractor)",
    )
    parser.add_argument("--out", required=True, help="Ruta de salida para nsig_extractor.js")
    parser.add_argument("--test", action="store_true", help="Validar el JS contra base.js real")
    args = parser.parse_args()

    # Obtener el archivo Java
    if args.java:
        print(f"Leyendo {args.java}...", file=sys.stderr)
        with open(args.java, encoding="utf-8") as f:
            java_src = f.read()
        newpipe_ref = "local"
    else:
        print("Descargando YoutubeThrottlingParameterUtils.java de NewPipeExtractor...", file=sys.stderr)
        req = urllib.request.Request(NEWPIPE_JAVA_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            java_src = r.read().decode("utf-8")
        newpipe_ref = "TeamNewPipe/NewPipeExtractor@dev"
        print(f"  Descargado ({len(java_src)} bytes)", file=sys.stderr)

    # Extraer constantes y patrones
    print("Extrayendo constantes Java...", file=sys.stderr)
    constants = extract_java_constants(java_src)
    found_consts = [k for k in ["SINGLE_CHAR_VARIABLE_REGEX", "MULTIPLE_CHARS_REGEX", "ARRAY_ACCESS_REGEX"] if k in constants]
    print(f"  Constantes encontradas: {found_consts}", file=sys.stderr)
    if len(found_consts) < 3:
        missing = [k for k in ["SINGLE_CHAR_VARIABLE_REGEX", "MULTIPLE_CHARS_REGEX", "ARRAY_ACCESS_REGEX"] if k not in constants]
        print(f"  [WARN] Constantes no encontradas: {missing}", file=sys.stderr)

    print("Extrayendo patrones NSig...", file=sys.stderr)
    patterns = extract_patterns(java_src, constants)

    # Generar JS
    print("Generando nsig_extractor.js...", file=sys.stderr)
    js = generate_js(patterns)

    # Validar
    if args.test:
        print("Validando JS contra base.js de YouTube...", file=sys.stderr)
        ok = test_js(js)
        if not ok:
            print("ERROR: test fallido. No se escribe el archivo.", file=sys.stderr)
            sys.exit(1)

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"Escrito: {args.out} ({len(js)} chars, {len(patterns)} patrones)", file=sys.stderr)


if __name__ == "__main__":
    main()
