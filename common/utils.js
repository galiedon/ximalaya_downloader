function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function httpCookie(cookies) {
    return cookies.cookies.map(cookie => {
        if (cookie.name === 'web_login')
            cookie.value = Date.now()
        if (cookie.name === 'Hm_lpvt_4a7d8ec50cfd6af753c4f8aee3425070')
            cookie.value = Math.floor(Date.now() / 1000)
        return `${cookie.name}=${cookie.value}`
    }).join('; ')
}


/**
 * 生成随机公网IP地址
 * @returns {string}
 */
function randomPublicIP() {
    const ranges = [
        // 避开私有/保留段，生成看起来合理的公网IP
        () => [Math.floor(Math.random() * 126) + 1, rand256(), rand256(), rand256()],     // 1.x - 126.x
        () => [Math.floor(Math.random() * 64) + 128, rand256(), rand256(), rand256()],    // 128.x - 191.x
        () => [Math.floor(Math.random() * 32) + 192, rand256(), rand256(), rand256()],    // 192.x - 223.x
    ]
    function rand256() { return Math.floor(Math.random() * 256) }
    const gen = ranges[Math.floor(Math.random() * ranges.length)]
    return gen().join('.')
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const UA = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"'
const PLATFORM = '"macOS"'


/**
 * @param referer 'https://www.ximalaya.com'
 * @param cookie {string}
 */
function buildHeaders(referer, cookie) {
    if (typeof cookie !== 'string') {
        throw new Error('Cookie must be string')
    }
    const fakeIP = randomPublicIP()
    return {
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Cookie': cookie,
        'Pragma': 'no-cache',
        'Referer': referer,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': USER_AGENT,
        'sec-ch-ua': UA,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': PLATFORM,
        'X-Forwarded-For': fakeIP,
        'X-Real-IP': fakeIP,
        'X-Client-IP': fakeIP
    }
}


function parseCookies(cookieArray) {
    return cookieArray
        .filter(cookieStr => cookieStr.trim() !== '')
        .map(cookieStr => {
            const cookieParts = cookieStr.split(';').map(part => part.trim())
            const cookieInfo = {}
            for (const part of cookieParts) {
                const [key, value] = part.split('=')
                if (key === 'Max-Age' || key === 'Expires') {
                    cookieInfo.expires = Date.parse(value)
                } else if (key === 'HttpOnly') {
                    cookieInfo.httpOnly = true
                } else {
                    cookieInfo[key] = value
                }
            }
            return cookieInfo
        })
}

/**
 * 将cookie文件中的格式转成请求可用的cookie格式
 * @param cookies
 * @returns {string}
 */
function convertCookiesToString(cookies) {
    const parts = []
    for (const cookieObj of cookies) {
        for (const [key, value] of Object.entries(cookieObj)) {
            if (key === 'expires' || key === 'Domain' || key === 'Path' || key === 'httpOnly' || key === 'secure') {
                continue
            }
            parts.push(`${key}=${value}`)
        }
    }
    return parts.join('; ')
}

/**
 * 在cookie数组中追加一条cookie（如果key不存在的话）
 * @param _cookies {Array}
 * @param key {string}
 * @param value {*}
 */
function addCookie(_cookies, key, value) {
    // 检查是否已存在该 key
    for (const item of _cookies) {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
            return
        }
    }
    _cookies.push({
        [key]: value,
        "expires": 3863521955000,
        "Domain": "ximalaya.com",
        "Path": "/"
    })
}


export {
    sleep, httpCookie, buildHeaders, parseCookies, convertCookiesToString, addCookie, randomPublicIP
}
