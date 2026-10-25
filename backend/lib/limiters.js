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

// Reporting is cheap for a user and expensive for a moderator, so keep the
// per-IP budget tight. Duplicate reports for the same review are collapsed.
const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reports. Please try again later.' }
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

module.exports = {
    reviewLimiter,
    loginLimiter,
    searchLimiter,
    resetLimiter,
    questionLimiter,
    reportLimiter,
    setupLimiter,
    resetUseLimiter
};
