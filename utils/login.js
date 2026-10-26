const { USERNAME, PASSWORD, COURSE_WHITELIST } = require('./config');
const { launchBrowser, locateInAnyFrame, humanClick, handleCaptcha } = require('./browser');
const { learnCourse } = require('./course');
const { createLogger } = require('./logger');

const MAX_CONCURRENT = 1;

async function run() {
    const { browser, context, page } = await launchBrowser();
    try {

    await require('../web-login.cjs').login(page,{username:PASSWORD?USERNAME:'',password:PASSWORD});

    // 2. 进入「我的课程」页
    // 2.1 点顶部头像（可能展开菜单）
    try {
        const avatar = page.locator('a.layout-header-avatar, #top_avatar');
        await avatar.first().waitFor({ state: 'visible', timeout: 10000 });
        await avatar.first().click();
        console.log('✅ 已点击顶部头像');
    } catch (e) {
        console.log('⚠️ 没找到/点不到顶部头像：' + String(e.message).split('\n')[0]);
        console.log('   当前页面:', page.url());
    }
    await page.waitForTimeout(2000);

    // 2.2 如果弹出了菜单，点「我的课程」这类入口
    for (const w of ['我的课程', '我的学习', '学习中心', '我的空间', '个人中心', '课程中心']) {
        try {
            const item = page.locator(`a:visible:has-text("${w}"), li:visible:has-text("${w}")`).first();
            if (await item.count() > 0) {
                await item.click({ timeout: 3000 });
                console.log(`✅ 点击菜单入口：${w}`);
                await page.waitForTimeout(3000);
                break;
            }
        } catch {}
    }

    // 3. 收集课程链接（多策略，不再只认「继续学习」这一个文案）
    const LEARN_TEXT = ['继续学习', '开始学习', '进入学习', '去学习', '继续观看', '继续上课', '继续播放', '开始上课'];
    async function collectCourses(p) {
        const found = [], seen = new Set();
        const anchors = await p.locator('a[href]').all();
        for (const a of anchors) {
            let href = null, text = '';
            try { href = await a.getAttribute('href'); } catch { continue; }
            if (!href) continue;
            let url;
            try { url = href.startsWith('http') ? href : new URL(href, p.url()).toString(); } catch { continue; }
            const m = url.match(/\/home\/learn(\/new)?\/(\d+)/) || url.match(/\/home\/course\/(\d+)/) || url.match(/\/course\/new\/(\d+)/);
            try { text = (await a.innerText()).replace(/\s+/g, ''); } catch {}
            if (!m && !LEARN_TEXT.some(t => text.includes(t))) continue;
            const id = m ? m[m.length - 1] : '';
            const norm = id ? `http://www.uooc.net.cn/home/course/${id}` : url;
            if (seen.has(norm)) continue;
            seen.add(norm);
            found.push(norm);
        }
        return found;
    }

    let courseLinks = [...new Set([...await collectCourses(page), ...require('./course-urls').parseCourses(process.env.UOOC_MANUAL_COURSES || '')])];
    console.log(`🔎 当前页找到 ${courseLinks.length} 个课程`);

    // 3.1 还是 0 个 → 依次试探常见的「我的课程」地址
    if (courseLinks.length === 0) {
        const CANDS = [
            'https://www.uooc.net.cn/home#/center/course/learn',
            'https://www.uooc.net.cn/home/learn',
            'https://www.uooc.net.cn/home/myCourse',
            'https://www.uooc.net.cn/my/course',
            'https://www.uooc.net.cn/ucenter/course',
            'https://www.uooc.net.cn/home/student/course'
        ];
        for (const u of CANDS) {
            try {
                console.log(`   试探 ${u} ...`);
                await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForTimeout(3000);
                const got = await collectCourses(page);
                if (got.length) { console.log(`✅ ${u} 找到 ${got.length} 个课程`); courseLinks = got; break; }
                console.log('   ✗ 该地址没有课程');
            } catch { console.log('   ✗ 打不开'); }
        }
    }

    courseLinks.forEach((u, i) => console.log(`   📌 课程 ${i + 1}: ${u}`));

    if (courseLinks.length === 0 && COURSE_WHITELIST.length === 0) {
        console.log('⚠️ 仍然没找到课程，输出诊断信息：');
        try {
            console.log('   当前页面:', page.url());
            console.log('   页面标题:', await page.title());
            const texts = await page.locator('a:visible').allInnerTexts();
            const uniq = [...new Set(texts.map(t => (t || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
            console.log(`   页面上可见的链接文字(${uniq.length} 个，取前 40):`);
            console.log('     ' + uniq.slice(0, 40).join(' | '));
            await page.screenshot({ path: 'debug_nocourse.png' });
            console.log('   已保存截图: debug_nocourse.png');
            console.log('   👉 可按脚本窗口提示补录课程网址；排查时请保留日志和截图');
        } catch (e) { console.log('   诊断失败:', e.message); }
        process.exitCode = 2;
        return;
    }

    // 3.2 课程白名单：只刷 COURSE_WHITELIST 里列出的课（留空 = 不限制，刷全部）
    if (COURSE_WHITELIST.length) {
        if (!courseLinks.some(link => COURSE_WHITELIST.includes(link.match(/\/course\/(\d+)/)?.[1]))) {
            // 登录后的重定向可能停在联盟公开课程页，直接检查指定课程入口。
            const verified = [];
            for (const id of COURSE_WHITELIST) {
                const link = `http://www.uooc.net.cn/home/course/${id}`;
                try {
                    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await page.locator('a.btn.btn-danger:has-text("开始学习"), a.btn.btn-danger:has-text("继续学习")')
                        .first().waitFor({ state: 'visible', timeout: 10000 });
                    verified.push(link);
                } catch { console.log(`指定课程 ${id} 暂不可进入`); }
            }
            courseLinks = verified;
        }
        const before = courseLinks.length;
        courseLinks = courseLinks.filter(link => {
            const id = link.match(/\/course\/(\d+)/)?.[1] || '';
            return COURSE_WHITELIST.includes(id);
        });
        console.log(`🎯 课程白名单 [${COURSE_WHITELIST.join(', ')}] → 匹配到 ${courseLinks.length}/${before} 门课`);
        courseLinks.forEach((u, i) => console.log(`   ✅ 要刷的第 ${i + 1} 门: ${u}`));
        if (courseLinks.length === 0) {
            console.log('⚠️ 白名单里的课程一个都没找到，退出（检查课程ID是否正确）');
            await browser.close();
            process.exitCode = 2;
            return;
        }
    } else {
        console.log(process.env.UOOC_AUTO_UNFINISHED === '1' ? 'ℹ️ 自动扫描课程状态，只选择未完成的视频和测验' : 'ℹ️ 未设置 COURSE_WHITELIST → 会处理全部课程');
    }

    if (process.env.UOOC_AUTO_UNFINISHED === '1') {
        const selection = await require('./course-selection').selectUnfinished(context, courseLinks, require('path').join(require('./config').DATA_DIR, 'course-selection'));
        courseLinks = selection.selected;
        if (selection.results.some(r => ['unknown','manual'].includes(r.status))) process.exitCode = 2;
        console.log('自动识别：选择 ' + courseLinks.length + ' 门未完成课程');
        if (process.env.UOOC_SELECT_ONLY === '1' || !courseLinks.length) {
            if (selection.results.some(r => ['unknown','manual'].includes(r.status))) process.exitCode = 2;
            console.log('课程状态清单已保存；没有打开测验或执行提交。');
            return;
        }
    }
    if(process.env.UOOC_PICK_COURSES==='1'&&courseLinks.length){courseLinks=await require('../course-picker.cjs').select(context,courseLinks);}
    if (process.env.UOOC_GRADE_WATCH_PID) {
        await require('./grade-watch').watchGrades(context, Number(process.env.UOOC_GRADE_WATCH_PID), COURSE_WHITELIST,
            process.env.UOOC_GRADE_WATCH_DIR || require('path').join(__dirname, '../grade-evidence'));
        return;
    }
    if (process.env.UOOC_INSPECT_EXAM) {
        const match = process.env.UOOC_INSPECT_EXAM.match(/^(\d+):(\d+)$/);
        if (!match || !COURSE_WHITELIST.includes(match[1])) throw new Error('查看测验入口不属于目标课程');
        const inspectPage = await context.newPage();
        await inspectPage.goto(`http://www.uooc.net.cn/exam/${match[2]}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
        await inspectPage.waitForTimeout(5000);
        const fs = require('fs'), path = require('path');
        const directory = process.env.UOOC_INSPECT_DIR || path.join(__dirname, '../inspection');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, `exam-${match[2]}.txt`), await inspectPage.locator('body').innerText(), 'utf8');
        await inspectPage.screenshot({ path: path.join(directory, `exam-${match[2]}.png`), fullPage: true });
        await inspectPage.bringToFront();
        console.log('测验已打开，仅查看，未填写或点击任何测验按钮；关闭窗口后退出。');
        await new Promise(resolve => browser.once('disconnected', resolve));
        return;
    }
    if (process.env.UOOC_AUDIT === '1') {
        const { auditCourses } = require('./audit');
        const path = require('path');
        const outputDir = process.env.UOOC_AUDIT_DIR || path.join(__dirname, '..', 'audit');
        try {
            console.log(JSON.stringify(await auditCourses(context, courseLinks, outputDir), null, 2));
        } finally {
            await browser.close();
        }
        return;
    }

    if (process.env.UOOC_EXAM_ONLY) {
        const match = process.env.UOOC_EXAM_ONLY.match(/^(\d+):(\d+)$/);
        if (!match || !COURSE_WHITELIST.includes(match[1])) throw new Error('单测验入口不属于目标课程');
        const examPage = await context.newPage();
        try {
            await examPage.goto(`http://www.uooc.net.cn/exam/${match[2]}`, { waitUntil:'domcontentloaded', timeout:40000 });
            const result = await require('./quiz').processQuizQuestions(examPage, console.log, match[1]);
            console.log('单测验结果：' + JSON.stringify(result));
            if (result.status !== 'submitted') process.exitCode = 2;
        } finally { await examPage.close(); }
        await require('./audit').auditCourses(context, courseLinks, process.env.UOOC_AUDIT_DIR || require('path').join(__dirname, '../audit'));
        return;
    }
    // 📥 字幕收集模式：把课程视频的字幕全部抓下来（UOOC_COLLECT=1 触发，不依赖刷课）
    if (process.env.UOOC_COLLECT === '1') {
        const { collectCourse } = require('./collect');
        const one = process.env.UOOC_PROBE_INDEX;
        const targets = (one === undefined || one === '')
            ? courseLinks
            : [courseLinks[parseInt(one, 10)] || courseLinks[0]];
        console.log(`\n📥 字幕收集模式：共 ${targets.length} 门课\n`);
        for (const link of targets) {
            console.log('\n===== 收集: ' + link + ' =====');
            try {
                const r = await collectCourse(context, link, console.log);
                console.log('📊 结果: ' + JSON.stringify(r, null, 2));
            } catch (e) {
                console.log('⚠️ 这门口收集失败: ' + String(e.message).split('\n')[0]);
            }
        }
        await browser.close();
        return;
    }

    // 🔬 开发调研模式：只打开第一门课，抓视频/字幕地址后退出（UOOC_PROBE=1 触发）
    if (process.env.UOOC_PROBE === '1') {
        const { probeCourse } = require('./probe');
        const pIdx = parseInt(process.env.UOOC_PROBE_INDEX || '0', 10) || 0;
        console.log(`\n🔬 探测模式：打开第 ${pIdx + 1} 门课（${courseLinks[pIdx] || courseLinks[0]}），抓视频/字幕地址\n`);
        const r = await probeCourse(context, courseLinks[pIdx] || courseLinks[0]);
        console.log('\n===== 探测结果 =====');
        console.log(JSON.stringify(r, null, 2));
        console.log('===== 探测结束 =====\n');
        await browser.close();
        return;
    }

    if (process.env.UOOC_LIST_ONLY === '1') {
        console.log('课程列表核对完成，未启动学习');
        await browser.close();
        return;
    }

    // 4. 并行学习课程（最多同时 MAX_CONCURRENT 个）
    console.log(`\n🚀 开始并行学习，最大并发: ${MAX_CONCURRENT}\n`);

    // 用于并发控制的任务处理器
    const runResults = [];
    async function processCourse(link, index) {
        const courseId = link.match(/\/course\/(\d+)/)?.[1] || '';
        const tag = `[课程${index + 1}/${courseLinks.length}:${courseId}]`;
        const log = createLogger(tag, index);

        // 每个课程开一个新 tab（共享登录 session）
        const coursePage = await context.newPage();

        try {
            log('📖 打开课程页...');
            const MAX_GOTO_RETRIES = 3;
            let gotoOk = false;
            for (let attempt = 1; attempt <= MAX_GOTO_RETRIES; attempt++) {
                try {
                    await coursePage.goto(link, { timeout: 30000 });
                    gotoOk = true;
                    break;
                } catch (e) {
                    if (attempt < MAX_GOTO_RETRIES) {
                        log(`⚠️ 页面加载超时，刷新重试 (${attempt}/${MAX_GOTO_RETRIES - 1})...`);
                        try { await coursePage.reload({ timeout: 30000 }); gotoOk = true; break; } catch {}
                    } else {
                        throw e;
                    }
                }
            }
            await coursePage.waitForTimeout(3000);

            const learnBtn = coursePage.locator('a.btn.btn-danger:has-text("开始学习"), a.btn.btn-danger:has-text("继续学习")');
            await learnBtn.first().waitFor({ state: 'visible', timeout: 5000 });
            await learnBtn.first().click();
            log('✅ 进入学习');

            const result = await learnCourse(coursePage, courseId, log);
            runResults.push({ courseId, ...result });
            log(`📋 学习结果: ${JSON.stringify(result)}`);
        } catch (e) {
            runResults.push({ courseId, status: 'failed', reason: e.message });
            log(`⚠️ 跳过: ${e.message}`);
        } finally {
            await coursePage.close();
        }
    }

    // 并发池：最多同时跑 MAX_CONCURRENT 个任务
    const pending = new Set();
    const queue = courseLinks.map((link, i) => () => processCourse(link, i));

    for (const task of queue) {
        if (pending.size >= MAX_CONCURRENT) {
            // 等待任意一个完成
            await Promise.race(pending);
        }
        const p = task().then(
            () => pending.delete(p),
            () => pending.delete(p)
        );
        pending.add(p);
    }

    // 等待剩余任务全部完成
    await Promise.all(pending);

    console.log('\n📋 所有课程处理结束，完成状态以平台记录为准');
    try {
        const fs = require('fs'), path = require('path');
        const { DATA_DIR } = require('./config');
        const auditDir = path.join(DATA_DIR, 'latest-audit');
        const audit = await require('./audit').auditCourses(context, courseLinks, auditDir);
        fs.writeFileSync(path.join(DATA_DIR, 'latest-run.json'), JSON.stringify({
            finishedAt: new Date().toISOString(), results: runResults, audit
        }, null, 2), 'utf8');
        if (runResults.some(r => ['blocked', 'failed', 'incomplete'].includes(r.status))) process.exitCode = 2;
        console.log(`运行结果与平台证据已保存: ${auditDir}`);
    } finally {
        await browser.close();
    }
    } finally { await browser.close().catch(() => {}); }
}

module.exports = { run };
