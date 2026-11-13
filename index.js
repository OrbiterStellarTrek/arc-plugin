import { renderB30, shutdownRenderers, RENDER_DEFAULTS } from './model/render/arcb30.js'

/**
 * arc-plugin
 *
 * 当前阶段只实现「渲染模板」：
 *   - 模板：resources/arcb30/（view.js 生成静态 HTML + style.css + 素材）
 *   - 渲染：model/render/（Shotium 优先，Puppeteer 兜底）
 *   - 数据：model/data/b30.js（把原始成绩数据整理成模板模型）
 *
 * 命令、账号绑定、数据抓取等业务逻辑留待后续实现，
 * 这里先行导出一个可直接调用的渲染入口，方便联调。
 */
export const name = 'arc-plugin'

/** 由宿主（云崽）注入的 app 集合，后续命令挂载在这里 */
export const apps = {}

export { renderB30, shutdownRenderers, RENDER_DEFAULTS }
