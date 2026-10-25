// Structured JSON logging.


// ========== STRUCTURED LOGGING ==========
// One JSON object per line, so Render's log drains can be parsed and searched
// (Render's console "search" is text-only, but a downloaded log or a drain to
// a log service can filter on msg/level/status). Plain console.* stays for
// errors because stack traces read better multiline.
const logJson = (level, msg, fields = {}) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
    if (level === 'error') console.error(line);
    else console.log(line);
};

module.exports = {
    logJson
};
