'use strict';

const app = require('../../server/server');

module.exports = function (FilterMapping) {
  // set flag to get controller
  FilterMapping.hasController = true;

  // initialize model helpers
  FilterMapping.helpers = {};

  /**
   * Filter out records that you don't have access to
   * @param userId Authenticated User
   * @param filter Filter
   * @returns {*}
   */
  FilterMapping.helpers.retrieveOnlyAllowedRecords = (userId, filter) => {
    // filter out records that you don't have access to
    return app.utils.remote
      .mergeFilters({
        where: {
          or: [{
            userId: userId
          }, {
            public: true
          }]
        }
      }, filter);
  };

  /**
   * Check if a filter mapping record is read-only
   * @param userId Authenticated User
   * @param filterMappingModel Record to be checked if read-only
   * @returns {boolean} true if readonly, False otherwise
   */
  FilterMapping.helpers.isReadOnly = (userId, filterMappingModel) => {
    return filterMappingModel.userId !== userId;
  };

  /**
   * Attach custom properties on a model that we don't want to save in the database before sending data back to client
   * @param userId Authenticated User
   * @param filterMappingModel Record to be checked if read-only
   */
  FilterMapping.helpers.attachCustomProperties = (userId, filterMappingModel) => {
    // readonly ?
    filterMappingModel.readOnly = FilterMapping.helpers.isReadOnly(userId, filterMappingModel);
  };
};
