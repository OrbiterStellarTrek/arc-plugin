import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDocument } from './static.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 插件根目录 */
export const pluginRoot = path.resolve(__dirname, '..', '..')
/** 资源根目录：渲染文档写在这里，模板相对路径（html/ assets/ original_ill/）都以此为基准 */
export const resourcesRoot = path.join(pluginRoot, 'resources')

/** 惰性加载 puppeteer，避免未安装时直接崩溃 */
let puppeteerModule = null
async function getPuppeteer() {
    if (puppeteerModule) return puppeteerModule
    try {
        puppeteerModule = (await import('puppeteer')).default
    } catch {
        throw new Error('[arc-plugin] 未安装 puppeteer，请先执行：pnpm add puppeteer')
    }
    return puppeteerModule
}

/**
 * 极简浏览器池：单实例复用，空闲一段时间后自动关闭。
 * 模板渲染只需要一个 page，规模很小，不必引入完整渲染框架。
 */
export class BrowserPool {
    constructor({ idleTimeout = 30 * 60 * 1000, args = [
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--no-zygote',
        '--font-render-hinting=none',
        '--disable-lcd-text',
    ] } = {}) {
        this.idleTimeout = idleTimeout
        this.args = args
        this.browser = null
        this.launching = null
        this.idleTimer = null
    }

    async getBrowser() {
        if (this.browser) return this.browser
        if (this.launching) return this.launching

        this.launching = (async () => {
            const puppeteer = await getPuppeteer()
            const browser = await puppeteer.launch({
                headless: 'new',
                args: this.args,
                handleSIGINT: false,
                handleSIGTERM: false,
                handleSIGHUP: false,
            })
            this.browser = browser
            browser.once('disconnected', () => {
                if (this.browser === browser) this.browser = null
            })
            return browser
        })()

        try {
            return await this.launching
        } finally {
            this.launching = null
        }
    }

    touch() {
        if (!this.idleTimeout) return
        clearTimeout(this.idleTimer)
        this.idleTimer = setTimeout(() => { void this.close() }, this.idleTimeout)
        this.idleTimer.unref?.()
    }

    async close() {
        clearTimeout(this.idleTimer)
        const browser = this.browser
        this.browser = null
        if (browser) await browser.close().catch(() => {})
    }
}

const pool = new BrowserPool()

/**
 * 用模板渲染一张图（Puppeteer 通道）。
 * @param {object} data 模板数据（见 model/data/b30.js）
 * @param {object} [options]
 * @param {number} [options.scale=3] 设备像素比（1 = 1000×1034）
 * @param {'webp'|'png'|'jpeg'} [options.type='webp']
 * @param {number} [options.quality=95] webp/jpeg 质量
 * @returns {Promise<Buffer>}
 */
export async function screenshot(data, options = {}) {
    const { scale = 3, type = 'webp', quality = 95 } = options
    const browser = await pool.getBrowser()
    const page = await browser.newPage()
    const doc = createDocument(data)
    try {
        await page.setViewport({ width: 1000, height: 1034, deviceScaleFactor: scale })
        await page.goto(doc.url, { waitUntil: ['load', 'networkidle0'], timeout: 120000 })
        await page.evaluate(async () => {
            await document.fonts.ready
            await Promise.all(Array.prototype.map.call(document.images, (img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())))
        })
        const buffer = await page.screenshot({ type, quality, captureBeyondViewport: false })
        return Buffer.from(buffer)
    } finally {
        doc.dispose()
        await page.close().catch(() => {})
        pool.touch()
    }
}

/** 插件卸载时调用 */
export function shutdown() {
    return pool.close()
}
