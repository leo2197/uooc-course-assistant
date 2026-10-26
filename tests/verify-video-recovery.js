const assert = require('node:assert/strict');
const { VideoTracker } = require('../utils/video');
let queue, waits;
const page = {
    waitForTimeout: async () => {},
    evaluate: async () => queue.shift(),
    locator: () => ({ isVisible: async () => false,
        first: () => ({ waitFor: async () => { waits++; } }) })
};
(async () => {
    const tracker = new VideoTracker('isolated-regression-fixture', () => {});
    waits = 0;
    queue = [{ ended: true, reason: 'not_found' }, { ended: true, reason: 'ended' }];
    assert.equal(await tracker.playVideo(page), true);
    assert.equal(waits, 1);
    waits = 0;
    queue = Array.from({ length: 3 }, () => ({ ended: true, reason: 'not_found' }));
    assert.equal(await tracker.playVideo(page), false);
    assert.equal(waits, 2);
    let reloads = 0;
    page.reload = async () => { reloads++; };
    queue = [...Array.from({ length: 41 }, () => ({ ended: false, currentTime: 1, duration: 60 })),
        { ended: true, reason: 'ended' }];
    assert.equal(await tracker.playVideo(page), true);
    assert.equal(reloads, 1);
    queue = Array.from({ length: 123 }, () => ({ ended: false, currentTime: 1, duration: 60 }));
    reloads = 0;
    assert.equal(await tracker.playVideo(page), false);
    assert.equal(reloads, 2);
    console.log('PASS transient video absence recovers; persistent absence stops without completion');
})().catch(e => { console.error(e); process.exitCode = 1; });
