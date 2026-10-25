// Zero-result search log (content-gap signals).

const db = require('../db');
const { logJson } = require('./log');

// ========== ZERO-RESULT SEARCH LOG ==========
// Students searching for a teacher who is not in the directory are telling us
// who to add next. Only zero-result queries are stored (they carry content
// information); successful searches are never logged, so the table is not a
// record of what anyone looked up. Retention below keeps it small.
const SEARCH_GAP_RETENTION_DAYS = 30;

const pruneSearchGaps = async () => {
    try {
        const cutoff = new Date(Date.now() - SEARCH_GAP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const [result] = await db.query('DELETE FROM search_gaps WHERE created_at < ?', [cutoff]);
        if (result.affectedRows > 0) {
            logJson('info', 'search_gaps_pruned', { deleted: result.affectedRows });
        }
    } catch (error) {
        console.error('Search gap prune error:', error.message);
    }
};

const recordSearchGap = (rawTerm) => {
    const term = String(rawTerm || '').trim().slice(0, 200);
    if (!term) return;
    db.query('INSERT INTO search_gaps (query) VALUES (?)', [term])
        .then(() => {
            logJson('info', 'search_zero_results', { query: term });
        })
        .catch((error) => {
            // Table may not exist yet on a cold deploy; never fail a search.
            console.error('Search gap log error:', error.message);
        });
};

module.exports = {
    SEARCH_GAP_RETENTION_DAYS,
    pruneSearchGaps,
    recordSearchGap
};
