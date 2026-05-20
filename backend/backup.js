require('dotenv').config();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const backupDir = path.join(__dirname, 'backups');

// Create backup directory if not exists
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, `backup_${timestamp}.sql`);

const command = `mysqldump -h ${process.env.DB_HOST} -u ${process.env.DB_USER} -p${process.env.DB_PASSWORD} ${process.env.DB_NAME} > "${backupFile}"`;

exec(command, (error, stdout, stderr) => {
    if (error) {
        console.error('Backup failed:', error);
        return;
    }
    
    // Delete backups older than 30 days
    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    
    files.forEach(file => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > thirtyDays) {
            fs.unlinkSync(filePath);
            console.log(`Deleted old backup: ${file}`);
        }
    });
    
    console.log(`✅ Backup created: ${backupFile}`);
});