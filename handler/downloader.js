import {WebSiteDownloader} from '../handler/webSiteDownloader.js'
import {DarwinDownloader} from '../handler/darwinDownloader.js'
import {CustomError} from '../common/error.js'
import {log} from '../common/log4jscf.js'
import {config} from '../common/config.js'

class DownloaderFactory {

    constructor() {
        this.downloaders = []
        // 限流自动恢复时间（毫秒），默认60分钟，可通过 config.limiterTimeout 覆盖
        this.limitRestoreMs = (config.limiterTimeout || 60 * 60 * 1000)
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
     * 重置所有下载通道的限流标志（错开恢复时间，避免同时被限）
     */
    resetLimits() {
        for (let i = 0; i < this.downloaders.length; i++) {
            const item = this.downloaders[i]
            // 每个通道错开 limiterTimeout / channelCount 的时间恢复
            const staggerMs = Math.ceil(this.limitRestoreMs / this.downloaders.length)
            item.isLimit = false
            item.limitTime = Date.now() - (i + 1) * staggerMs
        }
    }

    /**
     * 下载器数量
     */
    get channelCount() {
        return this.downloaders.length
    }

    /**
     * 检查是否所有通道都被限流（不含自动恢复，仅用于判断是否需要等待）
     * @returns {boolean}
     */
    isAllLimited() {
        if (this.channelCount === 0) return false
        return this.downloaders.every(item => item.isLimit && (!item.limitTime || Date.now() - item.limitTime < this.limitRestoreMs))
    }

    /**
     * 尝试恢复已过期的限流标记（在 getDownloader 中调用）
     */
    recoverExpiredLimits() {
        for (const item of this.downloaders) {
            if (item.isLimit && item.limitTime && Date.now() - item.limitTime >= this.limitRestoreMs) {
                log.info(`${item.downloader.deviceType}端限流已过期，自动恢复`)
                item.isLimit = false
                item.limitTime = null
            }
        }
    }

    /**
     * 回调中获取下载器
     * 错误处理策略:
     *   - CustomError(code=999): 速率限制 → 标记该下载器受限，尝试下一个
     *   - 其他错误(网络超时等): 瞬时错误 → 尝试下一个通道，全部失败后向上抛出
     * @param type
     * @param cb
     * @returns {Promise<*>}
     */
    async getDownloader(type, cb) {
        if (this.downloaders.length === 0) {
            await this._login(type)
        }

        this.recoverExpiredLimits()

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
                if (e instanceof CustomError && e.code === 999) {
                    log.warn(`${item.downloader.deviceType}端已被速率限制，切换到下一个下载通道`)
                    item.isLimit = true
                    item.limitTime = Date.now()
                } else {
                    log.warn(`${item.downloader.deviceType}端下载出错(${e.message})，尝试下一个下载通道`)
                }
                continue
            }
        }

        if (this.isAllLimited()) {
            log.error("所有下载方式都受限了，可以一个小时后再过来试试哦")
        }
        throw lastError || new Error("所有下载方式都受限了，可以一个小时后再过来试试哦")
    }
}

export {
    DownloaderFactory
}
