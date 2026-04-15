import {iaxios} from '../common/axioscf.js'
import {config} from '../common/config.js'
import {log} from '../common/log4jscf.js'
import readline from 'readline'

const SEARCH_ROWS = 20

/**
 * 通过 WSA 搜索服务搜索专辑（主接口）
 *
 * searchwsa.ximalaya.com 是喜马拉雅独立的 Solr 搜索服务，
 * 相比主站 /revision/search/main 接口反爬策略更宽松，无需 wfp 指纹 cookie。
 *
 * @param {string} keyword 搜索关键词
 * @param {number} page 页码（从 1 开始）
 * @returns {Promise<{totalPage: number, docs: Array}>}
 */
async function searchByWSA(keyword, page = 1) {
    const url = 'https://searchwsa.ximalaya.com/front/v1'
    const params = {
        appid: '0',
        core: 'album',
        kw: keyword,
        page: String(page),
        rows: String(SEARCH_ROWS),
        condition: 'relation',
        device: 'android',
        spellchecker: 'true',
        paidFilter: 'false',
        search_version: '2.8',
        live: 'true'
    }
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36'
    }
    const response = await iaxios.get(url, {params, headers, timeout: 15000})
    if (response.status !== 200) {
        throw new Error('WSA 搜索请求失败')
    }
    const body = response.data
    if (body == null || body.response == null) {
        throw new Error('WSA 搜索返回数据异常')
    }
    const solrResp = body.response
    return {
        totalPage: solrResp.totalPage || Math.ceil((solrResp.numFound || 0) / SEARCH_ROWS),
        docs: (solrResp.docs || []).map(doc => ({
            albumId: doc.id,
            title: stripHtmlTags(doc.title),
            nickname: doc.nickname || '',
            trackCount: doc.tracks || 0,
            intro: stripHtmlTags(doc.intro || ''),
            isPaid: doc.isPaid || false,
            categoryTitle: doc.category_title || ''
        }))
    }
}

/**
 * 通过主站接口搜索专辑（备选接口）
 *
 * 主站 /revision/search/main 接口受风控保护，
 * 无 wfp 指纹 cookie 时可能返回 riskLevel=5 拒绝服务。
 * 仅在 WSA 接口不可用时作为降级方案。
 *
 * @param {string} keyword 搜索关键词
 * @param {number} page 页码
 * @returns {Promise<{totalPage: number, docs: Array}>}
 */
async function searchByMainSite(keyword, page = 1) {
    const url = `${config.baseUrl}/revision/search/main`
    const params = {
        kw: keyword,
        page: page,
        spellchecker: true,
        condition: 'relation',
        rows: SEARCH_ROWS,
        device: 'iPhone',
        core: 'album',
        paidFilter: false
    }
    const response = await iaxios.get(url, {params, timeout: 15000})
    if (response.status !== 200) {
        throw new Error('网络请求失败')
    }
    if (response.data == null) {
        throw new Error('数据为空')
    }
    // 风控拦截检测
    if (response.data.data && response.data.data.reason === 'risk invalid') {
        throw new Error(`主站搜索被风控拦截 (riskLevel=${response.data.data.riskLevel})`)
    }

    const albumData = response.data.data.album
    if (albumData == null) {
        return {totalPage: 0, docs: []}
    }
    return {
        totalPage: albumData.totalPage || 0,
        docs: (albumData.docs || []).map(doc => ({
            albumId: doc.albumId,
            title: stripHtmlTags(doc.title),
            nickname: doc.nickname,
            trackCount: doc.trackCount || 0,
            intro: stripHtmlTags(doc.intro || ''),
            isPaid: doc.isPaid || false,
            categoryTitle: ''
        }))
    }
}

/**
 * 搜索专辑（自动降级策略）
 *
 * 优先使用 WSA 搜索服务，失败后降级到主站接口。
 *
 * @param {string} keyword 搜索关键词
 * @param {number} page 页码
 * @returns {Promise<{totalPage: number, docs: Array}>}
 */
async function searchAlbums(keyword, page = 1) {
    try {
        return await searchByWSA(keyword, page)
    } catch (e) {
        log.warn(`WSA 搜索失败 (${e.message})，尝试主站搜索...`)
        return await searchByMainSite(keyword, page)
    }
}

/**
 * 去除 HTML 标签（搜索结果中标题可能带高亮标签）
 */
function stripHtmlTags(str) {
    if (!str) return ''
    return str.replace(/<[^>]+>/g, '')
}

/**
 * 打印搜索结果列表
 * @param {Array} docs 专辑列表
 * @param {number} page 当前页码
 * @param {number} totalPage 总页数
 */
function printSearchResults(docs, page, totalPage) {
    if (docs.length === 0) {
        log.info('未找到相关专辑')
        return
    }
    log.info(`\n${'='.repeat(60)}`)
    log.info(`搜索结果 (第 ${page}/${totalPage} 页)`)
    log.info('='.repeat(60))
    docs.forEach((doc, index) => {
        const paidTag = doc.isPaid ? ' [付费]' : ''
        const catTag = doc.categoryTitle ? ` [${doc.categoryTitle}]` : ''
        log.info(`  [${index + 1}] ${doc.title}${paidTag}${catTag}`)
        log.info(`      主播: ${doc.nickname}  |  集数: ${doc.trackCount}  |  albumId: ${doc.albumId}`)
        if (doc.intro) {
            const shortIntro = doc.intro.length > 50 ? doc.intro.substring(0, 50) + '...' : doc.intro
            log.info(`      简介: ${shortIntro}`)
        }
    })
    log.info('='.repeat(60))
    const hints = ['输入序号选择专辑开始下载']
    if (page < totalPage) {
        hints.push('"n" 下一页')
    }
    if (page > 1) {
        hints.push('"p" 上一页')
    }
    hints.push('"q" 退出')
    log.info(`提示: ${hints.join(' | ')}`)
}

/**
 * 交互式读取用户输入
 * @param {string} prompt 提示文字
 * @returns {Promise<string>}
 */
function askQuestion(prompt) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            rl.close()
            resolve(answer.trim())
        })
    })
}

/**
 * 搜索交互主流程：搜索 → 展示 → 用户选择 → 返回 albumId
 * @param {string} keyword 搜索关键词
 * @returns {Promise<string|null>} 用户选择的 albumId，退出返回 null
 */
async function searchInteractive(keyword) {
    let page = 1

    while (true) {
        log.info(`正在搜索: "${keyword}" (第 ${page} 页)...`)
        const result = await searchAlbums(keyword, page)
        printSearchResults(result.docs, page, result.totalPage)

        if (result.docs.length === 0) {
            return null
        }

        const answer = await askQuestion('\n请输入选择: ')

        if (answer === 'q' || answer === 'Q') {
            log.info('已退出搜索')
            return null
        }
        if ((answer === 'n' || answer === 'N') && page < result.totalPage) {
            page++
            continue
        }
        if ((answer === 'p' || answer === 'P') && page > 1) {
            page--
            continue
        }

        const index = parseInt(answer, 10)
        if (isNaN(index) || index < 1 || index > result.docs.length) {
            log.warn('输入无效，请输入有效序号')
            continue
        }

        const selected = result.docs[index - 1]
        log.info(`已选择: ${selected.title} (albumId: ${selected.albumId})`)
        return String(selected.albumId)
    }
}

export {searchAlbums, searchInteractive}
