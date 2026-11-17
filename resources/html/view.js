/**
 * 成绩单视图：纯字符串渲染，无 DOM API。
 *
 * 同一份代码供两条链路复用：
 *   - Puppeteer：浏览器里 import 后 innerHTML 挂载（带 JS）
 *   - Shotium  ：Node 里生成静态 HTML 文件后直接截图（无 JS 引擎）
 * 因此这里只能有字符串拼接，不能出现 document/window。
 */

/* ---------------- 常量（与设计稿对齐） ---------------- */
const COLS = [9, 204.5, 400, 595.5, 791]
const ROW_TOP = 261
const ROW_GAP = 74

const FRAME = { left: 24, top: 29.02, width: 390, height: 97 }
const AXIS = { min: 10.5, max: 12.5, yMax: 24.38, yMin: 79.71 }
const PX_PER_UNIT = (AXIS.yMin - AXIS.yMax) / (AXIS.max - AXIS.min)

const valueToY = (v) => AXIS.yMax + (AXIS.max - v) * PX_PER_UNIT
const tickToX = (t) => t * FRAME.width

const esc = (str) => String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const n = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(v) : 0).toFixed(d)

/* ---------------- 头部 ---------------- */
function header(d) {
    const p = d.player || {}
    const ptt = d.ptt || {}
    // rating 为 -1（潜力值隐藏）时用 rating_off.png
    const ratingTag = ptt.rating == null ? 5 : (ptt.rating < 0 ? 'off' : ptt.rating)
    const stat = (top, label, value, field) =>
        `<div class="stat-label" style="top:${top}px">${esc(label)}</div>` +
        `<div class="stat-value" style="top:${top + 18.5}px" data-field="${field}">${esc(value)}</div>`

    return `
  <div class="bg">
    <img class="bg-img" src="assets/img/bg.jpg" alt="">
  </div>
  <div class="bg-mask"></div>

  <div class="title">${esc(d.title || 'Arcaea Bests')}</div>

  <div class="stats">
    ${stat(55, 'Save PTT', ptt.save, 'savePtt')}
    ${stat(99.5, 'Clac PTT', ptt.calc, 'calcPtt')}
    ${stat(148, 'B10 Avg.', ptt.b10, 'b10')}
    ${stat(193, 'B50 Avg.', ptt.b50, 'b50')}
  </div>

  <div class="nameplate">
    <div class="nameplate-bg"></div>
    <div class="nameplate-text">${esc(p.name)}</div>
  </div>

  <div class="avatar"><img src="${esc(p.avatar)}" alt=""></div>

  <div class="ptt">
    <img class="ptt-bg" src="assets/img/rating_${ratingTag}.png" alt="">
    <div class="ptt-text">${pttNumber(ptt.save)}</div>
  </div>

  <img class="chara" src="${esc(p.chara)}" alt="">`
}

/** PTT 数字：整数部分大、小数部分小（设计稿如此），两者共基线 */
function pttNumber(save) {
    const str = String(save == null ? '0.000' : save)
    const dot = str.indexOf('.')
    if (dot < 0) return `<span class="ptt-int">${esc(str)}</span>`
    return `<span class="ptt-int">${esc(str.slice(0, dot))}</span><span class="ptt-dec">${esc(str.slice(dot))}</span>`
}

/* ---------------- 趋势图 ---------------- */
function chart(d) {
    const c = d.chart || {}
    const series = Array.isArray(c.series) ? c.series : []
    if (!series.length) return ''

    // Y 轴按数据范围自适应：固定像素框 [yMax, yMin] 不变，只重算值→像素映射。
    // 加少量留白并对齐到 0.5，让折线完整收进图框、标签也取整好看。
    const vals = series.map((p) => Number(p.v))
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (!(hi > lo)) hi = lo + 1
    const padV = Math.max(0.1, (hi - lo) * 0.08)
    lo = Math.floor((lo - padV) * 2) / 2
    hi = Math.ceil((hi + padV) * 2) / 2
    const spanV = hi - lo || 1
    const yFor = (v) => AXIS.yMax + (hi - v) * (AXIS.yMin - AXIS.yMax) / spanV

    const pts = series.map((p) => ({ x: tickToX(p.t), y: yFor(p.v), v: p.v }))
    const first = pts[0]
    const last = pts[pts.length - 1]
    let minP = first
    let maxP = first
    for (const p of pts) {
        if (p.v < minP.v) minP = p
        if (p.v > maxP.v) maxP = p
    }

    const grid = [
        `<line x1="0" y1="${AXIS.yMax}" x2="390" y2="${AXIS.yMax}"></line>`,
        `<line x1="0" y1="${AXIS.yMin}" x2="390" y2="${AXIS.yMin}"></line>`,
        [-0.44, 97.06, 194.56, 291.63, 389.56]
            .map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="97"></line>`)
            .join(''),
    ].join('')

    const polyline = pts.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')
    const dots = [first, minP, last, maxP]
        .map((p) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="2"></circle>`)
        .join('')

    const marks = [
        { p: first, dx: 0.8, dy: 4.9, align: 'left' },
        { p: minP, dy: -22.6, align: 'center' },
        { p: last, dx: -13, dy: -16.7, align: 'right' },
    ].map(({ p, dx = 0, dy, align }) =>
        `<div class="trend-mark" style="left:${n(FRAME.left + p.x + dx)}px;top:${n(FRAME.top + p.y + dy)}px;transform:${
            align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : 'none'
        }">${n(p.v)}</div>`).join('')

    const ticks = Array.isArray(c.ticks) && c.ticks.length === 5 ? c.ticks : ['', '', '', '', 'now']
    const xlabels = ticks.map((label, i) => {
        const gridX = FRAME.left + (i / (ticks.length - 1)) * FRAME.width
        const left = Math.min(Math.max(gridX - 27.5, 24), 359)
        const align = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center'
        return `<div class="trend-xlabel" style="left:${n(left)}px;text-align:${align}">${esc(label)}</div>`
    }).join('')

    // y 轴标签跟随自适应范围：上/下网格线各标 hi/lo（-5.6 让文字与线垂直居中）
    const yTop = n(FRAME.top + AXIS.yMax - 5.6)
    const yBot = n(FRAME.top + AXIS.yMin - 5.6)
    const clipH = n(AXIS.yMin - AXIS.yMax)

    return `
  <div class="trend">
    <div class="trend-title">${esc(c.title || 'Potential Trend')}</div>
    <div class="trend-plays">${esc(c.plays || 0)} plays</div>
    <div class="trend-peak" style="left:${n(FRAME.left + maxP.x - 14)}px;top:${n(FRAME.top + maxP.y - 15.5)}px">${n(maxP.v)}</div>
    <svg class="trend-graph" width="390" height="97" viewBox="0 0 390 97" overflow="visible">
      <defs><clipPath id="trendClip"><rect x="0" y="${n(AXIS.yMax)}" width="390" height="${clipH}"></rect></clipPath></defs>
      <g class="trend-grid">${grid}</g>
      <polyline class="trend-line" points="${polyline}" clip-path="url(#trendClip)"></polyline>
      <g class="trend-dots">${dots}</g>
    </svg>
    <div class="trend-yaxis">
      <div class="trend-ylabel" style="top:${yTop}px">${hi.toFixed(1)}</div>
      <div class="trend-ylabel" style="top:${yBot}px">${lo.toFixed(1)}</div>
    </div>
    <div class="trend-xaxis">${xlabels}</div>
    <div class="trend-marks">${marks}</div>
  </div>`
}

/* ---------------- 卡片 ---------------- */
function card(c, i) {
    const left = COLS[i % 5]
    const top = ROW_TOP + Math.floor(i / 5) * ROW_GAP
    const jacket = c.jacket
        ? `<img class="jacket" src="${esc(c.jacket)}" alt="">`
        : '<div class="jacket"></div>'
    return `<div class="card" style="left:${left}px;top:${top}px">` +
        jacket +
        `<div class="bar" style="background:${esc(c.diffColor || '#D1455E')}"></div>` +
        `<div class="sname">${esc(c.title)}</div>` +
        `<div class="rank">#${esc(c.rank)}</div>` +
        `<div class="score">${esc(c.score)}</div>` +
        `<div class="poten">${esc(c.potentialLine)}</div>` +
        `<div class="p">${esc(c.p)}</div>` +
        `<div class="f">${esc(c.f)}</div>` +
        `<div class="l">${esc(c.l)}</div>` +
        `<div class="clear" style="color:${esc(c.clearColor || '#8A8A96')}">${esc(c.clear)}</div>` +
        `<div class="time">${esc(c.time)}</div>` +
        '</div>'
}

function grid(d) {
    const cards = Array.isArray(d.cards) ? d.cards : []
    return `<div class="grid">${cards.map(card).join('')}</div>`
}

function footer() {
    return `
  <div class="footer">
    <div class="footer-left">Designed By Pimeng</div>
    <div class="footer-center">Generated by YunluluBot</div>
    <img class="footer-logo" src="assets/img/lowiro_white.png" alt="">
  </div>`
}

/** 页面内容（.page 内部的全部结构） */
export function renderPage(data = {}) {
    return `<div class="page">${header(data)}${chart(data)}${grid(data)}${footer()}</div>`
}

/** 完整文档：Shotium 直接截这个（无 JS） */
export function renderDocument(data = {}) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Arcaea Bests</title>
<link rel="stylesheet" href="html/style.css">
</head>
<body>
${renderPage(data)}
</body>
</html>`
}
