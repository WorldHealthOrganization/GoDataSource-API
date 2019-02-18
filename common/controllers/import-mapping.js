'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (ImportMapping) {

  // disable unneeded methods
  app.utils.remote.disableRemoteMethods(ImportMapping, [
    'prototype.__get__owner'
  ]);

  // initialize model helpers
  ImportMapping.helpers = {
    /**
     * Filter out records that you don't have access to
     * @param userId Authenticated User
     * @param filter Filter
     * @returns {*}
     */
    retrieveOnlyAllowedRecords: (userId, filter) => {
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
    },

    /**
     * Check if an import mapping record is read-only
     * @param userId Authenticated User
     * @param importMappingModel Record to be checked if read-only
     * @returns {boolean} true if readonly, False otherwise
     */
    isReadOnly: (userId, importMappingModel) => {
      return importMappingModel.userId !== userId;
    },

    /**
     * Attach custom properties on a model that we don't want to save in the database before sending data back to client
     * @param userId Authenticated User
     * @param importMappingModel Record to be checked if read-only
     */
    attachCustomProperties: (userId, importMappingModel) => {
      // readonly ?
      importMappingModel.readOnly = ImportMapping.helpers.isReadOnly(userId, importMappingModel);
    }
  };

  /**
   * Set user ( owner ) ID
   */
  ImportMapping.beforeRemote('create', function (context, modelInstance, next) {
    // set owner
    context.args.data.userId = context.req.authData.user.id;

    // finished - continue with creation process
    next();
  });

  /**
   * Retrieve only records that belong to the current user or they are public
   */
  ImportMapping.beforeRemote('find', function (context, modelInstance, next) {
    // filter out records that you don't have access to
    context.args.filter = ImportMapping.helpers.retrieveOnlyAllowedRecords(
      context.req.authData.user.id,
      context.args.filter
    );

    // finished - continue
    next();
  });

  /**
   * Count only records that belong to the current user or they are public
   */
  ImportMapping.beforeRemote('count', function (context, modelInstance, next) {
    // filter out records that you don't have access to
    context.args.where = ImportMapping.helpers.retrieveOnlyAllowedRecords(
      context.req.authData.user.id,
      {where: _.get(context, 'args.where', {})}
    ).where;

    // finished - continue
    next();
  });

  /**
   * Go through all records and attach the custom properties
   */
  ImportMapping.afterRemote('find', function (context, modelInstances, next) {
    // go through all records and attach the custom properties
    modelInstances.forEach((importMappingModel) => {
      ImportMapping.helpers.attachCustomProperties(
        context.req.authData.user.id,
        importMappingModel
      );
    });

    // finished - continue
    next();
  });

  /**
   * Attach the custom properties
   */
  ImportMapping.afterRemote('findById', function (context, modelInstance, next) {
    // attach the custom properties
    ImportMapping.helpers.attachCustomProperties(
      context.req.authData.user.id,
      modelInstance
    );

    // finished - continue
    next();
  });

  /**
   * Attach the custom properties
   */
  ImportMapping.afterRemote('create', function (context, modelInstance, next) {
    // attach the custom properties
    ImportMapping.helpers.attachCustomProperties(
      context.req.authData.user.id,
      modelInstance
    );

    // finished - continue
    next();
  });

  /**
   * Attach the custom properties
   */
  ImportMapping.afterRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // attach the custom properties
    ImportMapping.helpers.attachCustomProperties(
      context.req.authData.user.id,
      modelInstance
    );

    // finished - continue
    next();
  });

  /**
   * Make sure we are authorized to change data for this record
   */
  ImportMapping.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // are we allowed to change this one ?
    if (ImportMapping.helpers.isReadOnly(context.req.authData.user.id, context.instance)) {
      // throw error
      next(app.utils.apiError.getError('ACCESS_DENIED', {
        accessErrors: 'Client is not allowed to change this record'
      }, 403));
    } else {
      // finished - continue
      next();
    }
  });

  /**
   * Make sure we are authorized to change data for this record
   */
  ImportMapping.beforeRemote('deleteById', function (context, modelInstance, next) {
    // retrieve record that we wan't to delete
    ImportMapping
      .findById(context.args.id)
      .then((importMapping) => {
        // are we allowed to delete this one ?
        if (ImportMapping.helpers.isReadOnly(context.req.authData.user.id, importMapping)) {
          // throw error
          next(app.utils.apiError.getError('ACCESS_DENIED', {
            accessErrors: 'Client is not allowed to delete this record'
          }, 403));
        } else {
          // finished - continue
          next();
        }
      });
  });
};
