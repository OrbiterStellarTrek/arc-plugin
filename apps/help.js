import plugin from '../../../lib/plugins/plugin.js'
import api from '../model/api/client.js'
import config from '../model/config.js'
import { serverName, allServers, resolveServer } from '../model/api/servers.js'
import { friendlyError, escapeRegExp, splitServerTag } from '../model/util.js'

// 指令头：包成函数，每次调用实时读取配置，改 cmdhead 免重启（配合配置监听）
const H = () => escapeRegExp(config.cmdhead)
const c = () => config.cmdhead

export class arcHelp extends plugin {
    constructor() {
        super({
            name: 'arc-帮助',
            dsc: 'Arcaea 查分帮助 / 服务状态',
            event: 'message',
            priority: 1000,
            rule: [
                // 末尾允许多一个 token 作为可选服标签（如 #a帮助国际服，帮助页忽略该标签）
                { reg: `^[#/]${H()}\\s*(帮助|help|菜单)\\s*(?:\\S+)?\\s*$`, fnc: 'help' },
                { reg: `^[#/]${H()}\\s*(状态|status)\\s*(?:\\S+)?\\s*$`, fnc: 'status' },
            ],
        })
    }

    async help(e) {
        const msg = [
            'Arcaea 查分帮助',
            `/${c()} bind <9位好友码>    绑定账号`,
            `/${c()} mybind              查看当前绑定`,
            `/${c()} unbind              解除绑定`,
            `/${c()} b50                 查询 B50 成绩单`,
            `/${c()} b50 last            查看上次 B50`,
            `/${c()} b50cd               查看 B50 查询冷却剩余时间`,
            `/${c()} song <曲> <难度>    查询单曲`,
            `/${c()} calc <分数> <定数>  计算单曲潜力值`,
            `/${c()} status              查分服务状态`,
            `命令末尾可加服标签（国服 / 国际服），如 /${c()}b50 国际服；默认 ${serverName()}`,
        ]
        if (e.isMaster) {
            msg.push(
                `/${c()} assets              查看资源版本（本地 / 最新）`,
                `/${c()} update              在线增量更新曲绘等资源（主人）`
            )
        }
        await e.reply(msg.join('\n'))
        return true
    }

    /** #a状态 [国服|国际服]：不带标签时逐个展示已配置的服 */
    async status(e) {
        const { serverId, msg } = splitServerTag(e.msg, { glued: true })
        if (!new RegExp(`^[#/]${H()}\\s*(?:状态|status)\\s*$`, 'i').test(msg)) {
            return e.reply(`用法：/${c()}状态 [国服|国际服]`, true)
        }
        const targets = serverId ? [resolveServer(serverId)] : allServers()
        const out = []
        for (const srv of targets) {
            if (!srv.configured) {
                out.push(`【${srv.name}】未配置：请在 config/config.yaml 填写 servers.${srv.id}.base_url`)
                continue
            }
            try {
                const h = await api.use(srv.id).health()
                const a = h.assets || {}
                out.push([
                    `【${srv.name}】查分服务：${h.status || '?'}（${h.name || ''}）`,
                    `后端：${h.backend || '?'} ${h.backend_version || ''}`,
                    `渲染器：${h.renderer || '?'}`,
                    `曲谱就绪：${a.charts_loaded ? '是' : '否'} / 曲目就绪：${a.songs_loaded ? '是' : '否'}`,
                    `缓存图：${a.cache_images ?? 0} 张（${a.cache_mib ?? 0} MiB）`,
                    `B50 冷却：${h.b50_cooldown_seconds ? `${h.b50_cooldown_seconds} 秒` : '未启用'}`,
                ].join('\n'))
            } catch (err) {
                out.push(`【${srv.name}】连接失败：${err?.message || err}`)
            }
        }
        await e.reply(out.join('\n\n'))
        return true
    }
}
