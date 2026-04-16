import {iaxios} from '../common/axioscf.js'
import {config} from '../common/config.js'
import {log} from '../common/log4jscf.js'
import {sleep, buildHeaders, parseCookies} from '../common/utils.js'
import path from "path"
import fs from "fs"
import {exec, spawn} from "child_process"
import kill from "tree-kill"
import {CustomError} from '../common/error.js'
import os from 'os'

/**
 * 下载抽象类
 */
class AbstractDownloader {
    static browser = null

    static setBrowser(browserHelper) {
        AbstractDownloader.browser = browserHelper
    }

    constructor(deviceType) {
        if (this.constructor === AbstractDownloader) {
            throw new Error("抽象类不能被实例化")
        }
        this.deviceType = deviceType
        this.cookiePath = path.join(config.xmd.replace('~', os.homedir()), `${deviceType}-cookies.json`)
        this.qrCodePath = path.join(config.xmd.replace('~', os.homedir()), `${deviceType}-qrcode.png`)
        this.albumId = null
        this.cookies = null
    }

    /**
     * 获取可用的cookies
     * @private
     */
    _getCookies() {
        throw new Error("抽象方法，子类需要实现")
    }

    /**
     * 获取 cookies json格式
     * @returns {Promise<unknown>}
     * @private
     */
    async __readCookies() {
        return new Promise((resolve) => {
            fs.readFile(this.cookiePath, (err, data) => {
                if (err) {
                    return resolve(null)
                }
                try {
                    return resolve(JSON.parse(String(data)))
                } catch {
                    return resolve(null)
                }
            })
        })
    }

    /**
     * 打开登录二维码
     * @returns {ChildProcessWithoutNullStreams}
     */
    _openQrCode() {
        const platform = process.platform
        let command

        if (platform === 'win32') {
            command = `start "" "${this.qrCodePath}"`
        } else if (platform === 'darwin') {
            command = `open "${this.qrCodePath}"`
        } else if (platform === 'linux') {
            command = `xdg-open "${this.qrCodePath}"`
        }

        return spawn(command, [], {shell: true})
    }

    /**
     * 关闭登录二维码
     * @param openProcess
     * @returns {Promise<void>}
     */
    _killQrCode(openProcess) {
        return new Promise((resolve, reject) => {
            const platform = process.platform
            if (platform === 'darwin') {
                exec(`osascript -e 'quit app "Preview"'`, (err) => {
                    if (err) {
                        log.error('Error closing the image viewer:', err)
                        return reject(err)
                    }
                    return resolve()
                })
            } else if (platform === 'win32') {
                exec(`taskkill /IM PhotosApp.exe /F`, (err) => {
                    if (err) {
                        log.error('Error closing the image viewer:', err)
                        return reject(err)
                    }
                    return resolve()
                })
            } else {
                kill(openProcess.pid, 'SIGKILL', (err) => {
                    if (err) {
                        log.error('Error closing the image viewer:', err)
                        return reject(err)
                    }
                    return resolve()
                })
            }
        })
    }

    /**
     * 获取登录二维码抽象方法
     * @returns {Promise<void>}
     * @private
     */
    async _getQrCode() {
        throw new Error("抽象方法，子类需要实现")
    }

    /**
     * 获取登录二维码
     * @returns {Promise<{qrId:int,img:str}>}
     */
    async __getQrCode(clientName) {
        const url = `${config.loginBaseUrl}/web/qrCode/gen?level=L&source=${encodeURIComponent(clientName)}`
        const response = await iaxios.get(url)

        if (response.status !== 200) {
            throw new Error('网络请求失败')
        }
        if (response.data == null) {
            throw new Error('数据为空')
        }
        if (response.data.ret !== 0) {
            log.error("喜马拉雅内部异常", response.data)
            throw new Error("喜马拉雅内部异常")
        }
        return {
            qrId: response.data.qrId,
            img: response.data.img
        }
    }

    /**
     * 登录方法
     * @returns {Promise<AbstractDownloader>}
     */
    async login() {
        let cookies = null
        if (config.cookie != null
            && config.cookie[this.deviceType] != null
            && config.cookie[this.deviceType]['serverMode']) {
            if (config.cookie[this.deviceType].value == null || config.cookie[this.deviceType].value.trim() === '') {
                throw new CustomError(10001, `当前为非扫码模式，请在config.json中手动配置cookie.${this.deviceType}.value的值`)
            }
            cookies = parseCookies(config.cookie[this.deviceType].value.split(';'))
        } else {
            const qrCode = await this._getQrCode()
            const qrCodeBuffer = Buffer.from(qrCode.img, 'base64')

            fs.writeFileSync(this.qrCodePath, qrCodeBuffer)

            log.info(this.deviceType, "请使用喜马拉雅APP扫描登录二维码")
            const openProcess = this._openQrCode()
            log.info(this.deviceType, "等待登录结果...")
            while (true) {
                const loginResult = await this._getLoginResult(qrCode.qrId)
                if (loginResult.isSuccess) {
                    cookies = loginResult.cookies
                    break
                }
                await sleep(2000)
            }

            try {
                await this._killQrCode(openProcess)
            } catch (e) {
                log.debug(e)
                log.info(this.deviceType, "扫码已成功，可自行关闭图片程序")
            }
        }
        fs.writeFileSync(this.cookiePath, Buffer.from(JSON.stringify(cookies)))
        log.info(this.deviceType, "登录成功")
        const user = await this._getCurrentUser()
        this._checkUser(user, false)
        return this
    }

    /**
     * 根据qrId，获取登录结果
     * @param qrId
     * @returns {Promise<{cookies: JSONObject, isSuccess: boolean}|{isSuccess: boolean}>}
     */
    async _getLoginResult(qrId) {
        const url = `${config.loginBaseUrl}/web/qrCode/check/${qrId}/${Date.now()}`
        const response = await iaxios.get(url)

        if (response.status !== 200) {
            throw new Error('网络请求失败')
        }
        if (response.data == null) {
            throw new Error('数据为空')
        }
        if (response.data.ret !== 0) {
            return {isSuccess: false}
        }
        const cookieHeaders = response.headers['set-cookie']
        const cookies = parseCookies(cookieHeaders)
        return {
            isSuccess: true,
            cookies: cookies
        }
    }

    async _getCurrentUser() {
        const url = `${config.baseUrl}/revision/main/getCurrentUser`
        const cookie = await this._getCookies()
        const headers = buildHeaders(config.baseUrl, cookie)
        const response = await iaxios.get(url, {headers: headers})
        if (response.status !== 200) {
            throw new Error('网络请求失败')
        }
        if (response.data == null) {
            throw new Error('数据为空')
        }
        if (response.data.ret === 401) {
            log.error(response.data.msg)
            return null
        }
        if (response.data.ret !== 200) {
            log.error("喜马拉雅内部异常", response.data)
            throw new Error("喜马拉雅内部异常")
        }
        return response.data.data
    }

    /**
     * 检查用户账号信息
     * @param user
     * @param single 是否只检查单条信息（不打印详情）
     */
    _checkUser(user, single) {
        if (user == null) {
            log.warn("无法获取用户信息，跳过用户检查")
            return
        }
        if (user.isLoginBan) {
            log.warn("该用户被禁止登录")
        }
        if (!single) {
            log.info("用户名称:", user.nickname)
            log.info("是否vip:", user.isVip ? "是" : "否")
            log.info("vip剩余天数:", user.vipExpireTime)
            log.info("是否被检测为机器人:", "否")
        }
        if (user.isRobot) {
            log.warn("警告，被系统检测为机器人，请暂停下载稍后重试")
        }
    }

    async isLogin() {
        const cookies = await this._getCookies()
        if (cookies == null) {
            return false
        }
        const user = await this._getCurrentUser()
        if (user == null) {
            return false
        }
        return true
    }

    /**
     * 获取专辑简况
     * @param albumId
     * @param cookie
     * @returns {Promise<*>}
     */
    async _getAlbumSimple(albumId, cookie) {
        const url = `${config.baseUrl}/revision/album/v1/simple?albumId=${albumId}`
        const referer = `${config.baseUrl}/album/${albumId}`
        const headers = buildHeaders(referer, cookie)
        const response = await iaxios.get(url, {headers: headers})
        if (response.status !== 200) {
            throw new Error('网络请求失败')
        }
        if (response.data == null) {
            throw new Error('数据为空')
        }
        if (response.data.ret !== 200) {
            log.error("喜马拉雅内部异常", response.data)
            throw new Error("喜马拉雅内部异常")
        }
        return response.data.data
    }

    /**
     * 获取专辑信息
     * @param albumId
     * @param cookie
     * @returns {Promise<*>}
     */
    async _getAlbumInfo(albumId, cookie) {
        const url = `${config.baseUrl}/tdk-web/seo/search/albumInfo?albumId=${albumId}`
        const referer = `${config.baseUrl}/album/${albumId}`
        const headers = buildHeaders(referer, cookie)
        const response = await iaxios.get(url, {headers: headers})
        if (response.status !== 200) {
            throw new Error('网络请求失败')
        }
        if (response.data == null) {
            throw new Error('数据为空')
        }
        if (response.data.ret !== 200) {
            log.error("喜马拉雅内部异常", response.data)
            throw new Error("喜马拉雅内部异常")
        }
        return response.data.data
    }

    /**
     * 获取专辑详情
     * @param albumId
     * @returns {Promise<{trackCount, albumTitle, isFinished}>}
     */
    async getAlbum(albumId) {
        if (albumId == null) {
            throw new Error("albumId不能为空")
        }
        const cookie = await this._getCookies()
        const simple = await this._getAlbumSimple(albumId, cookie)
        const book = await this.getTracksList(albumId, 1, 1)
        return {
            albumId: albumId,
            albumTitle: simple['albumPageMainInfo']['albumTitle'],
            isFinished: simple['albumPageMainInfo']['isFinished'],
            trackCount: book.trackTotalCount
        }
    }

    /**
     * 获取章节列表
     * @param albumId
     * @param pageNum
     * @param pageSize
     * @returns {Promise<*>}
     */
    async getTracksList(albumId, pageNum, pageSize) {
        if (AbstractDownloader.browser == null) {
            throw new Error('BrowserHelper未初始化')
        }
        return await AbstractDownloader.browser.getTracksList(
            albumId,
            pageNum,
            pageSize,
            await this._getCookies()
        )
    }

    /**
     * 获取音频数据
     * @param trackId
     * @returns {Promise<{trackTitle, playUrlList}>}
     * @private
     */
    async _getBaseInfo(trackId) {
        if (AbstractDownloader.browser == null) {
            throw new Error('BrowserHelper未初始化')
        }
        const responseData = await AbstractDownloader.browser.getBaseInfo(
            trackId,
            this.deviceType,
            await this._getCookies()
        )
        if (responseData == null) {
            throw new Error('数据为空')
        }
        if (responseData.ret === 999 || responseData.ret === 1001 || responseData.ret === 3001) {
            log.error(`${this.deviceType}端喜马拉雅接口内部异常`, responseData)
            throw new CustomError(999, `${this.deviceType}端速率限制`)
        }
        if (responseData.ret !== 0) {
            log.error(`${this.deviceType}端喜马拉雅接口内部异常`, responseData)
            throw new Error("喜马拉雅内部异常")
        }
        return {
            playUrlList: responseData.trackInfo.playUrlList,
            trackTitle: responseData.albumInfo.title
        }
    }

    /**
     * 获取音频数据
     * @param url
     * @returns {Promise<{buffer, extension}>}
     */
    async _getAudio(url) {
        if (url == null) {
            throw new Error("Invalid url")
        }
        const response = await iaxios({
            method: 'GET',
            url: url,
            responseType: 'arraybuffer',
        })
        if (response.status !== 200) {
            throw new Error('网络请求失败')
        }
        if (response.data == null) {
            throw new Error('数据为空')
        }

        const contentType = response.headers['content-type']
        let extension = ''
        if (contentType) {
            const parts = contentType.split('/')
            if (parts.length === 2) {
                extension = '.' + parts[1].replace("x-", "")
            }
        }

        return {
            buffer: response.data,
            extension: extension
        }
    }

    /**
     * 获取解密参数 — 从 playUrlList 中选取最优质音频URL
     * @param t playUrlList
     * @returns {{qualityLevel, encodeText}}
     */
    _playUrl = (t) => {
        let e, r = {}, n = 1
        r.mediaType && t.some((item) => {
            if (item.type.indexOf(r.mediaType) >= 0) {
                e = item.url
                return true
            }
            return false
        })
        if (!e) {
            e = t[0].url
        }
        if (t && t.length) {
            n = t[0].qualityLevel
        }
        return {
            qualityLevel: n,
            encodeText: e
        }
    }

    /**
     * 解密
     * @param encodeText
     * @return url
     */
    _decrypt(encodeText) {
        throw new Error("抽象方法，子类需要实现")
    }

    /**
     * 下载音频
     * @param trackId
     * @returns {Promise<{buffer, extension}>}
     */
    async download(trackId) {
        const user = await this._getCurrentUser()
        this._checkUser(user, true)
        const baseInfo = await this._getBaseInfo(trackId)
        const e = this._playUrl(baseInfo.playUrlList)
        const url = this._decrypt(e.encodeText)
        return await this._getAudio(url)
    }
}

export {
    AbstractDownloader
}
