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
    assert.ok(!body.includes('cdn.tailwindcss.com') && !body.includes('unpkg.com') && !body.includes('fonts.googleapis.com'), '筛选页不得再依赖任何 CDN');
    assert.ok(body.includes('Tailwind CSS v3.4'), '筛选页应内嵌预编译样式');
    assert.ok(!body.includes('666OS/ClashMac/raw'), '筛选页不得外链第三方装饰图');
    assert.ok(body.includes('特别鸣谢') && body.includes('ClashMac'), '筛选页页脚致谢应完整');
    assert.ok(body.includes('数据来源：Cloudflare 优选 IP 数据集'), '筛选页应标明数据来源');
    assert.ok(body.includes('viewBox="0 0 24 24"'), '图标应已内联为 SVG');
});

test('设计令牌: 转换页使用本项目视觉令牌', async () => {
    const { status, body } = await call('https://x.test/convert');
    assert.equal(status, 200);
    assert.ok(body.includes('#060809'), '转换页应使用本项目画布色');
    assert.ok(!body.includes('#0a84ff'), '转换页不得残留旧强调蓝');
});

test('edgetunnel 原有路由不被 IPF 劫持', async () => {
    for (const path of ['/version', '/login', '/']) {
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
    assert.ok(!html.includes('ipdata.co'), '国旗图不得再外呼第三方服务');
    assert.ok(html.includes('data:image/svg+xml'), '国旗应改为内联 emoji SVG');
    assert.ok(!html.includes('fonts.googleapis.com'), '检测页不得再依赖 Google Fonts');

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
        协议类型: 'trojan', 传输协议: 'ws',
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

test('上游 UI 管理台 (3.1): 页面自带零代理, 登录流与鉴权完整, 能力已融为页面自身形态', async () => {
    const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
    assert.ok(!src.includes('fetch(Pages静态页面'), '不得再从 edt-pages 抓取任何页面');
    assert.ok(!src.includes('__IPF_ADMIN_B64__') && !src.includes('IPF_注入管理页'), '旧注入机制应已移除');
    assert.ok(src.includes('preferredSubscriptionModule'), '应内嵌上游 UI 管理页');
    assert.ok(src.includes('id="regionSection"') && src.includes('value="region"') && src.includes('__ipfRegionDone'), '地区筛选应是优选模块自己的模式且呈现不拦用户切换');
    assert.ok(src.includes('testBuiltinSubAPI') && src.includes('validURL === undefined'), '内置转换(默认)应可实测验证, 且验证后可确认切回默认');
    assert.ok(src.includes('header-tools') && src.includes('href="/convert"') && src.includes('href="/ips-ui"') && src.includes('href="/socks5-ui"'), '页眉应有整合工具入口(转换/地区优选/SOCKS5 检测)');
    assert.ok(src.includes('IPF_脱敏日志URL(request.url)') && src.includes('log.URL === 日志内容.URL'), '日志写入前应脱敏 URL 中的 token/源订阅参数');
    assert.ok(src.includes('log.TYPE === 请求类型 && log.IP === 访问IP') && !src.includes('请求类型 !== "Get_SUB"'), 'Get_SUB 日志应与其它类型同样做 30 分钟去重, 减少 KV 写入');
    const fsMod = await import('node:fs');
    const cl = fsMod.readFileSync(new URL('../CHANGELOG', import.meta.url), 'utf8');
    const topV = cl.match(/## \[integration (\d+\.\d+\.\d+)\]/)[1];
    assert.ok(src.includes('整合版 ' + topV) && src.includes('edgetunnel-ipfilter integration ' + topV), '版本徽章与更新检查应使用本项目整合版号 (与 CHANGELOG 顶部一致), 不跟随上游版本号');
    assert.ok(src.includes('...currentConfig.订阅转换配置'), '转换模块保存应保留其不认识的配置键');
    assert.ok(!src.includes('id="chainEntry"'), '链式入口字段已按用户要求取消, 不应再出现');
    assert.ok(!src.includes('ipfChainModule') && !src.includes('ipfToolsModule') && !src.includes('ipfRegionBlock') && !src.includes('本项目功能'), '不得再有运行时注入的独立模块与外来标签');
    assert.ok(src.includes('登录设置页面'), '应内嵌上游 UI 登录页');

    const ua = 'ipf-test-ua';
    const secret = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
    const cookie = md5md5(ua + secret + 'test-admin-pass');
    const kvStore = {};
    const envA = {
        ADMIN: 'test-admin-pass', UUID: '11111111-2222-4333-8444-555555555555',
        KV: { async get(k) { return kvStore[k] ?? null; }, async put(k, v) { kvStore[k] = v; } },
    };
    async function callA(url, opts = {}) {
        const headers = { 'User-Agent': ua };
        if (opts.cookie) headers.Cookie = 'auth=' + cookie;
        const req = new Request(url, { headers, method: opts.method || 'GET', body: opts.body });
        Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
        return worker.fetch(req, envA, { waitUntil() {} });
    }
    // 未登录: /admin -> 302 /login
    let res = await callA('https://x.test/admin');
    assert.equal(res.status, 302, '/admin 未登录应跳转');
    assert.equal(res.headers.get('location'), 'https://x.test/login');
    // 未登录: /login -> 自研登录页
    res = await callA('https://x.test/login');
    assert.equal(res.status, 200);
    let body = await res.text();
    assert.ok(body.includes('登录设置页面') && body.includes('edgetunnel-ipfilter'), '登录页应为本项目登录页');
    assert.ok(body.includes('github.com/dukangalex/edgetunnel-ipfilter'), '登录页应带本项目联系方式');
    // 已登录: /login -> 302 /admin; /admin -> 自研管理台
    res = await callA('https://x.test/login', { cookie: true });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://x.test/admin');
    res = await callA('https://x.test/admin', { cookie: true });
    assert.equal(res.status, 200);
    body = await res.text();
    assert.ok(body.includes('preferredSubscriptionModule'), '/admin 应返回上游 UI 管理页');
    assert.ok(body.includes('优选订阅生成') && body.includes('regionSection') && !body.includes('chainEntry') && !body.includes('ipfChainModule'), '管理台应含上游模块与已融合的地区模式, 且无链式入口字段');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    // POST /login 正确密码 -> success + auth cookie (与校验同式)
    res = await callA('https://x.test/login', { method: 'POST', body: new URLSearchParams({ password: 'test-admin-pass' }) });
    const j = await res.json();
    assert.equal(j.success, true, '正确密码应登录成功');
    assert.ok((res.headers.get('set-cookie') || '').includes('auth=' + cookie), '登录应下发 auth cookie');
    // POST /login 错误密码 -> 回到自研登录页, 不下发成功标记
    res = await callA('https://x.test/login', { method: 'POST', body: new URLSearchParams({ password: 'wrong-pass' }) });
    body = await res.text();
    assert.ok(!body.includes('"success":true') && body.includes('登录设置页面'), '错误密码应回到登录页');
    // /logout -> 302 且清除 cookie
    res = await callA('https://x.test/logout', { cookie: true });
    assert.equal(res.status, 302);
    assert.ok((res.headers.get('set-cookie') || '').includes('Max-Age=0'), '退出应清除 cookie');
});

test('整合版默认: SUBAPI 留空走内置转换 (源码默认 + 新装配置)', async () => {
    const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
    assert.ok(src.includes("SUBAPI: '',"), '默认配置 SUBAPI 应为空 (内置转换)');
    assert.ok(!src.includes('SUBAPI: `https://SUBAPI.'), '不得再把上游公共后端写成默认');
    const ua = 'ipf-test-ua';
    const secret = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
    const cookie = md5md5(ua + secret + 'test-admin-pass');
    const kvStore = {};
    const envD = {
        ADMIN: 'test-admin-pass', UUID: '11111111-2222-4333-8444-555555555555',
        KV: { async get(k) { return kvStore[k] ?? null; }, async put(k, v) { kvStore[k] = v; } },
    };
    const req = new Request('https://x.test/admin/config.json', { headers: { 'User-Agent': ua, Cookie: 'auth=' + cookie } });
    Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const res = await worker.fetch(req, envD, { waitUntil() {} });
    assert.equal(res.status, 200);
    const cfg = JSON.parse(await res.text());
    assert.equal(cfg.订阅转换配置.SUBAPI, '', '新装默认 SUBAPI 应为空');
    assert.ok(src.includes("地区筛选: { 地区: 'JP-HK-SG-US', 数量: 10 }"), '种子配置应带地区筛选默认值 (运行时断言见 fresh-defaults.test.mjs)');
});

function surgeEnv(extra) {
    const testUuid = '11111111-2222-4333-8444-555555555555';
    const configFixture = {
        协议类型: 'trojan', 传输协议: 'ws',
        优选订阅生成: { local: true, 本地IP库: { 随机IP: false, 随机数量: 16, 指定端口: -1 }, SUB: null, SUBNAME: 'edgetunnel', SUBUpdateTime: 3 },
        订阅转换配置: { SUBAPI: '', SUBCONFIG: '', SUBEMOJI: false, SUBLIST: false, UDP: false, XUDP: false, TLS13: false, APPEND_TYPE: false, SORT: false, EXPAND: true },
        CF: { Usage: { success: false, pages: 0, workers: 0, total: 0, max: 100000 } },
        反代: { PROXYIP: 'auto', SOCKS5: { 启用: null, 全局: false, 账号: '', 白名单: [] } },
        TG: { 启用: false, BotToken: null, ChatID: null },
    };
    const kvStore = { 'config.json': JSON.stringify(configFixture), 'ADD.txt': 'ipf://JP-US?limit=1' };
    return {
        testUuid,
        configFixture,
        env: Object.assign({
            ADMIN: 'test-admin-pass', UUID: testUuid,
            KV: { async get(k) { return kvStore[k] ?? null; }, async put(k, v) { kvStore[k] = v; } },
        }, extra || {}),
    };
}

test('订阅转换 (CHN): 内置模式下 Surge 由内置转换原生生成 (零外部依赖)', async () => {
    // 即使还设着 EXTERNAL_SUBCONVERTER_URL 变量, 也不许再被调用
    const { testUuid, env } = surgeEnv({ EXTERNAL_SUBCONVERTER_URL: 'https://conv.example.invalid' });
    // 配置在 isolate 内有 30 秒缓存且先于本例的测试已缓存了 vless 配置;
    // 用带查询串的新模块实例 (独立 isolate 状态) 保证本例的 trojan 配置生效。
    const freshWorker = (await import(new URL('../_worker.js?surge-native', import.meta.url))).default;
    let sawExternal = '';
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u.startsWith('https://conv.example.invalid/')) { sawExternal = u; return new Response('EXTERNAL-USED', { status: 200 }); }
        return prevFetch(input, init);
    };
    try {
        const token = md5md5('x.test' + testUuid);
        const req = new Request(`https://x.test/sub?token=${token}`, { headers: { 'User-Agent': 'Surge/5.5.0' } });
        Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
        const res = await freshWorker.fetch(req, env, { waitUntil() {} });
        assert.equal(res.status, 200);
        const body = await res.text();
        assert.equal(sawExternal, '', '不许再调用任何外部转换后端');
        assert.ok(!body.includes('EXTERNAL-USED'), '输出不许来自外部后端');
        assert.ok(body.includes('[Proxy]'), 'Surge 应有 [Proxy] 段: ' + body.slice(0, 200));
        assert.equal((body.match(/= trojan,/g) || []).length, 2, '两个 trojan 节点应全部原生渲染');
        assert.ok(body.includes('[Proxy Group]'), 'Surge 应有 [Proxy Group] 段');
        assert.ok(body.includes('[Rule]'), 'Surge 应有 [Rule] 段');
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('订阅转换 (CHN): V2Ray / Loon / Quantumult X 直出与链式原生生成', async () => {
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
        const v2 = await worker.fetch(reqCHN('/conv?target=v2ray&url=' + encodeURIComponent('https://subs.test/exit')), env, ctx);
        assert.equal(v2.status, 200);
        const v2decoded = Buffer.from((await v2.text()).replace(/\s/g, ''), 'base64').toString('utf8');
        assert.equal((v2decoded.match(/vless:\/\//g) || []).length, 2, 'V2Ray 应是可解码的链接集合, 含 2 个 vless 链接');

        const qx = await worker.fetch(reqCHN('/conv?target=quanx&url=' + encodeURIComponent('https://subs.test/exit')), env, ctx);
        assert.equal(qx.status, 200);
        const qxText = await qx.text();
        assert.ok(qxText.includes('[server_local]'), 'Quantumult X 应使用真实段名 [server_local]');
        assert.ok(!qxText.includes('[proxy_local]'), 'Quantumult X 没有 [proxy_local] 段, 不许出现');
        assert.equal((qxText.match(/vless=/g) || []).length, 2, 'QuanX 两个 vless 节点应全部渲染');

        const loonChain = await worker.fetch(reqCHN('/chain?target=loon&entry=' + encodeURIComponent('https://subs.test/entry') + '&exit=' + encodeURIComponent('https://subs.test/exit')), env, ctx);
        assert.equal(loonChain.status, 200);
        const loonText = await loonChain.text();
        assert.ok(loonText.includes('[Proxy Chain]'), 'Loon 链式应使用 [Proxy Chain] 段');
        assert.ok(loonText.includes('⛓ 链式代理'), 'Loon 链式应有 ⛓ 链式代理 定义');

        const shorten = await worker.fetch(reqCHN('/shorten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'quanx', url: 'https://subs.test/exit' }) }), env, ctx);
        assert.equal(shorten.status, 200);
        const shortUrl = await shorten.text();
        const code = shortUrl.split('/').pop();
        assert.ok(shortUrl.includes('/c/' + code), 'quanx 短链应为 /c/<code> 形式: ' + shortUrl);
        const viaShort = await worker.fetch(reqCHN('/c/' + code), env, ctx);
        assert.equal(viaShort.status, 200);
        assert.ok((await viaShort.text()).includes('[server_local]'), '短链出件应为 QuanX 原生输出');

        const surgeVless = await worker.fetch(reqCHN('/conv?target=surge&url=' + encodeURIComponent('https://subs.test/exit')), env, ctx);
        assert.equal(surgeVless.status, 502, 'Surge 不支持 VLESS, 应明确失败而不是输出空壳');
        assert.ok((await surgeVless.text()).includes('没有 Surge 可用的节点'), '失败信息应说明原因');
    } finally {
        globalThis.fetch = prevFetch;
    }
});

test('一体化: /socks5/self-nodes 返回当前订阅节点与活池状态, 未登录 401', async () => {
    const ua = 'ipf-test-ua';
    const secret = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
    const cookie = 'auth=' + md5md5(ua + secret + 'test-admin-pass');
    const kvStore = { 'ADD.txt': 'ipf://JP-US?limit=1' };
    const env = {
        ADMIN: 'test-admin-pass', UUID: '11111111-2222-4333-8444-555555555555',
        KV: { async get(k) { return kvStore[k] ?? null; }, async put(k, v) { kvStore[k] = v; } },
    };
    const ctx = { waitUntil() {} };
    function reqS(path, auth) {
        const headers = { 'User-Agent': ua };
        if (auth) headers.Cookie = cookie;
        const r = new Request('https://x.test' + path, { headers });
        Object.defineProperty(r, 'cf', { value: { colo: 'NRT', country: 'JP' } });
        return r;
    }
    globalThis.__IPF_TEST_PROBE = async () => ({ alive: true, ms: 42 });
    try {
        const anon = await worker.fetch(reqS('/socks5/self-nodes', false), env, ctx);
        assert.equal(anon.status, 401, '未登录应 401');
        const res = await worker.fetch(reqS('/socks5/self-nodes', true), env, ctx);
        assert.equal(res.status, 200);
        const data = JSON.parse(await res.text());
        assert.equal(data.total, 2, 'JP/US 各 limit=1');
        assert.equal(data.alive, 2, '探测全活');
        assert.ok(data.nodes.every(n => n.address && n.ms === 42), '节点应带地址与探测延迟');
        const page = await worker.fetch(reqS('/socks5-ui', true), env, ctx);
        const html = await page.text();
        assert.ok(html.includes('ipf-self-panel'), '检测页应注入一体化面板脚本');
    } finally {
        delete globalThis.__IPF_TEST_PROBE;
    }
});

test('一体化: /socks5/check-config 检测已配置 SOCKS5 且凭据不外泄', async () => {
    const ua = 'ipf-test-ua';
    const secret = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
    const cookie = 'auth=' + md5md5(ua + secret + 'test-admin-pass');
    const kvStore = {};
    const env = {
        ADMIN: 'test-admin-pass', UUID: '11111111-2222-4333-8444-555555555555',
        KV: { async get(k) { return kvStore[k] ?? null; }, async put(k, v) { kvStore[k] = v; } },
    };
    const ctx = { waitUntil() {} };
    // 读-改-写: 先取完整配置 (空 KV 会播种默认配置), 只改 SOCKS5 账号再存回,
    // 避免手写配置缺字段被保存校验拒绝 (配置不完整)。
    const getReq = new Request('https://x.test/admin/config.json', { headers: { 'User-Agent': ua, Cookie: cookie } });
    Object.defineProperty(getReq, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const getRes = await worker.fetch(getReq, env, ctx);
    assert.equal(getRes.status, 200, '读取配置应成功');
    const cfg = JSON.parse(await getRes.text());
    cfg.反代 = cfg.反代 || {};
    cfg.反代.SOCKS5 = Object.assign({}, cfg.反代.SOCKS5, { 启用: 'socks5', 账号: 'user:pass@127.0.0.1:9' });
    const saveReq = new Request('https://x.test/admin/config.json', {
        method: 'POST',
        headers: { 'User-Agent': ua, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
    });
    Object.defineProperty(saveReq, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const saveRes = await worker.fetch(saveReq, env, ctx);
    assert.equal(saveRes.status, 200, '配置保存应成功: ' + (await saveRes.text()).slice(0, 100));
    const req = new Request('https://x.test/socks5/check-config', { headers: { 'User-Agent': ua, Cookie: cookie } });
    Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const res = await worker.fetch(req, env, ctx);
    assert.equal(res.status, 200);
    const text = await res.text();
    const data = JSON.parse(text);
    assert.equal(data.configured, true, '应识别到已配置的 SOCKS5');
    assert.equal(data.checks.length, 1);
    assert.equal(data.checks[0].target, '127.0.0.1:9', '目标只应出现主机:端口');
    assert.equal(typeof data.checks[0].success, 'boolean');
    assert.ok(!text.includes('user:pass') && !text.includes('pass@'), '响应不得包含代理凭据');
});

test('一体化: 转换按国家筛选 (名称判定 + IP 数据集反查 + 未知保留)', async () => {
    const kvStore = {};
    const env = {
        UUID: '11111111-2222-4333-8444-555555555555',
        KV: { async get(k) { return kvStore[k] ?? null; }, async put(k, v) { kvStore[k] = v; } },
    };
    const items = [
        CHN_VLESS('1.1.1.2', '🇺🇸 美国节点'),
        CHN_VLESS('2.2.2.1', '🇯🇵 日本节点'),
        CHN_VLESS('2.2.2.2', 'node-01'),
        CHN_VLESS('203.0.113.7', 'plain-node'),
    ].join('|');
    const qs = new URLSearchParams({ target: 'clash', regions: 'JP', url: items });
    const req = new Request('https://x.test/conv?' + qs.toString());
    Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const res = await worker.fetch(req, env, { waitUntil() {} });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('2.2.2.1'), 'JP 名称节点应保留');
    assert.ok(body.includes('203.0.113.7'), '地区未知节点应保留');
    assert.ok(!body.includes('1.1.1.2'), 'US 名称节点应被筛掉');
    assert.ok(!body.includes('2.2.2.2'), 'IP 反查为 US 的节点应被筛掉');

    const pageReq = new Request('https://x.test/convert');
    Object.defineProperty(pageReq, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    const page = await worker.fetch(pageReq, env, { waitUntil() {} });
    const html = await page.text();
    assert.ok(html.includes('ipf-conv-bar'), '转换页应注入按国家筛选条');
    assert.ok(html.includes('ipf-contact-footer'), '转换页应带页脚联系方式');
    assert.ok(html.includes('github.com/dukangalex/edgetunnel-ipfilter'), '页脚应含项目仓库链接');
    assert.ok(html.includes('t.me/AngelaNexus'), '页脚应含交流频道链接');
});

test('本项目指向: /api/ipinfo 由本部署回答 (登录把关, 字段与页面预期一致)', async () => {
    const ua = 'ipf-test-ua';
    const secret = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
    const cookie = 'auth=' + md5md5(ua + secret + 'test-admin-pass');
    const env = { ADMIN: 'test-admin-pass', UUID: '11111111-2222-4333-8444-555555555555', KV: { async get() { return null; }, async put() {} } };
    const ctx = { waitUntil() {} };
    function reqI(auth) {
        const headers = { 'User-Agent': ua, 'CF-Connecting-IP': '203.0.113.9' };
        if (auth) headers.Cookie = cookie;
        const r = new Request('https://x.test/api/ipinfo', { headers });
        Object.defineProperty(r, 'cf', { value: { colo: 'NRT', country: 'JP', asn: 64500, asOrganization: 'Test Org' } });
        return r;
    }
    const anon = await worker.fetch(reqI(false), env, ctx);
    assert.equal(anon.status, 401, '未登录应 401');
    const res = await worker.fetch(reqI(true), env, ctx);
    assert.equal(res.status, 200);
    const data = JSON.parse(await res.text());
    assert.equal(data.ip, '203.0.113.9');
    assert.equal(data.country_code, 'JP');
    assert.equal(data.asn, 'AS64500');
    assert.equal(data.as_name, 'Test Org');
});
