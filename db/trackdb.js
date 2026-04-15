import {BaseDB} from './basedb.js'
import {config} from '../common/config.js'
import os from 'os'
import path from 'path'

/**
 * 章节(音轨)数据库
 */
const trackDB = new BaseDB(
    path.join(config.xmd.replace('~', os.homedir()), 'db', 'file', 'track.db')
)

export {trackDB}
