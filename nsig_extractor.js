// Plei NSig Extractor v1.3
// Patrones basados en yt-dlp _extract_n_function_name (2025-07-01)
// Auto-fetched por Plei en runtime — actualizar este archivo repara seeks sin APK nuevo

(function(global) {
    'use strict';

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Resuelve 'name' si es un array y se necesita el índice idx
    function resolveArrayRef(js, name, idxStr) {
        if (!name) return null;
        var idx = (idxStr !== undefined && idxStr !== null && idxStr !== '') ? parseInt(idxStr) : NaN;
        if (!isNaN(idx)) {
            var arrRx = new RegExp('(?:var\\s+)?' + escapeRegex(name) + '\\s*=\\s*\\[([^\\]]{1,1000})\\]');
            var arrM = js.match(arrRx);
            if (arrM) {
                var parts = arrM[1].split(',');
                if (idx < parts.length) {
                    var resolved = parts[idx].trim().replace(/^['"]|['"]$/g, '');
                    if (resolved) return resolved;
                }
            }
        }
        return name;
    }

    function findNsigFunctionName(js) {
        var result = null;
        var m;

        // P1 — classic: .get("n"))&&(b=funcName[idx]?(arg)
        m = js.match(/\.get\("n"\)\)&&\(b=([a-zA-Z0-9_$]+)(?:\[(\d+)\])?\([a-zA-Z0-9_$]\)/);
        if (m) result = resolveArrayRef(js, m[1], m[2]);

        // P2 — .get("n"))&&(c=funcName (c instead of b, newer form)
        if (!result) {
            m = js.match(/\.get\("n"\)\)&&\(c=([a-zA-Z0-9_$]+)(?:\[(\d+)\])?\([a-zA-Z0-9_$]\)/);
            if (m) result = resolveArrayRef(js, m[1], m[2]);
        }

        // P3 — "nn"[+strIdx] form: strIdx&&(b="nn"[+strIdx]...&&(c=funcName  (2025+)
        if (!result) {
            m = js.match(/[a-zA-Z0-9_$]+&&\(b="nn"\[\+[a-zA-Z0-9_$]+\](?:[^)]{0,60})&&\(c=([a-zA-Z0-9_$]+)(?:\[(\d+)\])?\([a-zA-Z0-9_$]\)/);
            if (m) result = resolveArrayRef(js, m[1], m[2]);
        }

        // P4 — String.fromCharCode(110) → c=funcName
        if (!result) {
            m = js.match(/b=String\.fromCharCode\(110\)(?:[^)]{0,100})\)&&\(c=([a-zA-Z0-9_$]+)(?:\[(\d+)\])?\([a-zA-Z0-9_$]\)/);
            if (m) result = resolveArrayRef(js, m[1], m[2]);
        }

        // P5 — var form: var=funcName[idx]?(arg), something.set("n",var)
        if (!result) {
            m = js.match(/\b([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)(?:\[(\d+)\])?\([a-zA-Z0-9_$]\),[a-zA-Z0-9_$]+\.set\((?:"n+"|[a-zA-Z0-9_$]+),\1\)/);
            if (m) result = resolveArrayRef(js, m[2], m[3]);
        }

        // P6 — array[idx] + .set("n": arr[0](arg); something.set("n"
        if (!result) {
            m = js.match(/([a-zA-Z0-9_$]+)\[(\d+)\]\([a-zA-Z0-9_$]\);[a-zA-Z0-9_$]+\.set\("n"/);
            if (m) result = resolveArrayRef(js, m[1], m[2]);
        }

        // P7 — reverse search: function containing "_w8_" in return (post-2025-06-05)
        // YouTube embeds "_w8_" string inside the NSig function body
        if (!result) {
            result = findW8Function(js);
        }

        return result;
    }

    // Busca la función que contiene "_w8_" en su cuerpo (marcador YouTube post-2025-06-05)
    function findW8Function(js) {
        var w8Idx = js.indexOf('"_w8_"');
        if (w8Idx === -1) w8Idx = js.indexOf("'_w8_'");
        if (w8Idx === -1) return null;

        // Retroceder para encontrar el inicio de la función contenedora
        var searchStart = Math.max(0, w8Idx - 3000);
        var snippet = js.substring(searchStart, w8Idx);

        // Buscar el último 'function(' o 'var X=function(' antes del _w8_
        var funcMatch = null;
        var rx = /(?:var\s+([a-zA-Z0-9_$]+)\s*=\s*)?function\s*([a-zA-Z0-9_$]*)\s*\([a-zA-Z0-9_$,\s]*\)\s*\{/g;
        var m;
        while ((m = rx.exec(snippet)) !== null) {
            funcMatch = m;
        }
        if (!funcMatch) return null;

        return funcMatch[1] || funcMatch[2] || null;
    }

    function extractFunctionBody(js, funcName) {
        var escaped = escapeRegex(funcName);
        var startPatterns = [
            new RegExp('var\\s+' + escaped + '\\s*=\\s*function\\s*\\([a-zA-Z0-9_$]+\\)\\s*\\{'),
            new RegExp('(?:^|[;,])' + escaped + '\\s*=\\s*function\\s*\\([a-zA-Z0-9_$]+\\)\\s*\\{'),
            new RegExp('function\\s+' + escaped + '\\s*\\([a-zA-Z0-9_$]+\\)\\s*\\{'),
        ];

        var bodyStart = -1;
        for (var i = 0; i < startPatterns.length; i++) {
            var m = js.match(startPatterns[i]);
            if (m) {
                var declStart = js.indexOf(m[0]);
                bodyStart = declStart + m[0].length;
                break;
            }
        }
        if (bodyStart === -1) return null;

        var depth = 1, pos = bodyStart;
        var inStr = false, strChar = '';
        while (pos < js.length && depth > 0) {
            var c = js[pos];
            if (inStr) {
                if (c === '\\') { pos++; }
                else if (c === strChar) { inStr = false; }
            } else {
                if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
                else if (c === '{') depth++;
                else if (c === '}') { depth--; }
            }
            pos++;
        }
        if (depth !== 0) return null;

        return 'function(a){' + js.substring(bodyStart, pos);
    }

    global.PleiNsig = {
        version: '1.3',

        findFunctionName: function(js) {
            try { return findNsigFunctionName(js); } catch(e) { return null; }
        },

        findFunction: function(js) {
            try {
                var name = findNsigFunctionName(js);
                if (!name) return null;
                var body = extractFunctionBody(js, name);
                return body;
            } catch(e) {
                return null;
            }
        }
    };

})(typeof window !== 'undefined' ? window : this);
