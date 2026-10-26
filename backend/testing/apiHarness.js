// Shared harness for the API tests.
//
// The tests are black-box: they start the real server (`node server.js`) as a
// child process against a throwaway MySQL database and talk to it over HTTP.
// That way they exercise exactly what runs in production, and they keep
// working no matter how server.js is organised internally.
//
// They need a database the tests are allowed to wipe. Set TEST_DB_HOST (and
// optionally TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD / TEST_DB_NAME);
// without it every API test is skipped, so `npm test` still works on a
// machine with no MySQL.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const mysql = require('mysql2/promise');

const BACKEND_DIR = path.join(__dirname, '..');

const dbConfig = {
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD || '',
    database: process.env.TEST_DB_NAME || 'trs_test'
};

const SKIP = process.env.TEST_DB_HOST ? false : 'TEST_DB_HOST not set - API tests need a disposable MySQL database';

const SETUP_KEY = 'test-setup-key-0123456789';

const freePort = () => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
    });
});

// Drop every table and load schema.sql, so each test file starts from the
// same empty database.
const resetDatabase = async () => {
    const conn = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
    try {
        const [tables] = await conn.query(
            'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'
        );
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const { name } of tables) {
            await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
        }
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        await conn.query(fs.readFileSync(path.join(BACKEND_DIR, 'schema.sql'), 'utf8'));
    } finally {
        await conn.end();
    }
};

const dbQuery = async (sql, params = []) => {
    const conn = await mysql.createConnection(dbConfig);
    try {
        const [rows] = await conn.query(sql, params);
        return rows;
    } finally {
        await conn.end();
    }
};

const startServer = async (extraEnv = {}) => {
    const port = await freePort();
    const env = {
        // Keep the parent's PATH etc., but none of a developer's real config.
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'test',
        PORT: String(port),
        JWT_SECRET: crypto.randomBytes(32).toString('hex'),
        FRONTEND_URL: 'http://localhost:3000',
        DB_HOST: dbConfig.host,
        DB_PORT: String(dbConfig.port),
        DB_USER: dbConfig.user,
        DB_PASSWORD: dbConfig.password || 'unused',
        DB_NAME: dbConfig.database,
        DB_SSL: 'false',
        // Never reached: no test triggers a real email to an existing admin.
        EMAIL_USER: 'tests@example.invalid',
        EMAIL_PASS: 'unused',
        BCRYPT_ROUNDS: '10',
        ADMIN_SETUP_KEY: SETUP_KEY,
        ...extraEnv
    };
    // An empty DB_PASSWORD fails the server's env check, so root-without-a-
    // password setups (CI) pass the real value through explicitly.
    if (dbConfig.password === '') env.DB_PASSWORD = '';

    const child = spawn(process.execPath, ['server.js'], { cwd: BACKEND_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });

    // Ready = listening AND the schema bootstrap has finished (several routes
    // check the columns it adds).
    const deadline = Date.now() + 30000;
    while (!/Schema bootstrap complete/.test(log)) {
        if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
        if (Date.now() > deadline) {
            child.kill('SIGKILL');
            throw new Error(`server did not become ready in 30s:\n${log}`);
        }
        await new Promise((r) => setTimeout(r, 100));
    }

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        log: () => log,
        stop: () => new Promise((resolve) => {
            if (child.exitCode !== null) return resolve();
            child.once('exit', resolve);
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        })
    };
};

// Each client gets its own IP (the server trusts one proxy hop, so
// X-Forwarded-For decides req.ip). That keeps the per-IP rate limiters from
// leaking between tests, while still letting a test hit a limit on purpose.
let ipCounter = 1;
const nextIp = () => {
    ipCounter += 1;
    return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

// Minimal fetch wrapper with a cookie jar, the CSRF double-submit header and
// JSON handling.
const createClient = (baseUrl, { ip = nextIp() } = {}) => {
    const jar = new Map();

    const request = async (method, urlPath, { body, headers = {}, csrf = true, raw } = {}) => {
        // Like the browser, which always loads a page (and gets the cookie)
        // before posting a form: fetch the CSRF cookie first when it is missing.
        // Pass csrf: false to test what happens without it.
        if (csrf && !jar.has('csrf_token') && !['GET', 'HEAD'].includes(method)) {
            await request('GET', '/api/health', { csrf: false });
        }
        const h = { 'X-Forwarded-For': ip, ...headers };
        if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
        if (csrf && jar.has('csrf_token') && !['GET', 'HEAD'].includes(method)) {
            h['X-CSRF-Token'] = jar.get('csrf_token');
        }
        let payload;
        if (raw !== undefined) {
            payload = raw;
            h['Content-Type'] = h['Content-Type'] || 'application/json';
        } else if (body !== undefined) {
            payload = JSON.stringify(body);
            h['Content-Type'] = 'application/json';
        }
        const res = await fetch(baseUrl + urlPath, { method, headers: h, body: payload, redirect: 'manual' });
        for (const cookie of res.headers.getSetCookie()) {
            const [pair, ...attrs] = cookie.split(';');
            const idx = pair.indexOf('=');
            const name = pair.slice(0, idx).trim();
            const value = pair.slice(idx + 1).trim();
            const expired = attrs.some((a) => /^\s*expires=Thu, 01 Jan 1970/i.test(a));
            if (expired || value === '') jar.delete(name);
            else jar.set(name, value);
        }
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch (_) { json = undefined; }
        return { status: res.status, headers: res.headers, text, body: json };
    };

    return {
        ip,
        jar,
        get: (p, o) => request('GET', p, o),
        post: (p, body, o = {}) => request('POST', p, { ...o, body }),
        put: (p, body, o = {}) => request('PUT', p, { ...o, body }),
        del: (p, o) => request('DELETE', p, o),
        request,
        // Any GET hands out the CSRF cookie; do one before a state change.
        primeCsrf: () => request('GET', '/api/health')
    };
};

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) so the 2FA flow can be tested with
// the secret the server returns.
const base32Decode = (input) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of input.replace(/=+$/, '').toUpperCase()) {
        bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
};

const totpNow = (secret, at = Date.now()) => {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
    const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
    return String(code).padStart(6, '0');
};

// Creates the first admin through the real setup endpoint and returns a
// logged-in client.
const ADMIN = { username: 'admin', password: 'Correct-Horse-Battery-9', email: 'admin@example.com' };

const createAdminAndLogin = async (baseUrl) => {
    const client = createClient(baseUrl);
    await client.primeCsrf();
    const setup = await client.post('/api/admin/setup', ADMIN, { headers: { 'X-Setup-Secret': SETUP_KEY } });
    if (setup.status !== 200) throw new Error(`admin setup failed: ${setup.status} ${setup.text}`);
    const login = await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
    if (login.status !== 200) throw new Error(`admin login failed: ${login.status} ${login.text}`);
    return client;
};

module.exports = {
    SKIP,
    SETUP_KEY,
    ADMIN,
    resetDatabase,
    dbQuery,
    startServer,
    createClient,
    createAdminAndLogin,
    totpNow
};
