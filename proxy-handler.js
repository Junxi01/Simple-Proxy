const fs = require('fs');
const path = require('path');
const httpProxy = require('http-proxy');

const MAX_LOG_ENTRIES = 100;
const logs = [];

function getLogs() {
  return logs;
}

function addLog(entry) {
  logs.unshift(entry);
  if (logs.length > MAX_LOG_ENTRIES) {
    logs.length = MAX_LOG_ENTRIES;
  }
}

function findMatchingRule(url, rules) {
  for (const rule of rules) {
    if (rule.match && rule.match.test(url)) {
      return rule;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create the main proxy request handler.
 * Returns a function (req, res) suitable for http.createServer.
 */
function createProxyHandler(rules) {
  const proxy = httpProxy.createProxyServer({
    secure: false,
    selfHandleResponse: true,
  });

  // Reassemble the proxied response, apply modifyResponse if matched, then send to client.
  proxy.on('proxyRes', (proxyRes, req, res) => {
    const chunks = [];

    proxyRes.on('data', (chunk) => chunks.push(chunk));

    proxyRes.on('end', () => {
      const statusCode = proxyRes.statusCode;
      let body = Buffer.concat(chunks);

      const rule = req.__matchedRule;

      // Apply response body modification (HTTP plain-text only)
      if (rule && typeof rule.modifyResponse === 'function') {
        let bodyStr = body.toString('utf-8');
        bodyStr = rule.modifyResponse(bodyStr, proxyRes);
        body = Buffer.from(bodyStr, 'utf-8');
      }

      // Copy original response headers, then fix content-length
      const headers = Object.assign({}, proxyRes.headers);
      delete headers['content-length'];
      headers['content-length'] = body.length;
      // Remove transfer-encoding chunked since we're sending a complete buffer
      delete headers['transfer-encoding'];

      res.writeHead(statusCode, headers);
      res.end(body);

      // Finalize log entry
      const elapsed = Date.now() - req.__startTime;
      addLog({
        time: new Date(req.__startTime).toISOString(),
        method: req.method,
        url: req.url,
        statusCode,
        elapsed: `${elapsed}ms`,
      });
    });
  });

  proxy.on('error', (err, req, res) => {
    const elapsed = Date.now() - (req.__startTime || Date.now());
    addLog({
      time: new Date().toISOString(),
      method: req.method,
      url: req.url,
      statusCode: 502,
      elapsed: `${elapsed}ms`,
      error: err.message,
    });

    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end(`502 Bad Gateway: ${err.message}`);
  });

  // Main request handler
  async function handler(req, res) {
    req.__startTime = Date.now();

    const rule = findMatchingRule(req.url, rules);
    req.__matchedRule = rule;

    // --- Mock file: return local JSON directly ---
    if (rule && rule.mockFile) {
      const mockPath = path.resolve(__dirname, rule.mockFile);
      try {
        const content = fs.readFileSync(mockPath, 'utf-8');
        const elapsed = Date.now() - req.__startTime;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(content),
        });
        res.end(content);
        addLog({
          time: new Date(req.__startTime).toISOString(),
          method: req.method,
          url: req.url,
          statusCode: 200,
          elapsed: `${elapsed}ms`,
          mock: true,
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Mock file error: ${err.message}`);
        addLog({
          time: new Date(req.__startTime).toISOString(),
          method: req.method,
          url: req.url,
          statusCode: 500,
          elapsed: `${Date.now() - req.__startTime}ms`,
          error: err.message,
        });
      }
      return;
    }

    // --- Modify request headers ---
    if (rule && typeof rule.modifyRequest === 'function') {
      rule.modifyRequest(req);
    }

    // --- Inject delay ---
    if (rule && rule.delay) {
      await sleep(rule.delay);
    }

    // --- Forward to target ---
    // For a plain HTTP proxy the client sends the full URL, e.g. http://example.com/path
    const target = req.url;

    try {
      proxy.web(req, res, { target, changeOrigin: true });
    } catch (err) {
      const elapsed = Date.now() - req.__startTime;
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Proxy error: ${err.message}`);
      addLog({
        time: new Date(req.__startTime).toISOString(),
        method: req.method,
        url: req.url,
        statusCode: 502,
        elapsed: `${elapsed}ms`,
        error: err.message,
      });
    }
  }

  return handler;
}

module.exports = { createProxyHandler, getLogs };
