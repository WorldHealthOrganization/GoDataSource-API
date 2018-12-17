'use strict';

const path = require('path');
const disableRemoteMethods = require('../../components/disableRemoteMethods');
const disableStandardRelationRemoteMethods = require('../../components/disableStandardRelationRemoteMethods');
const disableCommonExtraRoutes = require('../../components/disableCommonExtraRoutes');
const searchByRelationProperty = require('../../components/searchByRelationProperty');
const mergeFilters = require('../../components/mergeFilters');
const convertLoopbackFilterToMongo = require('../../components/convertLoopbackFilterToMongo');
const apiError = require('../../components/apiError');
const anonymizeDatasetFields = require('../../components/anonymizeDatasetFields');
const maskField = require('../../components/maskField');
const qrCode = require('../../components/qrCode');
const helpers = require('../../components/helpers');
const remoteHelpers = require('../../components/remoteHelpers');
const pdfDoc = require('../../components/pdfDoc');
const spreadSheetFile = require('../../components/spreadSheetFile');
const dbSync = require('../../components/dbSync');
const pushNotificationsApi = require('../../components/services/pushNotificationsApi');
const fileCryptoSync = require('../../components/fileCrypto');
const worker = require('../../components/workerRunner');

function init(app, callback) {
  app.utils = {
    remote: {
      disableRemoteMethods: disableRemoteMethods,
      searchByRelationProperty: searchByRelationProperty,
      disableStandardRelationRemoteMethods: disableStandardRelationRemoteMethods,
      disableCommonExtraRoutes: disableCommonExtraRoutes,
      mergeFilters: mergeFilters,
      convertLoopbackFilterToMongo: convertLoopbackFilterToMongo,
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
    aesCrypto: {
      encrypt: worker.helpers.encrypt,
      decrypt: worker.helpers.decrypt
    },
    anonymizeDatasetFields: anonymizeDatasetFields,
    maskField: maskField,
    qrCode: qrCode,
    helpers: helpers,
    pdfDoc: pdfDoc,
    spreadSheetFile: spreadSheetFile,
    dbSync: dbSync,
    services: {
      pushNotificationsApi: pushNotificationsApi
    },
    fileCrypto: {
      encrypt: worker.helpers.encryptFile,
      encryptSync: fileCryptoSync.encryptSync,
      decrypt: worker.helpers.decryptFile,
      decryptSync: fileCryptoSync.decryptSync
    }
  };
  app.ROOT_PATH = path.resolve(__dirname, '../..');
  // add toJSON functionality for RegExp
  if (!RegExp.prototype.toJSON) {
    RegExp.prototype.toJSON = RegExp.prototype.toString;
  }
  callback();
}

module.exports = init;
