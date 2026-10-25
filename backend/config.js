// Environment configuration. Validates required variables at startup
// and exits early with a clear message if anything is missing.


const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
// Cost 12 is 4x the work of 10 and still only a couple of hundred ms, which is
// what keeps a stolen hash expensive to crack. Clamped so a typo in the env
// cannot silently weaken it, and existing cost-10 hashes still verify because
// bcrypt stores the cost inside the hash itself.
const BCRYPT_ROUNDS = Math.min(15, Math.max(10, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12));
// Sliding admin session: every authenticated request moves the expiry forward,
// so 30 idle minutes ends the session server-side as well as in the UI (the
// client timer alone left a stolen cookie usable for the full JWT lifetime).
const ADMIN_SESSION_MINUTES = Math.min(24 * 60, Math.max(5, parseInt(process.env.ADMIN_SESSION_MINUTES, 10) || 30));
const ADMIN_SESSION_MS = ADMIN_SESSION_MINUTES * 60 * 1000;
// Public site origin used in sitemap.xml / robots.txt. FRONTEND_URL is already
// required at startup, so there is no reason to bake a deployment hostname in.
const PUBLIC_SITE_URL = String(process.env.FRONTEND_URL || 'https://teacher-review-system-zeta.vercel.app').replace(/\/+$/, '');

// ========== ENV VALIDATION ==========
const missingVars = [];
if (!JWT_SECRET) missingVars.push('JWT_SECRET');
if (!process.env.FRONTEND_URL) missingVars.push('FRONTEND_URL');
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) missingVars.push('DB_*');
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) missingVars.push('EMAIL_USER/EMAIL_PASS');
if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Server will not start. Fix the environment configuration and retry.');
    process.exit(1);
}

// An HS256 token is only as strong as its key. A short secret can be
// brute-forced offline from one leaked admin cookie, so require the RFC 7518
// minimum instead of starting with a key that only looks configured.
if (JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET must be at least 32 characters. Generate one with:');
    console.error('   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
}

module.exports = {
    PORT,
    JWT_SECRET,
    BCRYPT_ROUNDS,
    ADMIN_SESSION_MINUTES,
    ADMIN_SESSION_MS,
    PUBLIC_SITE_URL,
    missingVars
};
