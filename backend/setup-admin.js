const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function setupAdmin() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: 'muna',
            database: 'teacher_reviews'
        });

        // Hash the password
        const hashedPassword = await bcrypt.hash('Admin@123', 10);
        
        // Insert or update admin
        await connection.execute(
            'INSERT INTO admins (username, password, email) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = ?',
            ['admin', hashedPassword, 'admin@example.com', hashedPassword]
        );
        
        console.log('✅ Admin user created/updated!');
        console.log('📝 Username: admin');
        console.log('📝 Password: Admin@123');
        
        await connection.end();
    } catch (error) {
        console.error('Error:', error);
    }
}

setupAdmin();