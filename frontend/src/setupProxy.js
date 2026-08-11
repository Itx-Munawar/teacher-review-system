const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
    app.use(
        '/api',
        createProxyMiddleware({
            target: 'https://teacher-review-system.onrender.com',
            changeOrigin: true,
            secure: true,
        })
    );
};
