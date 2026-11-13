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
                const job = await api.pollJob(submit.job_id, {
                    pollAfterMs: submit.poll_after_ms,
                    maxWaitMs: config.get('poll.b50_max_wait_ms', 180000),
                })
                if (job.status === 'failed') {
                    return e.reply(`B50 查询失败：${job.error || job.error_code || '未知错误'}`, true)
                }
                result = job.result
            }
        } catch (err) {
            // 提交/轮询失败：尝试回退到最近一次成功快照（服务器出图）
            const fallback = await this.#tryLastImage(e, userId, botId)
            if (fallback) return true
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

    /** #ab50 last：读最近一次成功 B50 快照（JSON）本地出图，秒回、不查后端 */
    async #sendLast(e, userId, botId) {
        try {
            const snap = await api.getLastB50(userId, botId)
            const buf = await this.#render(snap.result)
            const parts = [segment.image(buf), `\n生成于 ${formatTime(snap.generated_at)}`]
            if (snap.cache_stale) parts.push('（算法版本已更新，建议重新 #ab50）')
            await e.reply(parts)
        } catch (err) {
            await e.reply(friendlyError(err, { what: '读取上次 B50' }), true)
        }
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

    /** 轮询超时等情况下，回退拉取服务器的最近成功快照图 */
    async #tryLastImage(e, userId, botId) {
        try {
            const buf = await api.lastB50Image(userId, botId)
            await e.reply([segment.image(buf), '\n（查询较慢，先发上一次的结果）'])
            return true
        } catch (err) {
            if (err instanceof ArcApiError && err.code === 'B50_CACHE_NOT_FOUND') return false
            return false
        }
    }
}
