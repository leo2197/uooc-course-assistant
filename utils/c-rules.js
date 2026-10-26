const { evaluate } = require('./c-output');
function printfTypeIssue(text) {
    text = text.split(/(?:^|\n)\s*[A-H][.、．]/)[0];
    if (!/输出|结果/.test(text)) return null;
    const types = Object.create(null);
    for (const declaration of text.matchAll(/\b(int|char|float|double)\s+([^;]+);/g)) {
        for (const item of declaration[2].split(',')) {
            const name = item.trim().match(/^([A-Za-z_]\w*)(?:\s*=\s*[^,]+)?$/)?.[1];
            if (name) types[name] = declaration[1];
        }
    }
    for (const call of text.matchAll(/printf\s*\(\s*"([^"\n]*)"\s*,\s*([^;]*)\)\s*;/g)) {
        const conversions = [...call[1].matchAll(/%%|%([dcf])/g)].filter(m => m[1]).map(m => m[1]);
        if (call[1].replace(/%%|%[dcf]/g, '').includes('%')) continue;
        const args = call[2].split(',').map(s => s.trim());
        if (args.length !== conversions.length) continue;
        for (let i = 0; i < args.length; i++) {
            // No casts, calls, conditionals, pointers or comparison/logical operators.
            if (!/^[\w\s.()+*/%\-]+$/.test(args[i]) || /\b(?:int|float|double|char)\b|\w\s*\(/.test(args[i])) continue;
            const names = args[i].match(/[A-Za-z_]\w*/g) || [];
            if (names.some(name => !types[name])) continue;
            const floating = names.some(name => /float|double/.test(types[name])) || /\d\.\d/.test(args[i]);
            if (floating && /[dc]/.test(conversions[i])) {
                return `printf的%${conversions[i]}要求int，但参数${args[i]}是浮点表达式；C标准7.21.6.1第9段规定其行为未定义，无法确定数值答案`;
            }
        }
    }
    return null;
}
function verifyDigitSplit(text, choices) {
    const stem = text.split(/(?:^|\n)\s*[A-H][.、．]/)[0];
    const source = stem.match(/(?:三|3)位正整数\s*([A-Za-z_]\w*)/);
    if (!source || !/分解.*各位/.test(stem) || /百位|十位|个位/.test(stem)) return null;
    const variable = source[1], hits = [];
    for (const choice of choices) {
        const option = String(choice).trim().match(/^([A-H])[.、．]\s*([\s\S]*)$/);
        if (!option) return null;
        const code = option[2].replace(/\s/g, '');
        const operations = code.replace(/;$/, '').split(/[,;]/).map(s => s.match(/^([A-Za-z_]\w*)=(.+)$/));
        if (operations.length !== 3 || operations.some(m => !m) || new Set(operations.map(m => m[1])).size !== 3
            || operations.some(m => m[1] === variable)) continue;
        let valid = true;
        try {
            // Exhaust the entire domain; no sampled inputs and no arbitrary code execution.
            for (let x = 100; x <= 999; x++) {
                const vars = Object.create(null); vars[variable] = BigInt(x);
                for (const op of operations) vars[op[1]] = evaluate(op[2], vars);
                const digits = String(x).split('').sort().join(',');
                if (operations.map(op => vars[op[1]].toString()).sort().join(',') !== digits) { valid = false; break; }
            }
        } catch { valid = false; }
        if (valid) hits.push(option[1]);
    }
    return hits.length === 1 ? { answers: hits, evidence: '穷举全部900个三位正整数，逐条解释选项并验证各位数字，唯一匹配' } : null;
}
function verifyKeywordError(text, choices) {
    const stem = text.split(/(?:^|\n)\s*[A-H][.、．]/)[0];
    if (!/编译.*错误|出错原因/.test(stem)) return null;
    const keywords = new Set(('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local').split(' '));
    const invalid = [...stem.matchAll(/\b(?:int|char|float|double)\s+([A-Za-z_]\w*)\s*[;,=]/g)]
        .map(match => match[1]).filter(name => keywords.has(name));
    if (new Set(invalid).size !== 1) return null;
    const name = invalid[0];
    const hits = choices.map(c => String(c).trim().match(/^([A-H])[.、．]\s*([\s\S]*)$/))
        .filter(m => m && m[2].includes(name) && /关键字|保留字/.test(m[2]) && /不能.*标识符/.test(m[2]));
    return hits.length === 1 ? { answers:[hits[0][1]], evidence:`声明使用C保留字${name}作为变量名，唯一匹配编译错误原因` } : null;
}
module.exports = { printfTypeIssue, verifyDigitSplit, verifyKeywordError };
