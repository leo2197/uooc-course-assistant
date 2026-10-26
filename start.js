const { API_BASE_URL } = require('./utils/config');
require('./utils/network').installDnsFallback(['www.uooc.net.cn', new URL(API_BASE_URL).hostname]);
const { run } = require('./utils/login');
run().catch(error => {
    console.error('运行失败:', error.message);
    process.exitCode = 1;
});
