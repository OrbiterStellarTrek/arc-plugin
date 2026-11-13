import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderB30, shutdownRenderers, RENDER_DEFAULTS } from '../model/render/arcb30.js'

/**
 * 用示例数据渲染一张图。
 *
 *   node tools/render-preview.js [输出路径] [--scale=3] [--type=webp] [--quality=95]
 *                               [--renderer=auto|shotium|puppeteer]
 *
 * 默认预设：3 倍分辨率（3000×3102）+ WebP q95，约 2 MB。
 * 也可用环境变量：ARC_SCALE / ARC_TYPE / ARC_QUALITY / ARC_RENDERER
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const flags = new Map()
const positional = []
for (const a of args) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/)
    if (m) flags.set(m[1], m[2] ?? 'true')
    else positional.push(a)
}

const type = flags.get('type') || process.env.ARC_TYPE || RENDER_DEFAULTS.type
const options = {
    scale: Number(flags.get('scale') || process.env.ARC_SCALE || RENDER_DEFAULTS.scale),
    type,
    quality: Number(flags.get('quality') || process.env.ARC_QUALITY || RENDER_DEFAULTS.quality),
    renderer: flags.get('renderer') || process.env.ARC_RENDERER || RENDER_DEFAULTS.renderer,
}

const defaultExt = type === 'webp' ? '.webp' : type === 'jpeg' ? '.jpg' : '.png'
const outFile = positional[0] || path.join(__dirname, 'out', 'b30' + defaultExt)

const mockFile = path.join(__dirname, 'mock', 'b30.json')
const raw = JSON.parse(fs.readFileSync(mockFile, 'utf8'))

const t0 = Date.now()
const buffer = await renderB30(raw, options)
const cost = Date.now() - t0

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, buffer)
console.log(`rendered -> ${outFile}  ${(buffer.length / 1024).toFixed(0)}KB  ` +
    `scale=${options.scale} type=${options.type} renderer=${options.renderer}  ${cost}ms`)

await shutdownRenderers()
