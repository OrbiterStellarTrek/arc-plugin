import plugin from '../../../lib/plugins/plugin.js'
import api from '../model/api/client.js'
import config from '../model/config.js'
import { friendlyError, escapeRegExp } from '../model/util.js'

const H = escapeRegExp(config.cmdhead)
const c = config.cmdhead

export class arcHelp extends plugin {
    constructor() {
        super({
            name: 'arc-帮助',
            dsc: 'Arcaea 查分帮助 / 服务状态',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: `^[#/]${H}\\s*(帮助|help|菜单)\\s*$`, fnc: 'help' },
                { reg: `^[#/]${H}\\s*(状态|status)\\s*$`, fnc: 'status' },
            ],
        })
    }

    async help(e) {
        await e.reply([
            'Arcaea 查分帮助',
            `/${c}绑定 <9位好友码>   绑定账号`,
            `/${c}我的绑定            查看当前绑定`,
            `/${c}解绑                解除绑定`,
            `/${c}b50                 查询 B50 成绩单`,
            `/${c}b50 last            查看上次 B50（秒回，不重新查询）`,
            `/${c}b50cd               查看 B50 查询冷却剩余时间`,
            `/${c}查歌 <曲> <难度>    查询单曲（难度 PST/PRS/FTR/BYD/ETR 或 0-4）`,
            `/${c}calc <分数> <定数>  计算单曲潜力值（分数支持 971w 写法）`,
            `/${c}状态                查分服务状态`,
            `/${c}曲绘版本            查看资源版本（本地 / 最新）`,
            `/${c}更新曲绘            在线增量更新曲绘等资源（主人）`,
        ].join('\n'))
        return true
    }

    async status(e) {
        try {
            const h = await api.health()
            const a = h.assets || {}
            await e.reply([
                `查分服务：${h.status || '?'}（${h.name || ''}）`,
                `后端：${h.backend || '?'} ${h.backend_version || ''}`,
                `渲染器：${h.renderer || '?'}`,
                `曲谱就绪：${a.charts_loaded ? '是' : '否'} / 曲目就绪：${a.songs_loaded ? '是' : '否'}`,
                `缓存图：${a.cache_images ?? 0} 张（${a.cache_mib ?? 0} MiB）`,
                `B50 冷却：${h.b50_cooldown_seconds ? `${h.b50_cooldown_seconds} 秒` : '未启用'}`,
            ].join('\n'))
        } catch (err) {
            await e.reply(friendlyError(err, { what: '获取服务状态' }), true)
        }
        return true
    }
}
