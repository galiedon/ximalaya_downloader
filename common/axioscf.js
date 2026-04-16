import axios from 'axios'
import axiosRetry from "axios-retry"

function randomIP() {
    const a = Math.floor(Math.random() * 200) + 10
    const b = Math.floor(Math.random() * 255)
    const c = Math.floor(Math.random() * 255)
    const d = Math.floor(Math.random() * 255)
    return `${a}.${b}.${c}.${d}`
}

axios.interceptors.request.use((config) => {
    const fakeIp = randomIP()
    config.headers['X-Forwarded-For'] = fakeIp
    config.headers['X-Real-IP'] = fakeIp
    config.headers['Client-IP'] = fakeIp
    return config
})

axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return error.code === 'ETIMEDOUT';
    }
});

export const iaxios = axios