const fs = require('fs');
const path = require('path');
function statusProjection(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5) return undefined;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (/token|password|secret|cookie|authorization|phone|email/i.test(key)) continue;
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            const nested = statusProjection(item, depth + 1);
            if (nested && Object.keys(nested).length) output[key] = nested;
        } else if (/status|state|score|attempt|submit|remain|limit|finish|complete|passed|chance|examId/i.test(key)
            && ['string','number','boolean'].includes(typeof item) && String(item).length < 160) output[key] = item;
    }
    return output;
}

// Read course overviews only. Completion must be reviewed against platform tasks.
async function auditCourses(context, links, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    const results = [];
    for (const link of links) {
        const courseId = link.match(/\/course\/(\d+)/)?.[1];
        if (!courseId) throw new Error('无法识别课程 ID');
        const page = await context.newPage();
        try {
            await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 40000 });
            await page.waitForTimeout(5000);
            const text = await page.locator('body').innerText();
            const screenshot = path.join(outputDir, `course-${courseId}.png`);
            await page.screenshot({ path: screenshot, fullPage: true });
            fs.writeFileSync(path.join(outputDir, `course-${courseId}.txt`), text, 'utf8');
            results.push({ courseId, url: page.url(), capturedAt: new Date().toISOString(),
                title: await page.title(), screenshot, status: 'requires_review',
                reason: '课程主页证据已保存，须核对任务和完成状态' });
            const attemptDir = path.join(require('./config').DATA_DIR, 'submission-attempts');
            if (fs.existsSync(attemptDir)) {
                const reviews = [];
                for (const filename of fs.readdirSync(attemptDir)) {
                    const match = filename.match(/^(\d+)-(\d+)\.json$/);
                    if (!match || match[1] !== courseId) continue;
                    const examPage = await context.newPage();
                    const networkStates = [], pendingResponses = [];
                    examPage.on('response', response => {
                        if (!/json/i.test(response.headers()['content-type'] || '')) return;
                        pendingResponses.push((async () => {
                            const projected = statusProjection(await response.json());
                            if (projected && Object.keys(projected).length) networkStates.push({ endpoint: new URL(response.url()).pathname, status: projected });
                        })().catch(() => {}));
                    });
                    try {
                        // Read evidence only. Never click any exam or confirmation control.
                        await examPage.goto(`http://www.uooc.net.cn/exam/${match[2]}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
                        await examPage.waitForTimeout(3000);
                        const prefix = path.join(outputDir, `exam-${courseId}-${match[2]}`);
                        fs.writeFileSync(prefix + '.txt', await examPage.locator('body').innerText(), 'utf8');
                        await examPage.screenshot({ path: prefix + '.png', fullPage: true });
                        await Promise.allSettled(pendingResponses);
                        fs.writeFileSync(prefix + '-state.json', JSON.stringify(networkStates, null, 2), 'utf8');
                        reviews.push({ examId: match[2], url: examPage.url(), evidence: prefix + '.txt', status: 'requires_review' });
                    } catch (error) { reviews.push({ examId: match[2], status: 'audit_failed', reason: error.message }); }
                    finally { await examPage.close(); }
                }
                results[results.length - 1].attemptReviews = reviews;
            }
        } catch (error) {
            results.push({ courseId, status: 'audit_failed', reason: error.message });
        } finally {
            await page.close();
        }
    }
    fs.writeFileSync(path.join(outputDir, 'audit.json'), JSON.stringify(results, null, 2), 'utf8');
    return results;
}

module.exports = { auditCourses };
