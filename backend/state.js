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
    // chat_usage_daily and chat_feedback tables exist.
    chatUsageReady: false,
    // review_replies table exists.
    reviewRepliesReady: false,
    // review_votes table and reviews.helpful_count exist.
    reviewVotesReady: false,
    // teacher_summaries table exists.
    teacherSummariesReady: false,
    // error_logs table exists.
    errorLogsReady: false,
    // site_visits_daily, teacher_views_daily and search_terms_daily exist.
    analyticsReady: false,
    // retroactive review filter sweep has run.
    reviewSweepDone: false,
    // retroactive Q&A filter sweep has run.
    qaSweepDone: false
};
