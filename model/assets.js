import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { QentimArtClient, SyncConflictError } from '@qentimart/sdk'
import config from './config.js'
import { resetJacketCache } from './data/b30.js'
import { resetSonglistCache } from './data/songlist.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 同步目标：resources/ 根目录。远端清单含 original_ill/（曲绘）与 assets/（立绘/字体/界面图），
// 二者由仓库忽略、靠同步拉取；html/（模板）与 info/songlist.json 随仓库发布，作为未跟踪文件保留、绝不被删改。
const RESOURCES_DIR = path.resolve(__dirname, '..', 'resources')

/** 允许的本地改动处理策略 */
const POLICIES = new Set(['keep', 'overwrite', 'fail'])

/**
 * 规范化资源站地址：去掉末尾的 /index.json 与多余斜杠。
 * 官方站点仅支持 https（http 会 301 跳转且 SDK 不跟随），这里不强改协议，
 * 但默认配置给的就是 https，自建 http 镜像请自行保证可直接访问。
 */
function resolveBaseUrl() {
    let url = String(config.get('assets.base_url', 'https://arcaea-resources.phira.link')).trim()
    url = url.replace(/\/index\.json\/*$/i, '').replace(/\/+$/, '')
    return url
}

/** 读取同步策略，非法值回退 keep */
function resolvePolicy(force) {
    if (force) return 'overwrite'
    const p = String(config.get('assets.local_changes', 'keep')).toLowerCase()
    return POLICIES.has(p) ? p : 'keep'
}

/** 新建一个静态只读客户端（调用方负责 close） */
function makeClient() {
    return new QentimArtClient({
        baseUrl: resolveBaseUrl(),
        concurrency: Number(config.get('assets.concurrency', 16)) || 16,
        timeoutMs: Number(config.get('assets.timeout_ms', 60000)) || 60000,
    })
}

/**
 * 查询版本信息：本地已同步版本 vs 服务端最新版本。
 * @returns {Promise<{ baseUrl:string, local:string|null, latest:string, upToDate:boolean, clean:boolean }>}
 */
export async function checkVersion() {
    const baseUrl = resolveBaseUrl()
    const client = makeClient()
    try {
        const [latest, status] = await Promise.all([
            client.getVersion('latest'),
            client.status(RESOURCES_DIR),
        ])
        // 同步目标是 resources/，html/ 与 assets/ 本就不在清单里（untracked 属正常），
        // 因此是否最新只看版本号与「清单内文件」有无缺失/改动，不用 status.clean。
        const dirty = (status.modified?.length || 0) + (status.missing?.length || 0) > 0
        return {
            baseUrl,
            local: status.version || null,
            latest: latest.version,
            upToDate: status.synced === true && status.version === latest.version && !dirty,
            clean: !dirty,
        }
    } finally {
        client.close()
    }
}

/**
 * 增量同步曲绘与曲名表到 resources/（远端清单仅含 original_ill/ 与 info/songlist.json）。
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] 强制以服务端为准（overwrite，会删除本地多余文件）
 * @param {(p:{percent:number,bytesPerSecond:number})=>void} [opts.onProgress] 下载进度回调（已节流由调用方决定）
 * @returns {Promise<{
 *   version:string, upToDate:boolean, policy:string,
 *   created:number, updated:number, deleted:number, kept:number,
 *   downloadedMB:number, totalMB:number, elapsedMs:number
 * }>}
 * @throws {SyncConflictError} policy 为 fail 且存在本地冲突时
 */
export async function updateAssets({ force = false, onProgress } = {}) {
    const policy = resolvePolicy(force)
    const client = makeClient()
    try {
        const result = await client.sync(RESOURCES_DIR, {
            localChanges: policy,
            onProgress: typeof onProgress === 'function'
                ? (p) => {
                    if (p.phase !== 'download') return
                    const percent = p.total ? Math.floor((p.done / p.total) * 100) : 0
                    onProgress({ percent, bytesPerSecond: p.bytesPerSecond || 0 })
                }
                : undefined,
        })

        const files = result.files || {}
        const bytes = result.bytes || {}
        const created = files.created ?? 0
        const updated = files.updated ?? 0
        const deleted = files.deleted ?? 0
        // kept 在 SDK 里是被保留的文件路径数组，取其长度
        const kept = Array.isArray(files.kept) ? files.kept.length : (files.kept ?? 0)
        // 同步后清掉曲绘 / 曲名表缓存，新曲绘无需重启即可生效
        if (created || updated || deleted) {
            resetJacketCache()
            resetSonglistCache()
        }
        return {
            version: result.version,
            upToDate: created === 0 && updated === 0 && deleted === 0,
            policy,
            created,
            updated,
            deleted,
            kept,
            downloadedMB: Number(((bytes.downloadedWire ?? 0) / 1048576).toFixed(2)),
            totalMB: Number(((bytes.total ?? 0) / 1048576).toFixed(1)),
            elapsedMs: result.elapsedMs ?? 0,
        }
    } finally {
        client.close()
    }
}

/**
 * 首次启动兜底：曲绘/立绘目录缺失或为空时，后台拉取一次。
 * 已有资源则跳过（更新交给 /a更新曲绘）。调用方负责 try/catch 与日志，失败不应影响插件加载。
 * @returns {Promise<{ skipped: true } | ({ skipped: false } & Awaited<ReturnType<typeof updateAssets>>)>}
 */
export async function ensureAssets() {
    const hasFiles = (dir) => {
        try { return fs.readdirSync(dir).length > 0 } catch { return false }
    }
    // original_ill（曲绘）与 assets/char（立绘）任一缺失，就触发一次同步
    const ready = hasFiles(path.join(RESOURCES_DIR, 'original_ill')) && hasFiles(path.join(RESOURCES_DIR, 'assets', 'char'))
    if (ready) return { skipped: true }
    const result = await updateAssets({})
    return { skipped: false, ...result }
}

export { SyncConflictError, RESOURCES_DIR }
