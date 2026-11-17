import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SONGLIST = path.resolve(__dirname, '..', '..', 'resources', 'info', 'songlist.json')

/**
 * 曲名表（由 tools/copy-assets.js 从官方 songs/songlist 生成）。
 *
 * 每项为以下两种之一：
 *   "<song_id>": "曲名"
 *   "<song_id>": { "title": "曲名", "difficulties": { "<ratingClass>": "该难度的曲名" } }
 * 后者用于 BYD 等难度单独改名的曲目（如 axiumcrisis 的 BYD 为 Axium Divergence）。
 */
let cache = null
/** 清空曲名表缓存（在线更新 songlist.json 后调用，使新曲名免重启生效） */
export function resetSonglistCache() {
    cache = null
}
function load() {
    if (cache) return cache
    const titles = new Map()
    const diffTitles = new Map()
    try {
        const raw = JSON.parse(fs.readFileSync(SONGLIST, 'utf8'))
        for (const [id, v] of Object.entries(raw)) {
            if (typeof v === 'string') {
                titles.set(id, v)
            } else if (v && typeof v === 'object') {
                if (v.title) titles.set(id, v.title)
                for (const [rc, t] of Object.entries(v.difficulties || {})) {
                    if (t) diffTitles.set(id + ':' + rc, t)
                }
            }
        }
    } catch { /* 无曲库时全部回退到 song_id */ }
    cache = { titles, diffTitles }
    return cache
}

/** song_id → 展示名（缺失时回退到首字母大写） */
function prettifyId(id) {
    return String(id || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase())
}

/**
 * 指定难度的曲名：优先该难度专属曲名，其次整曲曲名；
 * 曲库里没有时用 fallback（如服务器带回的曲名），最后美化 song_id。
 */
export function songTitle(songId, difficulty, fallback) {
    const { titles, diffTitles } = load()
    const id = String(songId || '')
    return (difficulty != null && diffTitles.get(id + ':' + difficulty)) || titles.get(id) || fallback || prettifyId(id)
}

/**
 * 遍历所有可用于反查的名字。
 * @returns {Array<{ name: string, id: string, difficulty: number|null }>}
 */
export function songNames() {
    const { titles, diffTitles } = load()
    const out = []
    for (const [id, name] of titles) out.push({ name, id, difficulty: null })
    for (const [key, name] of diffTitles) {
        const [id, rc] = key.split(':')
        out.push({ name, id, difficulty: Number(rc) })
    }
    return out
}
