import {chromium} from 'playwright'
import {Mutex} from 'async-mutex'
import {config} from './config.js'
import {log} from './log4jscf.js'
import os from 'os'
import path from 'path'

class BrowserHelper {
    constructor() {
        this.context = null
        this.page = null
        // 浏览器页面是单实例，并发下载时必须串行化页面操作
        this._pageMutex = new Mutex()
    }

    async init() {
        if (this.page) {
            return
        }
        const userDataDir = path.join(config.xmd.replace('~', os.homedir()), 'browser-data')
        log.info('正在启动浏览器引擎...')
        this.context = await chromium.launchPersistentContext(userDataDir, {
            headless: true,
            args: ['--disable-blink-features=AutomationControlled'],
            viewport: {width: 1280, height: 720}
        })
        this.page = this.context.pages()[0] || await this.context.newPage()
        log.info('浏览器引擎已就绪')
    }

    async _ensureInit() {
        if (!this.page) {
            await this.init()
        }
    }

    async _syncCookies(cookieString) {
        if (!cookieString || cookieString.trim() === '') {
            return
        }
        const cookies = cookieString
            .split(';')
            .map(item => item.trim())
            .filter(item => item.length > 0)
            .map(item => {
                const index = item.indexOf('=')
                if (index <= 0) {
                    return null
                }
                const name = item.slice(0, index).trim()
                const value = item.slice(index + 1).trim()
                return {
                    name,
                    value,
                    domain: '.ximalaya.com',
                    path: '/',
                    httpOnly: false,
                    secure: true,
                    sameSite: 'Lax'
                }
            })
            .filter(Boolean)

        if (cookies.length > 0) {
            await this.context.addCookies(cookies)
        }
    }

    async _waitTracksResponse(albumId, pageNum, timeout = 20000) {
        return this.page.waitForResponse((resp) => {
            const url = resp.url()
            if (!url.includes('/revision/album/v1/getTracksList')) {
                return false
            }
            const u = new URL(url)
            return u.searchParams.get('albumId') === String(albumId)
                && u.searchParams.get('pageNum') === String(pageNum)
        }, {timeout})
    }

    async getTracksList(albumId, pageNum, pageSize, cookieString) {
        // 串行化页面操作，防止并发导致页面状态混乱
        return this._pageMutex.runExclusive(async () => {
            await this._ensureInit()
            await this._syncCookies(cookieString)

            const albumUrl = `${config.baseUrl}/album/${albumId}`

            if (pageNum === 1) {
                const [response] = await Promise.all([
                    this._waitTracksResponse(albumId, 1),
                    this.page.goto(albumUrl, {waitUntil: 'domcontentloaded', timeout: 30000})
                ])
                const payload = await response.json()
                if (payload == null || payload.ret !== 200 || payload.data == null) {
                    throw new Error('获取章节列表失败')
                }
                return payload.data
            }

            // 第2页及以后，确保处于专辑页面然后点击分页
            const currentUrl = this.page.url()
            if (!currentUrl.includes(`/album/${albumId}`)) {
                await this.page.goto(albumUrl, {waitUntil: 'domcontentloaded', timeout: 30000})
                await this.page.waitForTimeout(3000)
            }

            const responsePromise = this._waitTracksResponse(albumId, pageNum)
            const targetPageText = String(pageNum)
            const pageLocators = [
                this.page.locator(`[class*="pagination"] a:has-text("${targetPageText}")`).first(),
                this.page.locator(`[class*="page"] a:has-text("${targetPageText}")`).first(),
                this.page.locator(`a:has-text("${targetPageText}")`).first()
            ]

            let clicked = false
            for (const locator of pageLocators) {
                if (await locator.count() > 0 && await locator.isVisible()) {
                    await locator.click()
                    clicked = true
                    break
                }
            }

            if (!clicked) {
                // 回退: 重新加载专辑页面触发请求
                const [fallbackResp] = await Promise.all([
                    this._waitTracksResponse(albumId, pageNum, 30000),
                    this.page.goto(`${albumUrl}`, {waitUntil: 'domcontentloaded', timeout: 30000})
                ])
                const fallbackPayload = await fallbackResp.json()
                if (fallbackPayload == null || fallbackPayload.ret !== 200 || fallbackPayload.data == null) {
                    throw new Error('获取章节列表失败')
                }
                return fallbackPayload.data
            }

            const response = await responsePromise
            const payload = await response.json()
            if (payload == null || payload.ret !== 200 || payload.data == null) {
                throw new Error('获取章节列表失败')
            }
            return payload.data
        })
    }

    async getBaseInfo(trackId, deviceType, cookieString) {
        // 串行化页面操作，防止并发导致页面状态混乱
        return this._pageMutex.runExclusive(async () => {
            await this._ensureInit()
            await this._syncCookies(cookieString)

            const soundUrl = `${config.baseUrl}/sound/${trackId}`

            const responsePromise = this.page.waitForResponse((resp) => {
                const url = resp.url()
                if (!url.includes('/mobile-playpage/track/v3/baseInfo/')) {
                    return false
                }
                const u = new URL(url)
                return u.searchParams.get('trackId') === String(trackId)
            }, {timeout: 30000})

            await this.page.goto(soundUrl, {waitUntil: 'domcontentloaded', timeout: 30000})

            const playBtn = this.page.locator('.play-btn').first()
            await playBtn.waitFor({state: 'visible', timeout: 10000})
            await playBtn.click()

            const response = await responsePromise
            const payload = await response.json()
            return payload
        })
    }

    async close() {
        if (this.context) {
            await this.context.close()
            this.context = null
        }
        this.page = null
    }
}

export {
    BrowserHelper
}
