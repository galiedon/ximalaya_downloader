# 喜马拉雅搜索接口文档

## 概述

本工具需要通过喜马拉雅平台的搜索接口按关键词查找专辑。喜马拉雅有两套搜索接口，反爬策略不同：

| 接口 | 域名 | 风控等级 | 当前状态 |
|---|---|---|---|
| **WSA 搜索**（主接口） | `searchwsa.ximalaya.com` | 低 | ✅ 可用 |
| **主站搜索**（备选） | `www.ximalaya.com` | 高 | ⚠️ 需 wfp 指纹 |

代码中采用**自动降级策略**：优先 WSA → 失败则降级主站。

---

## 1. WSA 搜索接口（主接口）

### 基本信息

- **服务地址**: `https://searchwsa.ximalaya.com/front/v1`
- **底层引擎**: Apache Solr
- **HTTP 方法**: GET
- **认证要求**: 无（仅需 Android UA）

### 请求参数

| 参数 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `kw` | string | 是 | 搜索关键词 | `安德的游戏` |
| `core` | string | 是 | 搜索类型：`album`(专辑) / `track`(声音) | `album` |
| `page` | string | 是 | 页码，从 1 开始 | `1` |
| `rows` | string | 是 | 每页条数 | `20` |
| `condition` | string | 是 | 排序条件 | `relation` |
| `device` | string | 是 | 设备类型 | `android` |
| `appid` | string | 是 | 固定值 | `0` |
| `spellchecker` | string | 否 | 启用拼写纠错 | `true` |
| `paidFilter` | string | 否 | 过滤付费内容 | `false` |
| `search_version` | string | 否 | 搜索版本 | `2.8` |
| `live` | string | 否 | 是否包含直播 | `true` |

### 请求头

```
User-Agent: Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36
```

> 需要 Android User-Agent，使用桌面 UA 可能被拒绝。

### 响应结构

```json
{
  "responseHeader": {
    "QTime": 0,
    "params": { "q": "安德的游戏", "core": "album", ... }
  },
  "response": {
    "numFound": 28,
    "totalPage": 2,
    "start": 0,
    "docs": [
      {
        "id": "51994207",
        "title": "【类星体剧场】安德的游戏丨死者代言人丨安德的影子",
        "nickname": "类星体剧场",
        "tracks": 169,
        "category_title": "有声图书",
        "intro": "年度科幻震撼来袭...",
        "isPaid": false,
        "cover_path": "//imagev2.xmcdn.com/..."
      }
    ]
  },
  "recommendWord": "..."
}
```

### 字段映射（WSA → 内部模型）

| WSA 字段 | 内部字段 | 说明 |
|---|---|---|
| `id` | `albumId` | 专辑 ID |
| `title` | `title` | 专辑标题（可能含 HTML 高亮标签） |
| `nickname` | `nickname` | 主播名称 |
| `tracks` | `trackCount` | 音频集数 |
| `intro` | `intro` | 简介 |
| `isPaid` | `isPaid` | 是否付费 |
| `category_title` | `categoryTitle` | 分类名称 |

### 调用示例

```bash
curl 'https://searchwsa.ximalaya.com/front/v1?appid=0&core=album&kw=%E5%AE%89%E5%BE%B7%E7%9A%84%E6%B8%B8%E6%88%8F&page=1&rows=20&condition=relation&device=android&spellchecker=true&paidFilter=false&search_version=2.8&live=true' \
  -H 'User-Agent: Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36'
```

---

## 2. 主站搜索接口（备选）

### 基本信息

- **服务地址**: `https://www.ximalaya.com/revision/search/main`
- **HTTP 方法**: GET
- **认证要求**: 需要 wfp 指纹 cookie，否则返回 `riskLevel=5`

### 请求参数

| 参数 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `kw` | string | 是 | 搜索关键词 | `安德的游戏` |
| `page` | number | 是 | 页码 | `1` |
| `core` | string | 是 | 搜索类型 | `album` |
| `rows` | number | 是 | 每页条数 | `20` |
| `condition` | string | 是 | 排序条件 | `relation` |
| `device` | string | 是 | 设备类型 | `iPhone` |
| `spellchecker` | boolean | 否 | 拼写纠错 | `true` |
| `paidFilter` | boolean | 否 | 过滤付费 | `false` |

### 风控机制

该接口受喜马拉雅前端指纹系统（fireeyes）保护：

1. **wfp cookie**: 由 `ats.2.5.7.js` 中的 `getWfp.send()` 生成，需向 `/xuid-web-fireeyes/report/v1` 上报浏览器指纹后获得
2. **riskLevel**: 风控等级 0-5，>=5 时拒绝返回搜索结果
3. **返回格式**: 被拦截时返回 `{ "data": { "reason": "risk invalid", "riskLevel": 5 } }`

### 响应结构（正常情况）

```json
{
  "ret": 200,
  "data": {
    "album": {
      "totalPage": 3,
      "docs": [
        {
          "albumId": 51994207,
          "title": "<em>安德的游戏</em>",
          "nickname": "类星体剧场",
          "trackCount": 169,
          "intro": "...",
          "isPaid": false
        }
      ]
    }
  }
}
```

### 响应结构（被风控拦截）

```json
{
  "ret": 200,
  "data": {
    "reason": "risk invalid",
    "illegal": false,
    "kw": "安德的游戏",
    "riskLevel": 5
  }
}
```

---

## 3. 其他相关接口（非搜索）

以下接口在下载流程中使用，记录于此供参考。

### 3.1 获取专辑简况

```
GET https://www.ximalaya.com/revision/album/v1/simple?albumId={id}
Headers: Cookie, Referer (指向专辑页面)
```

### 3.2 获取专辑 SEO 信息

```
GET https://www.ximalaya.com/tdk-web/seo/search/albumInfo?albumId={id}
Headers: Cookie, Referer
```

### 3.3 获取章节列表

```
GET https://www.ximalaya.com/revision/album/v1/getTracksList?albumId={id}&pageNum=1&pageSize=30
注意: 需通过 Playwright 浏览器发起，直接 HTTP 调用会被拦截
```

### 3.4 获取音频基础信息

```
GET https://www.ximalaya.com/mobile-playpage/track/v3/baseInfo/?trackId={id}
注意: 需通过 Playwright 浏览器发起
```

### 3.5 登录二维码

```
GET https://passport.ximalaya.com/web/qrCode/gen?level=L&source={clientName}
GET https://passport.ximalaya.com/web/qrCode/check/{qrId}/{timestamp}
```

### 3.6 浏览器指纹上报（wfp 获取）

```
POST https://www.ximalaya.com/xuid-web-fireeyes/report/v1
Body: 加密的浏览器指纹数据（由 ats.2.5.7.js 生成）
Params: cid, p, m, c, e, s, r, t, v
Response: { "data": { "openid": "ACM..." } }  // openid 即 wfp cookie 值
```

---

## 4. 接口获取流程（逆向过程记录）

### 问题背景

原搜索功能使用主站 `/revision/search/main` 接口，2024 年后喜马拉雅加强了前端风控，
无 wfp 指纹 cookie 的请求会被 `riskLevel=5` 拒绝。

### 排查过程

1. **直接调用主站搜索 API** → 返回 `risk invalid`，riskLevel=5
2. **携带 wfp cookie 调用** → 仍被拒绝（wfp 需配合完整浏览器指纹）
3. **通过 Playwright 浏览器内 fetch()** → 仍被拒绝（headless 浏览器指纹异常）
4. **尝试前端 `/so/{keyword}` 页面** → SSR 页面，依赖客户端 JS 渲染搜索结果，headless 下无法获取
5. **尝试 `/search?kw=` 页面** → 风控同样拦截内部 API 调用
6. **扫描替代端点**:
   - `m.ximalaya.com/revision/search/main` → 同样被风控
   - `m.ximalaya.com/m-revision/front/v1` → 404
   - 各类 suggest/autocomplete 端点 → 均 404

### 突破口

通过 GitHub 开源项目（[musicdl](https://github.com/CharlesPikachu/musicdl)）发现独立搜索服务：

```
https://searchwsa.ximalaya.com/front/v1
```

该服务是喜马拉雅的 Solr 搜索后端，直接暴露了查询接口。使用 Android User-Agent 即可正常访问，
无需 wfp 指纹、无需登录 cookie。响应格式为标准 Solr JSON。

### 验证结果

搜索「安德的游戏」返回 28 条结果，响应时间 < 100ms，与主站搜索结果一致。
