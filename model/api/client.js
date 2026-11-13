import config from '../config.js'

/** 带后端错误码的 API 异常 */
export class ArcApiError extends Error {
    constructor(message, { code = '', status = 0, cause } = {}) {
        super(message)
        this.name = 'ArcApiError'
        this.code = code
        this.status = status
        if (cause) this.cause = cause
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * invtwd-server 查分 API 客户端（基于全局 fetch，无需 axios）。
 * 所有 base_url / api_key / 超时都从 config 实时读取，改配置 reload 后即生效。
 */
class ArcApi {
    get #base() {
        return String(config.get('server.base_url', 'http://127.0.0.1:8080')).replace(/\/+$/, '')
    }

    get #key() { return config.get('server.api_key', '') }

    get #timeout() { return Number(config.get('server.timeout_ms', 15000)) || 15000 }

    /**
     * 发一个请求。
     * @param {string} pathUrl 以 / 开头的路径（可带 query）
     * @param {object} [opt]
     * @param {string} [opt.method]
     * @param {object} [opt.body] JSON body
     * @param {boolean} [opt.auth=true] 是否带 Bearer
     * @param {'json'|'buffer'} [opt.as='json'] 期望响应类型
     * @returns {Promise<any>} json 对象、Buffer，或 204 时返回 null
     */
    async #request(pathUrl, opt = {}) {
        const { method = 'GET', body, auth = true, as = 'json' } = opt
        const headers = {}
        if (auth && this.#key) headers.Authorization = `Bearer ${this.#key}`
        if (body !== undefined) headers['Content-Type'] = 'application/json'
        if (as === 'json') headers.Accept = 'application/json'

        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), this.#timeout)
        let res
        try {
            res = await fetch(this.#base + pathUrl, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: ctrl.signal,
            })
        } catch (err) {
            throw new ArcApiError(
                err?.name === 'AbortError' ? '查分服务超时' : `无法连接查分服务：${err?.message || err}`,
                { code: 'network_error', cause: err },
            )
        } finally {
            clearTimeout(timer)
        }

        if (res.status === 204) return null

        const ct = res.headers.get('content-type') || ''
        if (res.ok && as === 'buffer') {
            return Buffer.from(await res.arrayBuffer())
        }

        let data = null
        if (ct.includes('application/json')) {
            data = await res.json().catch(() => null)
        } else if (res.ok && as === 'json') {
            // 期望 json 但服务器返回了别的（如 png），交给调用方判断
            return Buffer.from(await res.arrayBuffer())
        }

        if (!res.ok) {
            const code = data?.error?.code || ''
            const message = data?.error?.message || `HTTP ${res.status}`
            throw new ArcApiError(message, { code, status: res.status })
        }
        return data
    }

    // ---- Health ----
    health() {
        return this.#request('/healthz', { auth: false })
    }

    // ---- Bindings ----
    getBinding(onebotUserId, botId) {
        const q = botId ? `?bot_id=${encodeURIComponent(botId)}` : ''
        return this.#request(`/api/v1/bindings/${encodeURIComponent(onebotUserId)}${q}`)
    }

    putBinding(onebotUserId, friendCode, botId) {
        const body = { onebot_user_id: String(onebotUserId), friend_code: String(friendCode) }
        if (botId) body.bot_id = String(botId)
        return this.#request('/api/v1/bindings', { method: 'POST', body })
    }

    deleteBinding(onebotUserId, botId) {
        const q = botId ? `?bot_id=${encodeURIComponent(botId)}` : ''
        return this.#request(`/api/v1/bindings/${encodeURIComponent(onebotUserId)}${q}`, { method: 'DELETE' })
    }

    // ---- Queries ----
    submitB50(onebotUserId, botId) {
        const body = { onebot_user_id: String(onebotUserId) }
        if (botId) body.bot_id = String(botId)
        return this.#request('/api/v1/queries/b50', { method: 'POST', body })
    }

    /** 读取最近一次成功 B50 快照（JSON），可重复读、不查后端 */
    getLastB50(onebotUserId, botId) {
        const p = new URLSearchParams({ onebot_user_id: String(onebotUserId) })
        if (botId) p.set('bot_id', String(botId))
        return this.#request(`/api/v1/queries/b50/last?${p}`)
    }

    submitSong(onebotUserId, songId, difficulty, botId) {
        const body = { onebot_user_id: String(onebotUserId), song_id: String(songId), difficulty: Number(difficulty) }
        if (botId) body.bot_id = String(botId)
        return this.#request('/api/v1/queries/song', { method: 'POST', body })
    }

    getJob(jobId) {
        return this.#request(`/api/v1/queries/${encodeURIComponent(jobId)}`)
    }

    // ---- Last 快照出图（不消费 Job，可重复读）----
    lastB50Image(onebotUserId, botId) {
        const p = new URLSearchParams({ onebot_user_id: String(onebotUserId) })
        if (botId) p.set('bot_id', String(botId))
        return this.#request(`/api/v1/queries/b50/last/image.png?${p}`, { as: 'buffer' })
    }

    lastSongImage(onebotUserId, songId, difficulty, botId) {
        const p = new URLSearchParams({
            onebot_user_id: String(onebotUserId),
            song_id: String(songId),
            difficulty: String(difficulty),
        })
        if (botId) p.set('bot_id', String(botId))
        return this.#request(`/api/v1/queries/song/last/image.png?${p}`, { as: 'buffer' })
    }

    /**
     * 轮询任务到终态。
     * queued/processing 不消费、可无限轮询；completed/failed 首次读取原子消费并返回结果。
     * @param {string} jobId
     * @param {object} [opt]
     * @param {number} [opt.pollAfterMs] 首次等待间隔（来自提交响应）
     * @param {number} [opt.maxWaitMs] 最长等待（毫秒），覆盖 config.poll.max_wait_ms
     *   —— B50 后端分批串行，queued 可能数十秒，调用方可传更大的值
     * @returns {Promise<object>} 终态 JobOutput（status=completed|failed）
     */
    async pollJob(jobId, { pollAfterMs, maxWaitMs } = {}) {
        const maxWait = Number(maxWaitMs ?? config.get('poll.max_wait_ms', 60000)) || 60000
        const fallback = Number(config.get('poll.default_interval_ms', 3000)) || 3000
        let wait = Number(pollAfterMs) || fallback
        const deadline = Date.now() + maxWait

        for (;;) {
            if (Date.now() + wait > deadline) {
                throw new ArcApiError('查询超时，请稍后重试', { code: 'poll_timeout' })
            }
            await sleep(wait)
            const job = await this.getJob(jobId)
            if (job.status === 'completed' || job.status === 'failed') return job
            wait = Number(job.poll_after_ms) || fallback
        }
    }
}

const api = new ArcApi()
export default api
