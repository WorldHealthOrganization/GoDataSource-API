'use strict';

const disableRemoteMethods = require('../../components/disableRemoteMethods');
const disableStandardRelationRemoteMethods = require('../../components/disableStandardRelationRemoteMethods');
const disableCommonExtraRoutes = require('../../components/disableCommonExtraRoutes');
const searchByRelationProperty = require('../../components/searchByRelationProperty');
const mergeFilters = require('../../components/mergeFilters');
const apiError = require('../../components/apiError');
const aesCrypto = require('../../components/aesCrypto');
const anonymizeDatasetFields = require('../../components/anonymizeDatasetFields');
const maskField = require('../../components/maskField');
const qrCode = require('../../components/qrCode');
const helpers = require('../../components/helpers');
const remoteHelpers = require('../../components/remoteHelpers');

function init(app, callback) {
  app.utils = {
    remote: {
      disableRemoteMethods: disableRemoteMethods,
      searchByRelationProperty: searchByRelationProperty,
      disableStandardRelationRemoteMethods: disableStandardRelationRemoteMethods,
      disableCommonExtraRoutes: disableCommonExtraRoutes,
      mergeFilters: mergeFilters,
      helpers: remoteHelpers
    },
    apiError: apiError,
    aesCrypto: aesCrypto,
    anonymizeDatasetFields: anonymizeDatasetFields,
    maskField: maskField,
    qrCode: qrCode,
    helpers: helpers
  };
  callback();
}

module.exports = init;
