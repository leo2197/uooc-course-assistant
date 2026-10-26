// utils/collect.js —— 主动收集一门课的全部视频字幕（不依赖刷课流程）
// 用法：UOOC_COLLECT=1 node start.js                     → 白名单里所有课程
//       UOOC_COLLECT=1 UOOC_PROBE_INDEX=1 node start.js   → 只收集第 2 门
//
// 要点：光点 .oneline 只是切章节，必须再点开该节点下的「视频」资源，播放器才会加载并请求 .srt
const fs = require('fs');
const subs = require('./subtitles');

// 当前播放器加载的视频地址（用来判断"换视频了"）
async function currentVideoSrc(page) {
    try {
        return await page.evaluate(() => {
            const v = document.querySelector('video');
            return v ? (v.currentSrc || v.src || '') : '';
        });
    } catch { return ''; }
}

// 点开「视频」资源（多种写法都试）
async function openVideoResource(page, log) {
    // 已经有播放器在加载视频了就直接返回（这一步能省掉大量无用点击）
    if (await currentVideoSrc(page)) return true;
    for (const sel of ['.oneline:has-text("视频")', 'text=视频']) {
        let loc;
        try { loc = page.locator(sel); } catch { continue; }
        const n = await loc.count().catch(() => 0);
        if (!n) continue;
        for (let i = 0; i < Math.min(n, 2); i++) {
            try {
                await loc.nth(i).click({ timeout: 1500 });
                await page.waitForTimeout(2000);
                if (await currentVideoSrc(page)) return true;
            } catch { }
        }
    }
    return false;
}

function countSubs(courseId) {
    try {
        return fs.readdirSync(subs.dirOf(courseId)).filter(f => f.endsWith('.txt')).length;
    } catch { return 0; }
}

async function collectCourse(context, link, log = console.log) {
    const courseId = (link.match(/\/course\/(\d+)/) || [])[1] || 'unknown';
    const page = await context.newPage();

    subs.attachCollector(page, courseId, log);          // 监听 .srt 并落盘

    const mediaUrls = new Set();
    page.on('request', r => {
        const u = r.url();
        if (/\.(mp4|m3u8)(\?|#|$)/i.test(u)) mediaUrls.add(u);
    });

    log(`📖 打开课程 ${courseId}`);
    await page.goto(link, { timeout: 40000 });
    await page.waitForTimeout(3500);

    try {
        const btn = page.locator('a.btn.btn-danger:has-text("开始学习"), a.btn.btn-danger:has-text("继续学习")');
        if (await btn.count() > 0) { await btn.first().click(); log('   ✅ 进入学习页'); }
    } catch { }
    await page.waitForTimeout(5000);

    // 展开折叠的章节（有些子树是收起的，不展开点不到里面的视频）
    for (let round = 0; round < 4; round++) {
        const arrows = page.locator('.oneline .icon-arrow, .oneline i[class*=arrow], .basic .icon-arrow');
        const n = await arrows.count().catch(() => 0);
        if (!n) break;
        let clickedAny = false;
        for (let i = 0; i < n; i++) {
            try { await arrows.nth(i).click({ timeout: 900 }); clickedAny = true; await page.waitForTimeout(200); } catch { }
        }
        if (!clickedAny) break;
        await page.waitForTimeout(1200);
    }

    const total0 = await page.locator('.oneline').count().catch(() => 0);
    log(`   📚 初始目录节点 ${total0} 个，动态遍历（展开新的会继续点）…`);

    const seenSrc = new Set();
    const visited = new Set();
    let clicked = 0, played = 0;
    const before = countSubs(courseId);

    // 动态遍历：每轮重新查询节点（点开章节后子节点才会出现），用文本去重
    // ⚠️ 轮数不能太少：章节是一层一层展开的，轮数不够会点不到深层节点
    //    （实测把 12 降到 5 后，导论只覆盖 8/22 个节点、新增字幕 0）
    let idleRounds = 0;
    for (let round = 0; round < 20; round++) {
        const nodes = page.locator('.oneline');
        const n = await nodes.count().catch(() => 0);
        let progressed = false;

        for (let i = 0; i < n; i++) {
            let text = '';
            try { text = (await nodes.nth(i).innerText().catch(() => '')).replace(/\s+/g, '').slice(0, 40); } catch { }
            if (!text || visited.has(text)) continue;

            try {
                await nodes.nth(i).scrollIntoViewIfNeeded().catch(() => { });
                await nodes.nth(i).click({ timeout: 2000 });
                visited.add(text);
                clicked++;
                progressed = true;
                await page.waitForTimeout(1500);

                // 点开该节点下的「视频」资源
                await openVideoResource(page, log);

                const src = await currentVideoSrc(page);
                if (src) {
                    played++;
                    if (!seenSrc.has(src)) {
                        seenSrc.add(src);
                        await page.waitForTimeout(6000);   // 让播放器把 .srt 请求发出来
                    }
                }
            } catch { }
        }
        // 连续两轮都没有新节点才收工（展开可能有延迟）
        if (!progressed) { idleRounds++; if (idleRounds >= 2) break; }
        else idleRounds = 0;
    }

    // 兜底：对出现过的视频，用「猜地址」再试一遍
    let guessed = 0;
    for (const u of mediaUrls) {
        try {
            const pathname = new URL(u).pathname;
            const r = await subs.downloadByGuess(pathname);
            if (r) {
                const name = decodeURIComponent(pathname.split('/').pop().replace(/\.mp4$/i, ''));
                subs.save(courseId, name, r.text);
                guessed++;
                log('   💬 补下字幕: ' + name.slice(0, 40));
            }
        } catch { }
    }

    const after = countSubs(courseId);
    await page.close();
    return {
        courseId,
        目录节点: total0,
        已点开: clicked,
        播放器加载过: played,
        出现过的视频数: seenSrc.size,
        本次新增字幕: after - before,
        字幕文件总数: after,
        猜地址补下: guessed
    };
}

module.exports = { collectCourse };
