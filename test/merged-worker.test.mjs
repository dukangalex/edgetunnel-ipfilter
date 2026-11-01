// 整合版冒烟测试: IPF 地区筛选路由 + edgetunnel 原有路由不被劫持。
// 离线运行 (mock 上游数据源与 edgetunnel 的外部抓取), npm test 即可。
// 注: Node 的 WebCrypto 不支持 MD5 (Cloudflare Workers 支持), 本地测试需打补丁, 仅测试文件内生效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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
