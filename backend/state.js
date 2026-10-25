// Flags shared between the schema bootstrap, background jobs and routes.
// They start false so a request that arrives while the database is still
// migrating degrades gracefully instead of erroring.

module.exports = {
    // admins.token_version exists (session revocation is enforced).
    adminTokenVersionReady: false,
    // search_gaps table exists.
    searchGapsReady: false,
    // reviews.moderation_flag exists.
    reviewModerationColumnReady: false,
    // review_reports table exists.
    reviewReportsReady: false,
    // retroactive review filter sweep has run.
    reviewSweepDone: false,
    // retroactive Q&A filter sweep has run.
    qaSweepDone: false
};
