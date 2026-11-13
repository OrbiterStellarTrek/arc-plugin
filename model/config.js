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
            }
        } catch { /* 复制失败不阻塞，仍可读默认 */ }
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

    /** 清掉缓存，下次访问重新读取（改配置后用） */
    reload() { this.#cache = null }
}

const config = new ArcConfig()
export default config
