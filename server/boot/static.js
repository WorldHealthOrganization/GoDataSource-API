'use strict';

const express = require('express');
const path = require('path');

module.exports = function(app) {
  // serve angular build
  app.use('/', express.static(`${__dirname}/../../client/dist`));
  app.on('started', function() {
    // for all routes that are not API routes (and unmapped routes) serve angular app
    app.get(/^(?!(?:\/api\/))/, function(req, res) {
      res.sendFile(path.resolve(`${__dirname}/../../client/dist/index.html`));
    });
  });
};
