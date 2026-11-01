<div align="center">

# edgetunnel-ipfilter

**edgetunnel + country-specific Cloudflare IP filter, merged into ONE single-file Worker.**
**edgetunnel 与按国家/地区筛选 Cloudflare 优选 IP 的筛选器，整合为一个单文件 Worker。**

Deploy once, get both: the full edgetunnel proxy, and a built-in preferred-IP filter that serves region-filtered IP lists from the very same domain.
部署一次，两件都有：完整的 edgetunnel 代理，外加内建的优选 IP 地区筛选——同一个域名直接输出按地区筛选的 IP 列表。

<p style="color: #ff4d4f; font-weight: bold;">
此项目完全公益性质，🚫 禁止商用，请遵守当地法律法规使用，建议绑定自定义域<br>
Non-profit project. No commercial use. Please comply with local laws and regulations; binding a custom domain is recommended.
</p>

</div>

## Quick start / 快速开始

1. **Deploy** with any method in the deployment section below, and bind your custom domain. 选下面任意一种方式部署，并绑定自定义域名。
2. **Log in**: open `https://<your-domain>/admin`. The password is the `UUID` variable you set at deploy time (if you also set an `ADMIN` variable, use that instead). 打开 `https://<你的域名>/admin` 登录，密码是部署时设置的 `UUID` 变量（另设了 `ADMIN` 变量的用 ADMIN）。
3. **Pick regions**: in the admin panel, open 「优选生成」 and tick the countries/regions you want. 在后台打开「优选生成」，勾选想要的国家/地区。
4. **Get your subscription**: open 「订阅」, copy the subscription link (or scan the QR code), import it into your client (Clash / sing-box / Shadowrocket …) and update — if nodes show up, you are done. The overview page has a four-step first-run guide. 打开「订阅」复制订阅链接（或扫二维码），导入客户端并更新，能刷出节点即部署成功；后台概览页有四步上手清单。

## What is merged / 整合了什么

| Part 组成 | Source 来源 | Notes 说明 |
| --- | --- | --- |
| Proxy core 代理主体 | [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) (via [dukangalex/edgetunnel](https://github.com/dukangalex/edgetunnel), version 2026-10-08) | Original routes and behavior preserved; four surgical patches (below) wire in the filter and optimize hot paths. 原有路由与行为不变；仅有四处外科式补丁（见下）负责接入筛选与优化热点路径 |
| IP filter module (IPF) 优选 IP 筛选模块 | [dukangalex/Cloudflare-Country-Specific-IP-Filter](https://github.com/dukangalex/Cloudflare-Country-Specific-IP-Filter) (optimized edition) | Inlined into the same `_worker.js` with `IPF_` prefix isolation; if the module ever errors, it steps aside and the proxy keeps working. 以 `IPF_` 前缀隔离内嵌进同一个 `_worker.js`；模块异常时自动放行，绝不影响代理主功能 |
| Proxy checker module (CHK) 代理检测模块 | [dukangalex/CF-Workers-CheckSocks5](https://github.com/dukangalex/CF-Workers-CheckSocks5) | Wrapped in an IIFE (zero symbol leakage) behind the admin login; serves the deployment itself (own nodes, configured upstream). 整体包在 IIFE 内零符号泄漏，由后台登录把关；并为本部署自身服务（自有节点、已配置上游） |
| Subscription converter module (CHN) 订阅转换模块 | [dukangalex/subscription-chain-converter-cf](https://github.com/dukangalex/subscription-chain-converter-cf) | The deployment's conversion interface and its default converter (all six formats native in-process, chaining included, zero external dependencies). 本部署的订阅转换接口与默认转换器（六种格式全部进程内原生生成、含链式、零外部依赖） |

**The originals stay originals.** All four source projects remain independent, with their own repositories and their own development — this repository is a separate, new project. It vendors snapshots of them into one Worker through a reproducible merge build: nothing here modifies the originals, and when a source project improves, the improvement flows in on the next rebuild. If you only need one of the parts, use its original project; if you want them working together as one deployment, use this one.
**原项目保持原样。** 四个来源项目各自独立、各自有仓库、各自继续开发；本仓库是一个独立的新项目，通过可复现的合并构建把它们的快照收进同一个 Worker——这里的一切都不改动原项目；原项目有改进时，下一次重建即同步进来。只需要其中某一件时请用它的原项目；想要四件共同作用于一个部署时，用这个。
The filter's data layer comes with the optimizations from the standalone project: the upstream list (~16k lines from [zip.cm.edu.kg](https://zip.cm.edu.kg/all.txt)) is parsed once and cached for 5 minutes instead of being fetched on every request, sampling is unbiased, duplicate/invalid entries (`#Unknown` etc.) are filtered out, and the last good dataset is served if the upstream hiccups.
筛选模块的数据层带有独立版的全部优化：上游列表只解析一次并缓存 5 分钟、随机抽样无偏、重复与无地区条目（`#Unknown` 等）被过滤、上游抖动时降级用上次数据。

Integration & optimization patches on the proxy core / 代理主体的整合与优化补丁（均由 `merge.py` 以锚点补丁形式注入，上游结构变化会让构建直接报错，不会静默产出错版）:

1. **`ipf://` in-process expansion** — subscription generation expands `ipf://` entries in the preferred-IP list through the filter module directly (see below), and the list source is read from KV once instead of twice. 订阅生成在进程内展开优选列表中的 `ipf://` 条目；列表源只读一次 KV（原版读两次）。
2. **Config cache** — `config.json` is cached as raw text in-isolate for 30 s instead of one KV read per request (proxy handshakes included); admin saves invalidate it immediately. 配置原文在 isolate 内缓存 30 秒，不再每请求（含每次代理握手）读一次 KV；后台保存配置时立即失效。
3. **Conversion retry** — a failed subscription-conversion backend call is retried once before an error is surfaced. 订阅转换后端偶发失败时自动重试一次再报错。

## IP filter usage / 筛选器用法

Web UI / 网页界面: open **`https://<your-domain>/ips-ui`**, pick regions, copy ready-made links.
打开 `https://<你的域名>/ips-ui`，点选地区即可生成并复制链接。

| Route 路由 | Format 格式 | Description 说明 |
| --- | --- | --- |
| `/ips/JP-US?limit=10` | `line` (default; override with `?format=`) | Native path of this project. 本项目原生路径 |
| `/edgetunnel/JP-US?limit=10` | `line` | Compatible with links generated by the standalone filter. 兼容筛选器旧链接 |
| `/CFnew/JP-US?limit=10` | `cf_line_short` | Same, CFnew style. 同上，CFnew 风格 |
| `/?api=1&region=JP,US&format=cf_line_short&limit=10` | per `format` | Query-style API. 参数式接口 |
| `/?get_regions=1` | JSON | All region codes sorted by IP count. 全部地区代码（按 IP 数量降序） |

Common parameters / 通用参数: `limit` = max IPs per region (0 = unlimited), `base64=1` = base64-encode the output.  `limit` 为单地区上限（0 不限制），`base64=1` 输出 base64。

Formats / 格式: `line` · `cf_line` · `cf_line_short` · `cf_comma_short` — see the standalone filter's README for samples. 格式样例见筛选器仓库 README。

**Feed the filter into edgetunnel's own subscriptions / 让订阅直接吃本模块的筛选结果**: the two halves are wired together inside the process. In the admin panel, set the custom preferred-IP list (KV `ADD.txt`) to an `ipf://` entry and turn OFF random-IP mode in the subscription-generation settings:

在管理后台把自定义优选 IP 列表（KV 的 `ADD.txt`）填成 `ipf://` 条目，并关掉订阅生成的随机 IP 模式：

```text
ipf://JP-HK-SG-US?limit=10
```

Every `/sub` generation then expands that entry in-process into fresh country-filtered IPs from the built-in module (regions separated by `-`, `limit` = max per region). No HTTP self-request is involved — Cloudflare forbids a Worker from fetching its own routes, so the older "paste your own filter URL into ADD" approach cannot work from the same deployment; `ipf://` is the supported way. One deployment is fully self-contained: proxy, filter and subscription source in a single `_worker.js`.
此后每次生成 `/sub` 订阅，都会在进程内把该条目展开为本模块的国家筛选结果（地区用 `-` 连接，`limit` 为单地区上限）。全程不发 HTTP 自调用——Cloudflare 禁止 Worker 请求自身路由，所以"把本站筛选 URL 填进 ADD"这种旧接法在同部署内必然失败，`ipf://` 才是正解。一个部署即自包含：代理、筛选、订阅数据源全在同一个 `_worker.js` 里。

#### Your regions, your counts / 地区与数量完全自选

The `ipf://JP-HK-SG-US?limit=10` line is only the shipped default — nothing about it is hard-coded. The entry is plain data in the preferred-IP list, so every deployer chooses freely. Fresh deployments even work out of the box: random-IP mode now defaults to OFF in this project, and with no custom list set, the default entry above is used automatically.
`ipf://JP-HK-SG-US?limit=10` 只是出厂默认，代码里没有任何写死。它就是优选列表里的一行普通数据，每个部署者都能自由改。新装开箱即用：本项目已把随机 IP 模式的默认值改为关，未设置自定义列表时自动使用上面这条默认条目。

| Want 想要 | Write 写 |
| --- | --- |
| Only Japan, 20 nodes 只要日本 20 个 | `ipf://JP?limit=20` |
| Five regions, 5 each 五个地区各 5 个 | `ipf://JP-HK-SG-TW-KR?limit=5` |
| A region with no cap 某地区不限量 | `ipf://DE?limit=0` |
| Different caps per set 不同组合不同量 | two lines 两行：`ipf://JP?limit=20` + `ipf://US-DE?limit=5` |
| Filtered + hand-picked mixed 筛选与手填混排 | add plain lines like `1.2.3.4:443#MyNode` next to the `ipf://` lines 在 `ipf://` 行旁加 `1.2.3.4:443#我的节点` 这类普通行 |

- **Upstream admin UI, self-hosted, with fused modules / 上游管理界面自托管 + 功能融合**: the admin (`/admin`) and login (`/login`) pages are the upstream project's EDT-Pages pages, vendored into the Worker and served by the deployment itself (nothing is fetched from the Pages site at runtime), so upstream users keep their exact operating habits and every upstream feature. This project's additions live inside the same pages as native modules: a chain module beside the converter settings, a region picker in the preferred-subscription module (tick regions, set the count, one click writes the `ipf://` entry), and a tools module linking the region filter, proxy checker and chain converter. 管理与登录页为上游 EDT-Pages 页面，内嵌进 Worker 由部署自身下发（运行时不抓取 Pages 站点），上游用户的操作习惯与全部上游功能原样保留；本项目的加法以同页原生模块融合：订阅转换旁的链式代理模块、优选订阅生成内的地区勾选（点选地区、填数量、一键写入 `ipf://` 条目）、以及链向地区筛选/代理检测/链式转换的整合工具模块。
- **Living pool / 活节点池**: subscription generation probes every candidate in-process before serving it — dead IPs are dropped, the fastest live ones win, and results are remembered in a KV health registry, so the pool keeps healing itself through ordinary use (no cron, no setup). The card displays pool vitality live. 订阅生成前逐个实测候选节点：死的剔除、快的优先，结果记入 KV 健康档案，池子在日常使用中自我修复（无定时任务、无配置）。卡片实时显示节点池活性。
- **Built-in subscription converter / 内置订阅转换**: [subscription-chain-converter-cf](https://github.com/dukangalex/subscription-chain-converter-cf) integrated as the conversion interface. All six formats covered, **all of them generated natively in-process** (since integration 2.0): Clash / Mihomo, sing-box, V2Ray, Surge, Loon and Quantumult X — including chain-proxy structuring in every format that can express it — with **zero external dependencies**; no conversion ever leaves the deployment. **This built-in converter is the default**: edgetunnel's admin 订阅转换后端 field ships empty, and empty means built-in — type an external backend address there only if you want to override it. Force built-in even with a backend set via `订阅转换配置.内置转换: true`, and set `订阅转换配置.链式入口` (an entry subscription URL or `|`-separated node links) to get chained output. 管理台「整合工具」区有三个整合模块的醒目入口；登录页与转换页带本项目仓库与作者频道链接。 Converter page at `/convert`, short links via `POST /shorten` → `/m|s|c/<code>`, direct endpoints `/conv`, `/chain`, `/sub?url=`. Rule files mirror lazily into the KV under `/rules/…`; warm them all with an admin-authenticated `POST /rules-refresh`. 六种格式齐全且全部原生生成（含链式）、零外部依赖；转换页 /convert、短链、规则懒镜像都在同一部署内。
- **Built-in proxy checker / 内置代理检测**: [CF-Workers-CheckSocks5](https://github.com/dukangalex/CF-Workers-CheckSocks5) integrated — page at `/socks5-ui`, checking SOCKS5 / HTTP / HTTPS / TURN / SSTP proxies (single & batch, exit-IP info, latency). Unlike upstream, which ships unauthenticated, every checker route here requires the deployment's admin login. 后台卡片里有入口；未登录访问会跳登录页、接口返回 401。
- **One whole, not four tools / 融为一体**: the modules work for each other, not just side by side. The checker page opens with a panel listing **this deployment's own nodes** (the living pool's actual picks, with probe status) and can **verify the SOCKS5 upstream configured in the admin page** with one click; conversion endpoints (`/conv`, `/chain`, `/sub?url=`) accept `regions=JP-HK` so the **filter also applies while converting** any subscription (name-based detection first, the filter's dataset as reverse lookup for IP hosts, undetermined nodes kept); the admin tools card shows the **one shared pool's** vitality. 四个模块互相咬合：检测为本部署的节点与配置服务、转换时也能按国家筛选、节点池四方共用、状态一处可见。
- **Its own face / 独立视觉**: every page is built or restructured by this project, skeleton-first (see DESIGN.md): the console's left rail, the login page's brand wall, the filter page's two-pane workbench (region rail + results), the checker's single-column workspace with a summary strip on top, the converter's two-column form with a restore rail — no page shares its upstream layout, and the teal→blue token system ties them together. 每一页的骨架都由本项目自建或重排：管理台左侧栏、登录页品牌墙、筛选页双栏工作台（地区栏 + 结果区）、检测页单列工作区加顶部状态条、转换页双列表单加恢复右轨——没有一页与上游同构，青绿→蓝令牌系统贯穿全站。
- Any of the 70+ region codes works — browse them visually at `/ips-ui` or fetch the full list from `/?get_regions=1`. 全部 70 多个地区代码任选，可在 `/ips-ui` 图形化浏览，或用 `/?get_regions=1` 取全量列表。
- Entries take effect on the next subscription fetch; no redeploy needed. 改完下一次拉订阅即生效，无需重新部署。
- Prefer the upstream behavior instead? Turn random-IP mode back ON in the subscription-generation settings and the `ipf://` entries are bypassed. 想用回上游行为：在订阅生成设置里把随机 IP 模式打开即可，`ipf://` 条目会被绕过。

Filter UI preview / 筛选界面预览:

<img src="https://raw.githubusercontent.com/dukangalex/Cloudflare-Country-Specific-IP-Filter/main/Image/Light.png" width="100%" style="border-radius: 10px;">

## Proxy usage / 代理用法

Identical to upstream edgetunnel: set the `ADMIN` variable, open `/admin` to manage, and use `/sub` subscriptions as documented by the upstream project. For the full manual see the [upstream README](https://github.com/cmliu/edgetunnel#readme) and this repo's [CHANGELOG](CHANGELOG).
与上游 edgetunnel 完全一致：设置 `ADMIN` 变量后进入 `/admin` 管理、按上游文档使用 `/sub` 订阅。完整手册见上游 README 与本仓库 CHANGELOG。

## Deployment / 部署

Deployment is exactly as simple as upstream edgetunnel — the same three ways, the same two finishing steps (`ADMIN` variable + KV binding named `KV`), and **zero extra configuration for the filter**: it works out of the box, and subscriptions use the built-in country filter by default. Still a single `_worker.js` (~5.2 MB raw, ~1.1 MB gzip, same size class as upstream).
部署和上游 edgetunnel 一样简单：同样的三条路、同样的两个收尾动作（`ADMIN` 变量 + 名为 `KV` 的 KV 绑定），筛选功能**零额外配置**，装好即用、订阅默认走内置国家筛选。仍然是单个 `_worker.js`（约 5.2 MB，gzip 约 1.1 MB，与上游同量级）。

### A. Pages upload / Pages 上传部署（recommended 推荐）

1. Download this repo's zip: [main.zip](https://github.com/dukangalex/edgetunnel-ipfilter/archive/refs/heads/main.zip). 下载本仓库 zip。
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**, name the project, upload the zip, **Deploy site**. 控制台选"上传资产"，取名、传 zip、部署站点。
3. **Settings → Environment variables**: add `ADMIN` = your admin password (optionally `UUID`). 在设置里加变量 `ADMIN`（管理员密码，可选再加 `UUID`）。
4. **Settings → Functions → KV namespace bindings**: bind a KV namespace with the variable name **`KV`**. 绑定 KV 命名空间，变量名必须填 `KV`。
5. Back in **Deployments**, create a new deployment (re-upload the zip) so the variables take effect, then open `https://<your-project>.pages.dev/admin`. 回部署页新建一次部署让变量生效，然后访问 `/admin` 登录。

### B. Pages + GitHub

1. **Create → Pages → Connect to Git**, select this repository. 连接本仓库。
2. Build settings / 构建设置: Production branch `main`, Framework preset `None`, Build command *(empty 留空)*, Build output directory `/` — the root `_worker.js` is picked up automatically. 根目录 `_worker.js` 自动识别。
3. Add the `ADMIN` variable in the same flow, then **Save and Deploy**. 同流程里加 `ADMIN` 变量后保存部署。
4. Bind the KV namespace as variable **`KV`** (Settings → Functions), retry the deployment, open `/admin`. 绑定名为 `KV` 的 KV 后重试部署，访问 `/admin`。
5. Every later push to `main` redeploys automatically. 此后推送 `main` 自动重新部署。

### C. Workers

1. Create a Worker and replace its code with this repo's `_worker.js`, then deploy. 新建 Worker，代码整体替换为 `_worker.js` 后部署。
2. **Settings → Variables**: add `ADMIN` (and optionally `UUID`). 设置里加变量 `ADMIN`（可选 `UUID`）。
3. **Settings → Bindings**: add a KV namespace binding named **`KV`**. 加名为 `KV` 的 KV 绑定。
4. (Optional) **Settings → Domains & Routes**: attach your custom domain, then open `/admin`. （可选）绑定自定义域名后访问 `/admin`。

> Tip: `_worker.js` is ~5 MB; if a dashboard editor ever stalls saving it, use the Pages upload path or Wrangler instead — same result. 小提示：文件约 5 MB，个别时候控制台编辑器保存大文件会卡，用 Pages 上传或 Wrangler 部署效果相同。

### D. Wrangler CLI

```bash
npx wrangler deploy   # wrangler.toml is included; add the ADMIN variable and KV binding afterwards
```

## Development / 开发

```bash
npm test   # offline smoke tests: IPF routes + edgetunnel fallthrough, Node >= 18
```

The merge is reproducible: the IPF module is the standalone filter's optimized `_worker.js` logic, renamed with the `IPF_` prefix, plus a small dispatcher hooked in just before edgetunnel's own routing. If the dispatcher returns nothing, edgetunnel handles the request exactly as upstream.
整合方式可复现：IPF 模块即筛选器优化版的逻辑（符号统一加 `IPF_` 前缀），加一个挂在 edgetunnel 主路由之前的小分发器；分发器不命中时，请求与上游原版的处理完全一致。

## Credits / 鸣谢

This project integrates and builds on the work of others — everything it uses, embeds or calls is listed here. 本项目集成并受益于以下项目、数据与服务，凡引用到的都在这里列明。

**Source projects / 来源项目**

- [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) — the proxy core. License: GPL-2.0 (see [LICENSE](LICENSE), retained from upstream). 代理主体。
- [dukangalex/Cloudflare-Country-Specific-IP-Filter](https://github.com/dukangalex/Cloudflare-Country-Specific-IP-Filter) — the country IP filter, itself crediting CM大佬 ([cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)), Joey大佬 ([byJoey/cfnew](https://github.com/byJoey/cfnew)) and 6佬 ([666OS/ClashMac](https://github.com/666OS/ClashMac)). 国家优选筛选。
- [dukangalex/CF-Workers-CheckSocks5](https://github.com/dukangalex/CF-Workers-CheckSocks5) — the SOCKS5 proxy checker, itself built on [ToiCF/CF-Workers-HTTPS](https://github.com/ToiCF/CF-Workers-HTTPS), [ToiCF/CF-Workers-TURN](https://github.com/ToiCF/CF-Workers-TURN) and [ToiCF/CF-Workers-SoftEther](https://github.com/ToiCF/CF-Workers-SoftEther), and using [iplocate.io](https://www.iplocate.io/) for IP geolocation. 代理检测。
- [dukangalex/subscription-chain-converter-cf](https://github.com/dukangalex/subscription-chain-converter-cf) — the subscription converter. 订阅转换。

**Admin UI / 后台页面**

- [EDT-Pages](https://edt-pages.github.io/) — up to integration 2.1 the admin and login page bodies came from the EDT-Pages project (restyled at serve time). Since 2.2 both pages are this project's own and nothing is fetched from EDT-Pages anymore; the credit stays for the versions that used it. 整合版 2.1 及之前，后台与登录页面本体来自 EDT-Pages（下发时改写品牌与指向）；2.2 起两页已全部自研、不再取用 EDT-Pages，此致谢为使用过它的版本保留。

**Data & services / 数据与服务**

- The Cloudflare preferred-IP dataset served via zip.cm.edu.kg (maintained by cmliu) — the candidate pool for the IP filter. 优选 IP 数据集（筛选模块的候选池来源）。
- [VPNGate](https://www.vpngate.net/) (University of Tsukuba) — the optional free SSTP node pool offered in the admin page, via sub.cmliussss.net. 后台可选的免费 SSTP 节点池。
- The proxy-IP check service at api.check.proxyip.cmliussss.net — used by the admin page's reverse-proxy check. 后台反代检测所用服务。
- [cmliu/CF-Workers-UsagePanel](https://github.com/cmliu/CF-Workers-UsagePanel) — the optional companion that provides a Cloudflare UsageAPI address for the admin usage panel. 后台用量面板的可选配套。
- [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) — remote config templates referenced by edgetunnel's flow when a deployer configures an external subconverter backend. 外部转换后端流程引用的远程配置模板。

**Rules / 规则集**

- [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat), [SagerNet/sing-geosite](https://github.com/SagerNet/sing-geosite) and [SagerNet/sing-geoip](https://github.com/SagerNet/sing-geoip) — the rule files mirrored under `/rules/`. 规则镜像的来源。

**Libraries & platform / 代码库与平台**

- [js-yaml](https://github.com/nodeca/js-yaml) (MIT) — vendored into the converter core.
- [EDT-Pages](https://github.com/cmliu/edgetunnel) — the admin and login pages are the upstream project's pages, vendored into the Worker (self-hosted, nothing fetched at runtime) with this project's modules fused in. 管理与登录页为上游项目的页面，内嵌进 Worker 自托管（运行时不抓取），并融合了本项目的模块。
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, Kazuhiko Arase) — vendored into the admin console for offline QR codes.
- [Leaflet](https://leafletjs.com/) (BSD-2-Clause) and [OpenStreetMap](https://www.openstreetmap.org/) contributors (ODbL) — the checker's map.
- [Lucide](https://lucide.dev/) icons (ISC) and [Tailwind CSS](https://tailwindcss.com/) (MIT) — icons and utility styles on the filter page, inlined at build time.
- [Cloudflare Workers](https://workers.cloudflare.com/) — the runtime platform.

- Open source; forks are welcome, please keep the credits. 已开源，支持二创，二创请保留鸣谢链接。
