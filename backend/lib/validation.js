// Input type and range guards shared by routes.


// Body fields arrive from the network, so never assume a type: an object or
// array handed to bcrypt or a SQL parameter is both a bug and an attack
// surface. The length caps also stop a large payload from becoming a bcrypt
// cost amplifier.
const isText = (value, maxLen) => typeof value === 'string' && value.length > 0 && value.length <= maxLen;

// Query params and route params are attacker-controlled strings. Clamp them
// before they reach LIMIT/OFFSET, where MySQL rejects a negative value with a
// 500 instead of the 400 the caller deserves.
const clampInt = (value, fallback, min, max) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

module.exports = {
    isText,
    clampInt
};
