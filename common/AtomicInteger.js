/**
 * 简易计数器
 * Node.js 为单线程运行时，不存在多线程竞态条件，
 * 无需 async-mutex。方法保持同步返回，调用方的 await 仍可正常工作。
 */
class _AtomicInteger {
    constructor(initialValue = 0) {
        this._value = initialValue
    }

    increment() {
        return ++this._value
    }

    decrement() {
        return --this._value
    }

    get() {
        return this._value
    }

    set(value = 0) {
        this._value = value
    }
}

export const AtomicInteger = _AtomicInteger
