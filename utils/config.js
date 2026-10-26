const path = require('path');
const fs = require('fs');

// 从 config.txt 读取配置，环境变量作为备选
const cfgPath = path.join(__dirname, '..', 'config.txt');
const cfg = {};
if (fs.existsSync(cfgPath)) {
    for (const line of fs.readFileSync(cfgPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (val) cfg[key] = val;
    }
}

const publicProfile=process.env.UOOC_PROFILE_ID;
if(publicProfile&&!/^[A-Za-z0-9_-]+$/.test(publicProfile))throw Error('浏览器资料标识无效');
const savedProvider=require('../provider.cjs').load();
if(savedProvider){cfg.API_KEY=savedProvider.key;cfg.BASE_URL=savedProvider.url;cfg.MODEL=savedProvider.model;cfg.RETRY_MODEL=savedProvider.judge;cfg.JUDGE_MODEL=savedProvider.judge;cfg.ENSEMBLE_MODELS=savedProvider.model;cfg.VERIFY_MODEL=savedProvider.judge;}
const USERNAME = publicProfile || cfg.USERNAME || process.env.UOOC_USERNAME || 'default';
const PASSWORD = publicProfile ? '' : (cfg.PASSWORD || process.env.UOOC_PASSWORD || '');
const API_KEY = cfg.API_KEY || process.env.LLM_API_KEY;
const MODEL_NAME = cfg.MODEL || process.env.LLM_MODEL || 'doubao-seed-2-0-mini-260215';
const RETRY_MODEL = cfg.RETRY_MODEL || process.env.LLM_RETRY_MODEL || 'doubao-seed-2-0-lite-260215';
const API_BASE_URL = cfg.BASE_URL || process.env.LLM_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// ---- 多模型投票 ----
// ENSEMBLE_MODELS 用 | 或逗号分隔，按先后顺序代表优先级
const DEFAULT_ENSEMBLE = [
    'deepseek-ai/DeepSeek-V4.1-Flash',
    'Qwen/Qwen3.5-122B-A10B',
    'Qwen/Qwen3.8-27B'
];
const ENSEMBLE_MODELS = (() => {
    const raw = cfg.ENSEMBLE_MODELS || process.env.LLM_ENSEMBLE_MODELS;
    if (!raw) return DEFAULT_ENSEMBLE;
    const list = raw.split(/[|,]/).map(s => s.trim()).filter(Boolean);
    return list.length > 0 ? list : DEFAULT_ENSEMBLE;
})();
// 至少多少个模型答案完全一致才直接采用
const ENSEMBLE_MIN_AGREE = Math.max(1, parseInt(cfg.ENSEMBLE_MIN_AGREE || process.env.LLM_ENSEMBLE_MIN_AGREE || '1', 10) || 1);
// 分歧时的裁决模型（用高推理强度再判一次）
const JUDGE_MODEL = cfg.JUDGE_MODEL || process.env.LLM_JUDGE_MODEL || RETRY_MODEL;
// 每个模型的并行请求超时（毫秒）
const ENSEMBLE_TIMEOUT = parseInt(cfg.ENSEMBLE_TIMEOUT || '180000', 10) || 180000;

// ---- 提交策略（UOOC 只有一次提交机会，务必谨慎）----
// verify = 逐题二次复核，全部确认才自动提交；manual = 永不自动提交；auto = 答完直接提交
const SUBMIT_MODE = String(cfg.SUBMIT_MODE || process.env.UOOC_SUBMIT_MODE || 'verify').trim().toLowerCase();
const VERIFY_SECOND_PASS = String(cfg.VERIFY_SECOND_PASS ?? '1').trim() !== '0';
const VERIFY_MODEL = cfg.VERIFY_MODEL || process.env.LLM_VERIFY_MODEL || '';
const VERIFY_ALLOW_UNCERTAIN = (() => {
    const n = parseInt(cfg.VERIFY_ALLOW_UNCERTAIN || '0', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
})();
// 复核最多追加几轮投票（每轮 = 独立再判一次），凑到多数就停
const VERIFY_MAX_ROUNDS = (() => {
    const n = parseInt(cfg.VERIFY_MAX_ROUNDS || '3', 10);
    return Number.isFinite(n) && n >= 0 ? n : 3;
})();
// 遇到不确定：resolve=自动收敛（最高票）后照常提交，不打断用户（默认）/ stop=停下等人工
const ON_UNCERTAIN = String(cfg.ON_UNCERTAIN || 'resolve').trim().toLowerCase();
// 有题完全没答案：block=不提交（默认）/ force=照常提交（该题必然 0 分）
const ON_EMPTY = String(cfg.ON_EMPTY || 'block').trim().toLowerCase();

// ---- 每日调用额度上限 ----
// 魔搭每人每天 2000 次免费调用（所有模型加总），这里留余量
const DAILY_CALL_LIMIT = (() => {
    const n = parseInt(cfg.DAILY_CALL_LIMIT || process.env.LLM_DAILY_CALL_LIMIT || '1200', 10);
    return Number.isFinite(n) && n > 0 ? n : 1200;
})();

// ---- 课程白名单 ----
// COURSE_WHITELIST=136754434,273574985 → 只刷这两门课；留空 = 不限制（全部课程）
const COURSE_WHITELIST = (() => {
    const raw = process.env.UOOC_TARGET_COURSES || (process.env.UOOC_AUTO_UNFINISHED === '1' ? '' : (cfg.COURSE_WHITELIST || process.env.UOOC_COURSE_WHITELIST || ''));
    return raw.split(/[|,，\s]+/).map(s => s.trim()).filter(Boolean);
})();


if (!USERNAME || !PASSWORD) {
    console.error('❌ 请在 config.txt 中填写 USERNAME 和 PASSWORD');
    process.exit(1);
}

if (!API_KEY) {
    console.error('❌ 请在 config.txt 中填写 API_KEY');
    process.exit(1);
}

// 按课程单独覆盖配置：KEY_<课程ID>，例如 VERIFY_ALLOW_UNCERTAIN_136754434=0
// 课程ID 就是 data/<账号>/ 下的文件名（如 136754434.txt）
function courseSetting(courseId, key, fallback) {
    const v = cfg[key + '_' + courseId];
    return v === undefined ? fallback : v;
}

const DATA_DIR = path.join(__dirname, '..', 'data', USERNAME);
fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = {
    USERNAME, PASSWORD, API_KEY, MODEL_NAME, RETRY_MODEL, API_BASE_URL, DATA_DIR,
    ENSEMBLE_MODELS, ENSEMBLE_MIN_AGREE, JUDGE_MODEL, ENSEMBLE_TIMEOUT,
    DAILY_CALL_LIMIT,
    SUBMIT_MODE, VERIFY_SECOND_PASS, VERIFY_MODEL, VERIFY_ALLOW_UNCERTAIN,
    VERIFY_MAX_ROUNDS, ON_UNCERTAIN, ON_EMPTY,
    COURSE_WHITELIST,
    courseSetting
};
