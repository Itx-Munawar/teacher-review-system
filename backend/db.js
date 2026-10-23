require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2');

// TLS. Cloud providers such as Aiven enforce TLS (DB_SSL=true) and chain to a
// private CA that is not in the system trust store.
//
// rejectUnauthorized:false encrypts the connection but does not verify who is
// on the other end, so an on-path attacker could read the DB credentials this
// pool sends on every connection. Point DB_SSL_CA at the provider's CA - either
// the inline PEM text or a path to the file - and verification switches itself
// on. Without a CA there is nothing to verify against for a private-CA
// provider, so the previous behaviour is kept, but it is called out in the logs
// rather than being silent.
const buildSslConfig = () => {
    if (process.env.DB_SSL !== 'true') return {};

    const rawCa = process.env.DB_SSL_CA;
    let ca;
    if (rawCa) {
        ca = rawCa.includes('-----BEGIN CERTIFICATE-----')
            ? rawCa
            : fs.readFileSync(rawCa, 'utf8');
    }

    if (!ca) {
        console.warn('⚠️ DB_SSL is on but DB_SSL_CA is not set - the server certificate is NOT verified. Add your provider CA to enable verification.');
    } else {
        console.log('✅ DB server certificate verification is enabled');
    }

    return {
        ssl: {
            ca,
            rejectUnauthorized: Boolean(ca),
            servername: process.env.DB_HOST
        }
    };
};

const sslConfig = buildSslConfig();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // DB_PORT: Aiven prints its own port next to the host in Service
    // Overview; 24580 is the Render MySQL default (used when unset).
    port: process.env.DB_PORT || 24580,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    ...sslConfig
});

// Promisify pool for async/await
const promisePool = pool.promise();

// Test connection + keep-alive monitoring
const initDB = async () => {
    try {
        const connection = await promisePool.getConnection();
        console.log(`✅ Connected to MySQL at ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 24580}`);
        connection.release();

        // Optional: periodic ping to keep connections alive (every 5 minutes)
        setInterval(async () => {
            try {
                await promisePool.query('SELECT 1');
            } catch (err) {
                console.error('⚠️ MySQL keep-alive failed:', err.message);
            }
        }, 5 * 60 * 1000);

    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        // Don't exit immediately – let Render restart the service gracefully
        throw err;
    }
};

initDB();

module.exports = promisePool;