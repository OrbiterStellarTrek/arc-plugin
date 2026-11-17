import plugin from '../../../lib/plugins/plugin.js'
import config from '../model/config.js'
import { escapeRegExp } from '../model/util.js'

const H = escapeRegExp(config.cmdhead)
const c = config.cmdhead

// 分数上限（任何 ≥ 1000 万的分数都按 PM 处理）
const SCORE_MAX = 10002228
// 定数上限
const CONST_MAX = 12

/**
 * 解析一个数字 token，支持 w / 万 后缀（代表 ×10000）。
 * @param {string} token 形如 971w / 971万 / 9710000 / 11.3
 * @returns {{ value: number, scaled: boolean } | null} 解析失败返回 null
 */
function parseNum(token) {
    const t = String(token).trim().toLowerCase()
    const m = t.match(/^([0-9]*\.?[0-9]+)\s*(w|万)?$/)
    if (!m) return null
    let value = parseFloat(m[1])
    const scaled = !!m[2]
    if (scaled) value *= 10000
    return { value, scaled }
}

/**
 * 计算单曲潜力值（公式沿用参考插件 arc-calc.js 的约定）。
 * - PM（≥1000万）：定数 + 2.2（定数 + 2 + 0.2 TC，PM 必定 TC）
 * - [980万, 1000万)：定数 + 1.0 + (分数 - 980万) / 20万
 * - <980万：定数 + (分数 - 950万) / 30万，下限 0
 */
function calcPotential(score, constant) {
    if (score >= 10000000) return constant + 2.2
    if (score >= 9800000) return constant + 1.0 + (score - 9800000) / 200000
    return Math.max(0, constant + (score - 9500000) / 300000)
}

export class arcCalc extends plugin {
    constructor() {
        super({
            name: 'arc-单曲潜力值',
            dsc: '计算 Arcaea 单曲潜力值',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: `^[#/]${H}\\s*(?:com|calc)\\s+(.+)$`, fnc: 'calc' },
            ],
        })
    }

    async calc(e) {
        const m = e.msg.match(new RegExp(`^[#/]${H}\\s*(?:com|calc)\\s+(.+)$`, 'i'))
        const argStr = (m?.[1] || '').trim()
        const args = argStr.split(/\s+/)
        if (args.length < 2) {
            return e.reply(
                `用法：/${c}calc <分数> <定数>（顺序可互换）\n分数支持 971w / 971万 / 9710000 写法，如 /${c}calc 971w 11.3`,
                true,
            )
        }

        const a = parseNum(args[0])
        const b = parseNum(args[1])
        if (!a || !b) return e.reply('参数必须为数字！分数可用 971w / 971万 / 9710000 写法', true)

        // 判定谁是分数、谁是定数：带 w/万 后缀的必是分数，否则按大小判断（定数一般 ≤ 12）
        let score, constant
        if (a.scaled && !b.scaled) {
            ;[score, constant] = [a.value, b.value]
        } else if (b.scaled && !a.scaled) {
            ;[score, constant] = [b.value, a.value]
        } else if (a.value >= b.value) {
            ;[score, constant] = [a.value, b.value]
        } else {
            ;[score, constant] = [b.value, a.value]
        }

        if (score < 0 || score > SCORE_MAX) {
            return e.reply(`分数应在 0 ~ ${SCORE_MAX} 之间！`, true)
        }
        if (constant < 0 || constant > CONST_MAX) {
            return e.reply(`谱面定数应在 0 ~ ${CONST_MAX.toFixed(1)} 之间！`, true)
        }

        const potential = calcPotential(score, constant)
        const isPM = score >= 10000000

        const lines = [
            '[Arcaea 潜力值]',
            `分数：${Math.floor(score)}${isPM ? '（PM）' : ''}`,
            `谱面定数：${constant.toFixed(1)}`,
            `单曲潜力值：${potential.toFixed(4)}`,
        ]
        // 非 PM 时额外给出 TC（+0.2）后的潜力值
        if (!isPM) lines.push(`单曲潜力值(TC)：${(potential + 0.2).toFixed(4)}`)
        return e.reply(lines.join('\n'), true)
    }
}
