/**
 * 每日 API 调用额度闸门
 * 目的：别把魔搭的免费额度烧光（每人每天 2000 次，所有模型加总）。
 * 计数持久化在 data/<账号>/api-calls.json，跨重启累计，跨天自动清零。
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR, DAILY_CALL_LIMIT } = require('./config');

const FILE = path.join(DATA_DIR, 'api-calls.json');

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load() {
    try {
        const s = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
        if (s && typeof s.count === 'number' && typeof s.date === 'string') return s;
    } catch { }
    return { date: todayKey(), count: 0 };
}

function save(s) {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(s));
    } catch { }
}

// 取当天状态，跨天自动重置
function state() {
    const s = load();
    if (s.date !== todayKey()) {
        s.date = todayKey();
        s.count = 0;
        save(s);
    }
    return s;
}

function used() { return state().count; }
function remaining() { return Math.max(0, DAILY_CALL_LIMIT - used()); }
function exhausted() { return used() >= DAILY_CALL_LIMIT; }

/**
 * 申请一次调用额度。返回 true = 允许调用；false = 今日额度已用完，不要发请求。
 * 注意：先申请再调用，避免并发时超发。
 */
function consume(n = 1) {
    const s = state();
    if (s.count + n > DAILY_CALL_LIMIT) return false;
    s.count += n;
    save(s);
    return true;
}

function summary() {
    return `今日已调用 ${used()}/${DAILY_CALL_LIMIT} 次，剩余 ${remaining()} 次`;
}

module.exports = { consume, used, remaining, exhausted, summary, DAILY_CALL_LIMIT };
