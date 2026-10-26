// Pure interpretation of a small, defined subset of C. Unknown syntax falls back to AI.
const inRange = n => n >= -2147483648n && n <= 2147483647n;
function evaluate(source, vars) {
    const tokens = source.match(/0[xX][0-9a-fA-F]+|\d+|[A-Za-z_]\w*|[()+*/%\-]/g) || [];
    if (tokens.join('') !== source.replace(/\s/g, '') || /\+\+|--/.test(source)) throw Error('unsupported');
    let pos = 0;
    function atom() {
        const t = tokens[pos++];
        if (t === '+' || t === '-') { const v = atom(); return checked(t === '-' ? -v : v); }
        if (t === '(') { const v = expr(0); if (tokens[pos++] !== ')') throw Error('parenthesis'); return v; }
        if (/^\d/.test(t || '')) {
            if (/^0[0-9]+$/.test(t) && /[89]/.test(t)) throw Error('invalid octal');
            return checked(BigInt(/^0[0-7]+$/.test(t) ? '0o' + t.slice(1) : t));
        }
        if (!Object.hasOwn(vars, t)) throw Error('unknown variable');
        return vars[t];
    }
    function checked(v) { if (!inRange(v)) throw Error('overflow'); return v; }
    function expr(min) {
        let lhs = atom();
        while (pos < tokens.length) {
            const op = tokens[pos], precedence = ['+', '-'].includes(op) ? 1 : ['*', '/', '%'].includes(op) ? 2 : -1;
            if (precedence < min) break;
            pos++;
            const rhs = expr(precedence + 1);
            if ((op === '/' || op === '%') && rhs === 0n) throw Error('zero divisor');
            if ((op === '/' || op === '%') && lhs === -2147483648n && rhs === -1n) throw Error('overflow');
            lhs = checked(op === '+' ? lhs + rhs : op === '-' ? lhs - rhs : op === '*' ? lhs * rhs : op === '/' ? lhs / rhs : lhs % rhs);
        }
        return lhs;
    }
    const value = expr(0);
    if (pos !== tokens.length) throw Error('leftover');
    return value;
}
function verifyCOutput(text, choices) {
    // Only declarations/assignments/increments and a final printf; no execution or eval.
    if (/\b(?:if|else|while|for|switch|scanf|getchar|puts|putchar)\b/.test(text)) return null;
    const start = text.search(/\bint\s+(?!main\b)[A-Za-z_]\w*\s*[=,;]/);
    const prints = [...text.matchAll(/printf\s*\(\s*"([^"\\]*(?:\\n[^"\\]*)*)"\s*,([^;]*)\)\s*;/g)];
    if (start < 0 || prints.length !== 1 || prints[0].index < start) return null;
    if ((text.match(/\bprintf\s*\(/g) || []).length !== 1 || /;/.test(text.slice(0, start))) return null;
    const print = prints[0];
    const tail = text.slice(print.index + print[0].length).split(/(?:^|\n)\s*[A-H][.、．]/)[0];
    if (/;/.test(tail)) return null;
    const code = text.slice(start, print.index).trim();
    const vars = Object.create(null);
    try {
        for (const statement of code.split(';').map(s => s.trim()).filter(Boolean)) {
            const decl = statement.match(/^int\s+([\s\S]+)$/);
            if (decl) {
                for (const item of decl[1].split(',')) {
                    const m = item.trim().match(/^([A-Za-z_]\w*)(?:\s*=\s*(.+))?$/);
                    if (!m || Object.hasOwn(vars, m[1])) return null;
                    if (m[2]) vars[m[1]] = evaluate(m[2], vars);
                    else return null;
                }
                continue;
            }
            const assignment = statement.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
            if (assignment && Object.hasOwn(vars, assignment[1])) { vars[assignment[1]] = evaluate(assignment[2], vars); continue; }
            const increment = statement.match(/^(?:(\+\+|--)([A-Za-z_]\w*)|([A-Za-z_]\w*)(\+\+|--))$/);
            if (!increment) return null;
            const name = increment[2] || increment[3], op = increment[1] || increment[4];
            if (!Object.hasOwn(vars, name)) return null;
            vars[name] += op === '++' ? 1n : -1n;
            if (!inRange(vars[name])) return null;
        }
        const args = print[2].split(',').map(s => evaluate(s.trim(), vars));
        let index = 0;
        const supportedFormat = /%%|%([1-9]\d{0,2})?([doxX])/g;
        const output = print[1].replace(/\\n/g, '\n').replace(supportedFormat, (spec, widthText, conversion) => {
            if (spec === '%%') return '%';
            const value = args[index++];
            const width = Number(widthText || 0);
            if (width > 256 || value === undefined || (conversion !== 'd' && value < 0n)) throw Error('unsupported format');
            const result = value.toString(conversion === 'd' ? 10 : conversion === 'o' ? 8 : 16);
            return (conversion === 'X' ? result.toUpperCase() : result).padStart(width, ' ');
        });
        // A remaining format conversion is unsupported, but literal %% is permitted.
        if (/%/.test(print[1].replace(supportedFormat, '')) || index !== args.length) return null;
        const hits = choices.map(c => String(c).trim().match(/^([A-H])[.、．]\s*([\s\S]*)$/))
            .filter(m => m && m[2].trim() === output.trim());
        return hits.length === 1 ? { answers: [hits[0][1]], evidence: '受限C整数解释器校验进制、优先级和整数除法；未执行题目代码' } : null;
    } catch { return null; }
}
module.exports = { verifyCOutput, evaluate };
