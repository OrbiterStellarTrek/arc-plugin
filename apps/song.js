import plugin from '../../../lib/plugins/plugin.js'
import api from '../model/api/client.js'
import config from '../model/config.js'
import { pickTarget, parseDifficulty, diffName, friendlyError, escapeRegExp } from '../model/util.js'
import { songNames } from '../model/data/songlist.js'

const SONG_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const H = escapeRegExp(config.cmdhead)

/**
 * 曲名（小写去空格）→ { id, difficulty } 反查表，来自 songlist.json。
 * 难度专属曲名（如 Axium Divergence）会带上对应难度，整曲曲名与 song_id 的 difficulty 为 null。
 */
let nameIndex = null
function resolveSong(query) {
    const q = String(query).trim()
    if (!nameIndex) {
        nameIndex = new Map()
        const entries = songNames()
        // 先放难度专属曲名，再放整曲曲名 / song_id，同名时以后者为准
        for (const { name, id, difficulty } of entries) {
            if (difficulty != null) nameIndex.set(norm(name), { id, difficulty })
        }
        for (const { name, id, difficulty } of entries) {
            if (difficulty != null) continue
            nameIndex.set(norm(name), { id, difficulty: null })
            nameIndex.set(norm(id), { id, difficulty: null })
        }
    }
    const hit = nameIndex.get(norm(q))
    if (hit) return hit
    if (SONG_ID_RE.test(q)) return { id: q, difficulty: null }
    return null
}
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '')

export class arcSong extends plugin {
    constructor() {
        super({
            name: 'arc-单曲',
            dsc: 'Arcaea 单曲查询',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: `^[#/]${H}\\s*(查歌|单曲|song)\\s+(.+)$`, fnc: 'song' },
            ],
        })
    }

    async song(e) {
        const { userId, botId } = pickTarget(e)
        const m = e.msg.match(new RegExp(`^[#/]${H}\\s*(?:查歌|单曲|song)\\s+(.+)$`, 'i'))
        const argStr = (m?.[1] || '').trim()
        if (!argStr) return e.reply(`用法：/${config.cmdhead}查歌 <曲名或song_id> <难度>，如 /${config.cmdhead}查歌 deinosphainein FTR`, true)

        // 末位 token 若是难度就取出，其余作为曲目
        const tokens = argStr.split(/\s+/)
        let difficulty = parseDifficulty(tokens[tokens.length - 1])
        let songPart = argStr
        if (difficulty !== null && tokens.length > 1) {
            songPart = tokens.slice(0, -1).join(' ')
        } else {
            difficulty = null
        }

        const song = resolveSong(songPart)
        if (!song) {
            return e.reply(`无法识别曲目「${songPart}」，请直接用 song_id（字母数字/下划线/连字符）`, true)
        }
        const songId = song.id
        // 未指定难度：难度专属曲名用其难度，否则默认 FTR
        if (difficulty === null) difficulty = song.difficulty ?? 2

        try {
            const submit = await api.submitSong(userId, songId, difficulty, botId)
            if (submit.status !== 'completed') {
                const job = await api.waitJob(submit.job_id, { maxWaitMs: config.get('poll.max_wait_ms', 60000) })
                if (job.status === 'failed') {
                    return e.reply(`单曲查询失败：${job.error || job.error_code || '未知错误'}`, true)
                }
            }
            // 终态成功后，Last 已更新；用 Last 出图（稳定、可重复读）
            const buf = await api.lastSongImage(userId, songId, difficulty, botId)
            await e.reply([segment.image(buf)])
        } catch (err) {
            await e.reply(friendlyError(err, { what: `单曲查询（${songId} ${diffName(difficulty)}）` }), true)
        }
        return true
    }
}
