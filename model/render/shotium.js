import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pluginRoot } from './puppeteer.js'
import { createDocument } from './static.js'

/**
 * Shotium 渲染器：从 Chromium 里剥出来的纯静态渲染引擎（Blink 布局 + Skia 光栅化），
 * 没有 JS 引擎和浏览器外壳，单张图通常比 Puppeteer 快 3~5 倍，也没有进程泄漏风险。
 *
 * 代价：不执行 JS，所以数据必须在 Node 侧拼进 HTML —— 这里直接把
 * resources/html/view.js 生成的静态文档写到 resources/ 根目录下再截图。
 */

let sdkPromise = null
let started = false
let sequence = 0

/** 依次尝试：项目已安装的包 → phi-plugin 里同一份（同一台机器通常只装一次） */
async function loadSDK() {
    if (sdkPromise) return sdkPromise
    sdkPromise = (async () => {
        try {
            return await import('@pixel.js/shotium')
        } catch (/** @type {any} */ err) {
            if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err
            const fallback = path.resolve(pluginRoot, '..', 'phi-plugin', 'node_modules', '@pixel.js', 'shotium', 'dist', 'index.js')
            if (fs.existsSync(fallback)) return await import(pathToFileURL(fallback).href)
            throw new Error('[arc-plugin] 未安装 @pixel.js/shotium，请执行：pnpm add @pixel.js/shotium')
        }
    })()
    try {
        return await sdkPromise
    } catch (err) {
        sdkPromise = null
        throw err
    }
}

/** 是否可用（不抛错，供 auto 选择渲染器用） */
export async function isAvailable() {
    try {
        await loadSDK()
        return true
    } catch {
        return false
    }
}

async function ensureStarted(sdk) {
    if (started) return
    try {
        sdk.start({ cacheMaxBytes: 64 * 1024 * 1024 })
    } catch { /* 已在运行或当前环境不支持，直接沿用 */ }
    started = true
}

/**
 * 用 Shotium 截图。
 * @param {object} data 模板数据
 * @param {object} [options]
 * @param {number} [options.scale=2.5] 设备像素比
 * @param {'png'|'jpeg'|'webp'} [options.type='png']
 * @param {number} [options.quality]
 * @returns {Promise<Buffer>}
 */
export async function screenshot(data, options = {}) {
    const { scale = 3, type = 'webp', quality = 95 } = options
    const sdk = await loadSDK()
    await ensureStarted(sdk)

    // 与 Puppeteer 共用同一份静态文档，保证两边像素一致
    const doc = createDocument(data)
    try {
        const result = await sdk.screenshot({
            file: doc.file,
            type,
            quality: type === 'png' ? undefined : quality,
            scale,
            viewport: { width: 1000, height: 1034 },
            allowFileAccess: true,
            pageGotoParams: { waitUntil: 'networkidle' },
        })
        if (result.stats?.failed) {
            throw new Error(`[arc-plugin] Shotium 有 ${result.stats.failed} 个子资源加载失败（字体/图片路径可能不对）`)
        }
        if (!result.image) throw new Error('[arc-plugin] Shotium 未返回图像数据')
        return Buffer.from(result.image)
    } finally {
        doc.dispose()
    }
}

/** 插件卸载 / 进程退出时调用 */
export async function shutdown() {
    if (!started) return
    started = false
    try {
        const sdk = await loadSDK()
        await sdk.stop()
    } catch { /* 忽略 */ }
}
