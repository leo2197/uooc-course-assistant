const fs = require('fs');
const path = require('path');

const COLORS = [
    '\x1b[36m',  // cyan
    '\x1b[33m',  // yellow
    '\x1b[35m',  // magenta
    '\x1b[32m',  // green
    '\x1b[91m',  // bright red
    '\x1b[96m',  // bright cyan
    '\x1b[93m',  // bright yellow
    '\x1b[95m',  // bright magenta
];
const RESET = '\x1b[0m';

// ---- 把控制台输出同时落盘 ----
// 黑窗口一关日志就全没了，出问题时没法回看。这里把所有 console 输出镜像到 logs/run-YYYYMMDD.log
const LOG_DIR = path.join(__dirname, '..', 'logs');
let stream = null;
let streamFailed = false;

function getStream() {
    if (stream || streamFailed) return stream;
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const d = new Date();
        const name = `run-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.log`;
        stream = fs.createWriteStream(path.join(LOG_DIR, name), { flags: 'a' });
    } catch {
        streamFailed = true;
        stream = null;
    }
    return stream;
}

const stripAnsi = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');

function mirror(args) {
    try {
        const s = getStream();
        if (!s) return;
        const line = '[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] ' +
            args.map(a => {
                if (typeof a === 'string') return a;
                if (a && a.stack) return a.stack;
                try { return JSON.stringify(a); } catch { return String(a); }
            }).join(' ');
        s.write(stripAnsi(line) + '\n');
    } catch { }
}

const _log = console.log, _err = console.error, _warn = console.warn;
console.log = (...a) => { _log(...a); mirror(a); };
console.error = (...a) => { _err(...a); mirror(a); };
console.warn = (...a) => { _warn(...a); mirror(a); };

function createLogger(tag, colorIndex) {
    const color = COLORS[colorIndex % COLORS.length];
    const prefix = `${color}${tag}${RESET}`;
    // console.log 已被 hook，这里只管上色，落盘自动完成
    return (...args) => console.log(prefix, ...args);
}

module.exports = { createLogger, LOG_DIR };
