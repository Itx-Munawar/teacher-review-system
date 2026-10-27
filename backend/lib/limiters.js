// Per-IP rate limiters.

const rateLimit = require('express-rate-limit');

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

const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Too many search requests. Please try again later.' }
});

const resetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { error: 'Too many reset requests. Try again in an hour.' }
});

const questionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many questions. Please try again later.' }
});

// Replies to reviews: every one is moderated, so keep the per-IP budget modest.
const replyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: 'Too many replies. Please try again later.' }
});

// Admin account creation must not be reachable by a scanner. One attempt per
// hour per IP is plenty for a legitimate first-run setup.
const setupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many setup attempts. Try again later.' }
});

// Consuming a reset token is bounded separately from requesting one, so a
// mistyped link does not burn the forgot-password budget while token guessing
// still stays expensive.
const resetUseLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reset attempts. Try again later.' }
});

// Helpful votes are cheap and toggleable; generous but bounded per IP.
const voteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 120,
    message: { error: 'Too many votes. Please try again later.' }
});

// Analytics beacons: a busy browsing session sends a few dozen at most.
const trackLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: false,
    legacyHeaders: false,
    message: { error: 'Too many events' }
});

// Browser error reports: a broken page can loop, so cap it.
const clientErrorLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: false,
    legacyHeaders: false,
    message: { error: 'Too many error reports' }
});

module.exports = {
    reviewLimiter,
    loginLimiter,
    searchLimiter,
    resetLimiter,
    questionLimiter,
    replyLimiter,
    voteLimiter,
    trackLimiter,
    clientErrorLimiter,
    setupLimiter,
    resetUseLimiter
};
