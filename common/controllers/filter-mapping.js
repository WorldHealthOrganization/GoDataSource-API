'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (FilterMapping) {

  // disable unneeded methods
  app.utils.remote.disableRemoteMethods(FilterMapping, [
    'prototype.__get__owner'
  ]);

  /**
   * Set user ( owner ) ID
   */
  FilterMapping.beforeRemote('create', function (context, modelInstance, next) {
    // set owner
    context.args.data.userId = context.req.authData.user.id;

    // finished - continue with creation process
    next();
  });

  /**
   * Retrieve only records that belong to the current user or they are public
   */
  FilterMapping.beforeRemote('find', function (context, modelInstance, next) {
    // filter out records that you don't have access to
    if (
      context.req.authData.user.permissionsList.indexOf('system_settings_modify_saved_filters') < 0 &&
      context.req.authData.user.permissionsList.indexOf(app.models.role.permissionGroupMap['system_settings_modify_saved_filters'].groupAllId) < 0
    ) {
      context.args.filter = FilterMapping.helpers.retrieveOnlyAllowedRecords(
        context.req.authData.user.id,
        context.args.filter
      );
    }

    // finished - continue
    next();
  });

  /**
   * Count only records that belong to the current user or they are public
   */
  FilterMapping.beforeRemote('count', function (context, modelInstance, next) {
    // filter out records that you don't have access to
    if (
      context.req.authData.user.permissionsList.indexOf('system_settings_modify_saved_filters') < 0 &&
      context.req.authData.user.permissionsList.indexOf(app.models.role.permissionGroupMap['system_settings_modify_saved_filters'].groupAllId) < 0
    ) {
      context.args.where = FilterMapping.helpers.retrieveOnlyAllowedRecords(
        context.req.authData.user.id,
        {where: _.get(context, 'args.where', {})}
      ).where;
    }

    // finished - continue
    next();
  });

  /**
   * Go through all records and attach the custom properties
   */
  FilterMapping.afterRemote('find', function (context, modelInstances, next) {
    // go through all records and attach the custom properties
    modelInstances.forEach((filterMappingModel) => {
      FilterMapping.helpers.attachCustomProperties(
        context.req.authData.user.id,
        filterMappingModel
      );
    });

    // finished - continue
    next();
  });

  /**
   * Attach the custom properties
   */
  FilterMapping.afterRemote('findById', function (context, modelInstance, next) {
    // attach the custom properties
    FilterMapping.helpers.attachCustomProperties(
      context.req.authData.user.id,
      modelInstance
    );

    // finished - continue
    next();
  });

  /**
   * Attach the custom properties
   */
  FilterMapping.afterRemote('create', function (context, modelInstance, next) {
    // attach the custom properties
    FilterMapping.helpers.attachCustomProperties(
      context.req.authData.user.id,
      modelInstance
    );

    // finished - continue
    next();
  });

  /**
   * Attach the custom properties
   */
  FilterMapping.afterRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // attach the custom properties
    FilterMapping.helpers.attachCustomProperties(
      context.req.authData.user.id,
      modelInstance
    );

    // finished - continue
    next();
  });

  /**
   * Make sure we are authorized to change data for this record
   */
  FilterMapping.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // are we allowed to change this one ?
    if (
      FilterMapping.helpers.isReadOnly(context.req.authData.user.id, context.instance) &&
      context.req.authData.user.permissionsList.indexOf('system_settings_modify_saved_filters') < 0 &&
      context.req.authData.user.permissionsList.indexOf(app.models.role.permissionGroupMap['system_settings_modify_saved_filters'].groupAllId) < 0
    ) {
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
  FilterMapping.beforeRemote('deleteById', function (context, modelInstance, next) {
    // retrieve record that we wan't to delete
    FilterMapping
      .findById(context.args.id)
      .then((filterMapping) => {
        // are we allowed to delete this one ?
        if (
          FilterMapping.helpers.isReadOnly(context.req.authData.user.id, filterMapping) &&
          context.req.authData.user.permissionsList.indexOf('system_settings_delete_saved_filters') < 0 &&
          context.req.authData.user.permissionsList.indexOf(app.models.role.permissionGroupMap['system_settings_delete_saved_filters'].groupAllId) < 0
        ) {
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
