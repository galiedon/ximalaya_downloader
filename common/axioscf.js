import axios from 'axios'
import axiosRetry from "axios-retry"
import {config} from './config.js'
import {log} from './log4jscf.js'

// 代理池轮换
let _proxyIndex = 0
function nextProxy() {
    const proxies = config.proxy
    if (!proxies || proxies.length === 0) return null
    const proxy = proxies[_proxyIndex % proxies.length]
    _proxyIndex++
    log.debug(`使用代理 #${_proxyIndex}: ${proxy}`)
    return proxy
}

axios.interceptors.request.use((config) => {
    // 真实 IP 轮换：通过代理
    const proxy = nextProxy()
    if (proxy) {
        config.proxy = proxy
    }
    // 伪造 XFF 头（无代理时也有辅助作用）
    const fakeIp = `${Math.floor(Math.random() * 200) + 10}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
    config.headers['X-Forwarded-For'] = fakeIp
    config.headers['X-Real-IP'] = fakeIp
    return config
})

axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return error.code === 'ETIMEDOUT' || axiosRetry.isNetworkOrIdempotentRequestError(error);
    }
});

export const iaxios = axios