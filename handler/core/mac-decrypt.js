import CryptoJS from 'crypto-js'

function getSoundCryptLink(ciphertext) {
    const key = CryptoJS.enc.Hex.parse('aaad3e4fd540b0f79dca95606e72bf93')
    const encrypted = CryptoJS.enc.Base64url.parse(ciphertext)
    const decrypted = CryptoJS.AES.decrypt({ciphertext: encrypted}, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    })
    return decrypted.toString(CryptoJS.enc.Utf8)
}

export const decrypt = {
    getSoundCryptLink
}
