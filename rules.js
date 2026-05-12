module.exports = [
  // Add a custom header to all /api/users requests
  {
    match: /\/api\/users/,
    modifyRequest: (req) => {
      req.headers['x-custom-token'] = 'dev-token';
      return req;
    }
  },
  // Replace text in the response body for /api/posts
  {
    match: /\/api\/posts/,
    modifyResponse: (body, res) => {
      return body.replace(/real title/g, 'mocked title');
    }
  },
  // Inject a 3-second delay for /api/slow
  {
    match: /\/api\/slow/,
    delay: 3000
  },
  // Return a local mock JSON file for /api/profile
  {
    match: /\/api\/profile/,
    mockFile: './mocks/profile.json'
  }
];
