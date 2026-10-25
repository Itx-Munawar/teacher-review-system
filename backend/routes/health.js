// Liveness and readiness probes.

const express = require('express');
const db = require('../db');

const router = express.Router();

// Health check: process liveness only, so a platform restart loop is not
// triggered by a transient database blip.
router.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Readiness: unlike /api/health, this touches the database. Point uptime
// monitors here so "server up but DB unreachable" is visible.
router.get('/api/ready', async (req, res) => {
    try {
        await Promise.race([
            db.query('SELECT 1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
        ]);
        res.json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(503).json({ status: 'unavailable', error: 'Database check failed' });
    }
});

module.exports = router;
