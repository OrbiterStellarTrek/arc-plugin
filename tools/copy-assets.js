/**
 * 从 arcinf 素材包同步渲染资源到 resources/arcb30。
 *
 *   node tools/copy-assets.js D:\temp\arcinf\assets
 *
 * 只复制渲染用得上的图片/字体，音源、谱面、模型、粒子、csb 等一律跳过。
 * 已存在的文件不会覆盖，方便本地替换个别素材。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RES = path.resolve(__dirname, '..', 'resources', 'arcb30')
const SRC = process.argv[2] || 'D:\\temp\\arcinf\\assets'

function ensure(dir) {
    fs.mkdirSync(dir, { recursive: true })
}

function copyIfAbsent(from, to) {
    if (!fs.existsSync(from)) return false
    // 已经有同名的 .webp（optimize-assets 转换过）就不再复制原图
    if (fs.existsSync(to) || fs.existsSync(to.replace(/\.(png|jpe?g)$/i, '.webp'))) return false
    fs.copyFileSync(from, to)
    return true
}

function copyDir(src, dest, filter) {
    if (!fs.existsSync(src)) return 0
    ensure(dest)
    let n = 0
    for (const f of fs.readdirSync(src, { withFileTypes: true })) {
        if (!f.isFile() || !filter(f.name)) continue
        if (copyIfAbsent(path.join(src, f.name), path.join(dest, f.name))) n++
    }
    return n
}

const report = {}

// 字体：标题/正文 GeosansLight，分数 Exo Medium
ensure(path.join(RES, 'fonts'))
report.fonts = [
    ['Fonts/GeosansLight.ttf'],
    ['Fonts/Exo-Medium.ttf'],
].filter(([f]) => copyIfAbsent(path.join(SRC, f), path.join(RES, 'fonts', path.basename(f)))).length

// 界面图：背景、lowiro、PTT 星级底图
ensure(path.join(RES, 'img'))
report.img = 0
const uiMap = [
    ['startup/1080/bg_konzetsu.jpg', 'bg.jpg'],
    ['startup/lowiro_white.png', 'lowiro_white.png'],
]
for (const [from, to] of uiMap) {
    if (copyIfAbsent(path.join(SRC, from), path.join(RES, 'img', to))) report.img++
}
for (let i = 0; i <= 7; i++) {
    if (copyIfAbsent(path.join(SRC, `img/rating_${i}.png`), path.join(RES, 'img', `rating_${i}.png`))) report.img++
}
if (copyIfAbsent(path.join(SRC, 'img/rating_off.png'), path.join(RES, 'img', 'rating_off.png'))) report.img++

// 角色：char/1080/<id>.png 全身立绘 + char/<id>_icon.png 头像
report.char = copyDir(path.join(SRC, 'char', '1080'), path.join(RES, 'char'), (n) => n.endsWith('.png'))
report.icon = copyDir(path.join(SRC, 'char'), path.join(RES, 'char'), (n) => n.endsWith('_icon.png'))

// 曲绘：songs/<id>/1080_base_256.jpg，退化为 base_256.jpg（256 版本足够 56px 卡片用）
ensure(path.join(RES, 'jacket'))
report.jacket = 0
const songs = path.join(SRC, 'songs')
if (fs.existsSync(songs)) {
    for (const d of fs.readdirSync(songs, { withFileTypes: true })) {
        if (!d.isDirectory()) continue
        const dst = path.join(RES, 'jacket', d.name + '.jpg')
        if (fs.existsSync(dst) || fs.existsSync(dst.replace(/\.jpg$/, '.webp'))) continue
        const candidates = ['1080_base_256.jpg', 'base_256.jpg']
        for (const c of candidates) {
            const from = path.join(songs, d.name, c)
            if (fs.existsSync(from)) {
                fs.copyFileSync(from, dst)
                report.jacket++
                break
            }
        }
    }
}

const size = (dir) => {
    let s = 0
    const walk = (d) => {
        if (!fs.existsSync(d)) return
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, f.name)
            if (f.isDirectory()) walk(p)
            else s += fs.statSync(p).size
        }
    }
    walk(dir)
    return (s / 1048576).toFixed(1) + ' MB'
}

console.log('复制完成：', report)
console.log('资源占用：', size(RES))
