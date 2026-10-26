// utils/probe.js —— 开发调研用：探测 UOOC 视频源（媒体地址 / 字幕 / 播放器结构）
// 用法：UOOC_PROBE=1 node start.js
// 只探测第一门课，输出结果后退出，不改任何东西。
const fs = require('fs');

async function probeCourse(context, link) {
    const page = await context.newPage();
    const media = new Set();
    const captions = new Set();
    const jsonHits = [];
    const allXhr = new Set();

    const noteUrl = (u) => {
        if (/\.(m3u8|mp4|flv|ts|m4s|mpd|mov|avi)(\?|#|$)/i.test(u)) media.add(u);
        if (/\.(vtt|srt|ass|ssa)(\?|#|$)/i.test(u)) captions.add(u);
        if (/subtitle|caption|vtt|srt/i.test(u)) captions.add(u);
    };
    page.on('request', r => noteUrl(r.url()));
    page.on('response', async (res) => {
        try {
            const u = res.url();
            noteUrl(u);
            const ct = String(res.headers()['content-type'] || '');
            if (/^(video|audio)\//i.test(ct) || /mpegurl|octet-stream/i.test(ct)) media.add(u);
            if (/(api|service|json)/i.test(u) && !/\.(js|css|png|jpg|gif|woff)/i.test(u)) {
                allXhr.add(u);
                if (/json/i.test(ct)) {
                    const t = await res.text();
                    if (/m3u8|\.mp4|source|url|play/i.test(t) && t.length < 60000) {
                        jsonHits.push({ 接口: u, 片段: t.slice(0, 1500) });
                    }
                }
            }
        } catch { }
    });

    console.log('  📖 打开课程页: ' + link);
    await page.goto(link, { timeout: 40000 });
    await page.waitForTimeout(3500);

    try {
        const btn = page.locator('a.btn.btn-danger:has-text("开始学习"), a.btn.btn-danger:has-text("继续学习")');
        if (await btn.count() > 0) {
            await btn.first().click();
            console.log('  ✅ 点击了「开始/继续学习」');
        }
    } catch { }
    await page.waitForTimeout(5000);

    // ---- 点开「视频」资源（页面提示"请选择课程资源"，不点不会加载播放器）----
    const tryClickVideo = async () => {
        const sels = [
            '.oneline:has-text("视频")',
            'li:has-text("视频")',
            'div:has-text("视频"):not(:has(div))',
            'text=视频'
        ];
        for (const sel of sels) {
            let loc;
            try { loc = page.locator(sel); } catch { continue; }
            let n = 0;
            try { n = await loc.count(); } catch { continue; }
            for (let i = 0; i < Math.min(n, 4); i++) {
                try {
                    await loc.nth(i).click({ timeout: 2500 });
                    await page.waitForTimeout(4000);
                    const has = await page.evaluate(() => !!document.querySelector('video'));
                    if (has) { console.log(`  ✅ 点开视频（选择器 ${sel} 第 ${i} 个）`); return true; }
                } catch { }
            }
        }
        return false;
    };
    const clicked = await tryClickVideo();
    if (!clicked) console.log('  ⚠️ 没能点开视频节点，继续收集当前页信息');

    console.log('  ⏳ 再等 15 秒，收集播放器发出的请求…');
    await page.waitForTimeout(15000);

    const scan = async (f) => {
        try {
            return await f.evaluate(() => {
                const vids = [...document.querySelectorAll('video')].map(v => ({
                    src: v.currentSrc || v.src || '',
                    sources: [...v.querySelectorAll('source')].map(s => s.src),
                    tracks: [...v.querySelectorAll('track')].map(t => ({ kind: t.kind, src: t.src, lang: t.srclang })),
                    duration: Math.round(v.duration || 0),
                    readyState: v.readyState
                }));
                const players = [...document.querySelectorAll('script')]
                    .map(s => s.src).filter(s => s && /player|video|hls|dplayer|aliplayer|polyv|cyberplayer/i.test(s));
                return { vids, players };
            });
        } catch { return null; }
    };

    const main = await scan(page.mainFrame());
    const iframeResults = [];
    for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const r = await scan(f);
        if (r && (r.vids.length || r.players.length)) iframeResults.push({ frameUrl: f.url(), ...r });
    }

    const result = {
        课程链接: link,
        当前页面: page.url(),
        页面标题: await page.title(),
        "① 媒体地址": [...media],
        "② 字幕地址": [...captions],
        "③ 主页面视频元素": main,
        "④ iframe里的视频": iframeResults,
        "⑤ 接口返回里含视频线索的（最多5条）": jsonHits.slice(0, 5),
        "⑥ 观察到的接口": [...allXhr].slice(0, 25),
        所有frame: page.frames().map(f => f.url()).filter(Boolean)
    };

    try { await page.screenshot({ path: 'probe_video.png' }); result.截图 = 'probe_video.png'; } catch { }
    try {
        const html = await page.content();
        fs.writeFileSync('probe_video.html', html, 'utf8');
        result.页面HTML = 'probe_video.html（' + html.length + ' 字节）';
    } catch { }

    await page.close();
    return result;
}

module.exports = { probeCourse };
