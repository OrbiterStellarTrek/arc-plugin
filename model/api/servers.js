import config from '../config.js'

/**
 * 国服 / 国际服双后端解析。
 *
 * 两套 invtwd-server 部署的 API 端点完全一致，仅需各自填写 base_url 与 api_key：
 *   servers.cn     备注「国服」
 *   servers.global 备注「国际服」
 * 不带服标签的命令走 servers.default 指定的默认服；默认服的地址 / Key 为空时
 * 回退旧版 server.*（单后端老配置可平滑升级），其余服必须显式填写才可用。
 */

const KNOWN_IDS = ['cn', 'global']
const FALLBACK_NAMES = { cn: '国服', global: '国际服' }

function rawServers() {
    const servers = config.all.servers
    return servers && typeof servers === 'object' && !Array.isArray(servers) ? servers : {}
}

/** 配置声明的服 id 列表：内置双服固定在前，声明顺序在后的追加 */
export function serverIds() {
    const declared = Object.keys(rawServers()).filter((k) => k !== 'default')
    const ids = KNOWN_IDS.filter((id) => declared.includes(id))
    for (const id of declared) {
        if (!ids.includes(id)) ids.push(id)
    }
    return ids.length ? ids : KNOWN_IDS.slice()
}

/** 不带服标签时使用的默认服 id */
export function defaultServerId() {
    const ids = serverIds()
    const def = String(rawServers().default ?? '').trim()
    if (ids.includes(def)) return def
    return ids.includes('cn') ? 'cn' : ids[0]
}

/** 服的展示备注名（如 国服 / 国际服；未填写时回退内置名） */
export function serverName(id) {
    const sid = id == null || String(id) === '' ? defaultServerId() : String(id)
    const raw = rawServers()[sid]
    const name = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.name : ''
    return typeof name === 'string' && name.trim() ? name.trim() : (FALLBACK_NAMES[sid] || sid)
}

/**
 * 解析某服的有效连接信息（默认服回退旧版 server.*，其余服需显式配置）。
 * @returns {{id:string,name:string,baseUrl:string,apiKey:string,timeoutMs:number,isDefault:boolean,configured:boolean}}
 *   configured=false 表示该服未配置（base_url 为空），调用方应提示去 config.yaml 填写
 */
export function resolveServer(id) {
    const sid = id == null || String(id) === '' ? defaultServerId() : String(id)
    const raw = rawServers()[sid]
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const legacy = config.all.server || {}
    const isDefault = sid === defaultServerId()

    let baseUrl = String(entry.base_url ?? '').trim().replace(/\/+$/, '')
    let apiKey = String(entry.api_key ?? '').trim()
    if (isDefault) {
        if (!baseUrl) baseUrl = String(legacy.base_url ?? '').trim().replace(/\/+$/, '')
        if (!apiKey) apiKey = String(legacy.api_key ?? '').trim()
    }
    const timeoutNumber = Number(legacy.timeout_ms)
    return {
        id: sid,
        name: serverName(sid),
        baseUrl,
        apiKey,
        timeoutMs: Number.isFinite(timeoutNumber) && timeoutNumber > 0 ? timeoutNumber : 15000,
        isDefault,
        configured: Boolean(baseUrl),
    }
}

/** 全部已声明的服（含未配置的，configured=false），供状态展示 / 启动探活等 */
export function allServers() {
    return serverIds().map((id) => resolveServer(id))
}
