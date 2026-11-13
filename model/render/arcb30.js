import { buildB30Model } from '../data/b30.js'
import { screenshot as puppeteerShot, shutdown as puppeteerShutdown } from './puppeteer.js'
import { screenshot as shotiumShot, isAvailable as shotiumAvailable, shutdown as shotiumShutdown } from './shotium.js'

/**
 * 默认出图预设：3 倍分辨率 + WebP q95（3000×3102，约 2 MB）。
 * 需要 PNG 时传 { type: 'png' }，需要更小体积时传 { scale: 2 }。
 */
export const RENDER_DEFAULTS = Object.freeze({
    renderer: 'auto',
    scale: 3,
    type: 'webp',
    quality: 95,
})

/**
 * 渲染 Arcaea b30 成绩单。
 *
 * @param {object} raw 原始数据（见 model/data/b30.js）
 * @param {object} [options]
 * @param {'auto'|'shotium'|'puppeteer'} [options.renderer='auto'] 渲染器选择
 * @param {number} [options.scale=3] 设备像素比（1 = 1000×1034，3 = 3000×3102）
 * @param {'webp'|'png'|'jpeg'} [options.type='webp']
 * @param {number} [options.quality=95] webp/jpeg 质量
 * @returns {Promise<Buffer>}
 */
export async function renderB30(raw, options = {}) {
    const model = buildB30Model(raw)
    const opts = { ...RENDER_DEFAULTS, ...options }
    const renderer = opts.renderer || 'auto'

    if (renderer !== 'puppeteer' && await shotiumAvailable()) {
        try {
            return await shotiumShot(model, opts)
        } catch (err) {
            if (renderer === 'shotium') throw err
            // auto：Shotium 挂了就退回 Puppeteer，保证能出图
            console.warn('[arc-plugin] Shotium 渲染失败，回退 Puppeteer：', err?.message || err)
        }
    } else if (renderer === 'shotium') {
        throw new Error('[arc-plugin] 未安装 @pixel.js/shotium，无法使用 Shotium 渲染器')
    }

    return puppeteerShot(model, opts)
}

/** 关闭两个渲染器（进程退出时调用） */
export async function shutdownRenderers() {
    await Promise.allSettled([shotiumShutdown(), puppeteerShutdown()])
}
