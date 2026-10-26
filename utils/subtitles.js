// utils/subtitles.js —— 课程字幕：收集 / 下载 / 检索
// 用途：把视频字幕变成可检索的文稿，答题时用来回答「视频细节题」
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'subtitles');
const CDN = 'https://source11.uooconline.com';

function dirOf(courseId) {
    const d = path.join(ROOT, String(courseId));
    fs.mkdirSync(d, { recursive: true });
    return d;
}

// SRT → 带时间戳的纯文本（[mm:ss] 内容），便于定位与检索
function srtToText(srt) {
    const out = [];
    const clean = String(srt || '').replace(/^\uFEFF/, '');
    for (const block of clean.split(/\r?\n\r?\n+/)) {
        const lines = block.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) continue;
        const timeLine = lines.find(l => l.includes('-->'));
        if (!timeLine) continue;
        const start = timeLine.split('-->')[0].trim().split(',')[0];
        const text = lines
            .filter(l => !/^\d+$/.test(l.trim()) && !l.includes('-->'))
            .join(' ')
            .trim();
        if (text) out.push('[' + start + '] ' + text);
    }
    return out.join('\n');
}

// 由视频路径推测字幕地址（UOOC 的命名有多套规则，逐个试）
function srtVariants(videoPath) {
    let dec;
    try { dec = decodeURIComponent(videoPath); } catch { dec = videoPath; }
    const base = dec.replace(/\s+/g, '').replace(/\.mp4$/i, '');
    const set = new Set();
    const push = s => { if (s) set.add(encodeURI(s) + '.srt'); };
    push(base.replace(/\d*T$/, ''));   // 去掉末尾「数字+T」
    push(base.replace(/T$/, ''));      // 只去掉末尾 T
    push(base.replace(/\d+$/, ''));    // 去掉末尾数字
    return [...set];
}

// 按「猜地址」下载某视频的字幕；成功返回纯文本
async function downloadByGuess(videoPath) {
    for (const u of srtVariants(videoPath)) {
        try {
            const r = await fetch(CDN + u);
            if (!r.ok) continue;
            const srt = await r.text();
            if (!/-->/.test(srt)) continue;
            return { url: CDN + u, text: srtToText(srt) };
        } catch { }
    }
    return null;
}

function save(courseId, name, text) {
    const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const p = path.join(dirOf(courseId), safe + '.txt');
    fs.writeFileSync(p, text, 'utf8');
    return p;
}

// 在已下载的字幕里检索关键词 → [{ file, hits: [{keyword, line}] }]
function search(courseId, keywords) {
    const d = dirOf(courseId);
    const files = fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.txt')) : [];
    const kws = (keywords || [])
        .map(k => String(k || '').trim())
        .filter(k => k.length >= 2);
    if (!kws.length) return [];
    const result = [];
    for (const f of files) {
        const lines = fs.readFileSync(path.join(d, f), 'utf8').split('\n');
        const hits = [];
        for (const kw of kws) {
            for (const ln of lines) {
                if (ln.includes(kw)) hits.push({ keyword: kw, line: ln });
                if (hits.length >= 60) break;
            }
        }
        if (hits.length) result.push({ file: f, hits });
    }
    return result.sort((a, b) => b.hits.length - a.hits.length);
}

// 把检索结果压成一段可塞进提示词的上下文
/**
 * 把检索结果压成一段可塞进提示词的上下文。
 * 返回 '' 表示「这题不像视频里的题，别注入」—— 靠命中质量自己判断，不用额外调模型。
 */
function buildContext(courseId, keywords, maxChars = 1800) {
    const found = search(courseId, keywords);
    if (!found.length) return '';

    // ---- 质量门槛：判断这是不是一道"视频细节题" ----
    // 命中的关键词种类太少、条数太少 → 题干跟字幕基本不搭边，
    // 硬塞片段只会给模型添噪音、还白烧 token，所以直接不注入。
    const distinct = new Set();
    let total = 0;
    for (const f of found) for (const h of f.hits) { distinct.add(h.keyword); total += 1; }
    const hitRate = total / Math.max(1, keywords.length);
    if (distinct.size < 3 || total < 6 || hitRate < 0.08) return '';

    const parts = [];
    for (const f of found.slice(0, 3)) {
        parts.push('【' + f.file.replace(/\.txt$/, '') + '】');
        for (const h of f.hits.slice(0, 12)) parts.push(h.line);
        if (parts.join('\n').length > maxChars) break;
    }
    return parts.join('\n').slice(0, maxChars);
}

// 没有区分度的词，检索时滤掉（否则满屏噪音，还会把无关的题误判成"视频题"）
const STOP_WORDS = [
    '下列', '以下', '哪些', '哪个', '哪一', '什么', '关于', '说法', '正确', '错误', '不正确',
    '属于', '最能', '体现', '一项', '几项', '上述', '本题', '下列关于', '下列哪些', '以下哪些',
    '不包括', '包括', '有误', '无误', '选项', '答案', '描述', '表述', '叙述', '观点', '理解'
];

// 从题干里提取检索关键词：切成片段 + 2~6 字滑窗（命中多的自然排前面）
// ⚠️ 窗口必须从 **2 字** 起：中文里两字词最常见，像"吴俊豪"这种人名，
//    用 3 字以上窗口会切成一堆"吴俊豪是从什"之类的碎片，字幕里永远搜不到。
function keywordsFromStem(stem, maxPerSeg = 40) {
    const s = String(stem || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '|');
    const segs = s.split('|').filter(x => x.length >= 2);
    const out = new Set();
    const keep = w => w && w.length >= 2 && !STOP_WORDS.includes(w);
    for (const seg of segs) {
        if (seg.length <= 14 && keep(seg)) out.add(seg);
        let n = 0;
        for (let len = Math.min(6, seg.length); len >= 2 && n < maxPerSeg; len--) {
            for (let i = 0; i + len <= seg.length && n < maxPerSeg; i++, n++) {
                const cand = seg.slice(i, i + len);
                if (keep(cand)) out.add(cand);
            }
        }
    }
    return [...out].slice(0, 200);
}

// 监听页面上的 .srt 请求并落盘（跟着刷课流程自然收集，导论这类「猜不到」的靠它）
function attachCollector(page, courseId, log = console.log) {
    const seen = new Set();
    page.on('response', async (res) => {
        try {
            const u = res.url();
            if (!/\.srt(\?|$)/i.test(u) || seen.has(u)) return;
            seen.add(u);
            const srt = await res.text();
            if (!/-->/.test(srt)) return;
            const name = decodeURIComponent(u.split('/').pop().replace(/\.srt$/i, ''));
            save(courseId, name, srtToText(srt));
            log('   💬 抓到字幕: ' + name.slice(0, 42));
        } catch { }
    });
}

module.exports = { srtToText, srtVariants, downloadByGuess, save, search, buildContext, keywordsFromStem, attachCollector, dirOf };
