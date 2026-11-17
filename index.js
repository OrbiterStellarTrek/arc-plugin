import fs from 'node:fs'
import { renderB30, shutdownRenderers, RENDER_DEFAULTS } from './model/render/arcb30.js'
import api from './model/api/client.js'
import config from './model/config.js'

/**
 * arc-plugin —— Arcaea 查分插件
 *
 * - 业务层：apps/*.js（绑定、B50、单曲、帮助），对接 invtwd-server 查分 API
 * - 数据层：model/api（HTTP 客户端）、model/data（结果归一化）、model/config（配置）
 * - 渲染层：model/render（B50 本地出图：Shotium 优先，Puppeteer 兜底；单曲用服务器图）
 */
export const name = 'arc-plugin'

/** 动态加载 apps 目录下的命令类，供云崽挂载 */
const apps = {}
const appsDir = new URL('./apps/', import.meta.url)
try {
    const files = fs.readdirSync(appsDir).filter((f) => f.endsWith('.js'))
    const loaded = await Promise.allSettled(files.map((f) => import(`./apps/${f}`)))
    loaded.forEach((res, i) => {
        if (res.status === 'fulfilled') {
            const mod = res.value
            const key = Object.keys(mod)[0]
            if (key) apps[files[i].replace(/\.js$/, '')] = mod[key]
        } else {
            logger?.error?.(`[arc-plugin] 加载 ${files[i]} 失败：`, res.reason)
        }
    })
} catch (err) {
    logger?.error?.('[arc-plugin] 读取 apps 目录失败：', err)
}

// 后台探活，不阻塞加载
;(async () => {
    try {
        const h = await api.health()
        logger?.mark?.(`[arc-plugin] 已连接查分服务：${h?.backend || '?'} ${h?.backend_version || ''}`)
    } catch (err) {
        logger?.warn?.(
            `[arc-plugin] 未能连接查分服务（${config.get('server.base_url')}）：${err?.message || err}`,
        )
    }
})()

// 首次启动兜底：曲绘/立绘缺失时后台拉取一次，不阻塞加载。
// 动态 import：未安装 @qentimart/sdk 时仅跳过自动同步，不影响插件其余功能。
;(async () => {
    try {
        const { ensureAssets } = await import('./model/assets.js')
        const r = await ensureAssets()
        if (r && r.skipped === false) {
            logger?.mark?.(`[arc-plugin] 首次资源同步完成：v${r.version}，下载 ${r.downloadedMB} MB`)
        }
    } catch (err) {
        logger?.warn?.(`[arc-plugin] 资源自动同步跳过（可稍后用 #${config.cmdhead}更新曲绘 手动拉取）：${err?.message || err}`)
    }
})()

export { apps }
export { renderB30, shutdownRenderers, RENDER_DEFAULTS }
