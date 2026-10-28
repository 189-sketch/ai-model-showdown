<div align="center">

<img src="web/public/assets/ui/og.jpg" alt="ChatGPT、Claude、DeepSeek、Grok 四位角色大合照" width="100%" />

# 最强AI大模型对决

**Strongest AI Model Showdown**

ChatGPT、Claude、DeepSeek、Grok 化身格斗家，在直播间里一决高下的网页格斗游戏。<br/>
打开浏览器就能玩，支持单人闯关、本地双人、联机对战，手机也能用触屏操作。

**简体中文** · [English](README.en.md)

<p>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" />
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" />
  <img alt="WebRTC" src="https://img.shields.io/badge/WebRTC-P2P-333333?logo=webrtc&logoColor=white" />
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-green" />
</p>

<p>
  <a href="#-角色">角色</a> ·
  <a href="#-游戏模式">游戏模式</a> ·
  <a href="#-操作">操作</a> ·
  <a href="#-技术亮点">技术亮点</a> ·
  <a href="#-部署到你自己的-edgespark-项目">部署</a>
</p>

<img src="docs/demo.webp" alt="实机演示" width="720" />

</div>

---

## 🎃 制作方限时活动

<a href="https://renoise.ai/?utm_source=tomatoyan&utm_medium=github&utm_campaign=halloween">
  <img src="docs/promo/renoise-halloween-zh.webp" alt="Renoise 万圣节无限狂欢：7 天不限量，最高 30% 折扣" width="100%" />
</a>

这款游戏里的角色立绘、动作帧、舞台、过场动画、配音和音乐，全部是用 **[Renoise](https://renoise.ai/?utm_source=tomatoyan&utm_medium=github&utm_campaign=halloween)** 做出来的。

Renoise 正在举办 **万圣节无限狂欢** 活动：**7 天不限量生成，最高 30% 折扣**，Seedance 2.5、Wan 3.0、Kling 4.0 等模型都能用。想做一款自己的 AI 格斗游戏？现在正是好时机 👉 **[立即前往 Renoise](https://renoise.ai/?utm_source=tomatoyan&utm_medium=github&utm_campaign=halloween)**

---

## ✨ 特色

- 🥊 **正统 2D 格斗手感**：60 FPS 定点帧模拟，有判定框、硬直、顿帧、防御、投技、击倒起身、连段和能量槽，不是随便按的小游戏。
- 🤖 **四位 AI 大模型格斗家**：每位都有 3 个必杀技和 1 个超必杀，招式全部是 AI 圈的梗，比如「重置卡」、「你说得完全对！」、「已深度思考」、「火箭发射」。
- 🌐 **低延迟联机**：WebRTC 点对点直连，加上 GGPO 风格的回滚网络代码（rollback netcode），用房间码邀请好友，也可以快速匹配陌生人。
- 📱 **随开随玩**：不用下载、不用注册；手机横屏有虚拟摇杆和按键；界面中英双语，会自动跟随浏览器语言。
- 🎬 **完整的演出**：角色语音、比赛播报、三张舞台各自的 BGM、胜利过场动画，还有直播间风格的 HUD。

## 🥋 角色

<table>
  <tr>
    <td align="center" width="25%"><img src="web/public/assets/ui/portrait_chatgpt.jpg" width="180" alt="ChatGPT" /></td>
    <td align="center" width="25%"><img src="web/public/assets/ui/portrait_claude.jpg" width="180" alt="Claude" /></td>
    <td align="center" width="25%"><img src="web/public/assets/ui/portrait_deepseek.jpg" width="180" alt="DeepSeek" /></td>
    <td align="center" width="25%"><img src="web/public/assets/ui/portrait_grok.jpg" width="180" alt="Grok" /></td>
  </tr>
  <tr>
    <td align="center"><b>ChatGPT</b><br/><sub>全能型 · 稳稳接住你</sub></td>
    <td align="center"><b>Claude</b><br/><sub>控场型 · 使用政策</sub></td>
    <td align="center"><b>DeepSeek</b><br/><sub>力量变身型 · 开源之力</sub></td>
    <td align="center"><b>Grok</b><br/><sub>机动爆发型 · 点火</sub></td>
  </tr>
  <tr>
    <td align="center"><i>「我会稳稳接住你。」</i></td>
    <td align="center"><i>「你说得完全对！」</i></td>
    <td align="center"><i>「已深度思考。」</i></td>
    <td align="center"><i>「倒计时，三、二、一，点火！」</i></td>
  </tr>
  <tr>
    <td align="center"><sub>体力 1000 · 跑速 5.8</sub></td>
    <td align="center"><sub>体力 960 · 跑速 5.3</sub></td>
    <td align="center"><sub>体力 1080 · 跑速 5.0</sub></td>
    <td align="center"><sub>体力 980 · 跑速 6.4</sub></td>
  </tr>
</table>

<details>
<summary><b>📜 全角色出招表</b>（点开查看）</summary>

> `↓↘→` 是下、前下、前；`↓↙←` 是下、后下、后。所有必杀技都只需要一个四分之一圈的搓招，不需要复杂的指令。

**ChatGPT**

| 指令 | 招式 |
|---|---|
| `↓↘→` + 拳 | 重置卡：命中时显示「额度已重置」，对手能量 −300 |
| `↓↙←` + 拳 | 稳稳接住你：接住对手的拳、脚或跳攻，抱起来甩出去 |
| `↓↙←` + 脚 | Agent 代操作：游标连点 4 下，最后一下「确认」击倒 |
| 重拳 + 重脚 | **超必杀 · Ultra**：8 秒内速度更快、伤害更高，一次甩出 3 张卡 |

**Claude**

| 指令 | 招式 |
|---|---|
| `↓↘→` + 拳 | 使用政策审查：警示单命中后封禁对手 1 秒，期间不能出招 |
| `↓↙←` + 拳 | 你说得完全对！：反弹飞行道具，也能招架拳脚 |
| `↓↙←` + 脚 | Artifact 生成：召出程序窗口，挡下一发飞行道具 |
| 重拳 + 重脚 | **超必杀 · 你的账号已被封禁**：不可防御，但可以闪避 |

**DeepSeek**

| 指令 | 招式 |
|---|---|
| `↓↘→` + 拳 | 开源卷轴：轻版是 MIT，回复能量；重版是 GPL，感染对手持续扣血 |
| `↓↙←` + 拳 | 已深度思考：先想一下再出升龙，用来对空 |
| `↓↙←` + 脚 | 召唤鲸鱼女仆：托盘拍两下，再喷出水柱 |
| 重拳 + 重脚 | **超必杀 · 梁圣降临**：10 秒内变身壮汉，霸体，攻击力 +30% |

**Grok**

| 指令 | 招式 |
|---|---|
| `↓↘→` + 拳 | 火箭发射：重版先上升再砸下；飞行中再按拳可以当场引爆 |
| `↓↙←` + 拳 | 社群注记：贴上便条，5 秒内对手受到的伤害 +15% |
| `↓↙←` + 脚 | Roadster 2 翻转飞跃：起手无敌，落地砸人 |
| 重拳 + 重脚 | **超必杀 · 星舰齐射**：6 枚火箭轮番轰炸 |

超必杀都需要消耗 1 格能量。

</details>

## 🎮 游戏模式

| 模式 | 说明 |
|---|---|
| **单人闯关** ARCADE | 和电脑对手打擂台，有简单、普通、困难三档 AI |
| **联机对战** ONLINE PK | 用 6 位房间码邀请好友，或进入快速匹配，P2P 直连 |
| **本地双人** VERSUS | 两人共用一个键盘面对面对打 |
| **训练模式** TRAINING | 练习连段，可以打开判定框显示 |
| **模型竞技场** MODEL ARENA | 接入任意大模型（API 或命令行），让两个模型自己对打 |

每局 60 秒，先赢 2 回合的一方获胜。舞台共三张：**大模型发布会**、**算力机房**、**巅峰榜单擂台**，各有自己的 BGM。

### 🤖 模型竞技场：让任意两个大模型自己打

在「模型竞技场」里，每个角色由一个真正的大模型操控：你接入模型、给它选外观，然后挑两个模型 1v1。所有走位、出招、防御都由模型自己决定。

1. 先装好依赖（`cd web && npm install`），然后在项目根目录运行（需要 Node 22.18+）：`npm run arena`。它会先构建游戏，再启动本地桥接，游戏和桥接共用一个端口
2. 打开它打印出的链接（`http://localhost:7790/?bridge=<令牌>`），会直接进入「模型竞技场」。如果项目在远程服务器上，先把端口转发到本机：`ssh -L 7790:localhost:7790 <服务器>`。用 Vite 开发服务器调试时，改用 `npm run arena:bridge` 加 `cd web && npm run dev`，打开打印出的 5173 链接
3. 添加模型，接入方式三选一：
   - **OpenAI 兼容 API**：填 Base URL、模型 ID 和 API Key（OpenAI、DeepSeek、xAI、OpenRouter、Gemini、Ollama 等都能用）
   - **Anthropic API**：填模型 ID 和 API Key
   - **命令行**：比如 `claude -p`、`codex exec --skip-git-repo-check -`。提示词从 stdin 传入，参数里写 `{prompt}` 则替换到该位置；命令的标准输出就是回复
4. 选一个角色外观（同时决定招式），点 1P / 2P 安排上场，开打

个性化与公平：
- **强调色和头像**：每个模型可以设自己的颜色、上传头像，显示在卡片、血条头像和对战信息里
- **自定义精灵与动画**：在模型编辑里点「精灵与动画」，可以为基础角色的任意动画（站立、行走、出拳、必杀技、受击……）上传一张横向序列图，或一次选多张单帧图。可以调帧数、速度、高度和脚的位置，有原版和自定义的实时对比预览。没上传的动画沿用原版。只改外观，判定框和帧数不变
- **统一属性**（默认开启）：双方血量都是 1000，普通技伤害相同，只有必杀技不同，比较模型时更公平

工作方式：
- 模型思考时游戏暂停，所以比的是决策，不是网速
- 每次决策时，模型拿到局面（血量、能量、距离、对手正在出的招和帧数、飞行道具等）以及双方带帧数据的出招表，回复一段 JSON：未来 0.3–2 秒的行动计划，加上最多 4 条「条件反应」（比如对手跳进来就对空），反应由引擎逐帧检查
- 被打中会丢掉剩下的计划，立刻重新决策
- 胜负记录在每个模型的卡片上

排查问题：
- 模型卡片上的「测试决策」会让模型真的做一次决策，显示耗时，以及回复里有没有可用的计划。正式开打前先试一下
- 推理模型（DeepSeek 的 `deepseek-reasoner`、MiniMax M2 等）每次决策可能要想一两分钟。单次调用默认最长等 300 秒；API 只要还在输出（包括思考内容）就不会被掐断，但连续 90 秒没有任何输出会被判定超时。还不够就在模型设置里调大「超时」。想打得快，就选非推理模型，比如 `deepseek-chat`
- 桥接的终端里每次调用都有一行记录：耗时，或者失败原因
- 某个模型连续 3 次没能给出决策，对局会暂停并显示错误，可以选择继续尝试或返回竞技场
- 需要代理才能访问 API 的话，这样启动：`HTTPS_PROXY=http://你的代理 NODE_USE_ENV_PROXY=1 npm run arena`

API Key 和命令只保存在本机的 `arena/data/models.json` 里（已加入 .gitignore），浏览器只能看到打码后的配置。桥接只监听 127.0.0.1，每个请求都要带启动时生成的令牌。

## 🕹 操作

| | 移动 | 轻拳 | 轻脚 | 重拳 | 重脚 |
|---|:-:|:-:|:-:|:-:|:-:|
| **1P** | `W` `A` `S` `D` | `J` | `K` | `U` | `I` |
| **2P** | 方向键 | `,` 或小键盘 `1` | `.` 或小键盘 `2` | `L` 或小键盘 `4` | `;` 或小键盘 `5` |

- 同时按 **重拳 + 重脚** 发动超必杀。
- 手机横屏时会自动显示虚拟摇杆和四个攻击键。
- 游戏内的「操作说明」页里有完整的按键说明和出招表。

## 📸 截图

<table>
  <tr>
    <td><img src="docs/screenshots/ban.jpg" alt="Claude 的使用政策审查" /></td>
    <td><img src="docs/screenshots/banpage.jpg" alt="超必杀：你的账号已被封禁" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Claude「使用政策审查」：命中后对手被封禁 1 秒</sub></td>
    <td align="center"><sub>Claude 超必杀「你的账号已被封禁」</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/liangsheng.jpg" alt="DeepSeek 超必杀：梁圣降临" /></td>
    <td><img src="docs/screenshots/ultra.jpg" alt="ChatGPT 超必杀：Ultra" /></td>
  </tr>
  <tr>
    <td align="center"><sub>DeepSeek 超必杀「梁圣降临」</sub></td>
    <td align="center"><sub>ChatGPT 超必杀「Ultra · Effort 拉满」</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/roadster.jpg" alt="Grok：Roadster 2 翻转飞跃" /></td>
    <td><img src="docs/screenshots/limit.jpg" alt="KO 画面：这段对话已达长度上限" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Grok「Roadster 2 翻转飞跃」</sub></td>
    <td align="center"><sub>KO 之后：「这段对话已达长度上限」</sub></td>
  </tr>
</table>

## 🧠 技术亮点

```mermaid
flowchart LR
    A["玩家 A 浏览器<br/>sim + rollback"] <-- "WebRTC DataChannel<br/>只传输入" --> B["玩家 B 浏览器<br/>sim + rollback"]
    A -. "建房 / 匹配 / SDP 信令" .-> S["Hono API<br/>Cloudflare Workers"]
    B -. "建房 / 匹配 / SDP 信令" .-> S
    S --- D[("D1 数据库<br/>rooms · signals")]
```

- **确定性模拟**（`web/src/game/sim.ts`）：全部游戏状态都是纯数据，按固定 60 FPS 步进，同样的输入在任何机器上都得到完全相同的结果，这是回滚联机的基础。
- **回滚网络代码**（`web/src/game/rollback.ts`）：双方只交换按键输入。本地先预测对手的输入继续跑，等真实输入到达后发现预测错了，就回到那一帧重新模拟；还会定期交换状态校验和，检查两边有没有不同步。
- **P2P 联机**（`web/src/game/rtc.ts` + `server/`）：服务器只负责建房、匹配，以及转发 WebRTC 握手用的 SDP，对战本身完全点对点，不经过服务器。
- **电脑对手**（`web/src/game/ai.ts`）：会看距离和对手动作来决定出招、防御、对空和蹲防下段。
- **渲染**（`web/src/game/render.ts`）：Canvas 2D 绘制精灵图集动画、打击特效、画面震动和直播间风格的 HUD。
- **宣传片录制**（`web/src/rec/` + `tools/`）：用无头 Chrome 逐帧渲染 `/?rec=<film>`，再用 `tools/mix.py` 按游戏内的声音日志混音，直接产出宣传片。

### 项目结构

```
.
├── web/                  # 前端（React + Vite）
│   ├── src/game/         # 格斗引擎：模拟、回滚、渲染、AI、音频、输入
│   ├── src/ui/           # 标题、菜单、选人、对战、联机大厅等界面
│   ├── src/rec/          # 宣传片逐帧录制
│   └── public/assets/    # 精灵图集、舞台、语音音效、BGM、过场视频
├── server/               # 后端（Hono on Cloudflare Workers）：匹配 + 信令
│   ├── src/index.ts      # API 路由（/api/public/*）
│   └── src/defs/         # 数据库表结构
├── arena/bridge.ts       # 模型竞技场本地桥接：保存模型配置，调用 API / 命令行
├── tools/                # 确定性测试、截图、录制与混音脚本
├── configs/              # EdgeSpark 认证配置
└── docs/                 # README 用的截图和动图
```

## 🚀 部署到你自己的 EdgeSpark 项目

这个仓库不绑定任何 EdgeSpark 项目（`edgespark.toml` 里没有 `project_id`），你需要用自己的账号新建一个项目，再把代码放进去。需要 Node.js 20 以上版本。

**1. 注册 EdgeSpark 账号**

到 [edgespark.dev](https://edgespark.dev) 注册。

**2. 安装 CLI 并登录**（会打开浏览器完成授权）

```bash
npm install -g @edgespark/cli
edgespark login
```

**3. 新建一个 EdgeSpark 项目**

这一步会在平台上创建项目，并生成带有你自己 `project_id` 的 `edgespark.toml`。

```bash
edgespark init my-pk --agent claude
```

**4. 克隆本仓库，把代码复制进新项目**

要保留新项目自己的 `edgespark.toml`，不要覆盖它。

```bash
git clone https://github.com/chessunyan/strongest-ai-model-showdown.git
rsync -a --exclude .git --exclude edgespark.toml strongest-ai-model-showdown/ my-pk/
```

**5. 安装依赖、建表、本地运行**

```bash
cd my-pk
cd server && npm install && cd ../web && npm install && cd ..
edgespark db migrate
edgespark dev
```

**6. 部署上线**

```bash
edgespark deploy
```

部署之后，把 `web/index.html` 里分享卡片用的 `your-app.edgespark.app` 换成你自己的域名。

<details>
<summary><b>联机连不上？配置 TURN 中继（可选）</b></summary>

默认只使用公共 STUN 服务器，双方都在严格 NAT 后面时可能无法直连。如果需要 TURN 中继：

1. 在 `server/src/defs/runtime.ts` 的 `SecretKey` 里加上 `"TURN_KEY_ID" | "TURN_KEY_API_TOKEN"`；
2. 用 `edgespark secret set` 配置 Cloudflare Realtime TURN 的 key；
3. 在 `GET /api/public/ice` 里加回 TURN 凭证的获取逻辑。

</details>

## 🎨 素材说明

角色立绘、动作帧、舞台、过场视频、配音和音乐全部由 AI 生成，使用的工具是 [Renoise](https://renoise.ai/?utm_source=tomatoyan&utm_medium=github)。

## ⚠️ 免责声明

本项目是粉丝向的恶搞同人作品，仅供娱乐和学习交流。游戏中的角色形象与台词都是戏仿创作，与 OpenAI、Anthropic、DeepSeek、xAI 等公司及其相关人士没有任何关联，也未获得他们的认可。相关名称和商标归各自所有者所有。

## 📄 License

代码以 [MIT](LICENSE) 协议开源。
