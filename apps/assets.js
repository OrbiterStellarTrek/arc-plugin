import plugin from '../../../lib/plugins/plugin.js'
import config from '../model/config.js'
import { escapeRegExp } from '../model/util.js'
import { checkVersion, updateAssets, SyncConflictError } from '../model/assets.js'

const H = escapeRegExp(config.cmdhead)

export class arcAssets extends plugin {
    constructor() {
        super({
            name: 'arc-资源更新',
            dsc: 'Arcaea 曲绘 / 渲染资源在线增量更新',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: `^[#/]${H}\\s*(?:曲绘|资源)?\\s*(?:版本|version)\\s*$`, fnc: 'version' },
                { reg: `^[#/]${H}\\s*(?:更新|update)\\s*(?:曲绘|资源|assets)?\\s*(强制|force)?\\s*$`, fnc: 'update' },
                { reg: `^[#/]${H}\\s*强制更新\\s*(?:曲绘|资源|assets)?\\s*$`, fnc: 'forceUpdate' },
            ],
        })
    }

    /** #a曲绘版本：对比本地与服务端最新版本 */
    async version(e) {
        try {
            const v = await checkVersion()
            const lines = [
                'Arcaea 资源版本',
                `本地：${v.local || '未同步'}`,
                `最新：${v.latest}`,
                v.upToDate ? '已是最新 ✓' : `有更新可用，发送 /${config.cmdhead}更新曲绘 同步`,
            ]
            if (!v.clean && v.local) lines.push('（检测到本地有改动，更新时将按配置的策略处理）')
            await e.reply(lines.join('\n'), true)
        } catch (err) {
            await e.reply(`查询资源版本失败：${err?.message || err}`, true)
        }
        return true
    }

    /** #a更新曲绘 [强制]：增量同步资源 */
    async update(e) {
        const force = /(?:强制|force)\s*$/i.test(e.msg)
        return this.#doUpdate(e, force)
    }

    /** #a强制更新曲绘：等价于 #a更新曲绘 强制 */
    async forceUpdate(e) {
        return this.#doUpdate(e, true)
    }

    async #doUpdate(e, force) {
        if (!e.isMaster) {
            await e.reply('只有主人才能更新资源喵', true)
            return true
        }

        await e.reply(force ? '开始强制同步曲绘资源，请稍候…' : '开始检查并同步曲绘资源，请稍候…', true)
        try {
            const r = await updateAssets({
                force,
                onProgress: (p) => {
                    // 下载进度只写日志，避免刷屏；大包首次同步可在控制台观察
                    logger?.mark?.(`[arc-plugin] 资源同步 ${p.percent}%（${(p.bytesPerSecond / 1048576).toFixed(1)} MB/s）`)
                },
            })
            if (r.upToDate) {
                await e.reply(`资源已是最新（v${r.version}），无需更新`, true)
                return true
            }
            const parts = [
                `资源更新完成 ✓ v${r.version}`,
                `新增 ${r.created} / 更新 ${r.updated} / 删除 ${r.deleted}` + (r.kept ? ` / 保留本地 ${r.kept}` : ''),
            ]
            if (r.downloadedMB > 0) parts.push(`下载 ${r.downloadedMB} MB，用时 ${(r.elapsedMs / 1000).toFixed(1)}s`)
            await e.reply(parts.join('\n'), true)
        } catch (err) {
            if (err instanceof SyncConflictError) {
                const n = Array.isArray(err.conflicts) ? err.conflicts.length : 0
                await e.reply(
                    `检测到 ${n || '若干'} 处本地改动，已按「fail」策略中止、未改动任何文件。\n` +
                    `如需以服务端为准覆盖，请发送 /${config.cmdhead}强制更新曲绘`,
                    true,
                )
            } else {
                await e.reply(`资源更新失败：${err?.message || err}`, true)
            }
        }
        return true
    }
}
