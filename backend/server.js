require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');        // NEW for reset tokens
const nodemailer = require('nodemailer'); // NEW for email
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 10;

// Security Middleware
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const reviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reviews. Please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please try again later.' }
});

const resetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { error: 'Too many reset requests. Try again in an hour.' }
});

// Create transporter once
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Real email sender
const sendEmail = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: `"Teacher Reviews" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });
        console.log(`✅ Email sent to ${to}`);
        return true;
    } catch (error) {
        console.error('❌ Email error:', error);
        return false;
    }
};

// ========== HELPER FUNCTIONS ==========

const verifyAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
};

const createAuditLog = async (adminId, action, details, ip = 'unknown') => {
    try {
        await db.query(
            'INSERT INTO audit_logs (admin_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [adminId, action, details, ip]
        );
    } catch (error) {
        console.error('Audit log error:', error);
    }
};

// ========== PUBLIC API ENDPOINTS ==========

// Get all teachers (NO pagination – returns full list for client‑side search)
app.get('/api/teachers', async (req, res) => {
    try {
        const search = req.query.search || '';
        let searchQuery = '';
        let params = [];
        
        if (search) {
            searchQuery = 'WHERE t.name LIKE ? OR t.department LIKE ?';
            params = [`%${search}%`, `%${search}%`];
        }
        
        const [teachers] = await db.query(`
            SELECT t.*, 
                   COALESCE(ROUND(AVG(r.rating), 1), 0) as avg_rating,
                   COUNT(r.id) as review_count
            FROM teachers t
            LEFT JOIN reviews r ON t.id = r.teacher_id AND r.is_approved = 1
            ${searchQuery}
            GROUP BY t.id
            ORDER BY t.name
        `, params);
        
        res.json(teachers);
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get single teacher with reviews
app.get('/api/teachers/:id', async (req, res) => {
    try {
        const teacherId = req.params.id;
        
        const [teachers] = await db.query(
            'SELECT * FROM teachers WHERE id = ?',
            [teacherId]
        );
        
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        
        const [reviews] = await db.query(
            `SELECT * FROM reviews 
             WHERE teacher_id = ? AND is_approved = 1 
             ORDER BY created_at DESC`,
            [teacherId]
        );
        
        const [ratingData] = await db.query(
            'SELECT AVG(rating) as avg_rating, COUNT(*) as total FROM reviews WHERE teacher_id = ? AND is_approved = 1',
            [teacherId]
        );
        
        res.json({
            teacher: teachers[0],
            reviews: reviews,
            avg_rating: ratingData[0].avg_rating || 0,
            total_reviews: ratingData[0].total || 0
        });
    } catch (error) {
        console.error('Error fetching teacher details:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Submit review with validation
app.post('/api/reviews', reviewLimiter, [
    body('teacher_id').isInt({ min: 1 }).withMessage('Invalid teacher ID'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment').isLength({ min: 3, max: 1000 }).withMessage('Comment must be 3-1000 characters'),
    body('user_name').optional().isLength({ max: 100 }).withMessage('Name too long')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    
    try {
        const { teacher_id, rating, comment, user_name } = req.body;
        
        // Sanitize inputs
        const sanitizedComment = validator.escape(comment.trim());
        const sanitizedName = user_name ? validator.escape(user_name.trim()) : 'Anonymous';
        
        const [teachers] = await db.query(
            'SELECT id FROM teachers WHERE id = ?',
            [teacher_id]
        );
        
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        
        const [result] = await db.query(
            `INSERT INTO reviews (teacher_id, rating, comment, user_name, is_approved) 
             VALUES (?, ?, ?, ?, 1)`,
            [teacher_id, rating, sanitizedComment, sanitizedName]
        );
        
        res.json({
            success: true,
            review_id: result.insertId,
            message: 'Review submitted successfully!'
        });
    } catch (error) {
        console.error('Error saving review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== ADMIN API ENDPOINTS ==========

// Admin login with bcrypt and account lockout (FIXED: now uses bcrypt)
app.post('/api/admin/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const [admins] = await db.query(
            'SELECT * FROM admins WHERE username = ?',
            [username]
        );
        
        if (admins.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const admin = admins[0];
        
        // Check if account is locked
        if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
            return res.status(401).json({ error: 'Account locked. Try again later.' });
        }
        
        // ** FIXED: use bcrypt.compare **
        const isValid = await bcrypt.compare(password, admin.password);
        
        if (!isValid) {
            const failedAttempts = (admin.failed_attempts || 0) + 1;
            let lockedUntil = null;
            
            if (failedAttempts >= 5) {
                lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            }
            
            await db.query(
                'UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?',
                [failedAttempts, lockedUntil, admin.id]
            );
            
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Reset failed attempts on successful login
        await db.query(
            'UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = ?',
            [admin.id]
        );
        
        const token = jwt.sign(
            { id: admin.id, username: admin.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        await createAuditLog(admin.id, 'LOGIN', 'Admin logged in', req.ip);
        
        res.json({
            success: true,
            token,
            admin: { id: admin.id, username: admin.username }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login error' });
    }
});

// ========== NEW: FORGOT PASSWORD ==========
app.post('/api/admin/forgot-password', resetLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        
        const [admins] = await db.query('SELECT id, username FROM admins WHERE email = ?', [email]);
        if (admins.length === 0) {
            // Security: don't reveal if email exists
            return res.json({ success: true, message: 'If that email exists, we sent a reset link.' });
        }
        
        const admin = admins[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        
        await db.query(
            'UPDATE admins SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
            [resetToken, tokenExpiry, admin.id]
        );
        
        const resetLink = `http://localhost:3000/reset-password?token=${resetToken}`;
        await sendEmail(email, 'Password Reset Request', `<p>Click <a href="${resetLink}">here</a> to reset your password. Link expires in 1 hour.</p>`);
        
        res.json({ success: true, message: 'Reset link sent to email.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== NEW: RESET PASSWORD ==========
app.post('/api/admin/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Token and new password (min 6 chars) required' });
        }
        
        const [admins] = await db.query(
            'SELECT id FROM admins WHERE reset_token = ? AND reset_token_expires > NOW()',
            [token]
        );
        if (admins.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        await db.query(
            'UPDATE admins SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
            [hashedPassword, admins[0].id]
        );
        
        res.json({ success: true, message: 'Password reset successfully. You can now login.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== NEW: SETUP ENDPOINT (create admin with hashed password) ==========
app.post('/api/admin/setup', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        if (!username || !password || !email) {
            return res.status(400).json({ error: 'Username, password, and email required' });
        }
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        // Delete existing admin with same username
        await db.query('DELETE FROM admins WHERE username = ?', [username]);
        await db.query(
            'INSERT INTO admins (username, password, email) VALUES (?, ?, ?)',
            [username, hashedPassword, email]
        );
        res.json({ success: true, message: 'Admin created. Use new credentials to login.' });
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add teacher (unchanged)
app.post('/api/admin/teachers', verifyAdmin, [
    body('name').isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('department').isLength({ min: 2, max: 100 }).withMessage('Department must be 2-100 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    
    try {
        const { name, department } = req.body;
        const sanitizedName = validator.escape(name.trim());
        const sanitizedDept = validator.escape(department.trim());
        
        const [result] = await db.query(
            'INSERT INTO teachers (name, department) VALUES (?, ?)',
            [sanitizedName, sanitizedDept]
        );
        
        await createAuditLog(req.admin.id, 'ADD_TEACHER', `Added teacher: ${sanitizedName}`, req.ip);
        
        res.json({
            success: true,
            id: result.insertId,
            message: 'Teacher added successfully'
        });
    } catch (error) {
        console.error('Error adding teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete teacher (unchanged)
app.delete('/api/admin/teachers/:id', verifyAdmin, async (req, res) => {
    try {
        const teacherId = req.params.id;
        
        const [teachers] = await db.query('SELECT name FROM teachers WHERE id = ?', [teacherId]);
        
        const [result] = await db.query('DELETE FROM teachers WHERE id = ?', [teacherId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        
        await createAuditLog(req.admin.id, 'DELETE_TEACHER', `Deleted teacher: ${teachers[0]?.name || teacherId}`, req.ip);
        
        res.json({ success: true, message: 'Teacher deleted successfully' });
    } catch (error) {
        console.error('Error deleting teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all reviews for admin (unchanged)
app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
    try {
        const [reviews] = await db.query(`
            SELECT r.*, t.name as teacher_name 
            FROM reviews r
            JOIN teachers t ON r.teacher_id = t.id
            ORDER BY r.created_at DESC
        `);
        res.json(reviews);
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete review (unchanged)
app.delete('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
    try {
        const reviewId = req.params.id;
        
        const [result] = await db.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Review not found' });
        }
        
        await createAuditLog(req.admin.id, 'DELETE_REVIEW', `Deleted review ID: ${reviewId}`, req.ip);
        
        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (error) {
        console.error('Error deleting review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get statistics (unchanged)
app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
    try {
        const [teacherCount] = await db.query('SELECT COUNT(*) as count FROM teachers');
        const [reviewCount] = await db.query('SELECT COUNT(*) as count FROM reviews');
        const [avgRating] = await db.query('SELECT AVG(rating) as avg FROM reviews WHERE is_approved = 1');
        const [recentReviews] = await db.query(`
            SELECT COUNT(*) as count FROM reviews 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);
        
        res.json({
            total_teachers: teacherCount[0].count,
            total_reviews: reviewCount[0].count,
            average_rating: avgRating[0].avg || 0,
            reviews_last_week: recentReviews[0].count
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Health check (unchanged)
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/db-test', async (req, res) => {
    try {
        const [result] = await db.query('SELECT 1 as test');
        res.json({ status: 'Connected to DB', result });
    } catch (error) {
        res.status(500).json({ status: 'DB connection failed', error: error.message });
    }
});
// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints ready at http://localhost:${PORT}/api`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health\n`);
});