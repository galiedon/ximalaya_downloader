import Datastore from 'nedb'

/**
 * 通用数据库封装类
 * 将 NeDB 的回调式 API 统一封装为 Promise
 */
class BaseDB {
    constructor(filename) {
        this.db = new Datastore({filename, autoload: true})
    }

    insert(entity) {
        return new Promise((resolve, reject) => {
            this.db.insert(entity, (err, newDoc) => {
                if (err) return reject(err)
                return resolve(newDoc)
            })
        })
    }

    count(query) {
        return new Promise((resolve, reject) => {
            this.db.count(query, (err, count) => {
                if (err) return reject(err)
                return resolve(count)
            })
        })
    }

    find(query, sort, limit) {
        return new Promise((resolve, reject) => {
            let cursor = this.db.find(query)
            if (sort) {
                cursor = cursor.sort(sort)
            }
            if (limit) {
                cursor = cursor.limit(limit)
            }
            cursor.exec((err, docs) => {
                if (err) return reject(err)
                return resolve(docs)
            })
        })
    }

    findOne(query) {
        return new Promise((resolve, reject) => {
            this.db.findOne(query, (err, doc) => {
                if (err) return reject(err)
                return resolve(doc)
            })
        })
    }

    update(condition, setEntity) {
        return new Promise((resolve, reject) => {
            this.db.update(condition, {$set: setEntity}, (err, numReplaced) => {
                if (err) return reject(err)
                return resolve(numReplaced)
            })
        })
    }

    remove(condition) {
        return new Promise((resolve, reject) => {
            this.db.remove(condition, {}, (err, numRemoved) => {
                if (err) return reject(err)
                return resolve(numRemoved)
            })
        })
    }
}

export {BaseDB}
