# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

- 安装依赖：`pnpm install`
- 启动开发环境：`pnpm dev`
  - 会先执行 `pnpm gen:manifest`，再启动 Next.js 开发服务器
  - 默认监听 `0.0.0.0`
- 生产构建：`pnpm build`
- 启动生产环境：`pnpm start`
- 代码检查：`pnpm lint`
- 严格 lint：`pnpm lint:strict`
- 自动修复 lint + 格式：`pnpm lint:fix`
- 类型检查：`pnpm typecheck`
- 运行全部测试：`pnpm test`
- 监听模式测试：`pnpm test:watch`
- 运行单个测试文件：`pnpm test -- <path-to-test-file>`
- 格式化：`pnpm format`
- 检查格式：`pnpm format:check`

## 技术栈与运行方式

- Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS 4
- 包管理器固定为 `pnpm@10.14.0`
- 生产环境 `next.config.js` 开启 `output: 'standalone'`，Docker 镜像依赖该输出
- Jest 通过 `next/jest` 集成，别名 `@/* -> src/*`、`~/* -> public/*`
- SVG 在 Turbopack 中通过 `@svgr/webpack` 处理

## 项目整体架构

### 1. 应用骨架：`src/app/layout.tsx`

应用的全局结构在 `src/app/layout.tsx`：

- 服务端调用 `getConfig()` 读取站点配置，并把一部分运行时配置注入 `window.RUNTIME_CONFIG`
- 全局 Provider 组合顺序固定：
  - `ThemeProvider`
  - `QueryProvider`
  - `GlobalCacheProvider`
  - `DownloadProvider`
  - `WatchRoomProvider`
  - `SiteProvider`
- 导航、全局错误处理、下载面板、观影室聊天浮窗都挂在 layout 层，因此很多页面切换时不会卸载

如果改全局状态、主题、导航、全局浮层、运行时配置，先看这里。

### 2. 页面层：App Router + “服务端取配置，客户端承载交互”

本项目页面基本采用以下模式：

- `src/app/**/page.tsx` 负责服务端读取配置、鉴权信息或初始参数
- 复杂交互放在客户端组件中，例如首页 `src/app/HomeClient.tsx`、播放页 `src/app/play/page.tsx`
- 首页明确选择“客户端加载内容数据”而不是服务端 prefetch；不要轻易改回 SSR 数据预取，否则会影响当前的切页和 loading 体验

### 3. 配置中心：`src/lib/config.ts`

`src/lib/config.ts` 是最关键的服务端配置入口，承担：

- 站点基础配置装配
- 管理后台配置读取
- 配置文件 / 订阅配置与数据库配置合并
- 视频源、直播源、自定义分类的“保留用户手动修改 + 同步订阅变化”逻辑

理解这个项目时，要把 `getConfig()` 当作大多数服务端能力的源头。很多 API、layout、管理页、登录策略、功能开关都依赖它。

### 4. 存储抽象：`src/lib/db.ts`

项目不是单一存储实现，而是统一走 `DbManager`：

- 通过 `NEXT_PUBLIC_STORAGE_TYPE` 在以下后端之间切换：
  - `localstorage`
  - `redis`
  - `upstash`
  - `kvrocks`
  - `sqlite`
- `src/lib/db.ts` 暴露统一的播放记录、收藏、提醒、用户、统计等接口
- 各具体实现分散在：
  - `src/lib/redis.db.ts`
  - `src/lib/upstash.db.ts`
  - `src/lib/kvrocks.db.ts`
  - `src/lib/sqlite.db.ts`
  - 公共 Redis 兼容逻辑在 `src/lib/redis-base.db.ts`

修改数据层时不要直接假设只有一种存储；要确认改动是否同时兼容多后端。

### 5. API 层：`src/app/api/**/route.ts`

项目的大部分业务能力都通过 App Router Route Handlers 暴露，API 规模很大，大致可分为：

- 前台业务接口：搜索、详情、播放、收藏、提醒、弹幕、短剧、直播、网盘、YouTube、Bilibili、Emby、TMDB、豆瓣等
- 管理接口：集中在 `src/app/api/admin/**`，通常会结合 `src/lib/admin-auth.ts` 或配置读写
- 基础配置接口：如 `src/app/api/server-config/route.ts`
- 代理接口：如 `src/app/api/proxy/**`、`src/app/api/video-proxy/route.ts`、`src/app/api/image-proxy/route.ts`

该项目的“页面功能”通常都能在 `src/app/api/**` 找到对应服务端入口，不要只在组件层找逻辑。

### 6. 搜索与聚合链路

搜索是项目核心能力之一，关键链路是：

- `src/app/api/search/route.ts`：统一搜索入口
- `src/lib/downstream.ts`：对下游资源站发起并行搜索、分页拉取、结果清洗、缓存
- `src/lib/config.ts`：提供可用源配置
- `src/lib/search-cache.ts`、`src/lib/search-ranking.ts`：搜索缓存与排序相关能力

重要特征：

- 会对多个站点并行搜索
- 会生成搜索变体（繁简/别名策略）
- 会对分页结果继续抓取，但受配置项 `SearchDownstreamMaxPage` 限制
- 有黄色内容过滤开关，依赖 `config.SiteConfig.DisableYellowFilter`

搜索慢、结果异常、源不可用时，通常要同时检查 API 路由、downstream 聚合、配置源列表、缓存策略。

### 7. 前端数据获取：React Query + 少量自定义全局缓存

前端异步数据主要通过 TanStack Query 管理：

- `src/components/QueryProvider.tsx` 注入全局 `QueryClient`
- `src/lib/get-query-client.ts` 统一 QueryClient 配置
- `src/hooks/*` 中有大量 query/mutation 封装
- `QueryProvider` 还会监听播放记录、收藏、提醒的更新事件，并统一 `invalidateQueries`

此外还存在一个较轻量的自定义缓存层：

- `src/contexts/GlobalCacheContext.tsx`
- 主要用于首页数据的 stale-while-revalidate 风格缓存

新增前端数据流时，优先沿用 React Query 既有模式；只有明显属于全局首页级缓存时再考虑 `GlobalCacheContext`。

### 8. 播放页是最高复杂度页面之一

`src/app/play/page.tsx` 集中了大量前端业务：

- HLS 播放
- ArtPlayer 插件集成
- 弹幕
- 收藏 / 播放记录
- 观影室同步
- 下载
- 音轨切换
- 网盘 / ACG / 评论 / 豆瓣详情扩展能力

如果要改播放体验，先评估是否会影响：

- `src/components/play/**`
- `src/app/play/hooks/**`
- `src/hooks/useDanmu.ts`
- `src/components/WatchRoomProvider.tsx` 与观影室同步逻辑
- `src/contexts/DownloadContext.tsx` 下载逻辑

这是一个高度耦合页面，修改时优先做局部改动，避免破坏既有功能。

### 9. 下载体系是独立子系统

离线下载不是简单按钮，而是一套完整客户端子系统：

- Provider：`src/contexts/DownloadContext.tsx`
- UI：`src/components/download/**`
- 实现：`src/lib/download/**`
- 持久化依赖 IndexedDB：`src/lib/download/download-idb.ts`

其特点：

- 支持 M3U8 解析、分片下载、暂停恢复
- 支持多种 stream 保存模式检测与切换
- 任务会从 IndexedDB 恢复

改下载功能时，注意它是浏览器端持久状态，不只是 React 内存状态。

### 10. 观影室是另一套独立实时子系统

观影室相关代码横跨多层：

- Provider：`src/components/WatchRoomProvider.tsx`
- Hooks：`src/hooks/useWatchRoom.ts`、`src/hooks/useLiveSync.ts`、`src/hooks/useScreenShare.ts`、`src/hooks/useVoiceChat.ts`
- 页面：`src/app/watch-room/**`
- 配置接口：`src/app/api/watch-room/config/route.ts`
- 类型：`src/types/watch-room.types`

它依赖独立服务端地址与 authKey 配置，不等同于普通站内接口。改动前先确认是在修改：

- 仅前端房间体验
- 观影室配置读取
- 还是与外部实时服务的协议/连接流程

### 11. 管理后台是配置与运营中枢

`src/app/admin/page.tsx` 是一个超大聚合页，承载大量后台模块，例如：

- 站点设置
- 视频源 / 分类 / 直播源管理
- 缓存管理
- 数据迁移
- 权限与认证配置
- Telegram / OIDC / TVBox / Bilibili / YouTube / Emby / AI 推荐等集成设置
- 性能监控与邀请码管理

与之对应的服务端接口主要在 `src/app/api/admin/**`。

若用户要求“在后台增加一个配置项/管理功能”，通常需要同时改：

- `src/lib/admin.types.ts`
- `src/lib/config.ts`
- 对应 admin API route
- `src/app/admin/page.tsx` 或拆分出的后台组件

### 12. 认证与访问控制分成三层

- 普通登录鉴权：`src/lib/auth.ts` + cookie
- 管理员权限判断：`src/lib/admin-auth.ts`
- 全站请求侧的访问控制与信任网络：`src/proxy.ts`

`src/proxy.ts` 不是简单转发器，它还处理：

- trusted network 自动登录
- `/adult/*` 路径重写
- 不同路径的认证放行策略

涉及登录、鉴权、内网免登录、管理员访问异常时，要一起看这三层。

## 代码分布速览

- `src/app`：页面与 Route Handlers
- `src/components`：通用 UI、页面模块、后台模块、播放页模块、观影室模块
- `src/hooks`：前端业务 hooks，很多已围绕 React Query 封装
- `src/lib`：服务端核心逻辑、配置、聚合、存储、播放器插件、缓存、第三方集成
- `src/contexts`：少数跨页面客户端上下文（下载、全局缓存）
- `public`：静态资源与 manifest / service worker 相关文件
- `scripts/generate-manifest.js`：dev/build 前会执行
- `docs/`：部署、功能、认证、集成文档很全，遇到功能背景问题优先查对应文档

## 开发时的关键注意点

- 很多功能开关并不只在环境变量里，数据库配置也会覆盖或补充；不要只改 `.env` 思路处理问题
- 任何数据读写相关改动，都要确认是否兼容多存储后端
- 任何全局 UI/状态改动，都先检查 `src/app/layout.tsx` 上挂载的 Provider 和浮层
- 任何“后台配置改了但前台没生效”的问题，都优先检查 `getConfig()`、运行时注入配置、客户端缓存/Query 缓存
- 播放、下载、观影室三块耦合度高，修改前先缩小影响面
