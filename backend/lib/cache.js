// Small in-memory LRU cache for public list endpoints.


// ========== IN-MEMORY CACHE ==========
const { LRUCache } = require('lru-cache');
const cache = new LRUCache({
    max: 500, // Maximum number of items in cache
    ttl: 60 * 1000, // 60 seconds
});

const getCached = (key) => {
    return cache.get(key) || null;
};

const setCache = (key, data) => {
    cache.set(key, data);
};

const invalidateCache = (pattern) => {
    for (const key of cache.keys()) {
        if (key.startsWith(pattern)) cache.delete(key);
    }
};

module.exports = {
    LRUCache,
    cache,
    getCached,
    setCache,
    invalidateCache
};
