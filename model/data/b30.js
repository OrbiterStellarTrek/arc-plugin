import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { songTitle } from './songlist.js'
import config from '../config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESOURCES_ROOT = path.resolve(__dirname, '..', '..', 'resources')
// 曲绘单独放 original_ill/（由 qentimart 拉取）；立绘/界面图在 assets/，模板样式在 html/
const JACKET_DIR = path.join(RESOURCES_ROOT, 'original_ill')

/** 0 基难度索引 → 名称（接口 difficulty 0=PST 1=PRS 2=FTR 3=BYD 4=ETR） */
const DIFF_NAMES = ['PST', 'PRS', 'FTR', 'BYD', 'ETR']
const DIFF_COLORS = {
    PST: '#4FA8D8', // 蓝 Past
    PRS: '#93B84F', // 绿 Present
    FTR: '#9B4B80', // 品红 Future
    BYD: '#CE4557', // 红 Beyond
    ETR: '#7A5C97', // 紫 Eternal
    INS: '#3E5AB5', // 靛蓝 Insight（特殊 BYD）
}
/** 这些曲目的 BYD(3) 难度实际显示为 INS */
const INS_SONGS = new Set(['dreadarea', 'rivenpilgrim', 'cataclysmcry', 'deinosphainein'])
/** 通关状态：0 无 / 1 通关 / 2 全连 / 3 理论值 / 4 简单 / 5 困难 */
const CLEARS = {
    0: { text: '--', color: '#8A8A96' },
    1: { text: 'NC', color: '#2E9E6B' },
    2: { text: 'FR', color: '#C94A5A' },
    3: { text: 'PM', color: '#B07CD8' },
    4: { text: 'EZ', color: '#6BA6C9' },
    5: { text: 'HC', color: '#3D7BD8' },
}

/**
 * 潜力值 → 徽章底图档位（rating_0~7）；潜力值隐藏（-1）或非法返回 -1 → rating_off。
 * 区间（萌娘百科 / wiki）：
 *   0–3.499 蓝 / 3.5–6.999 绿 / 7–9.999 紫 / 10–10.999 紫(带花纹)
 *   / 11–11.999 红 / 12–12.499 红★ / 12.5–12.999 红★★ / ≥13 红★★★
 */
function ratingIndex(ptt) {
    const p = Number(ptt)
    if (!(p >= 0)) return -1
    const tiers = [3.5, 7, 10, 11, 12, 12.5, 13]
    let idx = 0
    for (const t of tiers) if (p >= t) idx++
    return Math.min(idx, 7)
}

/** 角色资源：char/<id><u?>.png 全身立绘 / char/<id><u?>_icon.png 头像 */
function charKey(raw) {
    const char = raw.char
    if (!char || char.character == null) return '81u'
    return String(char.character) + (char.is_char_uncapped ? 'u' : '')
}

/** 依次尝试 .webp / .png，存在即返回相对路径（相对 resources/，渲染文档也写在那里） */
function resourceWithExt(base) {
    for (const ext of ['.webp', '.png']) {
        try {
            if (fs.existsSync(path.join(RESOURCES_ROOT, base + ext))) return base + ext
        } catch { /* 忽略 */ }
    }
    return ''
}

function charaPath(raw) {
    return resourceWithExt('assets/char/' + charKey(raw)) || resourceWithExt('assets/char/81u') || 'assets/char/81u.webp'
}

function avatarPath(raw) {
    return resourceWithExt('assets/char/' + charKey(raw) + '_icon') || resourceWithExt('assets/char/81u_icon') || 'assets/char/81u_icon.webp'
}

let jacketCache = null
/** 清空曲绘文件名索引（在线更新曲绘后调用，使新曲绘免重启生效） */
export function resetJacketCache() {
    jacketCache = null
}
/**
 * 曲绘文件名索引：<song_id>[_<ratingClass>] -> original_ill/<name>.webp|.jpg
 * 部分难度有专属曲绘（官方 songlist 的 jacketOverride），存为 original_ill/<id>_<难度>.*，优先使用。
 */
function jacketFile(songId, difficulty) {
    if (!jacketCache) {
        jacketCache = new Map()
        try {
            for (const f of fs.readdirSync(JACKET_DIR)) {
                const id = f.replace(/\.(webp|jpg|jpeg|png)$/i, '')
                // .webp 优先（体积更小），其次保留旧格式兼容
                if (!jacketCache.has(id) || /\.webp$/i.test(f)) jacketCache.set(id, 'original_ill/' + f)
            }
        } catch { /* 目录不存在时按无曲绘处理 */ }
    }
    return (difficulty != null && jacketCache.get(songId + '_' + difficulty)) || jacketCache.get(songId) || ''
}

const pad = (n, len) => String(n).padStart(len, '0')

/** 9903582 -> 09'903'582 */
export function formatScore(score) {
    const s = pad(Math.max(0, Math.trunc(Number(score) || 0)), 8)
    return s.slice(0, 2) + "'" + s.slice(2, 5) + "'" + s.slice(5, 8)
}

const fixed = (n, d) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : (0).toFixed(d))

/** 判断是否为 stdin / 控制台这类非真实账号（适配器名或昵称命中都算） */
function isConsoleLike(text) {
    return /stdin|console|标准输入|控制台/i.test(String(text ?? ''))
}

/** 清洗控制台昵称里的 stdin/控制台 标记：如 "Elia-Yunzai Stdin" → "Elia-Yunzai" */
function cleanConsoleName(nick) {
    return String(nick ?? '')
        .replace(/[\s_\-·|/]*(stdin|console|标准输入|控制台)[\s_\-·|/]*/ig, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * 汇总全局 Bot 上所有账号 id。
 * Miao 系（含 Elia-Yunzai）约定：在线账号 uin 列表在 Bot.adapter 数组里
 * （stdin / QQBot 等都在其中），Bot.uin 则是默认 icqq 账号（可能被 stdin 占用）。
 */
function botAccountIds(b) {
    const ids = []
    const add = v => { if (v != null && v !== '' && !ids.includes(v)) ids.push(v) }
    if (Array.isArray(b.adapter)) for (const id of b.adapter) add(id)
    if (Array.isArray(b.uin)) for (const id of b.uin) add(id)
    else add(b.uin)
    return ids
}

/**
 * 取云崽 Bot 昵称：遍历所有账号（Bot[id].nickname），优先真实账号（如 QQBot），
 * 跳过 stdin / 控制台适配器；若只有控制台账号，则清洗掉 Stdin 标记后使用；取不到返回空串。
 */
function botNickname() {
    try {
        const b = globalThis.Bot
        if (!b) return ''
        const consoleNicks = []
        for (const id of botAccountIds(b)) {
            const bot = b[id]
            if (!bot) continue
            const nick = typeof bot.nickname === 'string' ? bot.nickname.trim() : ''
            if (!nick) continue
            // Bot[id].adapter 在 Miao 约定里是适配器名字符串（"QQBot" / "stdin"）
            if (isConsoleLike(id) || isConsoleLike(bot.adapter) || isConsoleLike(nick)) {
                consoleNicks.push(nick)
                continue
            }
            return nick // 真实账号昵称，直接用
        }
        // 兜底：个别框架只把昵称挂在全局 Bot 上
        const own = typeof b.nickname === 'string' ? b.nickname.trim() : ''
        if (own && !isConsoleLike(own)) return own
        // 只有 stdin / 控制台账号时：清洗掉标记后使用（如 "Elia-Yunzai Stdin" → "Elia-Yunzai"）
        for (const nick of [...consoleNicks, own]) {
            const cleaned = cleanConsoleName(nick)
            if (cleaned) return cleaned
        }
    } catch { /* 忽略：拿不到昵称不影响出图 */ }
    return ''
}

/** 规整昵称：控制台类昵称清洗掉 stdin/控制台 标记，其余原样 trim；空串返回空串 */
function normalizeName(nick) {
    const n = typeof nick === 'string' ? nick.trim() : ''
    if (!n) return ''
    return isConsoleLike(n) ? cleanConsoleName(n) : n
}

/**
 * 底部栏中间文字：固定为 "Generated by <名称>"，只有 <名称> 可配置。
 * 名称优先级：配置 footer.bot_name > 收到本次消息的 Bot 昵称（raw.botName，由 app 层传入）
 *            > 全局 Bot 昵称兜底（无事件信息时）> YunluluBot。
 */
function resolveFooterCenter(raw = {}) {
    const custom = config.get('footer.bot_name', '')
    const name = (typeof custom === 'string' && custom.trim())
        ? custom.trim()
        : (normalizeName(raw.botName) || botNickname() || 'YunluluBot')
    return 'Generated by ' + name
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
 * @param {string} [raw.botName] 收到本次消息的 Bot 昵称（底部栏「Generated by」用，app 层从事件传入）
 * @returns {object} 模板数据
 */
export function buildB30Model(raw = {}) {
    const records = Array.isArray(raw.records) ? raw.records.slice() : []
    const now = raw.now || Date.now()
    const pttValue = Number(raw.ptt?.value ?? raw.ptt?.save ?? 0)

    // 按潜力排序取前 N，同分按分数降序
    records.sort((a, b) => (b.potential ?? b.play_potential ?? 0) - (a.potential ?? a.play_potential ?? 0)
        || (b.score || 0) - (a.score || 0))

    const count = raw.count || 50
    const cards = records.slice(0, count).map((r, i) => {
        let diff = DIFF_NAMES[r.difficulty] || 'FTR'
        if (diff === 'BYD' && INS_SONGS.has(String(r.song_id || '').toLowerCase())) diff = 'INS'
        const clear = CLEARS[r.clear_type] ?? CLEARS[0]
        const potential = Number(r.potential ?? r.play_potential ?? 0)
        const days = r.time_played ? Math.max(0, Math.floor((now - r.time_played) / 86400000)) : 0
        return {
            rank: i + 1,
            // 官方曲库优先（含难度专属曲名），服务器曲名只作兜底
            title: songTitle(r.song_id, r.difficulty, r.title),
            jacket: r.song_id ? jacketFile(r.song_id, r.difficulty) : '',
            diff,
            diffColor: DIFF_COLORS[diff],
            potentialLine: diff + ' ' + formatConst(r.chart_constant ?? r.constant) + ' \u203a ' + fixed(potential, 4),
            score: formatScore(r.score),
            p: 'P' + (r.perfect_count ?? 0) + '(+' + (r.shiny_perfect_count ?? 0) + ')',
            f: 'F' + (r.near_count ?? 0),
            l: 'L' + (r.miss_count ?? 0),
            // FR 两字视觉比 NC 窄，中间补一个空格对齐观感
            clear: clear.text === 'FR' ? 'F R' : clear.text,
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
            // 潜力值隐藏（-1）时不显示数字，只保留 off 徽章
            save: pttValue < 0 ? '' : fixed(pttValue, 3),
            calc: Number(raw.ptt?.exact ?? pttValue) < 0 ? '' : fixed(raw.ptt?.exact ?? pttValue, 5),
            b10: fixed(raw.ptt?.b10 ?? 0, 5),
            b50: fixed(raw.ptt?.b50 ?? 0, 5),
            rating: ratingIndex(pttValue),
        },
        chart: buildChart(raw.chart, records, now),
        cards,
        footer: { center: resolveFooterCenter(raw) },
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
            // 丢弃无效点（无/零潜力），否则折线会掉到 0 冲出图框
            series: chart.series.filter((p) => Number(p.v) > 0),
            ticks: chart.ticks || ['', '', '', '', 'now'],
        }
    }

    // 只取既有游玩时间、又有有效潜力（>0）的记录，避免 0 值把折线拉出图框
    const plays = records
        .filter((r) => r.time_played && Number(r.potential ?? r.play_potential ?? 0) > 0)
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
