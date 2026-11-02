// 全新部署默认值 (独立进程运行, 避开主测试文件的 30s 配置缓存串扰):
// 空 KV 时, 种子配置应带地区筛选, ADD.txt 应报告筛选器条目, /sub 应直接
// 产出筛选后的节点 —— 即「筛选器是默认优选、转换器是默认转换」开箱成立。
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
const md5hex = (t) => createHash('md5').update(t).digest('hex');
const md5md5 = (t) => md5hex(md5hex(t).slice(7, 27));

const FIXTURE = [
    '1.1.1.1:443#JP',
    '2.2.2.1:443#US',
    '4.4.4.1:443#DE',
].join('\n');
globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://zip.cm.edu.kg/all.txt') return new Response(FIXTURE, { status: 200 });
    return new Response('<!DOCTYPE html><title>dummy</title>', { status: 200 });
};
globalThis.__IPF_TEST_PROBE = async () => ({ alive: true, ms: 42 });

const worker = (await import(new URL('../_worker.js', import.meta.url))).default;
const kvStore = {};
const env = {
    ADMIN: 'test-admin-pass', UUID: '11111111-2222-4333-8444-555555555555',
    KV: { async get(k) { return kvStore[k] ?? null; }, async put(k, v) { kvStore[k] = v; } },
};
const ua = 'fresh-test-ua';
const secret = '勿动此默认密钥，有需求请自行通过添加变量KEY进行修改';
const cookie = 'auth=' + md5md5(ua + secret + 'test-admin-pass');

async function call(url) {
    const req = new Request(url, { headers: { 'User-Agent': ua, Cookie: cookie } });
    Object.defineProperty(req, 'cf', { value: { colo: 'NRT', country: 'JP' } });
    return worker.fetch(req, env, { waitUntil() {} });
}

test('全新部署: 种子带地区筛选, ADD 报告筛选条目, /sub 直接产出筛选节点', async () => {
    const resCfg = await call('https://x.test/admin/config.json');
    assert.equal(resCfg.status, 200);
    const cfg = JSON.parse(await resCfg.text());
    assert.equal(cfg.订阅转换配置.SUBAPI, '', '新装默认 SUBAPI 应为空 (内置转换)');
    assert.deepEqual(cfg.优选订阅生成.本地IP库.地区筛选, { 地区: 'JP-HK-SG-US', 数量: 10 }, '新装默认应带地区筛选');
    assert.equal(cfg.优选订阅生成.本地IP库.随机IP, false, '新装默认随机 IP 应关闭');

    const resAdd = await call('https://x.test/admin/ADD.txt');
    assert.equal(resAdd.status, 200);
    assert.equal((await resAdd.text()).trim(), 'ipf://JP-HK-SG-US?limit=10', 'ADD.txt 应报告筛选器默认条目');

    const resSub = await call('https://x.test/sub?token=' + cfg.优选订阅生成.TOKEN);
    assert.equal(resSub.status, 200);
    const decoded = Buffer.from((await resSub.text()).trim(), 'base64').toString('utf8');
    assert.ok(decoded.includes('@1.1.1.1'), '/sub 应包含 JP 筛选节点');
    assert.ok(decoded.includes('@2.2.2.1'), '/sub 应包含 US 筛选节点');
    assert.ok(!decoded.includes('@4.4.4.1'), '/sub 不应包含未选地区 (DE) 节点');
});
