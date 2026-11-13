import { ArcApiError } from './api/client.js'

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

/** 后端错误码 → 友好中文提示 */
export function friendlyError(err, { what = '查询' } = {}) {
    if (!(err instanceof ArcApiError)) {
        return `${what}失败：${err?.message || err}`
    }
    switch (err.code) {
        case 'network_error':
            return err.message
        case 'poll_timeout':
            return `${what}超时，后端可能较忙，请稍后重试`
        case 'QUEUE_FULL':
            return '当前查询队列已满，请过一会儿再试'
        case 'job_not_found':
            return '任务已失效（可能服务重启），请重新查询'
        case 'result_consumed':
            return '该结果已被读取，请重新查询或查看最近一次记录'
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
