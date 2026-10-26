const dns = require('node:dns');
const { Resolver } = dns.promises;
const resolver = new Resolver({ timeout: 3000, tries: 1 });
resolver.setServers([process.env.UOOC_DNS_FALLBACK || '223.5.5.5']);
const originalLookup = dns.lookup.bind(dns);
const cache = new Map();
async function fallbackAddresses(host) {
    const cached = cache.get(host);
    if (cached && cached.until > Date.now()) return cached.addresses;
    const addresses = await resolver.resolve4(host);
    if (!addresses.length) throw new Error('备用DNS未返回地址');
    cache.set(host, { addresses, until: Date.now() + 60000 });
    return addresses;
}
function installDnsFallback(allowedHosts) {
    dns.lookup = (host, options, callback) => {
        if (typeof options === 'function') { callback = options; options = {}; }
        originalLookup(host, options, async (error, address, family) => {
            if (!error || !allowedHosts.includes(host)
                || !['ENOTFOUND', 'EAI_AGAIN', 'ETIMEOUT'].includes(error.code)) {
                callback(error, address, family); return;
            }
            try {
                const addresses = await fallbackAddresses(host);
                if (options?.all) callback(null, addresses.map(address => ({ address, family: 4 })));
                else callback(null, addresses[0], 4);
            } catch { callback(error); }
        });
    };
}
async function browserDnsRule() {
    try {
        await new Promise((resolve, reject) => originalLookup('www.uooc.net.cn', error => error ? reject(error) : resolve()));
        return [];
    } catch {
        const addresses = await fallbackAddresses('www.uooc.net.cn');
        return [`--host-resolver-rules=MAP www.uooc.net.cn ${addresses[0]}`];
    }
}
module.exports = { installDnsFallback, browserDnsRule };
