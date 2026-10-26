# 最强AI大模型对决 · Strongest AI Model Showdown

ChatGPT、Claude、DeepSeek、Grok 化身格斗家的网页格斗游戏：单人闯关、本地双人、联机对战（房间码 / 快速匹配），浏览器打开就能玩，手机也能用触屏操作。

![key art](web/public/assets/ui/og.jpg)

## 玩法

| | 移动 | 轻拳 | 轻脚 | 重拳 | 重脚 |
|---|---|---|---|---|---|
| 1P | W A S D | J | K | U | I |
| 2P | 方向键 | `,` / 小键盘 1 | `.` / 小键盘 2 | L / 小键盘 4 | `;` / 小键盘 5 |

- 每个角色有 3 个必杀技（方向 + 攻击键，没有复杂的搓招），**重拳＋重脚** 同时按出超必杀（消耗 1 格能量）。
- 出招表在游戏内「帮助」与选人界面里可以看到。

## 技术架构

- `web/` — React + Vite 单页应用。格斗逻辑在 `web/src/game/`：
  - `sim.ts` 定点帧步进的确定性模拟，`rollback.ts` 回滚网络代码（GGPO 风格），`rtc.ts` WebRTC P2P 数据通道
  - `render.ts` Canvas 2D 渲染，`ai.ts` 单人模式 AI，`audio.ts` 音效 / 语音 / BGM
- `server/` — [Hono](https://hono.dev) API，跑在 Cloudflare Workers（通过 [EdgeSpark](https://edgespark.dev) 部署）。只负责联机配对和 WebRTC 信令（SDP 交换），对战本身走点对点，不经过服务器。
- `web/src/rec/` + `tools/` — 宣传片录制工具：无头 Chrome 逐帧渲染 `/?rec=<film>`，`tools/mix.py` 按游戏内声音日志混音。
- `tools/simtest.ts` — 模拟器与回滚的确定性测试。

## 部署到你自己的 EdgeSpark 项目

这个仓库不绑定任何 EdgeSpark 项目（`edgespark.toml` 里没有 `project_id`），你需要用自己的账号新建一个项目，再把代码放进去。需要 Node.js 20+。

**1. 注册 EdgeSpark 账号**：到 [edgespark.dev](https://edgespark.dev) 注册。

**2. 安装 CLI 并登录**（会打开浏览器完成授权）：

```bash
npm install -g @edgespark/cli
edgespark login
```

**3. 新建一个 EdgeSpark 项目**（会在平台上创建项目，并生成带你自己 `project_id` 的 `edgespark.toml`）：

```bash
edgespark init my-pk --agent claude
```

**4. 克隆本仓库，把代码复制进新项目**（保留新项目自己的 `edgespark.toml`，不要覆盖）：

```bash
git clone https://github.com/chessunyan/strongest-ai-model-showdown.git
rsync -a --exclude .git --exclude edgespark.toml strongest-ai-model-showdown/ my-pk/
```

**5. 安装依赖、建表、本地运行**：

```bash
cd my-pk
cd server && npm install && cd ../web && npm install && cd ..
edgespark db migrate
edgespark dev
```

**6. 部署上线**：

```bash
edgespark deploy
```

部署后把 `web/index.html` 里分享卡片用的 `your-app.edgespark.app` 换成你自己的域名。

### 联机穿透（可选）

默认只用公共 STUN 服务器，严格 NAT 下可能连不上。如需 TURN 中继，参见 `server/src/defs/runtime.ts` 里的说明，用 `edgespark secret set` 配置 Cloudflare Realtime TURN 的 key。

## 素材说明

角色立绘、动作帧、场景、过场视频、配音和音乐均由 AI 生成（[Renoise](https://renoise.ai)）。

本项目是粉丝向的恶搞同人作品，与 OpenAI、Anthropic、DeepSeek、xAI 等公司无任何关联，也未获得其认可；相关名称和商标归各自所有者所有。

## License

代码以 [MIT](LICENSE) 协议开源。
