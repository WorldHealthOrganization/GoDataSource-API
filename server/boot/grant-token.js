
module.exports = function grantToken(server) {
  server.post('/api/oauth/token', (req, res, next) => {
    req.body = req.body || {};
    const username = req.body.username;
    const pw = req.body.password;

    if (!username) { return next(new Error('Missing required parameter: username', 'invalid_request')); }
    if (!pw) { return next(new Error('Missing required parameter: password', 'invalid_request')); }

    server.models.user.login({
      email: username,
      password: pw
    }, (err, token) => {
      if (err) {
        return next(err);
      }

      return res.send({
        token_type: 'bearer',
        expires_in: token.ttl,
        access_token: token.id
      });
    });
  });
};
