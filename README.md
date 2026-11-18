# arc-plugin

[![version](https://img.shields.io/badge/version-0.2.0-blue)](package.json)
[![Yunzai](https://img.shields.io/badge/Yunzai--Bot-plugin-ff69b4)](https://github.com/yoimiya-kokomi/Yunzai-Bot)
[![license](https://img.shields.io/badge/license-MIT-green)](package.json)

> 适用于云崽（Yunzai-Bot）的 Arcaea 查分插件 —— 绑定好友码，查询B50、单曲成绩

![预览](docs/preview.jpg)

## ✨ 功能

- **B50 成绩单**：本地渲染高清成绩图，附潜力值趋势折线。
- **单曲查询**：支持曲名或 `song_id`，可指定难度。
- **冷却与兜底**：B50 冷却中或查询较慢时，自动先渲染上一次的数据。
- **在线资源同步**：曲绘、立绘等大件资源由 QentimArt 远端增量同步（首次启动自动拉取，`#a更新曲绘` 手动更新）；模板与曲名表随仓库发布。

## 📦 安装

> 本插件需要配合查分后端服务使用，请先准备好服务地址与 API Key。

1. 在云崽根目录克隆插件本体并安装依赖：

   ```bash
   #安装插件本体
   git clone --depth=1 https://github.com/OrbiterStellarTrek/arc-plugin.git ./plugins/arc-plugin/
   #进入插件目录
   cd ./plugins/arc-plugin/
   #安装插件所需依赖
   pnpm install -P
   ```

   > 如果安装依赖时速度过慢，先执行 `pnpm config set registry https://registry.npmmirror.com` 换用国内镜像源。

2. 重启云崽。首次加载会自动生成 `config/config.yaml`，按下方说明填写后再次重启即可。

## 🎮 命令

指令头默认为 `a`，支持 `#` 或 `/` 前缀（如 `#ab50`、`/ab50`）

| 命令 | 说明 |
| --- | --- |
| `#a <bind\|绑定> <9位好友码>` | 绑定 Arcaea 好友码 |
| `#a <mybind\|我的绑定>` | 查看当前绑定 |
| `#a <unbind\|解绑>` | 解除绑定 |
| `#a <b50\|B50>` | 查询 B50 成绩单 |
| `#a <b50\|B50> 上次` | 直接查看上一次的 B50（不发起新查询） |
| `#a <b50cd\|B50冷却>` | 查看 B50 冷却剩余时间 |
| `#a <song\|查歌> <曲名或song_id> [难度]` | 查询单曲成绩，难度为 `PST/PRS/FTR/BYD/ETR` 或 `0-4`，默认 `FTR` |
| `#a <calc\|计算> <分数> <定数>` | 计算单曲潜力值（分数支持 `971w` 写法） |
| `#a <status\|状态>` | 查看查分服务状态 |
| `#a <artver\|曲绘版本>` | 查看资源版本（本地已同步版本 / 服务端最新版本） |
| `#a <updateart\|更新曲绘>` | 在线增量更新曲绘等渲染资源（仅主人，`#a更新曲绘 强制` 以服务端为准） |
| `#a <帮助\|help>` | 查看帮助 |

## ⚙️ 配置

编辑 `config/config.yaml`（请勿修改 `config_default.yaml`）：

```yaml
server:
  base_url: "http://127.0.0.1:8080"   # 查分服务地址
  api_key: ""                         # API Key
  timeout_ms: 15000                   # 单次请求超时（毫秒）

cmdhead: "a"                          # 指令头

poll:
  max_wait_ms: 60000                  # 单曲查询最长等待（毫秒）
  b50_max_wait_ms: 180000             # B50 查询最长等待（毫秒）

b50:
  renderer: "auto"                    # auto | shotium | puppeteer
  scale: 3                            # 输出倍率，1 = 1000×1034
  type: "webp"                        # webp | png | jpeg
  quality: 95                         # 图片质量（webp / jpeg）

assets:
  base_url: "https://arcaea-resources.phira.link"  # 资源站（QentimArt 静态源，须用 https）
  concurrency: 8                      # 下载并发连接数（过高可能触发 CDN 503）
  local_changes: "keep"               # keep 保留本地改动 / overwrite 以服务端为准 / fail 冲突即报错
  timeout_ms: 60000                   # 单次 HTTP 超时（毫秒）
```

### 曲绘更新

- **首次启动自动拉取**：插件加载时若检测到曲绘/立绘缺失，会后台同步一次（非阻塞，失败不影响启动）。之后可发 `#a更新曲绘`（仅主人）手动更新；`#a曲绘版本` 查看本地/最新版本。
- 默认 `keep` 策略保留本地改动过的素材；`#a更新曲绘 强制`（或把 `local_changes` 设为 `overwrite`）则以服务端为准覆盖曲绘/立绘

## 🛠️ 开发

### 本地预览

使用示例数据（`tools/mock/b30.json`）渲染一张成绩图，无需连接后端：

```bash
node tools/render-preview.js
```

```bash
node tools/render-preview.js out.png --type=png --scale=2 --renderer=shotium
```

默认输出到 `tools/out/b30.webp`。

### 目录结构

```
arc-plugin/
├── index.js            # 插件入口
├── apps/               # 命令处理（绑定 / B50 / 单曲 / 帮助 / 资源更新）
├── config/             # 默认配置与用户配置
├── model/
│   ├── api/            # 查分服务客户端
│   ├── data/           # 成绩数据处理
│   ├── render/         # 渲染器（Shotium / Puppeteer）
│   └── assets.js       # 曲绘 / 资源在线增量更新（@qentimart/sdk）
├── resources/
│   ├── html/           # 渲染模板与样式 view.js / style.css（随仓库）
│   ├── info/           # 曲名表 songlist.json（随仓库）
│   ├── assets/         # 立绘、字体、界面图（远端同步，不入库）
│   └── original_ill/   # 曲绘（远端同步，不入库）
└── tools/              # 预览与资源维护脚本
```

## 🗺️ Roadmap

- [x] 完整曲库（含难度专属曲名与曲绘）
- [x] 曲绘 / 立绘在线增量更新
- [ ] 中文曲名别名
