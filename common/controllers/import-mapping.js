'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (ImportMapping) {

  // disable unneeded methods
  app.utils.remote.disableRemoteMethods(ImportMapping, [
    'prototype.__get__owner'
  ]);

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
