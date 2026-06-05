# 启动屏远程配置（可热更新 / 投放广告）

App 默认显示**内置动效启动屏**（粒子汇聚 + 罗盘光环 + 标语）。
同时每次启动会在**后台**拉取一份远程配置 `splash-config.json`，命中条件时
**下次冷启动**自动换成你指定的图片/广告——**改图不需要发版**。

## 工作原理（不阻塞启动、永不崩溃）

1. 启动时只读**本地缓存**的配置决定本次显示什么 → 不卡白屏。
2. 同时后台静默拉远程配置 + 预下载图片 → 写缓存 → **下次**启动生效。
   （所以新广告从「发布后第 2 次冷启动」开始展示，这是行业标准做法。）
3. 任意异常（无网络 / 拉取失败 / 图片没下全 / 配置非法 / 不在投放期）
   一律**回退到内置动效**。

## 配置地址（接口）

代码常量：`src/services/SplashConfigService.js` → `CONFIG_URL`

```
https://raw.githubusercontent.com/chunguangwei/ImagePilot/main/splash-config.json
```

- 图片 `imageUrl` 可放 GitHub，也可放 **CDN**（任意可公开访问的 https 直链）。
- 以后整体换 CDN / 自建后端：只改 `CONFIG_URL` 这一处即可。

## 字段说明（`splash-config.json`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | number | 配置版本号，自增即可 |
| `enabled` | bool | 总开关；`false` = 强制用内置动效 |
| `type` | `"builtin"` \| `"image"` | `builtin`=内置动效；`image`=远程图/广告 |
| `id` | string | 本次投放标识（便于你自己追踪） |
| `imageUrl` | string | 广告图直链（png/jpg/webp）。`type=image` 必填 |
| `link` | string | 点击图片跳转的外链（留空则不可点） |
| `linkEnabled` | bool | 是否允许点击跳转；为 true 且 link 非空才生效，并显示「广告」角标 |
| `durationMs` | number | 展示时长（1500–8000，默认 4000），到时自动进主页 |
| `skippable` | bool | 是否显示「跳过」按钮（默认 true） |
| `skipAfterMs` | number | 多少毫秒后出现跳过按钮（默认 1000） |
| `startAt` | ISO 时间 / null | 投放开始时间（UTC，如 `2026-07-01T00:00:00Z`）；null=不限 |
| `endAt` | ISO 时间 / null | 投放结束时间；过期自动回退内置动效 |

## 换图 / 上广告操作步骤

1. 把广告图传到 GitHub（仓库里或某个 Release 的 asset）或你的 CDN，拿到 https 直链。
2. 编辑本仓库根目录 `splash-config.json`：把 `type` 改成 `"image"`，填 `imageUrl`，
   按需填 `link` / `startAt` / `endAt`，`version` 自增。
3. commit 到 `main`。用户**下次冷启动**起，活动期内即展示该广告，过期自动回退动效。

### 示例：一次限时广告

```json
{
  "version": 2,
  "enabled": true,
  "type": "image",
  "id": "summer-2026",
  "imageUrl": "https://your-cdn.example.com/ads/summer.jpg",
  "link": "https://your-landing.example.com/summer",
  "linkEnabled": true,
  "durationMs": 4000,
  "skippable": true,
  "skipAfterMs": 1000,
  "startAt": "2026-07-01T00:00:00Z",
  "endAt": "2026-07-15T23:59:59Z"
}
```

### 关掉广告、恢复内置动效

把 `type` 改回 `"builtin"`（或 `enabled` 设为 `false`），`version` 自增，commit 即可。

## 隐私说明

启用本功能后，App 每次启动会向 `CONFIG_URL` 发起一次网络请求（仅拉配置/图片，
不上传任何用户数据）。这与「仅你可见 · 不联后端」的定位存在取舍，请按产品策略决定是否长期开启。
