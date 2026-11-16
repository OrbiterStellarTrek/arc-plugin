/**
 * 从 arcinf 素材包同步渲染资源到 resources/arcb30。
 *
 *   node tools/copy-assets.js E:\存档\arcinf\assets
 *
 * 只复制渲染用得上的图片/字体，音源、谱面、模型、粒子、csb 等一律跳过。
 * 已存在的文件不会覆盖，方便本地替换个别素材；songlist.json 例外，每次按官方 songs/songlist 重新生成。
 * 素材目录只读，脚本不会往里面写任何东西。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RES = path.resolve(__dirname, '..', 'resources', 'arcb30')
const SRC = process.argv[2] || 'E:\\存档\\arcinf\\assets'

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

// 官方曲目表：生成曲名表，并复制难度专属曲绘
const songlistFile = path.join(songs, 'songlist')
if (fs.existsSync(songlistFile)) {
    const list = JSON.parse(fs.readFileSync(songlistFile, 'utf8')).songs || []
    const titleOf = (loc) => String(loc?.en || '').trim()
    const out = {}
    report.jacketDiff = 0
    for (const song of list) {
        if (!song.id || song.deleted) continue
        const title = titleOf(song.title_localized) || song.id
        const diffTitles = {}
        for (const d of song.difficulties || []) {
            const t = titleOf(d.title_localized)
            if (t && t !== title) diffTitles[d.ratingClass] = t

            // 难度专属曲绘：songs/<id>/1080_<难度>_256.jpg，退化为 <难度>_256.jpg → jacket/<id>_<难度>.jpg
            if (!d.jacketOverride) continue
            const dst = path.join(RES, 'jacket', `${song.id}_${d.ratingClass}.jpg`)
            if (fs.existsSync(dst) || fs.existsSync(dst.replace(/\.jpg$/, '.webp'))) continue
            for (const c of [`1080_${d.ratingClass}_256.jpg`, `${d.ratingClass}_256.jpg`]) {
                const from = path.join(songs, song.id, c)
                if (fs.existsSync(from)) {
                    fs.copyFileSync(from, dst)
                    report.jacketDiff++
                    break
                }
            }
        }
        out[song.id] = Object.keys(diffTitles).length ? { title, difficulties: diffTitles } : title
    }
    // 曲名表完全由官方数据生成，每次覆盖
    fs.writeFileSync(path.join(RES, 'songlist.json'), JSON.stringify(out, null, 2) + '\n')
    report.songlist = Object.keys(out).length
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
