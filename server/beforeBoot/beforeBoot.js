'use strict';

const path = require('path');
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
const pdfDoc = require('../../components/pdfDoc');
const spreadSheetFile = require('../../components/spreadSheetFile');
const dbSync = require('../../components/dbSync');

function init(app, callback) {
  app.utils = {
    remote: {
      disableRemoteMethods: disableRemoteMethods,
      searchByRelationProperty: searchByRelationProperty,
      disableStandardRelationRemoteMethods: disableStandardRelationRemoteMethods,
      disableCommonExtraRoutes: disableCommonExtraRoutes,
      mergeFilters: mergeFilters,
      helpers: remoteHelpers,
      /**
       * Get user from options (context)
       * @param options
       * @return {*}
       */
      getUserFromOptions: function (options) {
        let user;
        if (options && options.remotingContext && options.remotingContext.req && options.remotingContext.req.authData) {
          user = options.remotingContext.req.authData.user;
        }
        return user;
      }
    },
    apiError: apiError,
    aesCrypto: aesCrypto,
    anonymizeDatasetFields: anonymizeDatasetFields,
    maskField: maskField,
    qrCode: qrCode,
    helpers: helpers,
    pdfDoc: pdfDoc,
    spreadSheetFile: spreadSheetFile,
    dbSync: dbSync
  };
  app.ROOT_PATH = path.resolve(__dirname, '../..');
  callback();
}

module.exports = init;
