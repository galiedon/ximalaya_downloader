#!/usr/bin/env node

// Polyfill for deprecated util methods removed in Node.js v25+
import util from 'util';
if (!util.isDate) util.isDate = (d) => d instanceof Date;
if (!util.isArray) util.isArray = Array.isArray;
if (!util.isRegExp) util.isRegExp = (r) => r instanceof RegExp;

import {config} from './common/config.js'
import pLimit from 'p-limit'
import {log} from './common/log4jscf.js'
import {trackDB} from './db/trackdb.js'
import {albumDB} from './db/albumdb.js'
import {program, InvalidArgumentError} from "commander"
import {AtomicInteger} from './common/AtomicInteger.js'
import {sleep} from './common/utils.js'
import {DownloaderFactory} from './handler/downloader.js'
import {BrowserHelper} from './common/browser.js'
import {AbstractDownloader} from './handler/abstractDownloader.js'
import {searchInteractive} from './handler/searcher.js'
import os from "os"
import fs from "fs"
import path from 'path'
import {mkdirpSync} from "mkdirp"
import {rimrafSync} from 'rimraf'

let taskCount = new AtomicInteger(0)
let finishCount = new AtomicInteger(0)

let emoji = '>'

function printProgress(trackName, target, deviceType) {
    const downloaderName = `${deviceType == null ? '' : `(${deviceType})`}`
    if (trackName)
        log.info(`${downloaderName}下载成功${emoji.repeat(5)}进度:${getProgress()}%(${finishCount.get()}/${taskCount.get()})---->${target}`)
    else {
        log.info(`${downloaderName}当前信息${emoji.repeat(5)}进度:${getProgress()}%(${finishCount.get()}/${taskCount.get()})`)
    }
}

function getProgress() {
    const _finishCount = finishCount.get()
    const _taskCount = taskCount.get()
    if (_taskCount === 0) {
        return 100
    }
    return ((_finishCount / _taskCount) * 100).toFixed(2)
}

function myParseInt(value, dummyPrevious) {
    const parsedValue = parseInt(value, 10)
    if (isNaN(parsedValue)) {
        throw new InvalidArgumentError('Not a number.')
    }
    return parsedValue
}

function cleanedStr(str) {
    // 文件路径非法字符的正则表达式
    const pathCharactersRegex = /[<>:"\/\\|?*\x00-\x1F]/g
    return str.replace(pathCharactersRegex, '_')
}

async function download(factory, options, album, track) {
    if (track.path && fs.existsSync(track.path)) {
        return
    }
    let targetDir = options.output
    if (targetDir.includes('~')) {
        targetDir = targetDir.replace('~', os.homedir())
    }
    targetDir = path.join(targetDir, cleanedStr(album.albumTitle))

    if (!fs.existsSync(targetDir)) {
        mkdirpSync(targetDir)
    }

    const {data, deviceType} = await factory.getDownloader(options.type, async downloader => {
        return {
            data: await downloader.download(track.trackId),
            deviceType: downloader.deviceType
        }
    })
    const filePath = path.join(targetDir, track.num + "." + cleanedStr(track.title) + data.extension)
    // 使用异步写入，避免在并发下载时阻塞事件循环
    await fs.promises.writeFile(filePath, data.buffer)
    await trackDB.update({'trackId': track.trackId}, {'path': filePath})
    finishCount.increment()
    printProgress(track.title, filePath, deviceType)
}


async function main() {
    log.info("欢迎使用 ximalaya_downloader！")
    log.info("如果觉得好用，去 GitHub 给我们点个星星吧！")
    log.info("GitHub 地址：https://github.com/844704781/ximalaya_downloader")
    program
        .option('-a, --albumId <value>', 'albumId')
        .option('-k, --keyword <value>', '搜索关键词,通过关键词搜索专辑')
        .option('-n, --concurrency <number>', '并发数,默认10', myParseInt)
        .option('-s, --slow', '慢速模式')
        .option('-t, --type <value>', '登录类型,可选值pc、web,默认都登陆(需要扫码多次)')
        .option('-r, --replace', '清除缓存,任务将重新下载')
        .option('-o, --output <value>', '当前要保存的目录,默认为~/Downloads', config.archives)

    program.parse(process.argv)
    const options = program.opts()
    let albumId = options.albumId

    // 搜索模式：通过关键词搜索专辑，用户交互选择后自动下载
    if (options.keyword && options.keyword.trim() !== '') {
        log.info(`进入搜索模式，关键词: "${options.keyword}"`)
        const selectedAlbumId = await searchInteractive(options.keyword)
        if (selectedAlbumId == null) {
            return
        }
        albumId = selectedAlbumId
    }

    if (albumId == null || albumId.trim() === '') {
        log.error("要输入 albumId 或搜索关键词 哦，尝试输入 node xmd.js --help 查看使用说明吧")
        return
    }
    if (options.replace) {
        log.info("清空缓存中...")
        rimrafSync(path.join(config.xmd.replace('~', os.homedir()), 'db', 'file'))
    }
    log.info(`当前albumId:${albumId}`)
    log.info(`当前保存目录:${options.output}`)

    if (options.concurrency == null) {
        options.concurrency = 10
    }
    if (!options.slow) {
        emoji = '＞'
        log.warn(`${'>>'.repeat(5)}当前为快速模式,很容易被官方大大踢屁屁哦`)
    } else {
        emoji = '>'
        options.concurrency = 1
        log.info(`${'>>'.repeat(5)}当前为慢速模式`)
    }

    log.info(`并发数:${options.concurrency}`)
    const limit = pLimit(options.concurrency)
    let browser = null

    try {
        browser = new BrowserHelper()
        await browser.init()
        AbstractDownloader.setBrowser(browser)

        const factory = DownloaderFactory.create()
        log.info("正在获取专辑信息")

        const albumResp = await factory.getDownloader(options.type, async (downloader) => {
            return await downloader.getAlbum(albumId)
        })

        log.info(`当前专辑:${albumResp.albumTitle},总章节数:${albumResp.trackCount}`)
        let album = await albumDB.findOne({"albumId": albumId})
        let needFlushTracks = true

        if (album == null) {
            album = {
                "albumId": albumId,
                "albumTitle": albumResp.albumTitle,
                "isFinished": albumResp.isFinished, //0:不间断更新 1:连载中 2:完结
                "trackCount": albumResp.trackCount
            }
            await albumDB.insert(album)
        } else {
            await albumDB.update({'albumId': albumId}, {
                "isFinished": albumResp.isFinished,
                "trackCount": albumResp.trackCount
            })
            album = albumResp
        }

        const iTrackCount = await trackDB.count({'albumId': albumId})
        if (album.trackCount === iTrackCount) {
            needFlushTracks = false
        }
        if (needFlushTracks) {
            const pageSize = 30
            let total = 1
            let num = 0
            log.info("正在获取章节列表")
            for (let pageNum = 1; pageNum <= total; pageNum++) {
                const book = await factory.getDownloader(options.type, async downloader => {
                    return await downloader.getTracksList(albumId, pageNum, pageSize)
                })
                let trackTotalCount = book.trackTotalCount
                if (trackTotalCount === 0) {
                    trackTotalCount = albumResp.trackCount
                }
                total = Math.floor(trackTotalCount / pageSize) + 1
                for (const track of book.tracks) {
                    num++
                    const _track = await trackDB.findOne({'trackId': track.trackId})
                    if (_track == null) {
                        await trackDB.insert({
                            "trackId": track.trackId,
                            "title": track.title,
                            "albumId": albumId,
                            "num": num,
                            "path": null
                        })
                    }
                    log.info(`获取章节列中,总章节数:${album.trackCount},当前位置:${num}------>${track.title}`)
                }
            }
            log.info("获取章节列表成功")
        }
        const condition = {"albumId": albumId, path: null}

        taskCount.set(await trackDB.count({"albumId": albumId}))
        finishCount.set(await trackDB.count({
            "albumId": albumId,
            "path": {
                $ne: null
            }
        }))
        printProgress()
        if (taskCount.get() === finishCount.get()) {
            log.info("已经下载完成")
            return
        }
        log.info("数据加载中...")
        while (true) {
            const tracks = await trackDB.find(condition, {"num": 1}, !options.slow ? options.concurrency * 2 : 1)
            if (tracks.length === 0) {
                log.info("已经下载完成")
                break
            }
            const promises = tracks.map(track =>
                limit(async () => {
                    try {
                        await download(factory, options, album, track)
                    } catch (e) {
                        log.error(`下载失败: ${track.title} - ${e.message}`)
                        // 单个track下载失败不中断整批，继续下载其他track
                    }
                }))
            await Promise.all(promises)
            if (options.slow) {
                await sleep(Math.floor(Math.random() * (5000 - 500 + 1)) + 500)
            }
        }
    } finally {
        if (browser) {
            await browser.close()
        }
    }
}

main()
