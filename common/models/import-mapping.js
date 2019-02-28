'use strict';

const app = require('../../server/server');

module.exports = function (ImportMapping) {
  // set flag to get controller
  ImportMapping.hasController = true;

  // initialize model helpers
  ImportMapping.helpers = {};

  /**
   * Filter out records that you don't have access to
   * @param userId Authenticated User
   * @param filter Filter
   * @returns {*}
   */
  ImportMapping.helpers.retrieveOnlyAllowedRecords = (userId, filter) => {
    // filter out records that you don't have access to
    return app.utils.remote
      .mergeFilters({
        where: {
          or: [{
            userId: userId
          }, {
            isPublic: true
          }]
        }
      }, filter);
  };

  /**
   * Check if an import mapping record is read-only
   * @param userId Authenticated User
   * @param importMappingModel Record to be checked if read-only
   * @returns {boolean} true if readonly, False otherwise
   */
  ImportMapping.helpers.isReadOnly = (userId, importMappingModel) => {
    return importMappingModel.userId !== userId;
  };

  /**
   * Attach custom properties on a model that we don't want to save in the database before sending data back to client
   * @param userId Authenticated User
   * @param importMappingModel Record to be checked if read-only
   */
  ImportMapping.helpers.attachCustomProperties = (userId, importMappingModel) => {
    // readonly ?
    importMappingModel.readOnly = ImportMapping.helpers.isReadOnly(userId, importMappingModel);
  };
};
