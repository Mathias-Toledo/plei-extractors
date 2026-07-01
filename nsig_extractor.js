// Plei NSig Extractor v1.1
// Extracts and returns the NSig function body from YouTube's base.js
// Based on yt-dlp NSig extraction patterns (github.com/yt-dlp/yt-dlp)
// Auto-fetched by Plei at runtime — update this file to fix NSig without APK release

(function(global) {
    'use strict';

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function findNsigFunctionName(js) {
        // Ordered by how common each pattern is across YouTube versions
        var patterns = [
            // Pattern 1: .get("n"))&&(b=funcName(a.get("n")))  — most common 2024-2025
            /\.get\("n"\)\)&&\(b=([a-zA-Z0-9$_]{1,4})(?:\[(\d+)\])?\([a-zA-Z0-9$_]\)/,
            // Pattern 2: String.fromCharCode(110) variant
            /b=String\.fromCharCode\(110\),c=a\.get\(b\)\)&&\(c=([a-zA-Z0-9$_]{1,4})(?:\[(\d+)\])?\([a-zA-Z0-9$_]\)/,
            // Pattern 3: newer assignment form
            /\("n"\)\)&&\([a-zA-Z0-9$_]+=([a-zA-Z0-9$_]{1,4})(?:\[(\d+)\])?\([a-zA-Z0-9$_]\)/,
            // Pattern 4: array[index] form  .set("n"
            /[a-zA-Z0-9$_]+=([a-zA-Z0-9$_]{1,4})\[(\d+)\]\([a-zA-Z0-9$_]\);[a-zA-Z0-9$_]+\.set\("n"/,
            // Pattern 5: yt-dlp 2025 — function containing 'alr'+'yes' call signature
            /([a-zA-Z0-9$_]{2,12})=function\([a-zA-Z0-9$_]\)\{(?:(?!\n[a-zA-Z]).){0,500}['"]alr['"]/,
        ];

        for (var i = 0; i < patterns.length; i++) {
            var m = js.match(patterns[i]);
            if (!m) continue;
            var name = m[1];
            var idx = (m[2] !== undefined && m[2] !== '') ? parseInt(m[2]) : null;
            if (idx !== null) {
                // Resolve array reference: var name = [fn1, fn2, ...]
                var arrRx = new RegExp('var\\s+' + escapeRegex(name) + '\\s*=\\s*\\[([^\\]]+)\\]');
                var arrM = js.match(arrRx);
                if (arrM) {
                    var parts = arrM[1].split(',');
                    if (idx < parts.length) name = parts[idx].trim();
                }
            }
            return name;
        }
        return null;
    }

    function extractFunctionBody(js, funcName) {
        var escaped = escapeRegex(funcName);
        // Try both var and direct assignment forms
        var startPatterns = [
            new RegExp('(?:var\\s+)?' + escaped + '\\s*=\\s*function\\s*\\([a-zA-Z0-9$_]+\\)\\s*\\{'),
            new RegExp(escaped + '\\s*=\\s*function\\([a-zA-Z0-9$_]+\\)\\{'),
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

        // Balance braces to find end of function
        var depth = 1, pos = bodyStart;
        while (pos < js.length && depth > 0) {
            var c = js[pos];
            if (c === '{') depth++;
            else if (c === '}') depth--;
            pos++;
        }
        if (depth !== 0) return null;

        return 'function(a){' + js.substring(bodyStart, pos);
    }

    global.PleiNsig = {
        version: '1.1',
        // Returns the NSig function body as a string, ready for eval
        findFunction: function(js) {
            try {
                var name = findNsigFunctionName(js);
                if (!name) return null;
                return extractFunctionBody(js, name);
            } catch(e) {
                return null;
            }
        }
    };

})(typeof window !== 'undefined' ? window : this);
