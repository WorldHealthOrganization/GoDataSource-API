'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const localizationHelper = require('../../components/localizationHelper');

module.exports = function (HelpCategory) {

  // disable bulk delete for related models
  app.utils.remote.disableRemoteMethods(HelpCategory, [
    'prototype.__delete__helpItems',
    'prototype.__updateById__helpItems'
  ]);

  /**
   * Approve a help item
   * @param itemId
   * @param options
   * @param callback
   */
  HelpCategory.prototype.approveHelpItem = function (itemId, options, callback) {
    app.models.helpItem
      .findOne({
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
          approvedDate: localizationHelper.now().toDate()
        }, options);
      })
      .then((helpItem) => {
        callback(null, helpItem);
      })
      .catch(callback);
  };

  /**
   * Search for all help categories that contain certain strings
   * @param filter Accepts "token" on the first level of "where" property. Token supports "$text: {"search": "..."}"
   * @param options
   * @param callback
   */
  HelpCategory.searchHelpCategory = function (filter, options, callback) {
    // default filter
    filter = filter || {};
    // get token query (if any)
    const tokenQuery = _.get(filter, 'where.token', {});
    // clean-up filter
    if (tokenQuery) {
      delete filter.where.token;
    }
    // Get all language tokens that match the search criteria, and are either in the user's language or the default language (english)
    app.models.languageToken
      .find(app.utils.remote.mergeFilters({where: tokenQuery}, {
        where: {
          languageId: {
            inq: ['english_us', options.remotingContext.req.authData.user.languageId]
          }
        }
      }))
      .then((results) => {
        // Get all Help Categories referenced by the language tokens that have passed the search criteria
        let tokens = results.map((languageToken) => languageToken.token);
        app.models.helpCategory
          .find(app.utils.remote.mergeFilters({
            where: {
              or: [
                {
                  name: {
                    inq: tokens
                  }
                },
                {
                  description: {
                    inq: tokens
                  }
                }
              ],
            }
          }, filter))
          .then((result) => callback(null, result))
          .catch(callback);
      });
  };

  /**
   * Search for all help categories that contain certain strings
   * @param filter Accepts "token" on the first level of "where" property. Token supports "$text: {"search": "..."}"
   * @param options
   * @param callback
   */
  HelpCategory.searchHelpItem = function (filter, options, callback) {
    // default filter
    filter = filter || {};
    // get token query (if any)
    const tokenQuery = _.get(filter, 'where.token', {});
    // clean-up filter
    if (tokenQuery) {
      delete filter.where.token;
    }
    // Get all language tokens that match the search criteria, and are either in the user's language or the default language (english)
    app.models.languageToken
      .find(app.utils.remote.mergeFilters({where: tokenQuery}, {
        where: {
          languageId: {
            inq: ['english_us', options.remotingContext.req.authData.user.languageId]
          }
        }
      }))
      .then((results) => {
        // attach default order for categories & help items
        if (
          !filter ||
          _.isEmpty(filter.order)
        ) {
          filter = filter || {};
          filter.order = [
            ...(app.models.helpCategory.defaultOrder || []).map((order) => `category.${order}`),
            ...app.models.helpItem.defaultOrder
          ];
        }

        // Get all Help Categories referenced by the language tokens that have passed the search criteria
        let tokens = results.map((languageToken) => languageToken.token);
        app.models.helpItem
          .findAggregate(app.utils.remote.mergeFilters({
            where: {
              or: [
                {
                  title: {
                    inq: tokens
                  }
                },
                {
                  content: {
                    inq: tokens
                  }
                }
              ],
            }
          }, filter))
          .then((data) => callback(null, data))
          .catch(callback);
      });
  };

  /**
   * Attach before remote (GET help categories ) hooks
   */
  HelpCategory.beforeRemote('find', function (context, modelInstance, next) {
    // attach default order for categories
    if (
      !context.args.filter ||
      _.isEmpty(context.args.filter.order)
    ) {
      context.args.filter = context.args.filter || {};
      context.args.filter.order = app.models.helpCategory.defaultOrder;
    }

    // continue
    next();
  });

  /**
   * Attach before remote (GET help items ) hooks
   */
  HelpCategory.beforeRemote('prototype.__get__helpItems', function (context, modelInstance, next) {
    // attach default order for categories
    if (
      !context.args.filter ||
      _.isEmpty(context.args.filter.order)
    ) {
      context.args.filter = context.args.filter || {};
      context.args.filter.order = app.models.helpCategory.defaultOrder;
    }

    // continue
    next();
  });

  HelpCategory.prototype.updateHelpItem = function (itemId, data, options, callback) {
    app.models.helpItem.updateHelpItem(itemId, data, options, callback);
  };
};
