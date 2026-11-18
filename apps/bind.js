import plugin from '../../../lib/plugins/plugin.js'
import api from '../model/api/client.js'
import config from '../model/config.js'
import { pickTarget, friendlyError, escapeRegExp } from '../model/util.js'

const H = escapeRegExp(config.cmdhead)

export class arcBind extends plugin {
    constructor() {
        super({
            name: 'arc-绑定',
            dsc: 'Arcaea 好友码绑定',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: `^[#/]${H}\\s*(绑定|bind)\\s*((?:[0-9]\\s*){9})$`, fnc: 'bind' },
                { reg: `^[#/]${H}\\s*(解绑|unbind)\\s*$`, fnc: 'unbind' },
                { reg: `^[#/]${H}\\s*(我的绑定|查绑定|绑定查询|mybind)\\s*$`, fnc: 'query' },
            ],
        })
    }

    async bind(e) {
        const { userId, botId } = pickTarget(e)
        // 兼容 254420294 与 254 420 294 两种写法，取其中的数字
        const m = e.msg.match(/(?:绑定|bind)\s*((?:[0-9]\s*){9})/i)
        const friendCode = m ? m[1].replace(/\D/g, '') : ''
        if (!/^[0-9]{9}$/.test(friendCode)) {
            return e.reply(`好友码格式错误，应为 9 位数字，如 /${config.cmdhead} bind 114 514 191`, true)
        }
        try {
            const { binding } = await api.putBinding(userId, friendCode, botId)
            await e.reply(
                `绑定成功：好友码 ${binding.friend_code}${binding.verified ? '（已验证）' : ''}\n现在可以使用 /${config.cmdhead} b50 查询了`,
                true,
            )
        } catch (err) {
            await e.reply(friendlyError(err, { what: '绑定' }), true)
        }
        return true
    }

    async unbind(e) {
        const { userId, botId } = pickTarget(e)
        try {
            await api.deleteBinding(userId, botId)
            await e.reply('已解绑好友码', true)
        } catch (err) {
            await e.reply(friendlyError(err, { what: '解绑' }), true)
        }
        return true
    }

    async query(e) {
        const { userId, botId } = pickTarget(e)
        try {
            const { binding } = await api.getBinding(userId, botId)
            await e.reply(
                `当前绑定好友码：${binding.friend_code}${binding.verified ? '（已验证）' : ''}`,
                true,
            )
        } catch (err) {
            await e.reply(friendlyError(err, { what: '查询绑定' }), true)
        }
        return true
    }
}
