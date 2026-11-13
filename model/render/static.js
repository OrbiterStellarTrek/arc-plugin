import fs from 'node:fs'
import path from 'node:path'
import { templateRoot } from './puppeteer.js'
import { renderDocument } from '../../resources/arcb30/view.js'

/**
 * 把模板数据渲染成一份静态 HTML（不含任何 JS）。
 *
 * 两个渲染器都走这条路：
 *   - Shotium 没有 JS 引擎，只能吃静态文档
 *   - Puppeteer 也直接用同一份文档，保证两边像素一致
 *
 * 文件写在模板目录下，这样 style.css / 字体 / 图片的相对路径才成立。
 */
let sequence = 0

/**
 * @param {object} data 模板数据
 * @returns {{ file: string, url: string, dispose: () => void }}
 */
export function createDocument(data) {
    const file = path.join(templateRoot, `.render-${process.pid}-${++sequence}.html`)
    fs.writeFileSync(file, renderDocument(data), 'utf8')
    return {
        file,
        url: 'file://' + file.replace(/\\/g, '/'),
        dispose() {
            fs.promises.unlink(file).catch(() => {})
        },
    }
}
