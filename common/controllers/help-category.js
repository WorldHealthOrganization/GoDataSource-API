'use strict';

const app = require('../../server/server');

module.exports = function (HelpCategory) {

  // disable bulk delete for related models
  app.utils.remote.disableRemoteMethods(HelpCategory, [
    'prototype.__delete__helpItems'
  ]);

  /**
   * Approve a help item
   * @param itemId
   * @param options
   * @param callback
   */
  HelpCategory.prototype.approveHelpItem = function (itemId, options, callback) {
    app.models.helpItem.findOne({
      where: {
        categoryId: this.id,
        id: itemId
      }
    })
      .then((helpItem) => {
        if (!helpItem) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.helpItem.modelName, id: itemId});
        }

        return helpItem.updateAttributes({
          approved: true,
          approvedBy: options.accessToken.userId,
          approvedDate: Date.now()
        }, options);
      })
      .then((helpItem) => {
        callback(null, helpItem);
      })
      .catch(callback);
  };

  /**
   * Search for all help categories that contain certain strings
   * @param filter
   * @param options
   * @param callback
   */
  HelpCategory.searchHelpCategory = function (filter, options, callback) {
    // Get all language tokens that match the search criteria, and are either in the user's language or the default language (english)
    app.models.languageToken.find(app.utils.remote.mergeFilters({where: filter ? filter.where : {}}, {
      where: {
        languageId: {
          inq: ['english_us', options.remotingContext.req.authData.user.languageId]
        }
      }
    }))
      .then((results) => {
        // We delete the where block since we use it only for the language token search
        delete filter.where;
        // Get all Help Categories referenced by the language tokens that have passed the search criteria
        let helpCategoryIds = results.map((languageToken) => languageToken.token);
        app.models.helpCategory.find(app.utils.remote.mergeFilters({
          where: {
            id: {
              inq: helpCategoryIds
            }
          }
        }, filter || {}))
          .then((result) => callback(null, result))
          .catch(callback);
      });
  };

  /**
   * Search for all help categories that contain certain strings
   * @param filter
   * @param options
   * @param callback
   */
  HelpCategory.searchHelpItem = function (filter, options, callback) {
    // Get all language tokens that match the search criteria, and are either in the user's language or the default language (english)
    app.models.languageToken.find(app.utils.remote.mergeFilters({where: filter ? filter.where : {}}, {
      where: {
        languageId: {
          inq: ['english_us', options.remotingContext.req.authData.user.languageId]
        }
      }
    }))
      .then((results) => {
        // We delete the where block since we use it only for the language token search
        delete filter.where;
        // Get all Help Categories referenced by the language tokens that have passed the search criteria
        let helpItemIds = results.map((languageToken) => languageToken.token);
        app.models.helpItem.find(app.utils.remote.mergeFilters({
          where: {
            id: {
              inq: helpItemIds
            }
          }
        }, filter || {}))
          .then((result) => callback(null, result))
          .catch(callback);
      });
  };
};
