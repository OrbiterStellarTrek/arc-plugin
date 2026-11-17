/**
 * 把渲染资源里「随游戏更新的部分」打包成 QentimArt 静态分发树，供 Cloudflare Pages 等托管。
 *
 *   node tools/pack-resources.mjs <版本号> [输出目录] [--fresh]
 *   node tools/pack-resources.mjs 7.3.1 tools/out/arc-site
 *
 * 收录曲绘（original_ill/）与立绘/字体/界面图（assets/）——随游戏更新、体量大的资源；
 * 模板（html/）与曲名表（info/）随插件仓库发布，不打进分发树。
 *
 * 输出目录是 qentimart 的「持久镜像」：重复发布累积多版本，chunk 按内容哈希共享，
 * 历史版本几乎不额外占空间；已存在的版本号会被拒绝（请用新版本号），确需重来时加 --fresh。
 *
 * 依赖 qentimart CLI（需在 PATH，或用 QENTIMART_BIN 指定路径）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RES = path.join(ROOT, 'resources')

// 项目名与收录清单：打包曲绘与立绘/字体/界面图（随游戏更新、体量大的资源）。
// 曲名表 info/songlist.json 不打包——它随插件仓库发布，不走远端同步。
// 下游以 resources/ 为同步目标，故这些项的子路径要和 resources/ 下保持一致。
const PROJECT = 'arcaea-resources'
const INCLUDE = ['original_ill', 'assets']

const version = process.argv[2] || '7.1.0'
const outDir = path.resolve(ROOT, process.argv[3] || 'tools/out/arc-site')
const srcDir = path.resolve(ROOT, 'tools/out/.pack-src')
const bin = process.env.QENTIMART_BIN || 'qentimart'

/** 递归拷贝（目录或单文件） */
function copyInto(name) {
    const from = path.join(RES, name)
    const to = path.join(srcDir, name)
    if (!fs.existsSync(from)) {
        console.warn(`跳过缺失项：${name}`)
        return
    }
    fs.cpSync(from, to, { recursive: true })
}

// 1) 暂存收录项到干净的源目录
fs.rmSync(srcDir, { recursive: true, force: true })
fs.mkdirSync(srcDir, { recursive: true })
for (const name of INCLUDE) copyInto(name)
/** 递归统计文件数 */
function countFiles(dir) {
    let n = 0
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1
    }
    return n
}
console.log(`暂存 ${countFiles(srcDir)} 个文件到 ${path.relative(ROOT, srcDir)}`)

// 2) 构建静态树。qentimart 的 -o 是「持久镜像」：重复发布会累积新版本，
//    未变的 chunk 按内容哈希复用，所以历史版本几乎不额外占空间，应默认保留。
//    确需从零重建时加 --fresh 清空输出目录。
const fresh = process.argv.includes('--fresh')
if (fresh) {
    fs.rmSync(outDir, { recursive: true, force: true })
    console.log('已清空输出目录（--fresh）')
} else if (fs.existsSync(path.join(outDir, 'index.json'))) {
    const idx = JSON.parse(fs.readFileSync(path.join(outDir, 'index.json'), 'utf8'))
    const existing = (idx.versions || []).map((v) => v.version)
    if (existing.includes(version)) {
        console.error(`版本 ${version} 已存在于输出目录（${existing.join(', ')}）。`)
        console.error('请换一个新的版本号，或用 --fresh 从零重建。')
        process.exit(1)
    }
    console.log(`保留已有版本 ${existing.join(', ')}，将追加 ${version}`)
}
const args = ['publish', '-static', '-o', outDir, '-project', PROJECT, '-version', version, srcDir]
console.log(`运行：${bin} ${args.join(' ')}`)
const r = spawnSync(bin, args, { stdio: 'inherit', shell: process.platform === 'win32' })
if (r.error || r.status !== 0) {
    console.error('qentimart publish 失败：', r.error?.message || `exit ${r.status}`)
    console.error('请确认 qentimart 已在 PATH，或用环境变量 QENTIMART_BIN 指定其路径。')
    process.exit(1)
}

// 3) 清理 qentimart 留下的 .tmp，避免被 wrangler 一起上传
fs.rmSync(path.join(outDir, '.tmp'), { recursive: true, force: true })
fs.rmSync(srcDir, { recursive: true, force: true })

console.log(`\n静态树已生成：${path.relative(ROOT, outDir)}（项目 ${PROJECT}，版本 ${version}）`)
console.log('部署到 Cloudflare Pages：')
console.log(`  npx wrangler@latest pages deploy ${path.relative(ROOT, outDir)} --project-name <项目名> --branch <生产分支>`)
