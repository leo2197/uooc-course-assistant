const states = new WeakMap();
const bindings = new WeakSet();
function fence() {
    if (document.__uoocNavigationFence) return;
    document.__uoocNavigationFence = true;
    window.__uoocNavigationPaused = false;
    window.__uoocGuardSignal('state').then(paused => { window.__uoocNavigationPaused = paused; }).catch(() => {});
    document.addEventListener('click', event => {
        if (window.__uoocNavigationPaused) return;
        const target = event.target?.closest?.('.oneline,.basic,a[href]');
        if (!target) return;
        if (!target.matches('.oneline,.basic') && /^(?:javascript:|#?$)/i.test(target.getAttribute('href') || '')) return;
        if (event.isTrusted) {
            event.preventDefault(); event.stopImmediatePropagation();
            window.__uoocGuardSignal('blocked').catch(() => {});
        } else {
            window.__uoocGuardSignal('intent').catch(() => {});
        }
    }, true);
}
async function install(page, courseId, log, { allowedURL } = {}) {
    if (states.has(page)) return states.get(page);
    let initial = page.url();
    const allowed = allowedURL || (url => {
        try { const u = new URL(url); return /^(www\.)?uooc\.net\.cn$/.test(u.hostname) && /\/home\/learn\//.test(u.pathname) && new RegExp('(?:/|#|=)' + courseId + '(?:/|$|[?&#])').test(u.pathname + u.search + u.hash); }
        catch { return false; }
    });
    if (/^https?:\/\/(?:www\.)?uooc\.net\.cn\//.test(initial) && !allowed(initial)) {
        await page.waitForURL(url => allowed(url.href), { timeout: 20000 });
        initial = page.url();
    }
    const state = { expected: initial, revision: 0, paused: false, intentUntil: 0, pending: null, failed: null, video: null, recoveries: [], lastNotice: 0 };
    states.set(page, state);
    state.restore = async () => {
        if (state.paused || page.isClosed()) return;
        if (state.pending) return state.pending;
        state.revision++;
        const now = Date.now(); state.recoveries = state.recoveries.filter(t => now - t < 60000);
        if (state.recoveries.length >= 3) { state.failed = Error('页面一分钟内反复离开学习流程，请检查登录或网站状态'); log('🔔 ' + state.failed.message); return; }
        state.recoveries.push(now);
        log('↩️ 检测到离开自动学习页面，正在返回当前任务…');
        state.pending = (async () => {
            try {
                await page.goto(state.expected, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // Only restore playback time that was actually observed on this same asset.
                if (state.video) {
                    await page.locator('video').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
                    await page.evaluate(saved => {
                        const v = document.querySelector('video');
                        if (!v || (v.currentSrc || v.src) !== saved.src || v.ended || !(v.duration > saved.time)) return;
                        v.currentTime = saved.time; v.muted = true; v.playbackRate = 2; v.play().catch(() => {});
                    }, state.video);
                }
                log('✅ 已返回当前学习任务，继续自动流程');
            } catch (error) { state.failed = Error('页面恢复失败：' + error.message); log('🔔 ' + state.failed.message); }
            finally { state.pending = null; }
        })();
        return state.pending;
    };
    if (!bindings.has(page)) await page.exposeBinding('__uoocGuardSignal', (_source, action) => {
        const state = states.get(page);
        if (!state) return true;
        if (action === 'state') return state.paused;
        if (state.paused) return;
        if (action === 'intent') state.intentUntil = Date.now() + 3000;
        if (action === 'blocked' && Date.now() - state.lastNotice > 2000) { state.lastNotice = Date.now(); log('↩️ 已拦住误点跳转，保持当前任务；需要手动操作请先选择“接管”。'); }
    });
    bindings.add(page);
    await page.addInitScript(fence);
    for (const frame of page.frames()) await frame.evaluate(fence).catch(() => {});
    state.navigated = frame => {
        if (frame !== page.mainFrame() || state.paused || state.pending || state.failed) return;
        const url = page.url();
        if (url === state.expected) return;
        if (Date.now() < state.intentUntil && allowed(url)) { state.expected = url; state.video = null; state.intentUntil = 0; return; }
        void state.restore();
    };
    page.on('framenavigated', state.navigated);
    let sampling = false;
    state.timer = setInterval(async () => {
        if (state.paused || state.pending || state.failed || sampling || page.isClosed()) return;
        if (page.url() !== state.expected) { state.navigated(page.mainFrame()); return; }
        sampling = true;
        try { state.video = await page.evaluate(() => { const v = document.querySelector('video'); return v && !v.ended ? { src: v.currentSrc || v.src, time: v.currentTime } : null; }); } catch {}
        finally { sampling = false; }
    }, 1000);
    state.timer.unref?.();
    page.once('close', () => dispose(page));
    return state;
}
async function ensure(page) {
    const s = states.get(page); if (!s) return;
    if (!s.paused && page.url() !== s.expected && !s.pending) await s.restore();
    if (s.pending) await s.pending;
    if (s.failed) throw s.failed;
}
async function pause(page) {
    const s = states.get(page); if (!s) return;
    await ensure(page); s.paused = true;
    for (const frame of page.frames()) await frame.evaluate(() => { window.__uoocNavigationPaused = true; }).catch(() => {});
}
async function resume(page) {
    const s = states.get(page); if (!s) return;
    s.paused = false;
    await ensure(page);
    for (const frame of page.frames()) await frame.evaluate(() => { window.__uoocNavigationPaused = false; }).catch(() => {});
}
function revision(page) { return states.get(page)?.revision || 0; }
function dispose(page) { const s = states.get(page); if (!s) return; clearInterval(s.timer); page.off('framenavigated', s.navigated); states.delete(page); }
module.exports = { install, ensure, pause, resume, revision, dispose };
