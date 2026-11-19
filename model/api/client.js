import config from '../config.js'
import { resolveServer } from './servers.js'

/** 带后端错误码的 API 异常 */
export class ArcApiError extends Error {
    constructor(message, { code = '', status = 0, retryAfterSeconds, availableAt, cause } = {}) {
        super(message)
        this.name = 'ArcApiError'
        this.code = code
        this.status = status
        // B50_COOLDOWN 等场景：剩余冷却秒数与到期 Unix 秒
        if (retryAfterSeconds != null) this.retryAfterSeconds = Number(retryAfterSeconds)
        if (availableAt != null) this.availableAt = Number(availableAt)
        if (cause) this.cause = cause
    }
}

const safeJsonParse = (s) => { try { return JSON.parse(s) } catch { return null } }

/**
 * invtwd-server 查分 API 客户端（基于全局 fetch，无需 axios）。
 * 支持「国服 / 国际服」双后端：两服 API 端点完全一致，仅 base_url / api_key 不同，
 * 用 api.use('cn' | 'global') 取对应服的客户端，不指定时用配置的默认服。
 * 连接信息都从 config 实时读取，改配置 reload 后即生效。
 */
class ArcApi {
    /**
     * @param {string|undefined} serverId 查分服 id（cn=国服 / global=国际服）；
     *   缺省使用配置里的默认服（servers.default）
     */
    constructor(serverId) {
        this.serverId = serverId
    }

    /** 取指定服的客户端视图，如 api.use('global').submitB50(...)；不传则沿用本实例的服 */
    use(serverId) {
        return serverId === this.serverId ? this : new ArcApi(serverId)
    }

    /** 当前服的连接信息；未配置的服直接抛错，提示去 config.yaml 填写 */
    get #conn() {
        const conn = resolveServer(this.serverId)
        if (!conn.configured) {
            throw new ArcApiError(
                `${conn.name}查分后端尚未配置，请在 config/config.yaml 的 servers.${conn.id}.base_url 填写地址后重试`,
                { code: 'server_not_configured' },
            )
        }
        return conn
    }

    get #base() { return this.#conn.baseUrl }

    get #key() { return this.#conn.apiKey }

    get #timeout() { return this.#conn.timeoutMs }

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
            throw this.#toError(res, data)
        }
        return data
    }

    /** 把失败响应（含 error 体与 Retry-After 头）整理成 ArcApiError */
    #toError(res, data) {
        const code = data?.error?.code || ''
        const message = data?.error?.message || `HTTP ${res.status}`
        const headerRetry = res.headers?.get?.('Retry-After')
        return new ArcApiError(message, {
            code,
            status: res.status,
            retryAfterSeconds: data?.error?.retry_after_seconds ?? (headerRetry != null ? Number(headerRetry) : undefined),
            availableAt: data?.error?.available_at,
        })
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

    /** 读取当前绑定的 B50 冷却状态（秒），不触发查询 */
    getB50Cooldown(onebotUserId, botId) {
        const p = new URLSearchParams({ onebot_user_id: String(onebotUserId) })
        if (botId) p.set('bot_id', String(botId))
        return this.#request(`/api/v1/queries/b50cd?${p}`)
    }

    // ---- Last 快照出图（不消费 Job，可重复读）----
    // 注：B50 一律本地渲染（renderB30），不使用服务器出图；单曲仍走服务器出图。
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
     * 通过 SSE 等待任务到终态。
     *
     * 服务端把 GET /api/v1/queries/{job_id} 作为 SSE 长连接：排队/处理中每 15 秒发注释心跳，
     * 成功或失败发一次 `event: result`（data 为 JobOutput），随后关闭并原子消费该 Job；
     * 若结果已被其它连接消费，则发 `event: error`（data 为 {status,error}）或在建流前返回 410。
     *
     * @param {string} jobId
     * @param {object} [opt]
     * @param {number} [opt.maxWaitMs] 最长等待（毫秒），覆盖 config.poll.max_wait_ms
     *   —— B50 后端分批串行，queued 可能数十秒，调用方可传更大的值
     * @returns {Promise<object>} 终态 JobOutput（status=completed|failed）
     */
    async waitJob(jobId, { maxWaitMs } = {}) {
        const maxWait = Number(maxWaitMs ?? config.get('poll.max_wait_ms', 60000)) || 60000
        const headers = { Accept: 'text/event-stream' }
        if (this.#key) headers.Authorization = `Bearer ${this.#key}`

        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), maxWait)
        let res
        try {
            res = await fetch(`${this.#base}/api/v1/queries/${encodeURIComponent(jobId)}`, {
                method: 'GET',
                headers,
                signal: ctrl.signal,
            })
        } catch (err) {
            clearTimeout(timer)
            if (err?.name === 'AbortError') throw new ArcApiError('查询超时，请稍后重试', { code: 'poll_timeout' })
            throw new ArcApiError(`无法连接查分服务：${err?.message || err}`, { code: 'network_error', cause: err })
        }

        // 建流前的错误（410 result_consumed / 404 job_not_found / 401）以 JSON 返回
        if (!res.ok || !res.body) {
            clearTimeout(timer)
            const data = (res.headers.get('content-type') || '').includes('application/json')
                ? await res.json().catch(() => null)
                : null
            throw this.#toError(res, data)
        }

        try {
            return await this.#readJobStream(res)
        } catch (err) {
            if (err?.name === 'AbortError') throw new ArcApiError('查询超时，请稍后重试', { code: 'poll_timeout' })
            throw err
        } finally {
            clearTimeout(timer)
        }
    }

    /** 读取 SSE 流直到拿到终态 result 事件；error 事件抛出，心跳忽略 */
    async #readJobStream(res) {
        const decoder = new TextDecoder()
        const sep = /\r\n\r\n|\n\n|\r\r/
        let buf = ''
        try {
            for await (const value of this.#iterBody(res.body)) {
                buf += decoder.decode(value, { stream: true })
                let m
                while ((m = sep.exec(buf))) {
                    const chunk = buf.slice(0, m.index)
                    buf = buf.slice(m.index + m[0].length)
                    const ev = this.#parseSseEvent(chunk)
                    if (!ev) continue // 仅注释/心跳
                    if (ev.event === 'error') {
                        const d = safeJsonParse(ev.data)
                        throw new ArcApiError(
                            d?.error?.message || '结果已被读取，请重新查询或查看最近一次记录',
                            {
                                code: d?.error?.code || 'result_consumed',
                                status: d?.status || 410,
                                retryAfterSeconds: d?.error?.retry_after_seconds,
                                availableAt: d?.error?.available_at,
                            },
                        )
                    }
                    const job = safeJsonParse(ev.data)
                    if (job && (job.status === 'completed' || job.status === 'failed')) return job
                    // 其它事件（理论上不会出现的非终态）忽略，继续等待
                }
            }
        } finally {
            // 关闭连接：Node Readable 用 destroy，WHATWG 流用 cancel
            try { res.body?.destroy?.() } catch { /* ignore */ }
            try { res.body?.cancel?.().catch?.(() => {}) } catch { /* ignore */ }
        }
        throw new ArcApiError('查询连接已结束但未返回结果，请稍后重试', { code: 'poll_timeout' })
    }

    /**
     * 统一迭代响应体，兼容两种 fetch 实现：
     *   - 全局 undici fetch：res.body 是 WHATWG ReadableStream（有 getReader）
     *   - node-fetch 等：res.body 是 Node Readable（本身可异步迭代）
     */
    async *#iterBody(body) {
        if (!body) return
        if (typeof body.getReader === 'function') {
            const reader = body.getReader()
            try {
                for (;;) {
                    const { value, done } = await reader.read()
                    if (done) return
                    if (value) yield value
                }
            } finally {
                try { reader.cancel()?.catch?.(() => {}) } catch { /* ignore */ }
            }
        } else {
            yield* body
        }
    }

    /** 解析单个 SSE 事件块；纯注释（心跳）或无 data 返回 null */
    #parseSseEvent(chunk) {
        let event = 'message'
        const dataLines = []
        for (const line of chunk.split(/\r\n|\n|\r/)) {
            if (!line || line.startsWith(':')) continue // 空行或注释（: keep-alive）
            const i = line.indexOf(':')
            const field = i < 0 ? line : line.slice(0, i)
            let val = i < 0 ? '' : line.slice(i + 1)
            if (val.startsWith(' ')) val = val.slice(1)
            if (field === 'event') event = val
            else if (field === 'data') dataLines.push(val)
        }
        return dataLines.length ? { event, data: dataLines.join('\n') } : null
    }
}

const api = new ArcApi()
export default api
