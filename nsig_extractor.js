// Plei NSig Extractor — AUTO-GENERADO por GitHub Action
// Fuente: NewPipeExtractor YoutubeThrottlingParameterUtils.java (rama dev)
// Version: np-8p-3c38bef2  (hash de patrones — cambia solo cuando NewPipe actualiza sus regexes)
// NO editar manualmente — este archivo se sobreescribe en cada update automático

(function(global) {
    'use strict';

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Si name es un array (ej: funcArr), resuelve funcArr[idx] → nombre real
    function resolveArrayRef(js, name, idxStr) {
        if (!name) return null;
        var idx = (idxStr !== undefined && idxStr !== null && idxStr !== '')
                  ? parseInt(idxStr, 10) : NaN;
        if (!isNaN(idx)) {
            var arrRx = new RegExp(
                '(?:var\\s+)?' + escapeRegex(name) + '\\s*=\\s*\\[([^\\]]{1,2000})\\]'
            );
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

    // Patrones extraídos de NewPipeExtractor DEOBFUSCATION_FUNCTION_NAME_REGEXES
    // m[1] = nombre de función o array; m[2] = índice si es array
    var PATTERNS = [
    {
        "pattern": "([A-Za-z0-9_\\$]{2,})=function.*return [A-Z]\\[\\d+\\]",
        "flags": ""
    },
    {
        "pattern": "[a-zA-Z0-9$_]=\"nn\"\\[\\+[a-zA-Z0-9$_]+\\.[a-zA-Z0-9$_]+],[a-zA-Z0-9$_]+\\([a-zA-Z0-9$_]+\\),[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\\.[a-zA-Z0-9$_]+\\[[a-zA-Z0-9$_]+]\\|\\|null\\)&&\\([a-zA-Z0-9$_]+=([a-zA-Z0-9$_]+)\\[(\\d+)]",
        "flags": ""
    },
    {
        "pattern": "[a-zA-Z0-9$_]=\"nn\"\\[\\+[a-zA-Z0-9$_]+\\.[a-zA-Z0-9$_]+],[a-zA-Z0-9$_]+\\([a-zA-Z0-9$_]+\\),[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\\.[a-zA-Z0-9$_]+\\[[a-zA-Z0-9$_]+]\\|\\|null\\).+\\|\\|([a-zA-Z0-9$_]+)\\(\"\"\\)",
        "flags": ""
    },
    {
        "pattern": ",[a-zA-Z0-9$_]+\\([a-zA-Z0-9$_]+\\),[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\\.[a-zA-Z0-9$_]+\\[[a-zA-Z0-9$_]+]\\|\\|null\\)&&\\(\\b[a-zA-Z0-9$_]+=([a-zA-Z0-9$_]+)\\[(\\d+)]\\([a-zA-Z0-9$_]\\),[a-zA-Z0-9$_]+\\.set\\((?:\"n+\"|[a-zA-Z0-9$_]+),[a-zA-Z0-9$_]+\\)",
        "flags": ""
    },
    {
        "pattern": "[a-zA-Z0-9$_]=\"nn\"\\[\\+[a-zA-Z0-9$_]+\\.[a-zA-Z0-9$_]+],[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\\.get\\([a-zA-Z0-9$_]+\\)\\).+\\|\\|([a-zA-Z0-9$_]+)\\(\"\"\\)",
        "flags": ""
    },
    {
        "pattern": "[a-zA-Z0-9$_]=\"nn\"\\[\\+[a-zA-Z0-9$_]+\\.[a-zA-Z0-9$_]+],[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\\.get\\([a-zA-Z0-9$_]+\\)\\)&&\\([a-zA-Z0-9$_]+=([a-zA-Z0-9$_]+)\\[(\\d+)]",
        "flags": ""
    },
    {
        "pattern": "\\([a-zA-Z0-9$_]=String\\.fromCharCode\\(110\\),[a-zA-Z0-9$_]=[a-zA-Z0-9$_]\\.get\\([a-zA-Z0-9$_]\\)\\)&&\\([a-zA-Z0-9$_]=([a-zA-Z0-9$_]+)(?:\\[(\\d+)])?\\([a-zA-Z0-9$_]\\)",
        "flags": ""
    },
    {
        "pattern": "\\.get\\(\"n\"\\)\\)&&\\([a-zA-Z0-9$_]=([a-zA-Z0-9$_]+)(?:\\[(\\d+)])?\\([a-zA-Z0-9$_]\\)",
        "flags": ""
    }
];

    function findNsigFunctionName(js) {
        for (var i = 0; i < PATTERNS.length; i++) {
            try {
                var rx = new RegExp(PATTERNS[i].pattern, PATTERNS[i].flags);
                var m = js.match(rx);
                if (m && m[1]) {
                    return resolveArrayRef(js, m[1], m[2]);
                }
            } catch(e) { /* patrón inválido en este engine, skip */ }
        }
        return null;
    }

    function extractFunctionBody(js, funcName) {
        var escaped = escapeRegex(funcName);
        var startPatterns = [
            new RegExp('var\\s+' + escaped + '\\s*=\\s*function\\s*\\([a-zA-Z0-9_$]*\\)\\s*\\{'),
            new RegExp('(?:^|[;,])' + escaped + '\\s*=\\s*function\\s*\\([a-zA-Z0-9_$]*\\)\\s*\\{'),
            new RegExp('function\\s+' + escaped + '\\s*\\([a-zA-Z0-9_$]*\\)\\s*\\{'),
        ];
        var bodyStart = -1;
        for (var i = 0; i < startPatterns.length; i++) {
            var m = js.match(startPatterns[i]);
            if (m) {
                bodyStart = js.indexOf(m[0]) + m[0].length;
                break;
            }
        }
        if (bodyStart === -1) return null;
        var depth = 1, pos = bodyStart;
        var inStr = false, strChar = '';
        while (pos < js.length && depth > 0) {
            var c = js[pos];
            if (inStr) {
                if (c === '\\') pos++;
                else if (c === strChar) inStr = false;
            } else {
                if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
                else if (c === '{') depth++;
                else if (c === '}') depth--;
            }
            pos++;
        }
        if (depth !== 0) return null;
        return 'function(a){' + js.substring(bodyStart, pos);
    }

    global.PleiNsig = {
        version: 'np-8p-3c38bef2',
        source: 'NewPipeExtractor',

        findFunctionName: function(js) {
            try { return findNsigFunctionName(js); } catch(e) { return null; }
        },

        findFunction: function(js) {
            try {
                var name = findNsigFunctionName(js);
                if (!name) return null;
                return extractFunctionBody(js, name);
            } catch(e) { return null; }
        }
    };

})(typeof window !== 'undefined' ? window : this);
