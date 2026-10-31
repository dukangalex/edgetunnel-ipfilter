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
