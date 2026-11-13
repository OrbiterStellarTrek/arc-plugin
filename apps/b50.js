import plugin from '../../../lib/plugins/plugin.js'
import api, { ArcApiError } from '../model/api/client.js'
import config from '../model/config.js'
import { renderB30 } from '../model/render/arcb30.js'
import { b50ResultToRaw } from '../model/data/mapResult.js'
import { pickTarget, friendlyError, formatTime, escapeRegExp } from '../model/util.js'

const H = escapeRegExp(config.cmdhead)

export class arcB50 extends plugin {
    constructor() {
        super({
            name: 'arc-b50',
            dsc: 'Arcaea B50 查询（本地渲染）',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: `^[#/]${H}\\s*(?:b50cd|冷却|cd)\\s*$`, fnc: 'cooldown' },
                { reg: `^[#/]${H}\\s*(?:b50|B50|查分|bests)\\s*(?:last|上次|历史)?\\s*$`, fnc: 'b50' },
            ],
        })
    }

    async b50(e) {
        const { userId, botId } = pickTarget(e)
        // 带 last/上次/历史 时直接读最近一次快照，不触发新查询
        if (/(?:last|上次|历史)\s*$/i.test(e.msg)) return this.#sendLast(e, userId, botId)
        let result
        try {
            const submit = await api.submitB50(userId, botId)
            if (submit.status === 'completed' && submit.result) {
                result = submit.result
            } else {
                if (submit.status === 'queued' && submit.queue_position) {
                    await e.reply(
                        `正在排队查询 B50（第 ${submit.queue_position} 位），请稍候…`,
                        true,
                    )
                } else {
                    await e.reply('正在查询 B50，请稍候…', true)
                }
                const job = await api.waitJob(submit.job_id, {
                    maxWaitMs: config.get('poll.b50_max_wait_ms', 180000),
                })
                if (job.status === 'failed') {
                    return e.reply(`B50 查询失败：${job.error || job.error_code || '未知错误'}`, true)
                }
                result = job.result
            }
        } catch (err) {
            // B50 一律本地渲染：慢查询/冷却时回退「拉服务器最近数据(JSON) → 本地出图」
            const cooling = err instanceof ArcApiError && err.code === 'B50_COOLDOWN'
            const note = cooling
                ? `\n（B50 冷却中${cooldownHint(err)}，先渲染上一次的数据）`
                : '\n（查询较慢，先渲染上一次的数据）'
            try {
                if (await this.#renderLast(e, userId, botId, note)) return true
            } catch { /* 无最近快照或渲染失败，走下方错误提示 */ }
            return e.reply(friendlyError(err, { what: 'B50 查询' }), true)
        }

        if (!result) return e.reply('B50 查询没有返回结果\n请联系皮梦/班尼特处理喵', true)

        try {
            await e.reply(segment.image(await this.#render(result)))
        } catch (err) {
            await e.reply(`B50 渲染失败：${err?.message || err}`, true)
        }
        return true
    }

    /** #ab50cd：查看当前绑定的 B50 冷却剩余时间（只读，不触发查询） */
    async cooldown(e) {
        const { userId, botId } = pickTarget(e)
        try {
            const cd = await api.getB50Cooldown(userId, botId)
            const s = Number(cd.retry_after_seconds) || 0
            if (cd.can_query || s <= 0) {
                return e.reply('B50 现在可以查询，发送 #ab50 即可', true)
            }
            const left = s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
            const at = cd.available_at ? `，约 ${formatTime(cd.available_at)} 恢复` : ''
            return e.reply(`B50 冷却中，剩余 ${left}${at}\n期间可用「#${config.cmdhead}b50 last」查看上次结果`, true)
        } catch (err) {
            return e.reply(friendlyError(err, { what: '查询 B50 冷却' }), true)
        }
    }

    /** #ab50 last：读最近一次成功 B50 快照（JSON）本地出图，秒回、不查后端 */
    async #sendLast(e, userId, botId) {
        try {
            await this.#renderLast(e, userId, botId)
        } catch (err) {
            await e.reply(friendlyError(err, { what: '读取上次 B50' }), true)
        }
        return true
    }

    /**
     * 拉服务器最近一次成功 B50 快照（JSON）并本地渲染发出。
     * 不使用服务器出图；无快照（B50_CACHE_NOT_FOUND）或渲染失败时抛出，交调用方处理。
     * @returns {Promise<boolean>} 发送成功返回 true
     */
    async #renderLast(e, userId, botId, extraNote = '') {
        const snap = await api.getLastB50(userId, botId)
        const buf = await this.#render(snap.result)
        const parts = [segment.image(buf), `\n生成于 ${formatTime(snap.generated_at)}`]
        if (snap.cache_stale) parts.push('（算法版本已更新，建议重新 #ab50）')
        if (extraNote) parts.push(extraNote)
        await e.reply(parts)
        return true
    }

    /** 结果 → 本地渲染出图（读配置里的出图参数） */
    #render(result) {
        return renderB30(b50ResultToRaw(result), {
            renderer: config.get('b50.renderer', 'auto'),
            scale: config.get('b50.scale', 3),
            type: config.get('b50.type', 'webp'),
            quality: config.get('b50.quality', 95),
        })
    }
}

/** B50_COOLDOWN 剩余时间提示，如「，剩余 8 分钟」 */
function cooldownHint(err) {
    const s = Number(err?.retryAfterSeconds)
    if (!Number.isFinite(s) || s <= 0) return ''
    if (s < 60) return `，剩余 ${s} 秒`
    return `，剩余 ${Math.ceil(s / 60)} 分钟`
}
