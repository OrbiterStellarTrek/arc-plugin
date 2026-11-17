/**
 * 把渲染资源里「随游戏更新的部分」打包成 QentimArt 静态分发树，供 Cloudflare Pages 等托管。
 *
 *   node tools/pack-resources.mjs [版本号] [输出目录]
 *   node tools/pack-resources.mjs 7.1.0 tools/out/arc-site
 *
 * 只收录曲绘（jacket/）与曲名表（songlist.json）——即随 Arcaea 更新而变的内容；
 * 插件自带的模板（view.js / style.css）、字体、立绘、界面图一律不打进去，
 * 这样下游 `#a更新曲绘` 只会同步曲绘/曲名表，绝不动插件自带素材。
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

// 2) 清空输出目录（单版本干净树），再用 qentimart 构建静态树
fs.rmSync(outDir, { recursive: true, force: true })
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
