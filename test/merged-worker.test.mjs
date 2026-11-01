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
            SUBAPI: 'https://subapi.example.invalid', SUBCONFIG: 'https://config.example.invalid/x.ini',
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
            SUBAPI: 'https://subapi.example.invalid', SUBCONFIG: 'https://config.example.invalid/x.ini',
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

test('管理页内置入口: 注入脚本载荷完整且可解析, /admin 代理时注入卡片脚本', async () => {
    const src = readFileSync(new URL('../_worker.js', import.meta.url), 'utf8');
    const b64 = src.match(/const IPF_管理页脚本_B64 = '([A-Za-z0-9+/=]+)'/);
    assert.ok(b64, '应内嵌 base64 注入脚本');
    const code = Buffer.from(b64[1], 'base64').toString('utf8');
    assert.ok(code.includes('customIPSection') && code.includes('ipf://'), '脚本应包含卡片锚点与 ipf 逻辑');
    assert.doesNotThrow(() => new Function(code), '注入脚本应为合法 JS');
    assert.equal((src.match(/IPF_注入管理页\(await fetch/g) || []).length, 1, '管理页代理应只在一处接入注入');

    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const u = typeof input === 'string' ? input : input.url;
        if (u.includes('edt-pages.github.io')) {
            return new Response('<html><body><div id="customIPSection"><textarea id="customIPs"></textarea></div></body></html>', {
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
    } finally {
        globalThis.fetch = realFetch;
    }
});
