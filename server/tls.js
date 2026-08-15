'use strict';

const selfsigned = require('selfsigned');
const os = require('os');
const logger = require('./logger');

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = new Set(['127.0.0.1']);

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.address.startsWith('169.254')) {
        ips.add(net.address);
      }
    }
  }

  return Array.from(ips);
}

function getPrimaryLANIP() {
  const nets = os.networkInterfaces();
  const preferred = ['Wi-Fi', 'Ethernet', 'eth0', 'en0', 'wlan0'];

  for (const name of preferred) {
    if (nets[name]) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }

  return '127.0.0.1';
}

function generateCertificates() {
  logger.info('Generating dynamic in-memory TLS certificate with SANs...');
  const localIPs = getLocalIPs();
  
  const altNames = [
    { type: 2, value: 'localhost' }
  ];

  for (const ip of localIPs) {
    altNames.push({ type: 7, ip });
  }

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const extensions = [
    {
      name: 'basicConstraints',
      cA: true
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
      clientAuth: true
    },
    {
      name: 'subjectAltName',
      altNames
    }
  ];

  const pems = selfsigned.generate(attrs, {
    days: 30,
    keySize: 2048,
    algorithm: 'sha256',
    extensions
  });

  return {
    key: pems.private,
    cert: pems.cert,
    primaryLANIP: getPrimaryLANIP(),
    localIPs
  };
}

module.exports = {
  generateCertificates,
  getPrimaryLANIP,
  getLocalIPs
};
