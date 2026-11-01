// 整合版冒烟测试: IPF 地区筛选路由 + edgetunnel 原有路由不被劫持。
// 离线运行 (mock 上游数据源与 edgetunnel 的外部抓取), npm test 即可。
// 注: Node 的 WebCrypto 不支持 MD5 (Cloudflare Workers 支持), 本地测试需打补丁, 仅测试文件内生效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const origDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
globalThis.crypto.subtle.digest = async (algo, data) => {
    const name = typeof algo === 'string' ? algo : algo.name;
    if (String(name).toUpperCase() === 'MD5') {
        const h = createHash('md5');
        h.update(Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data));
        const d = h.digest();
        return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    }
    return origDigest(algo, data);
};

const FIXTURE = [
    '1.1.1.1:443#JP',
    '1.1.1.2:8443#JP',
    '2.2.2.1:443#US',
    '2.2.2.2:2053#US',
    '3.3.3.1:443#Unknown',
    '4.4.4.1:443#DE',
].join('\n');

globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://zip.cm.edu.kg/all.txt') {
        return new Response(FIXTURE, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response('<!DOCTYPE html><title>dummy-home</title>', { status: 200, headers: { 'content-type': 'text/html' } });
};

const worker = (await import(new URL('../_worker.js', import.meta.url))).default;
const env = { ADMIN: 'test-admin-pass', UUID: '11111111-2222-4333-8444-555555555555' };

async function call(url) {
    const req = new Request(url);
    Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const res = await worker.fetch(req, env, { waitUntil() {} });
    return { status: res.status, body: await res.text() };
}

test('/ips/<地区> 原生路径 (line 格式, limit 生效)', async () => {
    const { status, body } = await call('https://x.test/ips/JP?limit=1');
    assert.equal(status, 200);
    assert.match(body, /^1\.1\.1\.\d+:(443|8443)#🇯🇵 日本 /);
});

test('/CFnew/<地区> 兼容旧链接 (cf_line_short 格式)', async () => {
    const { body } = await call('https://x.test/CFnew/JP');
    assert.equal(body, '1.1.1.1:443#🇯🇵 日本¹\n1.1.1.2:8443#🇯🇵 日本²');
});

test('/edgetunnel/<地区> 兼容旧链接, 多地区 limit', async () => {
    const { body } = await call('https://x.test/edgetunnel/JP-US?limit=1');
    assert.equal(body.split('\n').length, 2);
});

test('?get_regions=1 不含 Unknown 误读的假地区', async () => {
    const { body } = await call('https://x.test/?get_regions=1');
    assert.deepEqual(JSON.parse(body), ['JP', 'US', 'DE']);
});

test('?api=1 参数式接口与 base64', async () => {
    const plain = await call('https://x.test/?api=1&region=DE&format=cf_line');
    assert.equal(plain.body, '4.4.4.1:443#🇩🇪 德国¹-443');
    const encoded = await call('https://x.test/ips/JP?base64=1&limit=1');
    assert.ok(Buffer.from(encoded.body, 'base64').toString('utf8').includes('#🇯🇵 日本'));
});

test('/ips-ui 筛选界面可访问', async () => {
    const { status, body } = await call('https://x.test/ips-ui');
    assert.equal(status, 200);
    assert.ok(body.includes('regionGrid'));
});

test('edgetunnel 原有路由不被 IPF 劫持', async () => {
    for (const path of ['/version', '/login', '/', '/admin']) {
        const { status, body } = await call('https://x.test' + path);
        assert.equal(status, 200, path);
        assert.ok(!body.includes('regionGrid'), path + ' 不应返回 IPF 界面');
    }
});

// --- 整合核心: ipf:// 进程内展开 + 配置缓存 -----------------------------------
function md5md5(text) {
    const first = createHash('md5').update(text).digest('hex');
    return createHash('md5').update(first.slice(7, 27)).digest('hex');
}

test('订阅经 ipf:// 条目进程内生成 (整合闭环) 且 config.json 只读 KV 一次', async () => {
    const testUuid = '11111111-2222-4333-8444-555555555555';
    const configFixture = {
        协议类型: 'vless', 传输协议: 'ws',
        优选订阅生成: {
            local: true,
            本地IP库: { 随机IP: false, 随机数量: 16, 指定端口: -1 },
            SUB: null, SUBNAME: 'edgetunnel', SUBUpdateTime: 3,
        },
        订阅转换配置: {
            SUBAPI: '', SUBCONFIG: 'https://config.example.invalid/x.ini',
            SUBEMOJI: false, SUBLIST: false, UDP: false, XUDP: false, TLS13: false,
            APPEND_TYPE: false, SORT: false, EXPAND: true,
        },
        CF: { Usage: { success: false, pages: 0, workers: 0, total: 0, max: 100000 } },
        反代: { PROXYIP: 'auto', SOCKS5: { 启用: null, 全局: false, 账号: '', 白名单: [] } },
        TG: { 启用: false, BotToken: null, ChatID: null },
    };
    const getCounts = {};
    const kvStore = {
        'config.json': JSON.stringify(configFixture),
        'ADD.txt': 'ipf://JP-US?limit=1',
    };
    const env2 = {
        ADMIN: 'test-admin-pass', UUID: testUuid,
        KV: {
            async get(k) { getCounts[k] = (getCounts[k] || 0) + 1; return kvStore[k] ?? null; },
            async put(k, v) { kvStore[k] = v; },
        },
    };
    const token = md5md5('x.test' + testUuid);
    async function callSub() {
        const req = new Request(`https://x.test/sub?token=${token}`, { headers: { 'User-Agent': 'subconverter' } });
        Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
        const res = await worker.fetch(req, env2, { waitUntil() {} });
        let body = await res.text();
        if (!body.startsWith('vless://')) {
            try { body = Buffer.from(body, 'base64').toString('utf8'); } catch { /* keep raw */ }
        }
        return body;
    }
    const first = await callSub();
    const links = first.split('\n').filter(l => l.startsWith('vless://'));
    assert.equal(links.length, 2, 'JP 与 US 各展开 1 条');
    assert.ok(links.some(l => l.includes('@1.1.1.')), '含 JP 筛选池地址');
    assert.ok(links.some(l => l.includes('@2.2.2.')), '含 US 筛选池地址');
    assert.ok(decodeURIComponent(first).includes('日本'), '节点备注带国家名');
    const second = await callSub();
    assert.ok(second.includes('vless://'));
    assert.equal(getCounts['config.json'], 1, '30 秒内第二次请求应命中配置缓存');
    assert.equal(getCounts['ADD.txt'], 2, 'ADD.txt 不缓存, 每次订阅都读');
});

// 与上一个用例共用同一份 config 语义 (随机IP 关), 只换 ADD.txt 内容。
async function callSubWithAdd(addText) {
    const testUuid = '11111111-2222-4333-8444-555555555555';
    const configFixture = {
        协议类型: 'vless', 传输协议: 'ws',
        优选订阅生成: {
            local: true,
            本地IP库: { 随机IP: false, 随机数量: 16, 指定端口: -1 },
            SUB: null, SUBNAME: 'edgetunnel', SUBUpdateTime: 3,
        },
        订阅转换配置: {
            SUBAPI: '', SUBCONFIG: 'https://config.example.invalid/x.ini',
            SUBEMOJI: false, SUBLIST: false, UDP: false, XUDP: false, TLS13: false,
            APPEND_TYPE: false, SORT: false, EXPAND: true,
        },
        CF: { Usage: { success: false, pages: 0, workers: 0, total: 0, max: 100000 } },
        反代: { PROXYIP: 'auto', SOCKS5: { 启用: null, 全局: false, 账号: '', 白名单: [] } },
        TG: { 启用: false, BotToken: null, ChatID: null },
    };
    const kvStore = { 'config.json': JSON.stringify(configFixture) };
    if (addText !== null) kvStore['ADD.txt'] = addText;
    const envX = {
        ADMIN: 'test-admin-pass', UUID: testUuid,
        KV: {
            async get(k) { return kvStore[k] ?? null; },
            async put(k, v) { kvStore[k] = v; },
        },
    };
    const token = md5md5('x.test' + testUuid);
    const req = new Request(`https://x.test/sub?token=${token}`, { headers: { 'User-Agent': 'subconverter' } });
    Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const res = await worker.fetch(req, envX, { waitUntil() {} });
    let body = await res.text();
    if (!body.startsWith('vless://')) {
        try { body = Buffer.from(body, 'base64').toString('utf8'); } catch { /* keep raw */ }
    }
    callSubWithAdd.lastStore = kvStore;
    return body.split('\n').filter(l => l.startsWith('vless://'));
}

test('多条 ipf:// 条目可混排 (不同地区/数量 + 手写 IP 并存)', async () => {
    const links = await callSubWithAdd('ipf://JP?limit=1\n9.9.9.9:443#手动节点\nipf://US?limit=2');
    assert.equal(links.length, 4, 'JP 1 + 手写 1 + US 2');
    assert.ok(links.some(l => l.includes('@9.9.9.9:443')), '手写条目原样保留');
    assert.equal(links.filter(l => l.includes('@1.1.1.')).length, 1, 'JP 只取 limit=1');
    assert.equal(links.filter(l => l.includes('@2.2.2.')).length, 2, 'US 取满 limit=2');
});

test('未设置 ADD.txt 时使用内置筛选默认条目 (新装开箱即优选)', async () => {
    const links = await callSubWithAdd(null);
    assert.equal(links.length, 4, '默认条目 JP-HK-SG-US?limit=10, 夹具中 JP/US 各 2 条');
    assert.ok(links.every(l => l.includes('@1.1.1.') || l.includes('@2.2.2.')));
});

test('活池: 订阅生成时剔除死节点、选最快、健康档案落盘', async () => {
    globalThis.__IPF_TEST_PROBE = async (ip) => {
        if (ip === '1.1.1.2:8443') return { alive: false, ms: 0 };
        return { alive: true, ms: ip === '2.2.2.2:2053' ? 20 : 50 };
    };
    try {
        const links = await callSubWithAdd('ipf://JP-US?limit=1');
        assert.equal(links.length, 2);
        assert.ok(links.some(l => l.includes('@1.1.1.1:443')), 'JP 应选存活节点');
        assert.ok(!links.some(l => l.includes('1.1.1.2')), 'JP 死节点应被剔除');
        assert.ok(links.some(l => l.includes('@2.2.2.2:2053')), 'US 应选最快节点');
        const healthRaw = callSubWithAdd.lastStore['IPF_health_v1'];
        assert.ok(healthRaw, '健康档案应写入 KV');
        const health = JSON.parse(healthRaw);
        assert.ok(health.ips['1.1.1.2:8443'][1] >= 1, '死节点失败计数应落盘');
        assert.ok(health.ips['2.2.2.2:2053'][0] >= 1, '存活节点成功计数应落盘');
    } finally {
        delete globalThis.__IPF_TEST_PROBE;
    }
});

test('代理检测 (CHK): 未登录拦截, 登录后页面/接口可用', async () => {
    const ua = 'Mozilla/5.0 (Test) AppleWebKit/537.36';
    const secret = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
    const envC = { ADMIN: 'test-admin-pass', UUID: '11111111-2222-4333-8444-555555555555' };
    const cookie = 'auth=' + md5md5(ua + secret + 'test-admin-pass');
    function reqC(path, { auth = false, method = 'GET', body } = {}) {
        const headers = { 'User-Agent': ua };
        if (auth) headers.Cookie = cookie;
        if (body) headers['Content-Type'] = 'application/json';
        const r = new Request('https://x.test' + path, { method, headers, body });
        Object.defineProperty(r, 'cf', { value: { colo: 'NRT', country: 'JP', asn: 64500, asOrganization: 'Test Org', city: 'Tokyo', region: 'Tokyo', timezone: 'Asia/Tokyo', longitude: '139.7', latitude: '35.7' } });
        return r;
    }
    const ctx = { waitUntil() {} };

    const pageAnon = await worker.fetch(reqC('/socks5-ui'), envC, ctx);
    assert.equal(pageAnon.status, 302, '未登录打开检测页应跳转登录');
    assert.ok((pageAnon.headers.get('location') || '').endsWith('/login'));

    const apiAnon = await worker.fetch(reqC('/socks5/check?proxy=socks5://1.2.3.4:1080'), envC, ctx);
    assert.equal(apiAnon.status, 401, '未登录调用检测接口应 401');

    const page = await worker.fetch(reqC('/socks5-ui', { auth: true }), envC, ctx);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('代理检测功能由 CF-Workers-CheckSocks5 提供'), '页脚应为整合版中性页脚');
    assert.ok(html.includes("'/socks5/check?proxy='"), '前端检测接口应已改挂 /socks5 前缀');
    assert.ok(!html.includes('tongji'), '不得包含上游第三方访问统计');

    const ipRes = await worker.fetch(reqC('/socks5/ip.json', { auth: true }), envC, ctx);
    assert.equal(ipRes.status, 200);
    const ipJson = JSON.parse(await ipRes.text());
    assert.ok('colo' in ipJson, 'ip.json 应返回机房信息');

    const batch = await worker.fetch(reqC('/socks5/resolve-batch', { auth: true, method: 'POST', body: JSON.stringify({ targets: ['socks5://1.2.3.4:1080'] }) }), envC, ctx);
    assert.equal(batch.status, 200);
    const batchJson = JSON.parse(await batch.text());
    assert.equal(batchJson.results.length, 1);
    assert.ok(batchJson.results[0].targets.includes('1.2.3.4:1080'), 'IP 字面量应直接展平为 ip:port');
});

const CHN_VLESS = (host, name) => `vless://11111111-2222-4333-8444-555555555555@${host}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=%2F#${encodeURIComponent(name)}`;

test('订阅转换 (CHN): 页面/直出/链式/短链/规则懒镜像', async () => {
    const kvStore = {};
    const env = {
        UUID: '11111111-2222-4333-8444-555555555555',
        KV: {
            async get(k, opts) {
                const v = kvStore[k];
                if (v === undefined) return null;
                if (opts && opts.type === 'arrayBuffer') return v instanceof ArrayBuffer ? v : new TextEncoder().encode(String(v)).buffer;
                return typeof v === 'string' ? v : null;
            },
            async put(k, v) { kvStore[k] = v; },
        },
    };
    const ctx = { waitUntil() {} };
    const reqCHN = (path, init) => {
        const r = new Request('https://x.test' + path, init);
        Object.defineProperty(r, 'cf', { value: { colo: 'NRT', country: 'JP' } });
        return r;
    };
    const prevFetch = globalThis.fetch;
    const exitText = [CHN_VLESS('exit1.example.com', '🇯🇵 日本-出口'), CHN_VLESS('exit2.example.com', '🇺🇸 美国-出口')].join('\n');
    const entryText = [CHN_VLESS('entry1.example.com', '🇭🇰 香港-入口')].join('\n');
    globalThis.fetch = async (input) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u.startsWith('https://subs.test/exit')) return new Response(Buffer.from(exitText, 'utf8').toString('base64'), { status: 200 });
        if (u.startsWith('https://subs.test/entry')) return new Response(Buffer.from(entryText, 'utf8').toString('base64'), { status: 200 });
        if (u.includes('raw.githubusercontent.com')) return new Response(new Uint8Array(256).fill(7), { status: 200 });
        return new Response('not found', { status: 404 });
    };
    try {
        const page = await worker.fetch(reqCHN('/convert'), env, ctx);
        assert.equal(page.status, 200);
        const pageText = await page.text();
        assert.ok(pageText.includes('订阅转换') && pageText.includes('/shorten'), '转换页应完整下发');

        const conv = await worker.fetch(reqCHN('/conv?target=clash&url=' + encodeURIComponent('https://subs.test/exit')), env, ctx);
        assert.equal(conv.status, 200);
        const convText = await conv.text();
        assert.ok(convText.includes('proxies:') && convText.includes('日本-出口') && convText.includes('美国-出口'), '普通转换应包含全部节点');
        assert.ok(convText.includes('https://x.test/rules/clash/'), '规则 URL 应指向本部署 /rules/');
        assert.ok(!convText.includes('__PUBLIC_ORIGIN__'), '骨架占位符必须全部替换');

        const chain = await worker.fetch(reqCHN('/chain?target=clash&entry=' + encodeURIComponent('https://subs.test/entry') + '&exit=' + encodeURIComponent('https://subs.test/exit')), env, ctx);
        assert.equal(chain.status, 200);
        const chainText = await chain.text();
        assert.ok(chainText.includes('dialer-proxy'), '链式 Clash 应有 dialer-proxy');
        assert.ok(chainText.includes('⛓ 入口优选') && chainText.includes('⛓ 出口优选'), '链式应有入口/出口优选组');
        assert.ok(chainText.includes('入口-') && chainText.includes('出口-'), '节点应按入口/出口改名');

        const shorten = await worker.fetch(reqCHN('/shorten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'singbox', entry: 'https://subs.test/entry', exit: 'https://subs.test/exit' }) }), env, ctx);
        assert.equal(shorten.status, 200);
        const shortUrl = await shorten.text();
        const code = shortUrl.split('/').pop();
        assert.ok(shortUrl.includes('/s/' + code), '短链应为 /s/<code> 形式: ' + shortUrl);

        const viaShort = await worker.fetch(reqCHN('/s/' + code), env, ctx);
        assert.equal(viaShort.status, 200);
        const sb = JSON.parse(await viaShort.text());
        assert.ok(sb.outbounds.some((o) => o.detour === '⛓ 入口优选'), 'sing-box 链式应有 detour 指向入口优选');

        const viaShortClash = await worker.fetch(reqCHN('/m/' + code), env, ctx);
        assert.equal(viaShortClash.status, 200);
        assert.ok((await viaShortClash.text()).includes('dialer-proxy'), '同码换 /m/ 应出 Clash 版');

        const linkInfo = await worker.fetch(reqCHN('/api/link/' + code), env, ctx);
        assert.equal(linkInfo.status, 200);
        const rec = JSON.parse(await linkInfo.text());
        assert.equal(rec.kind, 'chain');
        assert.equal(rec.entry, 'https://subs.test/entry');

        const shorten2 = await worker.fetch(reqCHN('/shorten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'clash', entry: 'https://subs.test/entry', exit: 'https://subs.test/exit' }) }), env, ctx);
        assert.equal(await shorten2.text(), shortUrl.replace('/s/', '/m/'), '同内容换 target 应复用同一短码');

        const rule = await worker.fetch(reqCHN('/rules/clash/private.mrs'), env, ctx);
        assert.equal(rule.status, 200, '规则首次访问应懒镜像成功');
        assert.equal(rule.headers.get('content-type'), 'application/octet-stream');
        assert.ok(kvStore['chn_rule:clash/private.mrs'] instanceof ArrayBuffer, '规则应已写入 KV 镜像');
        const rule404 = await worker.fetch(reqCHN('/rules/clash/not-a-rule.mrs'), env, ctx);
        assert.equal(rule404.status, 404, '白名单外规则应 404');
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('订阅转换 (CHN): edgetunnel /sub 经内置转换器出 Clash (无外部 SUBAPI)', async () => {
    const testUuid = '11111111-2222-4333-8444-555555555555';
    const configFixture = {
        协议类型: 'vless', 传输协议: 'ws',
        优选订阅生成: { local: true, 本地IP库: { 随机IP: false, 随机数量: 16, 指定端口: -1 }, SUB: null, SUBNAME: 'edgetunnel', SUBUpdateTime: 3 },
        订阅转换配置: { SUBAPI: '', SUBCONFIG: '', SUBEMOJI: false, SUBLIST: false, UDP: false, XUDP: false, TLS13: false, APPEND_TYPE: false, SORT: false, EXPAND: true },
        CF: { Usage: { success: false, pages: 0, workers: 0, total: 0, max: 100000 } },
        反代: { PROXYIP: 'auto', SOCKS5: { 启用: null, 全局: false, 账号: '', 白名单: [] } },
        TG: { 启用: false, BotToken: null, ChatID: null },
    };
    const kvStore = { 'config.json': JSON.stringify(configFixture), 'ADD.txt': 'ipf://JP-US?limit=1' };
    const env = {
        ADMIN: 'test-admin-pass', UUID: testUuid,
        KV: { async get(k) { return kvStore[k] ?? null; }, async put(k, v) { kvStore[k] = v; } },
    };
    const token = md5md5('x.test' + testUuid);
    const req = new Request(`https://x.test/sub?token=${token}`, { headers: { 'User-Agent': 'clash-verge/2.2.3' } });
    Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const res = await worker.fetch(req, env, { waitUntil() {} });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('proxies:'), '应返回 Clash YAML 而非转换后端异常');
    assert.ok(body.includes('1.1.1.'), '应包含筛选池展开的 JP 节点');
    assert.ok(body.includes('2.2.2.'), '应包含筛选池展开的 US 节点');
    assert.ok(!body.includes('订阅转换后端异常'), '不得出现外部后端异常');
});

test('管理页内置入口: 注入脚本载荷完整且可解析, /admin 代理时注入卡片脚本', async () => {
    const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
    const b64 = src.match(/const IPF_管理页脚本_B64 = '([A-Za-z0-9+/=]+)'/);
    assert.ok(b64, '应内嵌 base64 注入脚本');
    const code = Buffer.from(b64[1], 'base64').toString('utf8');
    assert.ok(code.includes('customIPSection') && code.includes('ipf://'), '脚本应包含卡片锚点与 ipf 逻辑');
    assert.doesNotThrow(() => new Function(code), '注入脚本应为合法 JS');
    assert.equal((src.match(/IPF_注入管理页\(await fetch/g) || []).length, 2, '管理页与登录页各接入一处注入');

    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u.includes('edt-pages.github.io')) {
            // 复刻上游真实页面陷阱: <template> 内容里有一个字面量 </body>,
            // 注入必须落在文档真正的 </body> (最后一个) 之前, 不能进模板。
            return new Response('<html><body><template><div></body></div></template><div id="customIPSection"><textarea id="customIPs"></textarea></div></body></html>', {
                status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' },
            });
        }
        return realFetch(input, init);
    };
    try {
        const ua = 'ipf-test-ua';
        const secret = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
        const cookie = md5md5(ua + secret + 'test-admin-pass');
        const kvStore = {};
        const envA = {
            ADMIN: 'test-admin-pass',
            KV: {
                async get(k) { return kvStore[k] ?? null; },
                async put(k, v) { kvStore[k] = v; },
            },
        };
        const req = new Request('https://x.test/admin', { headers: { 'User-Agent': ua, Cookie: 'auth=' + cookie } });
        Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
        const res = await worker.fetch(req, envA, { waitUntil() {} });
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('id="customIPs"'), '原始管理页内容应保留');
        assert.ok(html.includes('ipf-admin-card'), '应注入内置入口脚本');
        assert.ok(html.includes('内置国家优选'), '注入脚本应含卡片文案');
        assert.ok(html.indexOf('ipf-admin-card') > html.indexOf('</template>'), '注入脚本不得落进 <template> 内容');
        assert.equal(res.headers.get('cache-control'), 'no-store, no-cache, must-revalidate', '管理页外壳应禁止缓存');

        const loginReq = new Request('https://x.test/login', { headers: { 'User-Agent': ua } });
        Object.defineProperty(loginReq, 'cf', { value: { colo: 'NRT', country: 'JP' } });
        const loginRes = await worker.fetch(loginReq, envA, { waitUntil() {} });
        const loginHtml = await loginRes.text();
        assert.ok(loginHtml.includes('ipf-badge'), '登录页应注入品牌徽章脚本');
        assert.ok(loginHtml.includes('ipf-theme'), '登录页应注入品牌主题');
    } finally {
        globalThis.fetch = realFetch;
    }
});
