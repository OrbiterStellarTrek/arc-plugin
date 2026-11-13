/**
 * 把后端 B50Result（openapi 定义）归一化成 renderB30() 期望的 raw。
 *
 * buildB30Model(raw) 读取：
 *   raw.player.{name,avatar,chara}、raw.char、raw.ptt.{value,exact,b10,b50}、
 *   raw.records[].{song_id,difficulty,clear_type,score,perfect_count,shiny_perfect_count,
 *                  near_count,miss_count,potential,constant,chart_constant,time_played,title}
 *
 * B50Result 提供：name、friend_code、char、server_ptt、server_rating_raw、ptt、b10、b50、
 *   records[]（ScoreRecord：play_rating 而非 potential；constant；无保证的 title）。
 */
export function b50ResultToRaw(result = {}) {
    const records = Array.isArray(result.records) ? result.records : []
    return {
        title: 'Arcaea Bests',
        player: { name: result.name || 'Player' },
        char: result.char || null,
        ptt: {
            value: num(result.ptt ?? result.server_ptt ?? result.server_rating_raw),
            exact: num(result.ptt ?? result.server_ptt),
            b10: num(result.b10),
            b50: num(result.b50),
        },
        records: records.map(mapRecord),
        friend_code: result.friend_code,
    }
}

function mapRecord(r = {}) {
    const potential = r.potential ?? r.play_potential ?? r.play_rating
    const constant = r.constant ?? r.chart_constant
    return {
        ...r,
        song_id: r.song_id,
        difficulty: r.difficulty,
        clear_type: r.clear_type,
        score: r.score,
        perfect_count: r.perfect_count,
        shiny_perfect_count: r.shiny_perfect_count,
        near_count: r.near_count,
        miss_count: r.miss_count,
        time_played: r.time_played,
        // 字段名归一，供 buildB30Model 直接读取
        potential: num(potential),
        constant: num(constant),
        chart_constant: num(constant),
        // 服务器若带了曲名就保留，否则 buildB30Model 回退 songlist/美化 id
        title: r.title || r.name,
    }
}

function num(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}
