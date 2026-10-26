// 仅解释受支持的 scanf 输入格式，不编译或执行题目代码。
function scan(format, input, detailed = false) {
    let p = 0;
    const values = [];
    for (let i = 0; i < format.length; i++) {
        const ch = format[i];
        if (/\s/.test(ch)) { while (/\s/.test(input[p] || '') && p < input.length) p++; continue; }
        if (ch !== '%') { if (input[p++] !== ch) return null; continue; }
        let widthText = '';
        while (/\d/.test(format[i + 1] || '')) widthText += format[++i];
        const width = widthText ? Number(widthText) : 256;
        if (width < 1 || width > 256) return null;
        const conversion = format[++i];
        if (!['d', 'c', 'f'].includes(conversion)) return null;
        if (conversion === 'c') {
            if (widthText && width !== 1) return null;
            if (p >= input.length) return null;
            values.push(input[p++]);
        } else {
            const whitespace = input.slice(p).match(/^\s*/)[0].length;
            p += whitespace;
            const field = input.slice(p, p + width);
            const match = field.match(conversion === 'd' ? /^([+-]?\d+)/ : /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/);
            if (!match) return null;
            if (conversion === 'f' && /^[eE]/.test(field.slice(match[0].length))) return null;
            const number = Number(match[1]);
            if (!Number.isFinite(number) || (conversion === 'd' && (number < -2147483648 || number > 2147483647))) return null;
            values.push(Number(match[1])); p += match[0].length;
        }
    }
    return detailed ? { values, consumed: p } : values;
}

function verifyScanfInput(text, choices) {
    const code = text.match(/scanf\s*\(\s*"([^"\\]*)"\s*,\s*([^)]*)\)/);
    const target = text.match(/(?:若要求|要求)([\w\s、，,]+)的值分别为\s*([\w.\s、，,和]+?)[，,。]/);
    if (!code || !target) return null;
    const names = target[1].replace(/\s/g, '').split(/[、，,]/);
    const expected = target[2].replace(/\s/g, '').split(/[、，,和]/);
    const args = code[2].replace(/\s/g, '').split(',');
    if (names.length !== expected.length || args.some(a => !/^&[A-Za-z_]\w*$/.test(a))
        || new Set(names).size !== names.length || args.length !== names.length) return null;
    const hits = [];
    for (const choice of choices) {
        const option = String(choice).trim().match(/^([A-H])[.、．]\s*([\s\S]*)$/);
        if (!option) return null;
        let input = option[2].trim();
        if (/#(?:代表|表示)空格/.test(text)) input = input.replace(/#/g, ' ');
        const values = scan(code[1], input);
        if (!values || values.length !== args.length) continue;
        const correct = args.every((arg, i) => {
            const index = names.indexOf(arg.slice(1));
            if (index < 0) return false;
            return typeof values[i] === 'number' ? values[i] === Number(expected[index]) : values[i] === expected[index];
        });
        if (correct) hits.push(option[1]);
    }
    return hits.length === 1 ? { answers: hits, evidence: '按scanf格式逐字符模拟所有选项，唯一匹配目标变量值' } : null;
}
function verifyInputStream(text, choices) {
    const single = text.match(/输入数据的形式为[：:]\s*([^\n（]+)/);
    const lines = text.match(/代表回车[）)]\s*([\s\S]+?)\s*后[，,]/);
    if (!single && !lines) return null;
    const input = single ? single[1].trim() : lines[1].trim().split(/\n+/).map(s => s.trim()).join('\n');
    const operations = [...text.matchAll(/([A-Za-z_]\w*)\s*=\s*getchar\s*\(\s*\)\s*;|scanf\s*\("([^"\\]*)"\s*,([^)]*)\)\s*;|printf\s*\("([^"\n]*)"\s*,([^)]*)\)\s*;/g)];
    if (!operations.length) return null;
    const start = text.search(/\b(?:char|int)\s+[A-Za-z_]/);
    if (start < 0) return null;
    let code = text.slice(start, operations.at(-1).index + operations.at(-1)[0].length);
    for (const op of operations) code = code.replace(op[0], '');
    code = code.replace(/\b(?:char|int)\s+[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*;/g, '').replace(/[{}\s]/g, '');
    if (code) return null;
    let position = 0, output = '';
    const values = Object.create(null);
    for (const op of operations) {
        if (op[1]) {
            if (position >= input.length) return null;
            values[op[1]] = input[position++];
        } else if (op[2] !== undefined) {
            const args = op[3].replace(/\s/g, '').split(',');
            if (args.some(a => !/^&[A-Za-z_]\w*$/.test(a))) return null;
            const result = scan(op[2], input.slice(position), true);
            if (!result || result.values.length !== args.length) return null;
            args.forEach((a, i) => values[a.slice(1)] = result.values[i]);
            position += result.consumed;
        } else {
            const args = op[5].replace(/\s/g, '').split(',');
            if (args.some(a => !/^[A-Za-z_]\w*$/.test(a) || values[a] === undefined)) return null;
            let n = 0;
            output += op[4].replace(/\\n/g, '\n').replace(/%([dc])/g, (_, type) => {
                const value = values[args[n++]];
                return type === 'd' ? String(typeof value === 'number' ? value : value.charCodeAt(0))
                    : (typeof value === 'number' ? String.fromCharCode(value) : value);
            });
            if (n !== args.length || /%/.test(output)) return null;
        }
    }
    const requested = text.match(/后[，,]\s*([\w\s、,]+)的值分别是/);
    if (requested) {
        const names = requested[1].replace(/\s/g, '').split(/[、,]/);
        if (names.some(name => values[name] === undefined)) return null;
        output = names.map(name => values[name] === '\n' ? '\\n' : String(values[name])).join(',');
    }
    if (!output) return null;
    const normalize = s => s.trim().replace(/、/g, ',');
    const hits = choices.map(c => String(c).trim().match(/^([A-H])[.、．]\s*([\s\S]*)$/))
        .filter(m => m && normalize(m[2]) === normalize(output));
    return hits.length === 1 ? { answers: [hits[0][1]], evidence: '受限输入流模拟逐步验证scanf字段宽度、getchar和换行读取' } : null;
}
module.exports = { scan, verifyScanfInput, verifyInputStream };
