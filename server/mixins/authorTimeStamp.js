'use strict';

const localizationHelper = require('../../components/localizationHelper');

/**
 * Extract request form options (if available)
 * @param options
 * @returns {*}
 */
function getRequestFromOptions(options) {
  let request;

  if (options.remotingContext && options.remotingContext.req) {
    request = options.remotingContext.req;
  }

  return request;
}

/**
 * Get logged in user from options (if available)
 * Might be a client instance for sync requests
 * @param options
 * @returns {*}
 */
function getLoggedInUserFromOptions(options) {
  const request = getRequestFromOptions(options);
  let loggedInUser;

  if (request && request.authData) {
    if (request.authData.user) {
      loggedInUser = request.authData.user;
    } else if (request.authData.client) {
      loggedInUser = request.authData.client;
    }
  }

  return loggedInUser;
}

/**
 * Add createdAt, createdBy, updatedAt, updatedBy properties (and keep them up to date)
 * @param Model
 */
module.exports = function (Model) {

  /**
   * Extract user information from request
   * Might be a client for sync requests
   * @param context
   * @returns {{id: string}}
   */
  function getUserContextInformation(context) {
    let loggedInUser = getLoggedInUserFromOptions(context.options);
    return {
      id: loggedInUser ?
        loggedInUser.id :
        undefined
    };
  }

  /**
   * On sync increment updatedAt with 1 millisecond if there were "before save" changes
   * This is done in order for mobile to notice the "before save" changes
   * @param context
   */
  function incrementUpdatedAtIfNeeded(context) {
    // get target
    let target = context.instance || context.data;

    // check for "before save" changes
    if (context.options && context.options._syncActionBeforeSaveChanges) {
      // get updatedAt
      let updatedAt = localizationHelper.toMoment(target.updatedAt).toDate();

      // increment updatedAt with 1 millisecond
      updatedAt.setMilliseconds(updatedAt.getMilliseconds() + 1);
      target.updatedAt = updatedAt;

      // reset flag
      context.options._syncActionBeforeSaveChanges = false;
    }
  }

  Model.defineProperty('createdAt', {
    type: Date,
    readOnly: true,
    safeForImport: true
  });

  Model.defineProperty('createdBy', {
    type: String,
    readOnly: true,
    safeForImport: true
  });

  Model.defineProperty('updatedAt', {
    type: Date,
    readOnly: true,
    safeForImport: true
  });

  Model.defineProperty('updatedBy', {
    type: String,
    readOnly: true,
    safeForImport: true
  });

  // required to store the insert/update/restore date time of the record in the database
  Model.defineProperty('dbUpdatedAt', {
    type: Date,
    readOnly: true,
    safeForImport: true
  });

  Model.observe('before save', function (context, next) {
    // initialize system author info
    const systemAuthor = 'system';

    // normalize context options
    context.options = context.options || {};
    // get user information
    let user = getUserContextInformation(context);
    if (context.instance) {
      if (context.isNewInstance) {
        // update createdAt property if it is missing from the instance
        // or it's not an init / sync action
        if (!context.instance.createdAt || (!context.options._init && !context.options._sync)) {
          context.instance.createdAt = localizationHelper.now().toDate();
        }

        // lets keep original author if sync snapshot provides it
        if (context.options._sync) {
          if (!context.instance.createdBy) {
            context.instance.createdBy = user.id || systemAuthor;
          }
        } else {
          context.instance.createdBy = user.id ?
            user.id : (
              context.instance.createdBy ?
                context.instance.createdBy :
                systemAuthor
            );
        }
      }

      // update updatedAt property if it is missing from the instance
      // or it's not an init / sync action
      if (!context.instance.updatedAt || (!context.options._init && !context.options._sync)) {
        context.instance.updatedAt = localizationHelper.now().toDate();
      }

      // set always dbUpdatedAt as current date
      context.instance.dbUpdatedAt = localizationHelper.now().toDate();

      // increment updatedAt if needed
      incrementUpdatedAtIfNeeded(context);

      // lets keep original author if sync snapshot provides it
      if (context.options._sync) {
        if (!context.instance.updatedBy) {
          context.instance.updatedBy = user.id || systemAuthor;
        }
      } else {
        context.instance.updatedBy = user.id ?
          user.id : (
            context.instance.updatedBy ?
              context.instance.updatedBy :
              systemAuthor
          );
      }
    } else {
      // update updatedAt property if it is missing from the update payload
      // or it's not an init / sync action
      if (!context.data.updatedAt || (!context.options._init && !context.options._sync)) {
        context.data.updatedAt = localizationHelper.now().toDate();
      }

      // set always dbUpdatedAt as current date
      context.data.dbUpdatedAt = localizationHelper.now().toDate();

      // increment updatedAt if needed
      incrementUpdatedAtIfNeeded(context);

      // don't change updatedBy on sync since it might be updated by system and not by current user which in turn might cause us to loose information
      if (!context.options._sync) {
        context.data.updatedBy = user.id ?
          user.id : (
            context.data.updatedBy ?
              context.data.updatedBy :
              systemAuthor
          );
      }
    }
    return next();
  });
};
