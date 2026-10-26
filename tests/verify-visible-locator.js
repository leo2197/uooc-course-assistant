const assert = require('node:assert/strict');
const { locateInAnyFrame } = require('../utils/browser');
const hidden = { isVisible: async () => false };
const visible = { isVisible: async () => true };
const frame = elements => ({ locator: () => ({ count: async () => elements.length, nth: i => elements[i] }) });
(async () => {
    const page = { ...frame([hidden]), frames: () => [frame([hidden, visible])] };
    assert.equal(await locateInAnyFrame(page, 'button'), visible);
    assert.equal(await locateInAnyFrame({ ...frame([hidden]), frames: () => [frame([hidden])] }, 'button'), null);
    console.log('PASS hidden iframe controls are excluded; later visible match selected');
})().catch(error => { console.error(error); process.exitCode = 1; });
