import plugin from '../../../lib/plugins/plugin.js'
import api from '../model/api/client.js'
import config from '../model/config.js'
import { serverName } from '../model/api/servers.js'
import { pickTarget, friendlyError, escapeRegExp, splitServerTag } from '../model/util.js'

// 指令头：包成函数，每次调用实时读取配置，改 cmdhead 免重启（配合配置监听）
const H = () => escapeRegExp(config.cmdhead)

// 剥掉末尾服标签后的合法命令形态，不匹配则回用法提示
const BIND = () => new RegExp(`^[#/]${H()}\\s*(?:绑定|bind)\\s*((?:[0-9]\\s*){9})\\s*$`, 'i')
const UNBIND = () => new RegExp(`^[#/]${H()}\\s*(?:解绑|unbind)\\s*$`, 'i')
const MYBIND = () => new RegExp(`^[#/]${H()}\\s*(?:我的绑定|查绑定|绑定查询|mybind)\\s*$`, 'i')

export class arcBind extends plugin {
    constructor() {
        super({
            name: 'arc-绑定',
            dsc: 'Arcaea 好友码绑定（国服 / 国际服）',
            event: 'message',
            priority: 1000,
            rule: [
                // 末尾允许多一个 token 作为可选服标签（如 #a绑定 114514191 国际服）
                { reg: `^[#/]${H()}\\s*(绑定|bind)\\s*((?:[0-9]\\s*){9})\\s*(?:\\S+)?\\s*$`, fnc: 'bind' },
                { reg: `^[#/]${H()}\\s*(解绑|unbind)\\s*(?:\\S+)?\\s*$`, fnc: 'unbind' },
                { reg: `^[#/]${H()}\\s*(我的绑定|查绑定|绑定查询|mybind)\\s*(?:\\S+)?\\s*$`, fnc: 'query' },
            ],
        })
    }

    async bind(e) {
        const { userId, botId } = pickTarget(e)
        // 末尾可带服标签（国服 / 国际服），不带则用默认服；写法兼容 254420294 与 254 420 294
        const { serverId, msg } = splitServerTag(e.msg, { glued: true })
        const m = msg.match(/(?:绑定|bind)\s*((?:[0-9]\s*){9})\s*$/i)
        const friendCode = m ? m[1].replace(/\D/g, '') : ''
        if (!/^[0-9]{9}$/.test(friendCode)) {
            return e.reply(
                `好友码格式错误，应为 9 位数字，如 /${config.cmdhead} bind 114 514 191\n末尾可带服标签（国服 / 国际服），如 /${config.cmdhead}绑定 114514191 国际服`,
                true,
            )
        }
        try {
            const { binding } = await api.use(serverId).putBinding(userId, friendCode, botId)
            await e.reply(
                `绑定成功（${serverName(serverId)}）：好友码 ${binding.friend_code}${binding.verified ? '（已验证）' : ''}\n现在可以使用 /${config.cmdhead} b50 查询了`,
                true,
            )
        } catch (err) {
            await e.reply(friendlyError(err, { what: '绑定' }), true)
        }
        return true
    }

    async unbind(e) {
        const { userId, botId } = pickTarget(e)
        const { serverId, msg } = splitServerTag(e.msg, { glued: true })
        if (!UNBIND().test(msg)) {
            return e.reply(`用法：/${config.cmdhead}解绑 [国服|国际服]`, true)
        }
        try {
            await api.use(serverId).deleteBinding(userId, botId)
            await e.reply(`已解绑（${serverName(serverId)}）好友码`, true)
        } catch (err) {
            await e.reply(friendlyError(err, { what: '解绑' }), true)
        }
        return true
    }

    async query(e) {
        const { userId, botId } = pickTarget(e)
        const { serverId, msg } = splitServerTag(e.msg, { glued: true })
        if (!MYBIND().test(msg)) {
            return e.reply(`用法：/${config.cmdhead}我的绑定 [国服|国际服]`, true)
        }
        try {
            const { binding } = await api.use(serverId).getBinding(userId, botId)
            await e.reply(
                `当前绑定（${serverName(serverId)}）：好友码 ${binding.friend_code}${binding.verified ? '（已验证）' : ''}`,
                true,
            )
        } catch (err) {
            await e.reply(friendlyError(err, { what: '查询绑定' }), true)
        }
        return true
    }
}
