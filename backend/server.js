require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 10;

// Security Middleware
app.use(helmet());
app.use(cors({
    origin: ['https://teacher-review-system-zeta.vercel.app', 'http://localhost:3000'],
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

// Email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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
    if (!token) return res.status(401).json({ error: 'No token provided' });
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

// GET /api/teachers - paginated list (20 per page)
app.get('/api/teachers', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        console.log(`📚 Page=${page}, Limit=${limit}, Offset=${offset}`);

        const query = `
            SELECT t.*, 
                   COALESCE(ROUND(AVG(r.rating), 1), 0) as avg_rating,
                   COUNT(r.id) as review_count
            FROM teachers t
            LEFT JOIN reviews r ON t.id = r.teacher_id AND r.is_approved = 1
            GROUP BY t.id
            ORDER BY t.name
            LIMIT ${limit} OFFSET ${offset}
        `;
        
        const [teachers] = await db.query(query);
        console.log(`✅ Returned ${teachers.length} teachers`);

        const [countResult] = await db.query('SELECT COUNT(*) as total FROM teachers');
        const total = countResult[0].total;

        res.json({
            teachers: teachers,
            pagination: {
                page: page,
                limit: limit,
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/teachers/search - search all teachers (no pagination)
app.get('/api/teachers/search', async (req, res) => {
    try {
        const searchTerm = req.query.q;
        if (!searchTerm || searchTerm.trim() === '') {
            return res.json([]);
        }
        
        const [teachers] = await db.query(`
            SELECT t.*, 
                   COALESCE(ROUND(AVG(r.rating), 1), 0) as avg_rating,
                   COUNT(r.id) as review_count
            FROM teachers t
            LEFT JOIN reviews r ON t.id = r.teacher_id AND r.is_approved = 1
            WHERE t.name LIKE ? OR t.department LIKE ?
            GROUP BY t.id
            ORDER BY t.name
        `, [`%${searchTerm}%`, `%${searchTerm}%`]);
        
        res.json(teachers);
    } catch (error) {
        console.error('Error searching teachers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== NEW: GET SINGLE TEACHER WITH REVIEWS ==========
app.get('/api/teachers/:id', async (req, res) => {
    try {
        const teacherId = req.params.id;

        // Get teacher
        const [teachers] = await db.query(
            'SELECT * FROM teachers WHERE id = ?',
            [teacherId]
        );
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Get approved reviews for this teacher
        const [reviews] = await db.query(
            `SELECT * FROM reviews 
             WHERE teacher_id = ? AND is_approved = 1 
             ORDER BY created_at DESC`,
            [teacherId]
        );

        // Get average rating and total review count
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

// POST /api/reviews - submit a new review
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
        const sanitizedComment = validator.escape(comment.trim());
        const sanitizedName = user_name ? validator.escape(user_name.trim()) : 'Anonymous';
        
        const [teachers] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacher_id]);
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

app.post('/api/admin/login', loginLimiter, async (req, res) => {
    // ... (your existing admin login code) ...
    try {
        const { username, password } = req.body;
        const [admins] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
        if (admins.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const admin = admins[0];
        if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
            return res.status(401).json({ error: 'Account locked. Try again later.' });
        }
        const isValid = await bcrypt.compare(password, admin.password);
        if (!isValid) {
            const failedAttempts = (admin.failed_attempts || 0) + 1;
            let lockedUntil = null;
            if (failedAttempts >= 5) lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            await db.query('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?', [failedAttempts, lockedUntil, admin.id]);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        await db.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [admin.id]);
        const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
        await createAuditLog(admin.id, 'LOGIN', 'Admin logged in', req.ip);
        res.json({ success: true, token, admin: { id: admin.id, username: admin.username } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login error' });
    }
});

app.post('/api/admin/forgot-password', resetLimiter, async (req, res) => {
    // ... (your existing forgot password code) ...
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        const [admins] = await db.query('SELECT id, username FROM admins WHERE email = ?', [email]);
        if (admins.length === 0) return res.json({ success: true, message: 'If that email exists, we sent a reset link.' });
        const admin = admins[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
        await db.query('UPDATE admins SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [resetToken, tokenExpiry, admin.id]);
        const resetLink = `http://localhost:3000/reset-password?token=${resetToken}`;
        await sendEmail(email, 'Password Reset Request', `<p>Click <a href="${resetLink}">here</a> to reset your password. Link expires in 1 hour.</p>`);
        res.json({ success: true, message: 'Reset link sent to email.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/reset-password', async (req, res) => {
    // ... (your existing reset password code) ...
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Token and new password (min 6 chars) required' });
        const [admins] = await db.query('SELECT id FROM admins WHERE reset_token = ? AND reset_token_expires > NOW()', [token]);
        if (admins.length === 0) return res.status(400).json({ error: 'Invalid or expired token' });
        const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        await db.query('UPDATE admins SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [hashedPassword, admins[0].id]);
        res.json({ success: true, message: 'Password reset successfully. You can now login.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/setup', async (req, res) => {
    // ... (your existing setup code) ...
    try {
        const { username, password, email } = req.body;
        if (!username || !password || !email) return res.status(400).json({ error: 'Username, password, and email required' });
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await db.query('DELETE FROM admins WHERE username = ?', [username]);
        await db.query('INSERT INTO admins (username, password, email) VALUES (?, ?, ?)', [username, hashedPassword, email]);
        res.json({ success: true, message: 'Admin created. Use new credentials to login.' });
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/teachers', verifyAdmin, [
    body('name').isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('department').isLength({ min: 2, max: 100 }).withMessage('Department must be 2-100 characters'),
    body('image_url').optional().isURL().withMessage('Image URL must be a valid URL')
], async (req, res) => {
    // ... (your existing add teacher code) ...
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const { name, department, image_url } = req.body;
        const sanitizedName = validator.escape(name.trim());
        const sanitizedDept = validator.escape(department.trim());
        const sanitizedImageUrl = image_url ? validator.escape(image_url.trim()) : null;
        const [result] = await db.query('INSERT INTO teachers (name, department, image_url) VALUES (?, ?, ?)', [sanitizedName, sanitizedDept, sanitizedImageUrl]);
        await createAuditLog(req.admin.id, 'ADD_TEACHER', `Added teacher: ${sanitizedName}`, req.ip);
        res.json({ success: true, id: result.insertId, message: 'Teacher added successfully' });
    } catch (error) {
        console.error('Error adding teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/admin/teachers/:id', verifyAdmin, async (req, res) => {
    // ... (your existing delete teacher code) ...
    try {
        const teacherId = req.params.id;
        const [teachers] = await db.query('SELECT name FROM teachers WHERE id = ?', [teacherId]);
        const [result] = await db.query('DELETE FROM teachers WHERE id = ?', [teacherId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Teacher not found' });
        await createAuditLog(req.admin.id, 'DELETE_TEACHER', `Deleted teacher: ${teachers[0]?.name || teacherId}`, req.ip);
        res.json({ success: true, message: 'Teacher deleted successfully' });
    } catch (error) {
        console.error('Error deleting teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== UPDATE TEACHER (admin only) ==========
app.put('/api/admin/teachers/:id', verifyAdmin, [
    body('name').isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('department').isLength({ min: 2, max: 100 }).withMessage('Department must be 2-100 characters'),
    body('image_url').optional().isURL().withMessage('Image URL must be a valid URL')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const teacherId = req.params.id;
        const { name, department, image_url } = req.body;
        const sanitizedName = validator.escape(name.trim());
        const sanitizedDept = validator.escape(department.trim());
        const sanitizedImageUrl = image_url ? validator.escape(image_url.trim()) : null;

        // Check if teacher exists
        const [existing] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacherId]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        await db.query(
            'UPDATE teachers SET name = ?, department = ?, image_url = ? WHERE id = ?',
            [sanitizedName, sanitizedDept, sanitizedImageUrl, teacherId]
        );

        await createAuditLog(req.admin.id, 'UPDATE_TEACHER', `Updated teacher: ${sanitizedName} (ID: ${teacherId})`, req.ip);

        res.json({
            success: true,
            message: 'Teacher updated successfully'
        });
    } catch (error) {
        console.error('Error updating teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
    // ... (your existing get admin reviews code) ...
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

app.delete('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
    // ... (your existing delete review code) ...
    try {
        const reviewId = req.params.id;
        const [result] = await db.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
        await createAuditLog(req.admin.id, 'DELETE_REVIEW', `Deleted review ID: ${reviewId}`, req.ip);
        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (error) {
        console.error('Error deleting review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
    // ... (your existing stats code) ...
    try {
        const [teacherCount] = await db.query('SELECT COUNT(*) as count FROM teachers');
        const [reviewCount] = await db.query('SELECT COUNT(*) as count FROM reviews');
        const [avgRating] = await db.query('SELECT AVG(rating) as avg FROM reviews WHERE is_approved = 1');
        const [recentReviews] = await db.query('SELECT COUNT(*) as count FROM reviews WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)');
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

// Health check
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