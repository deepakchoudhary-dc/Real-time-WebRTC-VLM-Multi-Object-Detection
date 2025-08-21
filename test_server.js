const express = require('express');
const app = express();
const PORT = 3000;

app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Simple test server working' });
});

app.get('/phone', (req, res) => {
    res.send(`
        <html>
        <head><title>Test Phone Page</title></head>
        <body>
            <h1>Test Phone Page Working!</h1>
            <p>If you can see this, the server is accessible from your phone.</p>
            <p>IP Address: ${req.ip}</p>
            <p>Host: ${req.get('host')}</p>
        </body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Test server running on port ${PORT}`);
    console.log(`📱 Phone URL: http://localhost:${PORT}/phone`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
});

// Keep the process alive
process.on('SIGINT', () => {
    console.log('Server shutting down...');
    process.exit(0);
});
