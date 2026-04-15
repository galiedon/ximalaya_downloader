import {BaseDB} from './basedb.js'
import {config} from '../common/config.js'
import os from 'os'
import path from 'path'

/**
 * 专辑数据库
 */
const albumDB = new BaseDB(
    path.join(config.xmd.replace('~', os.homedir()), 'db', 'file', 'album.db')
)

export {albumDB}
