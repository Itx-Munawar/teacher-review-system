require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./db');

async function setup() {
    try {
        const hashedPassword = await bcrypt.hash('Admin@123', 10);
        
        await db.query(
            'INSERT INTO admins (username, password, email) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = ?',
            ['admin', hashedPassword, 'admin@example.com', hashedPassword]
        );
        
        console.log('✅ Admin user created!');
        console.log('Username: admin');
        console.log('Password: Admin@123');
        console.log('\n⚠️  Please change this password after first login!');
        
        process.exit(0);
    } catch (error) {
        console.error('Setup error:', error);
        process.exit(1);
    }
}

setup();