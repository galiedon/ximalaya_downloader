import {WebSiteDownloader} from '../handler/webSiteDownloader.js'
import {DarwinDownloader} from '../handler/darwinDownloader.js'
import {CustomError} from '../common/error.js'
import {log} from '../common/log4jscf.js'

class DownloaderFactory {

    constructor() {
        this.downloaders = []
    }

    /**
     * 创建一个工厂类
     * @returns {DownloaderFactory}
     */
    static create() {
        return new DownloaderFactory()
    }

    /**
     * 登录操作
     * @param type 要登录的目标
     */
    async _login(type) {
        if (type == null) {
            this.downloaders.push({
                isLimit: false,
                downloader: new WebSiteDownloader()
            })
            this.downloaders.push({
                isLimit: false,
                downloader: new DarwinDownloader()
            })
        } else if (type === 'pc') {
            this.downloaders.push({
                isLimit: false,
                downloader: new DarwinDownloader()
            })
        } else if (type === 'web') {
            this.downloaders.push({
                isLimit: false,
                downloader: new WebSiteDownloader()
            })
        } else {
            throw new Error(`暂不支持: ${type} 这种登录方式`)
        }
        for (const item of this.downloaders) {
            const downloader = item.downloader
            const isLogin = await downloader.isLogin()
            if (isLogin) {
                continue
            }
            log.info(`登录${downloader.deviceType}中...`)
            await downloader.login()
        }
    }

    /**
     * 回调中获取下载器
     * 错误处理策略:
     *   - CustomError(code=999): 速率限制 → 标记该下载器受限，尝试下一个
     *   - 其他错误(网络超时等): 瞬时错误 → 直接向上抛出，由调用方处理重试
     * @param type
     * @param cb
     * @returns {Promise<*>}
     */
    async getDownloader(type, cb) {
        if (this.downloaders.length === 0) {
            await this._login(type)
        }

        let lastError = null
        for (let i = 0; i < this.downloaders.length; i++) {
            const item = this.downloaders[i]
            if (item.isLimit) {
                continue
            }
            try {
                return await cb(item.downloader)
            } catch (e) {
                lastError = e
                // 仅速率限制错误才永久标记该下载通道为受限
                if (e instanceof CustomError && e.code === 999) {
                    log.warn(`${item.downloader.deviceType}端已被速率限制，切换到下一个下载通道`)
                    item.isLimit = true
                    continue
                }
                // 其他错误(网络超时、DNS解析失败等)属于瞬时错误，向上抛出
                throw e
            }
        }

        // 所有下载器都被速率限制
        log.error("所有下载方式都受限了，可以一个小时后再过来试试哦")
        throw lastError || new Error("所有下载方式都受限了，可以一个小时后再过来试试哦")
    }
}

export {
    DownloaderFactory
}
