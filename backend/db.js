require('dotenv').config();
const mysql = require('mysql2');

// SSL configuration – enable if required by your cloud MySQL provider
const sslConfig = process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {};

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
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
        console.log('✅ Connected to MySQL database on Render');
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