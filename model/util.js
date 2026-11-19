import { ArcApiError } from './api/client.js'
import { serverName } from './api/servers.js'

/** 转义正则特殊字符（用于把 cmdhead 拼进命令正则） */
export function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 从事件取 onebot_user_id（发送者 QQ）与 bot_id（当前机器人 uin） */
export function pickTarget(e) {
    const userId = String(e?.user_id ?? '')
    const botId = String(e?.self_id ?? e?.bot?.uin ?? '')
    return { userId, botId: botId || undefined }
}

/** 服标签（国服 / 国际服）→ 服 id 的内置别名表 */
const SERVER_TAG_WORDS = [
    ['cn', ['国服', '国', 'cn']],
    ['global', ['国际服', '国际', '外服', 'global']],
]

/** 消息里可用的服标签词表（内置别名 + 配置里的备注名），长词优先避免「国际服」被「国」截胡 */
function serverTagPatterns() {
    const words = []
    for (const [id, aliases] of SERVER_TAG_WORDS) {
        for (const alias of aliases) words.push([alias, id])
        const name = serverName(id)
        if (!aliases.includes(name)) words.push([name, id])
    }
    return words.sort((a, b) => b[0].length - a[0].length)
}

/** 判断一个词是不是服标签；是则返回对应服 id（cn / global），否则 undefined */
export function parseServerTag(token) {
    const t = String(token ?? '').trim().toLowerCase()
    if (!t) return undefined
    for (const [word, id] of serverTagPatterns()) {
        if (word.toLowerCase() === t) return id
    }
    return undefined
}

/**
 * 从消息末尾剥离可选的服标签（国服 / 国际服）。
 * glued=true 允许标签紧贴前面的词（如 #ab50国际服）；
 * glued=false 要求标签是独立一词（如 查歌 xxx 国际服），避免误吞以「国」结尾的曲名。
 * @returns {{serverId?:string, serverName?:string, msg:string}}
 *   无标签时 serverId / serverName 为 undefined，msg 为去掉尾随空白的原文
 */
export function splitServerTag(text, { glued = true } = {}) {
    const msg = String(text ?? '').replace(/\s+$/, '')
    const patterns = serverTagPatterns()
    if (!patterns.length) return { serverId: undefined, serverName: undefined, msg }
    const alt = patterns.map(([word]) => escapeRegExp(word)).join('|')
    const re = glued ? new RegExp(`(${alt})$`, 'i') : new RegExp(`\\s(${alt})$`, 'i')
    const m = msg.match(re)
    if (!m) return { serverId: undefined, serverName: undefined, msg }
    const serverId = parseServerTag(m[1])
    if (!serverId) return { serverId: undefined, serverName: undefined, msg }
    return {
        serverId,
        serverName: serverName(serverId),
        msg: msg.slice(0, m.index).replace(/\s+$/, ''),
    }
}

/** 难度词 → API difficulty（0=PST 1=PRS 2=FTR 3=BYD 4=ETR） */
const DIFF_MAP = {
    pst: 0, past: 0, 0: 0,
    prs: 1, present: 1, 1: 1,
    ftr: 2, future: 2, 2: 2,
    byd: 3, beyond: 3, 3: 3,
    etr: 4, eternal: 4, 4: 4,
}

/** 解析难度，返回 0-4 或 null */
export function parseDifficulty(token) {
    if (token == null) return null
    const key = String(token).trim().toLowerCase()
    return key in DIFF_MAP ? DIFF_MAP[key] : null
}

const DIFF_NAMES = ['PST', 'PRS', 'FTR', 'BYD', 'ETR']
export const diffName = (d) => DIFF_NAMES[d] || String(d)

/** Unix 秒 → 本地「YYYY-MM-DD HH:mm」 */
export function formatTime(unixSec) {
    const t = Number(unixSec)
    if (!Number.isFinite(t) || t <= 0) return '未知时间'
    const d = new Date(t * 1000)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 后端错误码 → 友好中文提示 */
export function friendlyError(err, { what = '查询' } = {}) {
    if (!(err instanceof ArcApiError)) {
        return `${what}失败：${err?.message || err}`
    }
    switch (err.code) {
        case 'network_error':
            return err.message
        case 'server_not_configured':
            return err.message
        case 'poll_timeout':
            return `${what}超时，后端可能较忙，请稍后重试`
        case 'B50_COOLDOWN': {
            const s = Number(err.retryAfterSeconds)
            const left = Number.isFinite(s) && s > 0
                ? (s < 60 ? `剩余 ${s} 秒` : `剩余 ${Math.ceil(s / 60)} 分钟`)
                : '请稍后'
            return `B50 查询冷却中（${left}），期间可用「last/上次」查看最近一次结果`
        }
        case 'QUEUE_FULL':
            return '当前查询队列已满，请过一会儿再试'
        case 'job_not_found':
            return '任务已失效（可能服务重启），请重新查询'
        case 'result_consumed':
            return '该结果已被使用，请重新查询或查看最近一次记录'
        case 'B50_CACHE_NOT_FOUND':
            return '还没有可用的 B50 记录，请先 #ab50 查询一次'
        case 'SONG_CACHE_NOT_FOUND':
            return '还没有这首歌的记录，请先查询一次'
        default:
            break
    }
    if (err.status === 401) return '查分服务认证失败，请联系皮梦检查一下配置文件喵'
    if (err.status === 404) return `${what}失败：未找到对应记录或绑定`
    if (err.status === 400) return `${what}失败：参数有误（${err.message}）`
    return `${what}失败：${err.message}`
}
