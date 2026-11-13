import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESOURCE_ROOT = path.resolve(__dirname, '..', '..', 'resources', 'arcb30')
const JACKET_DIR = path.join(RESOURCE_ROOT, 'jacket')

/** 1 基难度索引 → 名称（接口里 1=PST 2=PRS 3=FTR 4=BYD 5=ETR） */
const DIFF_NAMES = ['', 'PST', 'PRS', 'FTR', 'BYD', 'ETR']
const DIFF_COLORS = {
    PST: '#4FA8D8',
    PRS: '#46B87E',
    FTR: '#D1455E',
    BYD: '#8E56C8',
    ETR: '#B18BD8',
}
/** 通关状态：0 无 / 1 通关 / 2 全连 / 3 理论值 / 4 简单 / 5 困难 */
const CLEARS = {
    0: { text: '--', color: '#8A8A96' },
    1: { text: 'NC', color: '#2E9E6B' },
    2: { text: 'FR', color: '#C94A5A' },
    3: { text: 'PM', color: '#B07CD8' },
    4: { text: 'EZ', color: '#6BA6C9' },
    5: { text: 'HC', color: '#3D7BD8' },
}

/** PTT 星级底图档位 */
function ratingIndex(ptt) {
    const tiers = [3.5, 5.5, 7.5, 9.5, 11, 12.5, 13.5]
    let idx = 0
    for (const t of tiers) if (ptt >= t) idx++
    return Math.min(idx, 7)
}

/** 角色资源：char/<id><u?>.png 全身立绘 / char/<id><u?>_icon.png 头像 */
function charKey(raw) {
    const char = raw.char
    if (!char || char.character == null) return '81u'
    return String(char.character) + (char.is_char_uncapped ? 'u' : '')
}

/** 依次尝试 .webp / .png，存在即返回相对路径 */
function resourceWithExt(base) {
    for (const ext of ['.webp', '.png']) {
        try {
            if (fs.existsSync(path.join(RESOURCE_ROOT, base + ext))) return base + ext
        } catch { /* 忽略 */ }
    }
    return ''
}

function charaPath(raw) {
    return resourceWithExt('char/' + charKey(raw)) || resourceWithExt('char/81u') || 'char/81u.webp'
}

function avatarPath(raw) {
    return resourceWithExt('char/' + charKey(raw) + '_icon') || resourceWithExt('char/81u_icon') || 'char/81u_icon.webp'
}

let jacketCache = null
/** 曲绘文件名索引：song_id -> jacket/<id>.webp|.jpg */
function jacketFile(songId) {
    if (!jacketCache) {
        jacketCache = new Map()
        try {
            for (const f of fs.readdirSync(JACKET_DIR)) {
                const id = f.replace(/\.(webp|jpg|jpeg|png)$/i, '')
                // .webp 优先（体积更小），其次保留旧格式兼容
                if (!jacketCache.has(id) || /\.webp$/i.test(f)) jacketCache.set(id, 'jacket/' + f)
            }
        } catch { /* 目录不存在时按无曲绘处理 */ }
    }
    return jacketCache.get(songId) || ''
}

const pad = (n, len) => String(n).padStart(len, '0')

/** 9903582 -> 09'903'582 */
export function formatScore(score) {
    const s = pad(Math.max(0, Math.trunc(Number(score) || 0)), 8)
    return s.slice(0, 2) + "'" + s.slice(2, 5) + "'" + s.slice(5, 8)
}

const fixed = (n, d) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : (0).toFixed(d))

/** song_id → 展示名（资源的 songlist 只覆盖样例曲目，缺失时回退到首字母大写） */
function prettifyId(id) {
    return String(id || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase())
}

function loadSonglist() {
    try {
        return JSON.parse(fs.readFileSync(path.join(RESOURCE_ROOT, 'songlist.json'), 'utf8'))
    } catch {
        return {}
    }
}

/**
 * 把原始成绩数据整理成模板数据。
 *
 * @param {object} raw
 * @param {object} [raw.player] { name, avatar, chara }
 * @param {object} raw.ptt { value, exact, b10, b50 }
 * @param {Array<object>} raw.records 成绩记录
 * @param {number} [raw.now] 生成时间（ms）
 * @param {object} [raw.chart] 直接指定趋势图数据 { series:[{t,v}], ticks:[], title, plays }
 * @param {number} [raw.count=50] 卡片数量
 * @returns {object} 模板数据
 */
export function buildB30Model(raw = {}) {
    const records = Array.isArray(raw.records) ? raw.records.slice() : []
    const now = raw.now || Date.now()
    const songlist = loadSonglist()
    const title = (id) => songlist[id] || prettifyId(id)
    const pttValue = Number(raw.ptt?.value ?? raw.ptt?.save ?? 0)

    // 按潜力排序取前 N，同分按分数降序
    records.sort((a, b) => (b.potential ?? b.play_potential ?? 0) - (a.potential ?? a.play_potential ?? 0)
        || (b.score || 0) - (a.score || 0))

    const count = raw.count || 50
    const cards = records.slice(0, count).map((r, i) => {
        const diff = DIFF_NAMES[r.difficulty] || 'FTR'
        const clear = CLEARS[r.clear_type] ?? CLEARS[0]
        const potential = Number(r.potential ?? r.play_potential ?? 0)
        const days = r.time_played ? Math.max(0, Math.floor((now - r.time_played) / 86400000)) : 0
        return {
            rank: i + 1,
            title: r.title || title(r.song_id),
            jacket: r.song_id ? jacketFile(r.song_id) : '',
            diff,
            diffColor: DIFF_COLORS[diff],
            potentialLine: diff + ' ' + formatConst(r.chart_constant ?? r.constant) + ' \u203a ' + fixed(potential, 4),
            score: formatScore(r.score),
            p: 'P' + (r.perfect_count ?? 0) + '(+' + (r.shiny_perfect_count ?? 0) + ')',
            f: 'F' + (r.near_count ?? 0),
            l: 'L' + (r.miss_count ?? 0),
            clear: clear.text,
            clearColor: clear.color,
            time: days + 'd',
        }
    })

    return {
        title: raw.title || 'Arcaea Bests',
        player: {
            name: raw.player?.name || 'Player',
            avatar: raw.player?.avatar || avatarPath(raw),
            chara: raw.player?.chara || charaPath(raw),
        },
        ptt: {
            save: fixed(pttValue, 3),
            calc: fixed(raw.ptt?.exact ?? pttValue, 5),
            b10: fixed(raw.ptt?.b10 ?? 0, 5),
            b50: fixed(raw.ptt?.b50 ?? 0, 5),
            rating: ratingIndex(pttValue),
        },
        chart: buildChart(raw.chart, records, now),
        cards,
    }
}

/** 11.6 / 12 这种常数保持原样，1 位小数即可 */
function formatConst(v) {
    const n = Number(v)
    if (!Number.isFinite(n)) return '0.0'
    return Number.isInteger(n) ? n.toFixed(1) : String(n)
}

/**
 * 趋势图数据。
 * 未显式给出时，用每局潜力值按时间展开，并补齐默认刻度。
 */
function buildChart(chart, records, now) {
    if (chart && Array.isArray(chart.series) && chart.series.length) {
        return {
            title: chart.title || 'Potential Trend',
            plays: chart.plays ?? records.length,
            series: chart.series,
            ticks: chart.ticks || ['', '', '', '', 'now'],
        }
    }

    const plays = records
        .filter((r) => r.time_played)
        .slice()
        .sort((a, b) => a.time_played - b.time_played)

    let series = []
    let ticks = ['', '', '', '', 'now']
    if (plays.length) {
        const t0 = plays[0].time_played
        const t1 = Math.max(now, plays[plays.length - 1].time_played)
        const span = Math.max(1, t1 - t0)
        series = plays.map((r) => ({
            t: (r.time_played - t0) / span,
            v: Number(r.potential ?? r.play_potential ?? 0),
        }))
        ticks = [0, 0.25, 0.5, 0.75, 1].map((f, i) => {
            if (i === 4) return 'now'
            return formatMonth(t0 + span * f)
        })
    }

    return {
        title: (chart && chart.title) || 'Potential Trend',
        plays: (chart && chart.plays) ?? records.length,
        series,
        ticks,
    }
}

function formatMonth(ms) {
    const d = new Date(ms)
    return d.getFullYear() + '.' + pad(d.getMonth() + 1, 2)
}
