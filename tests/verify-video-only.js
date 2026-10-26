const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { VideoTracker } = require('../utils/video');
const findUnwatchedVideo = VideoTracker.prototype.findUnwatchedVideo;
VideoTracker.prototype.findUnwatchedVideo = async () => false;
const quizzes = require('../utils/quiz');
quizzes.processQuizQuestions = async () => { throw Error('Video-only mode must never process an exam'); };
quizzes.clickQuizTaskIfAvailable = async () => { throw Error('Video-only mode must never open an exam'); };
const { learnCourse } = require('../utils/course');
(async () => {
    process.env.UOOC_VIDEO_ONLY = '1';
    const browser = await chromium.launch({ channel:'msedge', headless:true });
    try {
        const page = await browser.newPage();
        await page.setContent('<li><div class="oneline active">同文件的另一个任务</div><div class="basic uncomplete"><i class="icon-video"></i></div></li><video style="width:300px;height:150px"></video>');
        await page.evaluate(() => Object.defineProperty(document.querySelector('video'),'currentSrc',{get:()=> 'https://test.invalid/same.mp4'}));
        page.waitForTimeout = async () => {};
        const duplicate = new VideoTracker('video-only-offline-test',()=>{});
        duplicate.watched.add('/same.mp4');
        assert.equal(await findUnwatchedVideo.call(duplicate,page), true, 'Unfinished task must replay even when its file was watched');
        await page.evaluate(() => {
            const task = document.querySelector('.basic');
            task.className = 'basic complete';
            task.onclick = () => { throw Error('Completed task must not be clicked'); };
        });
        duplicate.watched.clear();
        assert.equal(await findUnwatchedVideo.call(duplicate,page), false, 'Platform checkmark overrides missing local record');
        await page.setContent('<div class="oneline active">待确认测验</div><div class="oneline">后续视频</div><script>document.querySelectorAll(".oneline").forEach(el=>el.onclick=()=>{document.querySelectorAll(".oneline").forEach(n=>n.classList.remove("active"));el.classList.add("active");});</script>');
        page.waitForTimeout = async () => {};
        const result = await learnCourse(page,'video-only-offline-test',()=>{});
        assert.equal(result.status,'incomplete');
        assert.equal(await page.locator('.oneline.active').innerText(),'后续视频');
        await page.setContent('<div class="active"><div class="oneline">父章节</div><div class="oneline">此前小节</div><div class="oneline active">当前小节</div><div class="oneline">下一小节</div></div><script>document.querySelectorAll(".oneline").forEach(el=>el.onclick=()=>{document.querySelectorAll(".oneline").forEach(n=>n.classList.remove("active"));el.classList.add("active");});</script>');
        const nestedResult = await learnCourse(page,'video-only-offline-test',()=>{});
        assert.equal(nestedResult.status,'incomplete');
        assert.equal(await page.locator('.oneline.active').innerText(),'下一小节');
        console.log('PASS real browser video-only navigation advances past pending exam without opening or submitting any quiz');
    } finally { await browser.close(); delete process.env.UOOC_VIDEO_ONLY; }
})().catch(error => { console.error(error); process.exitCode=1; });
