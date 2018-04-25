'use strict';

const disableRemoteMethods = require('../../components/disableRemoteMethods');
const disableStandardRelationRemoteMethods = require('../../components/disableStandardRelationRemoteMethods');
const disableCommonExtraRoutes = require('../../components/disableCommonExtraRoutes');
const mergeFilters = require('../../components/mergeFilters');
const apiError = require('../../components/apiError');
const aesCrypto = require('../../components/aesCrypto');
const anonymizeDatasetFields = require('../../components/anonymizeDatasetFields');

function init(app, callback) {
  app.utils = {
    remote: {
      disableRemoteMethods: disableRemoteMethods,
      disableStandardRelationRemoteMethods: disableStandardRelationRemoteMethods,
      disableCommonExtraRoutes: disableCommonExtraRoutes,
      mergeFilters: mergeFilters
    },
    apiError: apiError,
    aesCrypto: aesCrypto,
    anonymizeDatasetFields: anonymizeDatasetFields
  };
  callback();
}

module.exports = init;
