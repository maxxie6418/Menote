// 入口只做装配（架构 §2.3.1）。两件事，除此之外没有逻辑：
//
// 1. **http → https 兜底升级**：http 下浏览器不提供 WebCrypto，登录/保存全不可用（真实故障：
//    Cloudflare 的「Always Use HTTPS」默认关闭，直接敲域名会落在 http 上）。放在挂载之前，
//    用户不会先看到一屏"无法登录"再被跳走。判断规则（含"本地与局域网不跳"）见
//    `app/ui/cryptoEnvironment.ts`。
// 2. **按路径分流**（M5-S3）：`/s/<分享ID>` 是**分享查看器**，其余是主应用。Static Assets 的
//    SPA 规则已经把这类路径回落到本文件（wrangler.jsonc 的 `not_found_handling`），这里只按
//    pathname 选装哪棵树；**两边都是动态导入**——访客只拉查看器那一个 chunk，编辑器与同步
//    代码不会跟着下载（架构 §十「查看器只加载渲染模块」）。
//
// 与架构 §2.3.1 入口表的一处**已知差异**：那里写的是 `apps/web/share.html` 独立入口。
// `@cloudflare/vite-plugin` v1.60 的客户端入口由插件接管、不接受第二个 html 入口（手写
// `build.rollupOptions.input` 会 UNRESOLVED_ENTRY 失败），故改为同一入口按路径分流；
// 行为等价（查看器仍是独立 chunk、不含编辑器与同步代码），已登记待 wiki 回写。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { httpsUpgradeUrl } from "./app/ui/cryptoEnvironment";
import { AppErrorBoundary } from "./app/ui/AppErrorBoundary";
import "./app/theme/tokens.css";
import "./app/theme/app.css";

const upgradeUrl = httpsUpgradeUrl();
if (upgradeUrl !== null) {
  // replace：不往历史里塞一条 http 记录，用户按返回键不会又回到不能用的页面
  location.replace(upgradeUrl);
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("挂载点 #root 不存在");
}

const isSharePath = /^\/s\/[A-Za-z0-9_-]{22}\/?$/.test(window.location.pathname);
const root = createRoot(rootEl);

/**
 * 两条分支都**必须**有 `catch`，外面还套一层错误边界（2026-10-04）。
 *
 * 此前是 `void import(...).then((m) => root.render(...))`——导入一失败，`.then` 不执行、
 * 也没有人接，页面就停在空的 `#root` 上：**纯白、无提示、只能手动刷新**。这会把一次部署
 * 半程或 chunk 404 伪装成「代码坏了」，实测排查成本极高。
 *
 * 失败**不是** `componentDidCatch` 能接到的（树还没建起来），所以除了边界，
 * 还得把错误交给它渲染。
 */
if (isSharePath) {
  void import("./features/share-viewer/ui/ShareViewerApp").then(
    (module) => {
      root.render(
        <StrictMode>
          <AppErrorBoundary>
            <module.ShareViewerApp />
          </AppErrorBoundary>
        </StrictMode>,
      );
    },
    (error: unknown) => {
      root.render(
        <StrictMode>
          <AppErrorBoundary loadError={error} />
        </StrictMode>,
      );
    },
  );
} else {
  void import("./app/App").then(
    (module) => {
      root.render(
        <StrictMode>
          <AppErrorBoundary>
            <module.default />
          </AppErrorBoundary>
        </StrictMode>,
      );
    },
    (error: unknown) => {
      root.render(
        <StrictMode>
          <AppErrorBoundary loadError={error} />
        </StrictMode>,
      );
    },
  );
}
