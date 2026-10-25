// TOTP two-factor authentication helpers.

const crypto = require('crypto');

// ========== TOTP TWO-FACTOR (RFC 6238, SHA1, 30s, 6 digits) ==========
// Deliberately dependency-free: the algorithm is ~40 lines and the only
// "secret" material it handles is a per-admin code, so pulling in otplib for
// it would not pay for its supply-chain surface.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buffer) => {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
};

const base32Decode = (input) => {
    const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    if (!clean) return Buffer.alloc(0);
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const ch of clean) {
        value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((value >>> bits) & 0xff);
        }
    }
    return Buffer.from(bytes);
};

const generateTotpSecret = () => base32Encode(crypto.randomBytes(20)); // 32 chars

// HOTP (RFC 4226) with the counter written big-endian, as TOTP uses.
const hotp = (secretBytes, counter) => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', secretBytes).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) |
        (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(code % 1_000_000).padStart(6, '0');
};

// Accept the current step plus one step either side so a phone whose clock is
// a minute off still works; the code is a 22-bit space, so a 3-way check does
// not meaningfully weaken brute-force resistance (the login is also
// rate-limited and the password still gates the request).
const totpVerify = (secret, code) => {
    const clean = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) return false;
    const secretBytes = base32Decode(secret);
    if (secretBytes.length < 10) return false;
    const step = Math.floor(Date.now() / 1000 / 30);
    const given = Buffer.from(clean);
    for (let i = -1; i <= 1; i++) {
        const candidate = Buffer.from(hotp(secretBytes, step + i));
        if (crypto.timingSafeEqual(candidate, given)) return true;
    }
    return false;
};

const totpProvisioningUri = (secret, username) => {
    const label = `UMT Teacher Reviews:${username}`;
    const params = new URLSearchParams({
        issuer: 'UMT Teacher Reviews',
        algorithm: 'SHA1',
        digits: '6',
        period: '30',
        secret
    });
    return `otpauth://totp/${label}?${params.toString()}`;
};

module.exports = {
    BASE32_ALPHABET,
    base32Encode,
    base32Decode,
    generateTotpSecret,
    hotp,
    totpVerify,
    totpProvisioningUri
};
