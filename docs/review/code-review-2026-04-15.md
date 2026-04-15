# 喜马拉雅下载器 — 代码审查报告

**审查日期**: 2026-04-15  
**审查范围**: 全部源码（不含 node_modules/dist）  
**代码规模**: ~1,500 行（不含混淆代码）

---

## 一、项目概览

| 维度 | 评估 |
|---|---|
| **代码规模** | ~1,500 行（不含混淆代码），中小型 CLI 工具 |
| **整体架构** | 合理的分层结构，common/handler/db 各司其职 |
| **代码风格** | ESM + 无 TypeScript，一致性尚可 |
| **成熟度** | 个人项目级别，有明显可改进空间 |

---

## 二、架构评估

### 项目结构

```
ximalaya_downloader/
├── xmd.js              # CLI 入口 (257 行)
├── settings.js         # 路径工具
├── rollup.config.js    # 构建配置
├── config.json         # 用户配置
├── common/             # 基础设施层
│   ├── config.js       # 配置管理（深度合并 + 默认值）
│   ├── utils.js        # HTTP/cookie 工具函数
│   ├── log4jscf.js     # 日志配置
│   ├── browser.js      # Playwright 浏览器封装
│   ├── axioscf.js      # Axios + 重试
│   ├── error.js        # 自定义错误类
│   ├── code.js         # 错误码枚举
│   └── AtomicInteger.js# 计数器
├── db/                 # 数据持久化层
│   ├── basedb.js       # NeDB Promise 封装（基类）
│   ├── albumdb.js      # 专辑仓库
│   └── trackdb.js      # 章节仓库
├── handler/            # 业务逻辑层
│   ├── downloader.js   # 工厂模式
│   ├── abstractDownloader.js  # 抽象基类
│   ├── webSiteDownloader.js   # Web端(www2)实现
│   ├── darwinDownloader.js    # PC端(mac)实现
│   ├── searcher.js     # 搜索功能
│   └── core/           # 解密 & 反爬
│       ├── www2-decrypt.js    # Web端解密
│       ├── mac-decrypt.js     # PC端解密
│       └── ats.2.5.7.js       # 反爬/指纹
└── dist/               # 构建输出
```

### 依赖流图

```
xmd.js
  ├──→ common/config.js
  ├──→ common/log4jscf.js
  ├──→ common/AtomicInteger.js
  ├──→ common/utils.js (sleep)
  ├──→ common/browser.js (BrowserHelper)
  ├──→ db/trackdb.js
  ├──→ db/albumdb.js
  ├──→ handler/downloader.js (DownloaderFactory)
  ├──→ handler/abstractDownloader.js (AbstractDownloader)
  └──→ handler/searcher.js

handler/downloader.js
  ├──→ handler/webSiteDownloader.js
  ├──→ handler/darwinDownloader.js
  ├──→ common/error.js
  └──→ common/log4jscf.js

handler/abstractDownloader.js
  ├──→ common/axioscf.js
  ├──→ common/config.js
  ├──→ common/log4jscf.js
  ├──→ common/utils.js
  └──→ common/error.js

db/albumdb.js, trackdb.js
  ├──→ db/basedb.js
  └──→ common/config.js
```

### 架构优点

1. **合理的分层**: `common/`（基础设施）→ `db/`（持久化）→ `handler/`（业务逻辑）→ `xmd.js`（入口），层次清晰
2. **工厂模式 + 抽象类**: `DownloaderFactory` + `AbstractDownloader` 实现了双通道下载的策略切换
3. **BaseDB 封装**: 将 NeDB 的 callback API 统一包装为 Promise
4. **断点续传**: 通过 track 的 `path` 字段实现已下载检测
5. **并发控制**: 使用 `p-limit` 限制并发，有慢速模式避免风控

### 架构可改进点

1. **全局可变状态**: `AbstractDownloader.browser` 是静态字段 + 全局设值，属于隐式依赖，应改为依赖注入
2. **xmd.js 过于 fat**: 入口文件承担参数解析、目录创建、数据库交互、下载编排等全部职责，应拆分
3. **无 TypeScript / JSDoc**: 缺乏类型定义，API 返回值全靠推测
4. **零测试覆盖**: 重构风险高
5. **Rollup 输出 CJS vs 项目 ESM**: `package.json` 声明 `"type": "module"` 但 rollup 输出 `commonjs`（因 pkg 打包需要），缺少注释说明

---

## 三、严重问题（High）

### 1. `main()` 无顶层错误处理

**文件**: `xmd.js:256`

```js
main()  // 没有 .catch()，unhandled promise rejection 会导致进程静默崩溃
```

**应改为:**

```js
main().catch(err => {
    log.error('致命错误:', err)
    process.exit(1)
})
```

### 2. 分页计算 off-by-one bug

**文件**: `xmd.js:196`

```js
total = Math.floor(trackTotalCount / pageSize) + 1
```

当 `trackTotalCount` 恰好被 `pageSize` 整除时（如 60 / 30 = 2），结果是 3，多请求一页空数据。

**应改为:** `Math.ceil(trackTotalCount / pageSize)`

### 3. `album` 对象被错误覆盖

**文件**: `xmd.js:176`

```js
} else {
    await albumDB.update({'albumId': albumId}, { ... })
    album = albumResp  // albumResp 是 API 返回格式，不一定含 DB 所需字段
}
```

### 4. `nedb` 库已停止维护（2016 年最后发布）

`nedb@1.8.0` 在 Node.js 12+ 上有已知问题。`xmd.js:3-7` 的 polyfill 正是为此修补:

```js
if (!util.isDate) util.isDate = (d) => d instanceof Date;
```

**建议:** 迁移到 `nedb-promises` 或 `better-sqlite3`。

### 5. 速率限制标记不可恢复

**文件**: `downloader.js:85`

```js
item.isLimit = true  // 一旦设置，永不重置
```

README 说"每个整点风控会重置"，但 `isLimit` 永远不会变回 `false`。一旦被限速，该通道在本次运行中永久失效。

---

## 四、中等问题（Medium）

### 6. 每次下载都调用 `_getCurrentUser()`

**文件**: `abstractDownloader.js:474`

下载 1000 首音频 = 1000 次额外 HTTP 请求。应缓存用户信息或改为定期检查。

### 7. cookie 解析 `=` 分割 bug

**文件**: `utils.js:56`

```js
const [key, value] = part.split('=')
// "token=abc=def" → value 只拿到 "abc"，丢失后半段
```

**应改为:**

```js
const idx = part.indexOf('=')
const key = part.slice(0, idx)
const value = part.slice(idx + 1)
```

### 8. `~` 路径替换过于简单

多处出现 `str.replace('~', os.homedir())`：
- 只替换第一个 `~`
- 不检查 `~` 是否在路径开头
- 分散在 xmd.js、albumdb.js、trackdb.js、abstractDownloader.js、browser.js

应抽成统一工具函数。

### 9. axios-retry 只重试 ETIMEDOUT

**文件**: `axioscf.js:8`

不重试 5xx、ECONNRESET、DNS 失败等常见网络问题。建议使用 `axiosRetry.isNetworkOrIdempotentRequestError`。

### 10. Windows 上 `_killQrCode` 硬编码 `PhotosApp.exe`

**文件**: `abstractDownloader.js:97`

用户可能使用其他图片查看器。

### 11. `resource/log4js.json` 是死文件

`log4jscf.js` 直接内联配置，`resource/log4js.json` 未被引用。其中配置的 `maxLogSize`、`backups`、`compress` 均未生效——日志文件会无限增长。

### 12. `package-lock.json` 被 gitignore

对应用级项目（非库），lock 文件应提交以确保依赖一致性。

### 13. `httpCookie` 直接变异入参

**文件**: `utils.js:6-8`

```js
cookie.value = Date.now()  // 直接修改传入对象的属性
```

副作用会影响原始 cookie 对象。

### 14. `searcher.js` readline 接口泄漏

**文件**: `handler/searcher.js:100-109`

`askQuestion` 每次调用都 `createInterface`，在搜索交互的 `while(true)` 循环中反复创建。应在整个交互流程中复用同一个实例。

### 15. QR 码临时文件未清理

**文件**: `abstractDownloader.js:166`

扫码登录成功后从未删除 `~/.xmd/xxx-qrcode.png` 文件。

---

## 五、低优先级 / 代码质量

### 16. `ats.2.5.7.js` 不可维护

从喜马拉雅前端逆向的混淆代码，变量名无意义（`b('0x382')`），含自定义 SHA-1 实现。一旦喜马拉雅更新，极难调试。

**建议:** 至少添加函数级注释。

### 17. 硬编码 GPU 指纹

**文件**: `ats.2.5.7.js:159`

```js
const GPU_RENDERER = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER ...)'
```

代码自带 TODO 已指出此问题。

### 18. `_playUrl` 中的死代码

**文件**: `abstractDownloader.js:439-446`

```js
let e, r = {}, n = 1
r.mediaType && t.some(...)  // r 是空对象，r.mediaType 永远 undefined，此循环不执行
```

### 19. 无优雅退出处理

没有 `process.on('SIGINT', ...)`。用户 Ctrl+C 时浏览器实例可能不会被正确关闭。

### 20. `cleanedStr` 不处理 Windows 保留设备名

**文件**: `xmd.js:60`

未处理 `CON`, `PRN`, `NUL` 等 Windows 保留名称。

---

## 六、按优先级排序的行动建议

| 优先级 | 行动 | 文件 |
|---|---|---|
| P0 | 添加 `main().catch()` | `xmd.js` |
| P0 | 修复分页 `Math.floor + 1` → `Math.ceil` | `xmd.js:196` |
| P1 | 修复 cookie 解析的 `=` 分割 bug | `utils.js:56` |
| P1 | 给 `isLimit` 添加超时重置（如1小时） | `downloader.js` |
| P1 | 缓存 `_getCurrentUser()` 结果 | `abstractDownloader.js` |
| P2 | 提取 `expandHome()` 工具函数 | 多文件 |
| P2 | 使用 `resource/log4js.json` 或删除它 | `log4jscf.js` |
| P2 | 扩展 axios-retry 条件 | `axioscf.js` |
| P2 | 添加 SIGINT 优雅退出 | `xmd.js` |
| P2 | 修复 readline 泄漏 | `searcher.js` |
| P2 | 登录后删除 QR 码文件 | `abstractDownloader.js` |
| P3 | 迁移 nedb → 维护中的替代品 | `db/` |
| P3 | 提交 `package-lock.json` | `.gitignore` |
| P3 | 给 `ats.2.5.7.js` 加注释 | `handler/core/` |

---

## 七、总结

| 类别 | 数量 | 最严重的 |
|---|---|---|
| 逻辑 Bug | 3 | 分页 off-by-one、album 对象覆盖、cookie `=` 解析 |
| 可靠性 | 3 | 无顶层 catch、isLimit 不可恢复、无 SIGINT 处理 |
| 性能浪费 | 2 | 每次下载调 getCurrentUser、axios-retry 条件过窄 |
| 资源泄漏 | 3 | readline 重复创建、QR 码未删除、日志无限增长 |
| 维护性 | 4 | 混淆代码无注释、God File、~替换重复、死文件 |
| 依赖健康 | 2 | nedb 停更、package-lock 未提交 |
| 架构优化 | 3 | 全局静态状态、缺少 DI、CJS/ESM 混搭 |

**整体评价**: 功能完整、设计思路清晰的个人项目。三层架构和工厂/抽象类模式运用得当。主要问题集中在边界 case 处理和长时间运行稳定性上。P0 的几个 bug 修复工作量都很小，性价比高。
