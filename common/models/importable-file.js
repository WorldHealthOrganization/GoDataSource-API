'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

module.exports = function (ImportableFile) {

  // set flag to force using the controller
  ImportableFile.hasController = true;
};
