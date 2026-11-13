# arc-plugin

[![version](https://img.shields.io/badge/version-0.2.0-blue)](package.json)
[![Yunzai](https://img.shields.io/badge/Yunzai--Bot-plugin-ff69b4)](https://github.com/yoimiya-kokomi/Yunzai-Bot)

> Arcaea 查分插件 —— 绑定好友码，一键出 B50 成绩单、单曲成绩与潜力趋势图。

对接后端查分 API（[`invtwd-server`](tools/out/openapi.json)）：B50 用插件自带的本地模板渲染（像素级对齐设计稿），单曲直接使用服务器渲染的图片。

![预览](docs/preview.jpg)

## ✨ 功能特性

- **B50 成绩单** —— 本地模板渲染，逐像素对齐官方设计稿，默认 3x / WebP q95（约 2.1 MB）。
- **单曲查询** —— 支持曲名或 `song_id` + 难度（`PST/PRS/FTR/BYD/ETR`）。
- **潜力趋势图** —— 自动根据历史成绩生成折线，或由服务器数据驱动。
- **双渲染器** —— Shotium（默认，进程内，快约 2.3 倍）/ Puppeteer（兜底），出图像素一致。
- **资源自带** —— 立绘、头像、曲绘全部随插件复制，不引用外部路径。

## 📦 安装

进入云崽（Yunzai-Bot）根目录的 `plugins/`，克隆本仓库：

```bash
git clone https://github.com/OrbiterStellarTrek/arc-plugin.git ./plugins/arc-plugin
```

安装渲染器依赖（二选一即可，均为可选 peer 依赖）：

```bash
pnpm add @pixel.js/shotium -w   # 默认渲染器，推荐
```

```bash
pnpm add puppeteer -w           # 兜底渲染器
```

重启云崽后插件自动加载，首次会从 `config/config_default.yaml` 生成 `config/config.yaml`。

## 🎮 命令

指令头 `cmdhead` 默认 `a`（可在 `config/config.yaml` 改），支持 `#` / `/` 前缀：

| 命令 | 说明 |
| --- | --- |
| `#a绑定 <9位好友码>` | 绑定 Arcaea 好友码 |
| `#a我的绑定` | 查看当前绑定 |
| `#a解绑` | 解除绑定 |
| `#ab50` | 查询 B50 成绩单（本地渲染） |
| `#a查歌 <曲名或song_id> <难度>` | 查询单曲，难度 `PST/PRS/FTR/BYD/ETR` 或 `0-4`（默认 FTR） |
| `#a状态` | 查分服务状态 |
| `#a帮助` | 命令帮助 |

> 单曲与非样例 B50 的曲名解析依赖 `resources/arcb30/songlist.json`（样例覆盖有限）；识别不到时请直接用 `song_id`。

## ⚙️ 配置

首次加载会从 `config/config_default.yaml` 生成 `config/config.yaml`（已 gitignore），改后者即可：

```yaml
server:
  base_url: "http://127.0.0.1:8080"   # 查分服务地址
  api_key: ""                         # server.api_key（Bearer）
  timeout_ms: 15000
cmdhead: "a"                          # 指令头
poll:
  max_wait_ms: 60000                  # 单曲等普通查询最长等待
  b50_max_wait_ms: 180000             # B50 最长等待（后端分批串行，排队可能数十秒）
b50:                                  # B50 本地出图参数（透传 renderB30）
  renderer: "auto"
  scale: 3
  type: "webp"
  quality: 95
```

成图默认输出：3 倍分辨率（3000 × 3102）+ WebP q95，约 2.1 MB → [docs/arc-b30@3x.webp](docs/arc-b30@3x.webp)

## 📁 目录结构

```
arc-plugin/
├── index.js                  # 插件入口（挂载 apps、导出 renderB30）
├── package.json
├── apps/                     # 业务层：命令处理
│   ├── bind.js               # 绑定 / 我的绑定 / 解绑
│   ├── b50.js                # B50 成绩单
│   ├── song.js               # 单曲查询
│   └── help.js               # 帮助 / 状态
├── config/                   # 配置（config.yaml 已 gitignore）
│   ├── config_default.yaml
│   └── config.yaml
├── model/
│   ├── api/client.js         # invtwd-server HTTP 客户端
│   ├── config.js             # 配置读取
│   ├── data/b30.js           # 原始成绩数据 → 模板数据
│   └── render/
│       ├── arcb30.js         # renderB30(raw, options)：渲染器调度
│       ├── static.js         # 数据 → 静态 HTML（两个渲染器共用）
│       ├── shotium.js        # Shotium 渲染器（快，默认优先）
│       └── puppeteer.js      # Puppeteer 渲染器（兜底）
├── resources/arcb30/         # 模板本体（素材已随插件复制）
│   ├── view.js               # 纯字符串视图：生成页面 HTML（无 DOM API）
│   ├── style.css
│   ├── songlist.json         # song_id → 曲名（示例数据）
│   ├── fonts/                # GeosansLight、Exo Medium
│   ├── img/                  # 背景、lowiro 标识、PTT 星级底图
│   ├── char/                 # 角色立绘 141 + 头像 132（WebP）
│   └── jacket/               # 曲绘 565（WebP，256px）
├── tools/
│   ├── render-preview.js     # 用示例数据渲染一张图
│   ├── copy-assets.js        # 从 arcinf 素材包同步资源
│   ├── optimize-assets.py    # 立绘/曲绘转 WebP 省空间
│   └── mock/b30.json         # 示例数据（对应设计稿）
└── docs/preview.jpg
```

## 🛠️ 开发

### 渲染 API

```js
import { renderB30, shutdownRenderers, RENDER_DEFAULTS } from './index.js'

// 默认预设：renderer=auto、scale=3、type=webp、quality=95 → 3000 × 3102 WebP，约 2.1 MB
const img = await renderB30(raw)

// 需要别的规格时覆盖即可
const png = await renderB30(raw, { type: 'png', scale: 2 })
const big = await renderB30(raw, { scale: 4, quality: 97 })

await shutdownRenderers()   // 进程退出时释放引擎
```

`RENDER_DEFAULTS` 导出了当前预设，改一处即可全局调整：

```js
export const RENDER_DEFAULTS = Object.freeze({
    renderer: 'auto',
    scale: 3,
    type: 'webp',
    quality: 95,
})
```

命令行：

```bash
node tools/render-preview.js                       # tools/out/b30.webp（3x / WebP q95）
node tools/render-preview.js out.png --type=png
node tools/render-preview.js out.webp --scale=4 --renderer=shotium
```

输出体积参考（3000 × 3102）：WebP q95 ≈ **2.1 MB**、PNG ≈ 9.3 MB。3x WebP 是本项目默认基准，发群直接用默认即可。

### 渲染器对比

两个渲染器共用同一份静态 HTML（`view.js` 在 Node 侧拼出文档，无 JS 参与），所以两边出图像素一致：

| 渲染器 | 首次 | 之后每张 | 依赖 |
| --- | --- | --- | --- |
| **Shotium**（默认） | ~1.3s（进程内引擎） | ~1.3s | `@pixel.js/shotium` |
| Puppeteer | ~2.9s（启动 Chromium） | ~2.9s | `puppeteer` |

> 本机实测（默认 3x / WebP q95，3000×3102）：Shotium 1.28s（2.11 MB）/ Puppeteer 2.91s（2.09 MB），快约 2.3 倍；两者像素差 mean 1.1/255（仅抗锯齿差异）。

### 模板数据格式

渲染器最终交给模板的是 `buildB30Model()` 的返回值：

```js
{
  title: 'Arcaea Bests',
  player: { name, avatar, chara },
  ptt: { save, calc, b10, b50, rating },
  chart: { title, plays, series: [{ t: 0..1, v: 12.06 }], ticks: [...] },
  cards: [{ rank, title, jacket, diff, diffColor, potentialLine, score, p, f, l, clear, clearColor, time }],
}
```

`raw.chart` 未提供时，会根据 `records` 的 `time_played` / `potential` 自动生成趋势序列；示例数据直接携带了设计稿使用的序列，以便逐像素对照。

### 素材

全部**复制**到 `resources/arcb30`（不引用外部路径），并与设计稿 1000 × 1034 对齐：

| 目录 | 内容 | 数量 | 大小 |
| --- | --- | --- | --- |
| `fonts/` | GeosansLight（标题/正文）、Exo Medium（分数） | 2 | 0.2 MB |
| `img/` | `bg_konzetsu.jpg`、`lowiro_white.png`、`rating_0~7/off.png` | 11 | 1.9 MB |
| `char/` | `char/1080/*.png` 立绘 + `*_icon.png` 头像（WebP q95/q92） | 273 | 52.4 MB |
| `jacket/` | `songs/*/1080_base_256.jpg`（缺失用 `base_256.jpg`），WebP q90 | 565 | 27.3 MB |
| | | **851** | **约 87 MB** |

- 素材更新：`node tools/copy-assets.js <arcinf/assets 路径>`（增量，不覆盖已有文件）
- 体积优化：`python tools/optimize-assets.py`（PNG/JPG → WebP，需 Pillow）
- 数据层依次尝试 `.webp` / `.png`，两种格式都能直接用

角色资源按 `char.character` + `char.is_char_uncapped` 拼成 `char/<id><u?>.webp`，头像为 `char/<id><u?>_icon.webp`，找不到回退 `81u`。

<details>
<summary><b>🎨 设计稿对照与还原细节</b></summary>

### 元素位置 / 规格

| 元素 | 位置 / 规格 |
| --- | --- |
| 背景 | `startup/1080/bg_konzetsu.jpg`，cover + 顶部对齐，上下更深的暗化渐变 |
| 标题 | 12, 10.25，GeosansLight 42px |
| 左侧统计 | 标签 16px / 数值 24px，四组 |
| 名条 | 351, 14，274 × 33，两端箭头的六边形 clip-path，名字居中 18.2px |
| 头像 | 559.74, 14，78.68 × 65.92；45° 菱形遮罩（对角线 78.5，中心比节点偏上 7px，上顶点被切平） |
| PTT | 599.88, 39.73，56 × 56 `rating_*.png` + 数字（白字/深色描边：整数 20px、小数 13.8px） |
| 角色图 | 662, 0，338 × 338（全身立绘，contain） |
| 趋势图 | 117, 85，428 × 148，rgba(138,138,138,.75)，圆角 12 |
| 成绩卡 | 189 × 61，圆角 8，列距 195.5，行距 74；曲名 12px 行高盒内上下居中 |
| 页脚 | 9,1010 / 447,1010，14px #7C89A6 + 932,999 lowiro 标识 |

### 细节还原

- **PTT 数字**：设计稿是游戏同款样式 —— 白字 + 深色描边，且**整数部分比小数部分大**（14.5px vs 10px，约 0.69 倍），小数点是小方点、与数字共基线。实现为 `<span class="ptt-int">` + `<span class="ptt-dec">`，flex 基线对齐，`-webkit-text-stroke: 0.8px` + `paint-order: stroke fill` 保证白字不被描边吃掉。实测整数部分与设计稿墨迹边界完全重合（52.5–66.5 / x 606–621.5）。
- **趋势折线**：描边 2.2px、卡片 rgba(138,138,138,.78)（与设计稿组件导出的 4px@2x / alpha 199 一致）。
- **头像遮罩**：设计稿不是正中菱形，而是 45° 菱形（对角线 78.5）中心上移 7px，所以顶部被节点上边缘切平；名条则是**两端都带箭头**的六边形（右端被头像盖住）。
- **卡片小字**：用 `-webkit-text-stroke` 补到与设计稿相同的笔画覆盖率。

### 与设计稿的已知差异

1. **卡片小字 / PTT 数字**：设计稿的小字是同一家的"窄体"字重，素材里只有 GeosansLight 一款，模板按行高/位置对齐、逐串校准字号（曲名 10.2px、潜力 9.3px、P/F/L 9.1px），并用 `-webkit-text-stroke` 把笔画粗细补到与设计稿一致。长曲名偶有 1～2px 宽度差。
2. **趋势曲线形状**：由数据决定，示例数据已内置设计稿曲线以便对照。

</details>

## 🗺️ Roadmap

- [ ] 完整曲库 / 中文曲名别名表（当前单曲名解析仅覆盖 `songlist.json` 样例）
- [ ] 曲绘 / 立绘按需下载（目前是全量自带）
