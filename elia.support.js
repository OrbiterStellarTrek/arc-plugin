/**
 * EliaAdminPanel / Guoba 原生配置入口。
 *
 * 面板扫描插件时会优先加载本文件的 supportPanel()，渲染出可视化配置表单。
 * 配置仍落盘到 config/config.yaml（合并在 config_default.yaml 之上），
 * 与 model/config.js 的读取逻辑完全一致；保存后调用 config.reload() 即时生效。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import config from './model/config.js'

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = path.join(pluginDir, 'config')
const DEFAULT_FILE = path.join(CONFIG_DIR, 'config_default.yaml')
const USER_FILE = path.join(CONFIG_DIR, 'config.yaml')
const previewPath = path.join(pluginDir, 'docs', 'preview.jpg')

// 下拉选项：value 为实际写入配置的值
const rendererOptions = [
    { label: '自动（Shotium 优先，Puppeteer 兜底）', value: 'auto' },
    { label: 'Shotium', value: 'shotium' },
    { label: 'Puppeteer', value: 'puppeteer' },
]
const rendererValues = rendererOptions.map(o => o.value)
const imageTypeOptions = [
    { label: 'WebP（体积小，推荐）', value: 'webp' },
    { label: 'PNG（无损）', value: 'png' },
    { label: 'JPEG', value: 'jpeg' },
]
const imageTypeValues = imageTypeOptions.map(o => o.value)
const localChangesOptions = [
    { label: '保留本地改动（keep）', value: 'keep' },
    { label: '以服务端为准并删除多余文件（overwrite）', value: 'overwrite' },
    { label: '有冲突则报错（fail）', value: 'fail' },
]
const localChangesValues = localChangesOptions.map(o => o.value)

// 默认值：同时决定表单初始值的类型
const defaultConfig = {
    cmdhead: 'a',
    watch_config: true,
    server: {
        base_url: 'http://127.0.0.1:8080',
        api_key: '',
        timeout_ms: 15000,
    },
    poll: {
        max_wait_ms: 60000,
        b50_max_wait_ms: 180000,
    },
    b50: {
        renderer: 'auto',
        scale: 3,
        type: 'webp',
        quality: 95,
    },
    assets: {
        base_url: 'https://arcaea-resources.phira.link',
        concurrency: 8,
        local_changes: 'keep',
        timeout_ms: 60000,
    },
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 取整并限幅；越界或非整数回退到 fallback */
function boundedInteger(value, min, max, fallback) {
    const number = Number(value)
    return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback
}

function pickString(value, fallback) {
    return typeof value === 'string' ? value : fallback
}

/** 把任意来源的配置规整成模板约定的形状，缺失项补默认值 */
function normalizeConfig(value) {
    const saved = isRecord(value) ? value : {}
    const server = isRecord(saved.server) ? saved.server : {}
    const poll = isRecord(saved.poll) ? saved.poll : {}
    const b50 = isRecord(saved.b50) ? saved.b50 : {}
    const assets = isRecord(saved.assets) ? saved.assets : {}
    return {
        cmdhead: pickString(saved.cmdhead, defaultConfig.cmdhead),
        watch_config: typeof saved.watch_config === 'boolean' ? saved.watch_config : defaultConfig.watch_config,
        server: {
            base_url: pickString(server.base_url, defaultConfig.server.base_url),
            api_key: pickString(server.api_key, defaultConfig.server.api_key),
            timeout_ms: boundedInteger(server.timeout_ms, 1000, 120000, defaultConfig.server.timeout_ms),
        },
        poll: {
            max_wait_ms: boundedInteger(poll.max_wait_ms, 1000, 600000, defaultConfig.poll.max_wait_ms),
            b50_max_wait_ms: boundedInteger(poll.b50_max_wait_ms, 1000, 600000, defaultConfig.poll.b50_max_wait_ms),
        },
        b50: {
            renderer: rendererValues.includes(b50.renderer) ? b50.renderer : defaultConfig.b50.renderer,
            scale: boundedInteger(b50.scale, 1, 4, defaultConfig.b50.scale),
            type: imageTypeValues.includes(b50.type) ? b50.type : defaultConfig.b50.type,
            quality: boundedInteger(b50.quality, 1, 100, defaultConfig.b50.quality),
        },
        assets: {
            base_url: pickString(assets.base_url, defaultConfig.assets.base_url),
            concurrency: boundedInteger(assets.concurrency, 1, 32, defaultConfig.assets.concurrency),
            local_changes: localChangesValues.includes(assets.local_changes) ? assets.local_changes : defaultConfig.assets.local_changes,
            timeout_ms: boundedInteger(assets.timeout_ms, 1000, 600000, defaultConfig.assets.timeout_ms),
        },
    }
}

/** 保存前的服务端校验；前端控件限制不能替代服务端校验 */
function validateConfig(data) {
    if (!isRecord(data)) return '配置数据无效'

    const cmdhead = data.cmdhead
    if (typeof cmdhead !== 'string' || !/^[0-9a-zA-Z一-龥]{1,16}$/.test(cmdhead)) {
        return '指令头必须是 1 到 16 位的字母、数字或汉字'
    }
    if (typeof data.watch_config !== 'boolean') return '配置文件监听开关无效'

    const server = data.server
    if (!isRecord(server)) return '后端服务配置必须是对象'
    if (typeof server.base_url !== 'string' || !/^https?:\/\//i.test(server.base_url) || server.base_url.length > 2048) {
        return '查分服务地址必须是 http(s):// 开头的 URL'
    }
    if (typeof server.api_key !== 'string' || server.api_key.length > 1024) return 'API Key 无效'
    if (boundedInteger(server.timeout_ms, 1000, 120000, NaN) !== Number(server.timeout_ms)) {
        return '请求超时必须是 1000 到 120000 毫秒之间的整数'
    }

    const poll = data.poll
    if (!isRecord(poll)) return '任务等待配置必须是对象'
    if (boundedInteger(poll.max_wait_ms, 1000, 600000, NaN) !== Number(poll.max_wait_ms)) {
        return '普通查询最长等待必须是 1000 到 600000 毫秒之间的整数'
    }
    if (boundedInteger(poll.b50_max_wait_ms, 1000, 600000, NaN) !== Number(poll.b50_max_wait_ms)) {
        return 'B50 最长等待必须是 1000 到 600000 毫秒之间的整数'
    }

    const b50 = data.b50
    if (!isRecord(b50)) return 'B50 渲染配置必须是对象'
    if (!rendererValues.includes(b50.renderer)) return '渲染器选择无效'
    if (boundedInteger(b50.scale, 1, 4, NaN) !== Number(b50.scale)) return '渲染倍率必须是 1 到 4 之间的整数'
    if (!imageTypeValues.includes(b50.type)) return '图片格式无效'
    if (boundedInteger(b50.quality, 1, 100, NaN) !== Number(b50.quality)) return '图片质量必须是 1 到 100 之间的整数'

    const assets = data.assets
    if (!isRecord(assets)) return '资源同步配置必须是对象'
    if (typeof assets.base_url !== 'string' || !/^https?:\/\//i.test(assets.base_url) || assets.base_url.length > 2048) {
        return '资源站地址必须是 http(s):// 开头的 URL'
    }
    if (boundedInteger(assets.concurrency, 1, 32, NaN) !== Number(assets.concurrency)) {
        return '下载并发数必须是 1 到 32 之间的整数'
    }
    if (!localChangesValues.includes(assets.local_changes)) return '本地改动处理策略无效'
    if (boundedInteger(assets.timeout_ms, 1000, 600000, NaN) !== Number(assets.timeout_ms)) {
        return '资源请求超时必须是 1000 到 600000 毫秒之间的整数'
    }

    return ''
}

/**
 * 读取当前生效配置（default 合并 user）。
 * 直接复用 model/config.js 的合并逻辑，reload 以反映面板外的手动编辑。
 */
function readCurrentConfig() {
    config.reload()
    return normalizeConfig(config.all)
}

/**
 * 把规整后的配置写回 config/config.yaml。
 * 以 config_default.yaml 为底稿（保留全部注释与字段顺序），
 * 再逐项覆盖用户值；default 文件不存在时退化为纯 YAML 输出。
 */
function writeUserConfig(next) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    let doc
    try {
        doc = YAML.parseDocument(fs.readFileSync(DEFAULT_FILE, 'utf8'))
    } catch {
        doc = null
    }
    if (!doc || doc.errors?.length) {
        fs.writeFileSync(USER_FILE, `# arc-plugin 用户配置（由管理面板生成）\n${YAML.stringify(next)}`, 'utf8')
        return
    }
    const setIn = (segs, value) => doc.setIn(segs, value)
    setIn(['cmdhead'], next.cmdhead)
    setIn(['watch_config'], next.watch_config)
    setIn(['server', 'base_url'], next.server.base_url)
    setIn(['server', 'api_key'], next.server.api_key)
    setIn(['server', 'timeout_ms'], next.server.timeout_ms)
    setIn(['poll', 'max_wait_ms'], next.poll.max_wait_ms)
    setIn(['poll', 'b50_max_wait_ms'], next.poll.b50_max_wait_ms)
    setIn(['b50', 'renderer'], next.b50.renderer)
    setIn(['b50', 'scale'], next.b50.scale)
    setIn(['b50', 'type'], next.b50.type)
    setIn(['b50', 'quality'], next.b50.quality)
    setIn(['assets', 'base_url'], next.assets.base_url)
    setIn(['assets', 'concurrency'], next.assets.concurrency)
    setIn(['assets', 'local_changes'], next.assets.local_changes)
    setIn(['assets', 'timeout_ms'], next.assets.timeout_ms)

    // 底稿顶部是“默认配置/请勿修改”横幅，对用户文件不适用，替换成面板说明
    const userBanner = '# arc-plugin 用户配置\n# 本文件由管理面板生成，也可手动编辑；缺省项见 config_default.yaml'
    const out = doc.toString().replace(
        /^# arc-plugin 默认配置\n# 请勿直接修改本文件[^\n]*\n/,
        `${userBanner}\n`,
    )
    fs.writeFileSync(USER_FILE, out, 'utf8')
}

export function supportPanel() {
    const pluginInfo = {
        name: 'arc-plugin',
        title: 'Arcaea 查分插件',
        description: '绑定好友码，一键出 B50 成绩单与单曲成绩',
        author: '空间站「星旅」',
        link: 'https://github.com/OrbiterStellarTrek/arc-plugin',
        icon: 'mdi:music-circle-outline',
        iconColor: '#485ab6',
        iconPath: fileURLToPath(new URL("./resources/arc.png", import.meta.url)),
    }
    return {
        pluginInfo,
        configInfo: {
            schemas: [
                { label: '基础设置', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'cmdhead',
                    label: '指令头',
                    component: 'Input',
                    required: true,
                    bottomHelpMessage: '匹配 ^[#/]<指令头>，默认 a，即 #ab50 / #a绑定。支持字母、数字或汉字，1~16 位。修改后需重启 Bot 生效。',
                    componentProps: { placeholder: 'a' },
                },
                {
                    field: 'watch_config',
                    label: '监听配置文件变化',
                    component: 'Switch',
                    bottomHelpMessage: '开启后手动修改 config.yaml 会自动热重载，无需重启（全局仅建一个监听器）。',
                },
                {
                    field: 'server.base_url',
                    label: '查分服务地址',
                    component: 'Input',
                    required: true,
                    bottomHelpMessage: 'invtwd-server 地址，不带末尾斜杠。',
                    componentProps: { placeholder: 'http://127.0.0.1:8080', autocomplete: 'url' },
                },
                {
                    field: 'server.api_key',
                    label: 'API Key',
                    component: 'Input',
                    bottomHelpMessage: 'Bearer Token，留空表示不带认证（仅本机调试用）。会以明文写入 config.yaml，请妥善保管。',
                    componentProps: { type: 'password', autocomplete: 'new-password', placeholder: '留空表示不认证' },
                },
                {
                    field: 'server.timeout_ms',
                    label: '请求超时（毫秒）',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 1000, max: 120000, step: 1000, placeholder: '15000' },
                },

                { label: '任务等待', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'poll.max_wait_ms',
                    label: '普通查询最长等待（毫秒）',
                    component: 'InputNumber',
                    required: true,
                    bottomHelpMessage: '单曲等普通查询从提交到出结果的最长等待，超时走 Last 兜底或提示。',
                    componentProps: { min: 1000, max: 600000, step: 1000, placeholder: '60000' },
                },
                {
                    field: 'poll.b50_max_wait_ms',
                    label: 'B50 最长等待（毫秒）',
                    component: 'InputNumber',
                    required: true,
                    bottomHelpMessage: '后端单 worker 分批串行出图，排队可能持续数十秒，建议给更长的超时。',
                    componentProps: { min: 1000, max: 600000, step: 1000, placeholder: '180000' },
                },

                { label: 'B50 渲染', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'b50.renderer',
                    label: '渲染器',
                    component: 'Select',
                    required: true,
                    componentProps: { options: rendererOptions },
                },
                {
                    field: 'b50.scale',
                    label: '渲染倍率',
                    component: 'InputNumber',
                    required: true,
                    bottomHelpMessage: '设备像素比：1 = 1000×1034，3 = 3000×3102。',
                    componentProps: { min: 1, max: 4, step: 1, placeholder: '3' },
                },
                {
                    field: 'b50.type',
                    label: '图片格式',
                    component: 'Select',
                    required: true,
                    componentProps: { options: imageTypeOptions },
                },
                {
                    field: 'b50.quality',
                    label: '图片质量',
                    component: 'InputNumber',
                    required: true,
                    bottomHelpMessage: '仅 WebP / JPEG 生效，PNG 无损忽略此项。',
                    componentProps: { min: 1, max: 100, step: 1, placeholder: '95' },
                },

                { label: '资源同步', component: 'SOFT_GROUP_BEGIN' },
                {
                    field: 'assets.base_url',
                    label: '资源站地址',
                    component: 'Input',
                    required: true,
                    bottomHelpMessage: 'QentimArt 静态发布树，务必用 https（官方站会把 http 301 跳转，底层 SDK 不跟随）。',
                    componentProps: { placeholder: 'https://arcaea-resources.phira.link', autocomplete: 'url' },
                },
                {
                    field: 'assets.concurrency',
                    label: '下载并发数',
                    component: 'InputNumber',
                    required: true,
                    bottomHelpMessage: '过高可能触发 CDN 限流返回 503，默认 8 较稳。',
                    componentProps: { min: 1, max: 32, step: 1, placeholder: '8' },
                },
                {
                    field: 'assets.local_changes',
                    label: '本地改动处理策略',
                    component: 'Select',
                    required: true,
                    componentProps: { options: localChangesOptions },
                },
                {
                    field: 'assets.timeout_ms',
                    label: '资源请求超时（毫秒）',
                    component: 'InputNumber',
                    required: true,
                    componentProps: { min: 1000, max: 600000, step: 1000, placeholder: '60000' },
                },
            ],

            async getConfigData() {
                return readCurrentConfig()
            },

            async setConfigData(data, { Result }) {
                // 先校验原始提交数据：normalize 会把非法值回退成默认值，
                // 若先 normalize 再校验等于跳过校验，故顺序不能颠倒。
                const error = validateConfig(data)
                if (error) return Result.error(error)

                writeUserConfig(normalizeConfig(data))
                config.reload()
                return Result.ok({}, '配置已保存并即时生效')
            },

            actions: {
                // 重新读取磁盘配置，刷新内存缓存
                async reload(args, { Result }) {
                    config.reload()
                    return Result.ok({}, '配置已重载')
                },
                // 用当前配置探活查分后端
                async testConnection(args, { Result }) {
                    config.reload()
                    try {
                        const { default: api } = await import('./model/api/client.js')
                        const health = await api.health()
                        const backend = [health?.backend, health?.backend_version].filter(Boolean).join(' ') || '未知'
                        return Result.ok({ backend }, `连接成功：${backend}`)
                    } catch (err) {
                        return Result.error(`连接失败：${err?.message || err}`)
                    }
                },
            },
        },
    }
}
