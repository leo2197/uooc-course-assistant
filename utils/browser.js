const { chromium } = require('playwright');

async function launchBrowser() {
 const path=require('path'),{USERNAME}=require('./config');
 const dnsRules=await require('./network').browserDnsRule();
 const context=await chromium.launchPersistentContext(path.join(__dirname,'..','profiles',USERNAME),{
  channel:'msedge',headless:false,viewport:{width:1440,height:1000},
  args:[...dnsRules,'--mute-audio','--disable-renderer-backgrounding','--disable-background-timer-throttling']
 });
 return {browser:context.browser(),context,page:context.pages()[0]||await context.newPage()};
}

// 在主页面或任意 iframe 中查找可见元素
async function locateInAnyFrame(page, selector) {
    for (const frame of [page, ...page.frames()]) {
        try {
            const matches = frame.locator(selector);
            for (let i = 0; i < await matches.count(); i++) {
                const candidate = matches.nth(i);
                if (await candidate.isVisible().catch(() => false)) return candidate;
            }
        } catch {}
    }
    return null;
}

// 模拟人类鼠标点击
async function humanClick(page, element) {
    const box = await element.boundingBox();
    if (!box) {
        await element.click({ timeout: 5000, force: true });
        return;
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // 随机偏移钳制在元素尺寸 1/4 以内，避免移出元素边界触发 mouseleave
    const maxDx = Math.min(5, box.width / 4);
    const maxDy = Math.min(5, box.height / 4);
    await page.mouse.move(x + (Math.random() * 2 - 1) * maxDx, y + (Math.random() * 2 - 1) * maxDy, { steps: 5 });
    await page.waitForTimeout(100 + Math.random() * 200);
    await page.mouse.click(x, y);
}

// 通用阿里云验证码处理
// locateFn: (selector) => Promise<Locator|null>
// checkEnabledFn: () => Promise<boolean> — 检查目标按钮是否已启用
async function handleCaptcha(page, locateFn, checkEnabledFn, maxRetries = 10, log) {
 const write=log||console.log;let announced=false;
 while(!page.isClosed()){
  if(await checkEnabledFn())return true;
  if(!announced){write('\x07请在网页本人完成安全验证，完成后自动继续。');announced=true;}
  await page.waitForTimeout(1000);
 }
 throw Error('浏览器关闭，安全验证尚未完成');
}

module.exports = { launchBrowser, locateInAnyFrame, humanClick, handleCaptcha };
