const http = require('http');
const net = require('net');
const express = require('express');
const path = require('path');
const rules = require('./rules');
const { createProxyHandler, getLogs } = require('./proxy-handler');

const PROXY_PORT = 8888;
const UI_PORT = 8080;

// ─── Web UI Server (Express, port 8080) ───────────────────────────────────────

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/logs', (_req, res) => {
  res.json(getLogs());
});

app.get('/api/rules', (_req, res) => {
  // Serialize rules for display: regex -> string, functions -> signature hint
  const simplified = rules.map((r, i) => ({
    index: i,
    match: r.match ? r.match.toString() : null,
    modifyRequest: typeof r.modifyRequest === 'function' ? true : false,
    modifyResponse: typeof r.modifyResponse === 'function' ? true : false,
    delay: r.delay || null,
    mockFile: r.mockFile || null,
  }));
  res.json(simplified);
});

app.listen(UI_PORT, () => {
  console.log(`Web UI on http://localhost:${UI_PORT}`);
});

// ─── HTTP Proxy Server (port 8888) ────────────────────────────────────────────

const proxyHandler = createProxyHandler(rules);

const proxyServer = http.createServer(proxyHandler);

// HTTPS CONNECT tunnel – transparently pipe encrypted traffic without decryption
proxyServer.on('connect', (req, clientSocket, head) => {
  const [hostname, port] = req.url.split(':');
  const targetPort = parseInt(port, 10) || 443;

  const serverSocket = net.connect(targetPort, hostname, () => {
    clientSocket.write(
      'HTTP/1.1 200 Connection Established\r\n' +
      'Proxy-Agent: SimpleProxy\r\n' +
      '\r\n'
    );
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error(`CONNECT tunnel error to ${req.url}: ${err.message}`);
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });

  clientSocket.on('error', (err) => {
    console.error(`CONNECT client socket error: ${err.message}`);
    serverSocket.destroy();
  });
});

proxyServer.listen(PROXY_PORT, () => {
  console.log(`Proxy server running on http://localhost:${PROXY_PORT}`);
});
