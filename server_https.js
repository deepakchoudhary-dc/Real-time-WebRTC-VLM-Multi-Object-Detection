const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const cors = require('cors');
const fs = require('fs');

const app = express();

// Create self-signed certificate for HTTPS
const sslOptions = {
  key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7J8aNqC8uH8QI
dTzP6Eh4IzK9vO+6aO+1xgE6XHDGdFzG7LGCd1dXFYzHhOwYW5S9VnGOdG7Rm8s
...simplified for demo...
-----END PRIVATE KEY-----`,
  cert: `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJALmMd7h9dHK4MA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
...simplified for demo...
-----END CERTIFICATE-----`
};

// Create simple self-signed cert inline (not for production!)
const selfSignedCert = {
  key: `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAwfKJ1QON0mJD7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x
5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY
7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J
4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J
5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2m
QzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR
8Z1J4x3QwIDAQABAoIBAQC7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQz
OY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8
Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q
7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x
5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY
7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J
4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J
5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2m
QzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR
8Z1J4x3QQAoGBAONzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J
5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2m
QzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR
8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q
AoGBAL8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J
5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2m
QzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR
8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q
AoGBAKjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR
8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q
7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x
5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY
7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J
4x3QAoGAFKjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY
7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J
4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J
5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2m
QzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR
8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q
AoGADKjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR
8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q
7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x
5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY
7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J
4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q
-----END RSA PRIVATE KEY-----`,
  cert: `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJALmMd7h9dHK4MA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMjUwODIwMDgwMDAwWhcNMjYwODIwMDgwMDAwWjBF
MQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50
ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEAwfKJ1QON0mJD7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY
7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J
4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J
5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2m
QzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR8Z1J4x3Q7s8J5b9x5k2mQzOY7KjR
8Z1J4x3QwIDAQABo1AwTjAdBgNVHQ4EFgQU6x3Q7s8J5b9x5k2mQzOY7KjR8Z1J
4x3QAfMDAfMAfMAfMAfMAfMAfMAfMAfMAfMAfMAfMAfMAfMAfMAfMAfMAfMAfM
-----END CERTIFICATE-----`
};

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const MODE = process.env.MODE || 'wasm';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Basic health endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        mode: MODE,
        timestamp: Date.now()
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/phone', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/phone.html'));
});

// Get local IP address
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    
    // Prefer mobile hotspot interfaces
    const preferredInterfaces = ['Mobile Hotspot', 'Wi-Fi', 'Ethernet', 'eth0', 'en0'];
    
    // First try preferred interfaces
    for (const preferred of preferredInterfaces) {
        if (nets[preferred]) {
            for (const net of nets[preferred]) {
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
    }
    
    // Fallback to any non-internal IPv4 address
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
                return net.address;
            }
        }
    }
    
    return '127.0.0.1';
}

// Start HTTP server for redirect
const httpServer = http.createServer((req, res) => {
    const host = req.headers.host;
    const url = `https://${host.replace(':3000', ':3443')}${req.url}`;
    res.writeHead(301, { Location: url });
    res.end();
});

// Start HTTPS server (main server)
const httpsServer = https.createServer(selfSignedCert, app);

httpServer.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`🔀 HTTP Redirect server running on port ${PORT}`);
    console.log(`🔒 Redirecting to HTTPS: https://${localIP}:${HTTPS_PORT}`);
});

httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`🚀 HTTPS Server running on port ${HTTPS_PORT}`);
    console.log(`📱 Mode: ${MODE}`);
    console.log(`🌐 Desktop: https://localhost:${HTTPS_PORT}`);
    console.log(`📱 Phone: https://${localIP}:${HTTPS_PORT}/phone`);
    console.log(`📡 Server listening on all interfaces (0.0.0.0:${HTTPS_PORT})`);
    console.log(`🔥 Local IP detected: ${localIP}`);
    console.log(`⚠️  Accept the security warning when accessing via HTTPS`);
});
