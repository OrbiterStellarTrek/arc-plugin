import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = path.resolve(__dirname, '..', 'config')
const DEFAULT_FILE = path.join(CONFIG_DIR, 'config_default.yaml')
const USER_FILE = path.join(CONFIG_DIR, 'config.yaml')

function readYaml(file) {
    try {
        return YAML.parse(fs.readFileSync(file, 'utf8')) || {}
    } catch {
        return {}
    }
}

/** 深合并：用户配置覆盖默认，对象递归合并，其余直接覆盖 */
function merge(base, override) {
    const out = Array.isArray(base) ? base.slice() : { ...base }
    for (const [k, v] of Object.entries(override || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object') {
            out[k] = merge(base[k], v)
        } else {
            out[k] = v
        }
    }
    return out
}

/**
 * 轻量配置组件：加载 config_default.yaml 并合并用户 config.yaml。
 * 首次运行自动把默认配置复制为用户配置，方便直接编辑。
 */
class ArcConfig {
    #cache = null

    /** 确保用户配置存在；缺失时从默认复制 */
    #ensureUserFile() {
        try {
            if (!fs.existsSync(USER_FILE) && fs.existsSync(DEFAULT_FILE)) {
                fs.copyFileSync(DEFAULT_FILE, USER_FILE)
                return
            }
            // 用户文件已存在时，把默认里新增的键回填进去（只增不改）
            this.#syncDefaults()
        } catch { /* 失败不阻塞，运行时仍按 default+user 合并读取 */ }
    }

    /**
     * 回填默认配置里用户文件缺失的键：保留用户已有的值、注释和多余键，
     * 仅补入 config_default.yaml 新增的键（连同其注释），有改动才写回磁盘。
     */
    #syncDefaults() {
        if (!fs.existsSync(USER_FILE) || !fs.existsSync(DEFAULT_FILE)) return
        const defDoc = YAML.parseDocument(fs.readFileSync(DEFAULT_FILE, 'utf8'))
        const userDoc = YAML.parseDocument(fs.readFileSync(USER_FILE, 'utf8'))
        if (defDoc.errors?.length || userDoc.errors?.length) return
        if (!YAML.isMap(defDoc.contents) || !YAML.isMap(userDoc.contents)) return

        let changed = false
        const backfill = (defMap, userMap) => {
            for (const pair of defMap.items) {
                const key = pair.key.value
                if (!userMap.has(key)) {
                    userMap.items.push(pair.clone()) // 整键克隆，保留值与注释
                    changed = true
                } else {
                    const dv = pair.value
                    const uv = userMap.get(key, true)
                    if (YAML.isMap(dv) && YAML.isMap(uv)) backfill(dv, uv) // 子对象递归补齐
                }
            }
        }
        backfill(defDoc.contents, userDoc.contents)

        if (changed) {
            fs.writeFileSync(USER_FILE, userDoc.toString(), 'utf8')
            logger?.mark?.('[arc-plugin] 已将新增默认配置回填到 config/config.yaml')
        }
    }

    /** 读取并合并配置（带内存缓存） */
    get all() {
        if (this.#cache) return this.#cache
        this.#ensureUserFile()
        this.#cache = merge(readYaml(DEFAULT_FILE), readYaml(USER_FILE))
        return this.#cache
    }

    /** 点路径读取，如 get('server.api_key') */
    get(pathStr, fallback) {
        let cur = this.all
        for (const key of String(pathStr).split('.')) {
            if (cur == null) return fallback
            cur = cur[key]
        }
        return cur === undefined ? fallback : cur
    }

    get server() { return this.all.server || {} }
    get cmdhead() { return this.all.cmdhead || 'a' }
    get poll() { return this.all.poll || {} }
    get b50() { return this.all.b50 || {} }
    get assets() { return this.all.assets || {} }

    /** 清掉缓存，下次访问重新读取（改配置后用） */
    reload() { this.#cache = null }
}

const config = new ArcConfig()
export default config
