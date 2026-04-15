import fs from "fs";
import {projectRoot} from "../settings.js";

const defaultConfig = {
    "baseUrl": "https://www.ximalaya.com",
    "loginBaseUrl": "https://passport.ximalaya.com",
    "archives": "~/Downloads",
    "xmd": "~/.xmd",
    "cookie": {
        "www2": {
            "serverMode": false,
            "value": ""
        },
        "mac": {
            "serverMode": false,
            "value": ""
        }
    }
}

/**
 * 深度合并对象，source 中的值覆盖 target，但不会丢失 target 中 source 缺失的字段
 */
function deepMerge(target, source) {
    const result = {...target}
    for (const key of Object.keys(source)) {
        if (
            source[key] !== null &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            typeof target[key] === 'object' &&
            target[key] !== null
        ) {
            result[key] = deepMerge(target[key], source[key])
        } else {
            result[key] = source[key]
        }
    }
    return result
}

let _config = {...defaultConfig}

const configPath = `${projectRoot}/config.json`
if (fs.existsSync(configPath)) {
    try {
        const configBuf = fs.readFileSync(configPath)
        const userConfig = JSON.parse(String(configBuf))
        _config = deepMerge(defaultConfig, userConfig)
    } catch (e) {
        console.error(`config.json 解析失败，使用默认配置: ${e.message}`)
    }
}

export const config = _config
