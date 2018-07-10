'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (HelpCategory) {

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
   * Before Create Help Category Hook
   */
  HelpCategory.beforeRemote('create', function (context, modelInstance, next) {
    HelpCategory.beforeCreateHook(app.models.helpCategory.modelName, 'name', context, modelInstance, next);
  });

  /**
   * After Create Help Category Hook
   */
  HelpCategory.afterRemote('create', function (context, modelInstance, next) {
    HelpCategory.afterCreateHook(app.models.helpCategory.modelName, 'name', context, modelInstance, next);
  });

  /**
   * Before Create Help Item Hook
   */
  HelpCategory.beforeRemote('prototype.__create__helpItems', function (context, modelInstance, next) {
    HelpCategory.beforeCreateHook(app.models.helpItem.modelName, 'title', context, modelInstance, next);
  });

  /**
   * After Create Help Item Hook
   */
  HelpCategory.afterRemote('prototype.__create__helpItems', function (context, modelInstance, next) {
    HelpCategory.afterCreateHook(app.models.helpItem.modelName, 'title', context, modelInstance, next);
  });

  /**
   * Before Update Help Category Hook
   */
  HelpCategory.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    HelpCategory.beforeUpdateHook(app.models.helpCategory.modelName, 'name', context, modelInstance, next);
  });

  /**
   * After Update Help Category Hook
   */
  HelpCategory.afterRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    HelpCategory.afterUpdateHook(app.models.helpCategory.modelName, 'name', context, modelInstance, next);
  });

  /**
   * Before Update Help Item Hook
   */
  HelpCategory.beforeRemote('prototype.__updateById__helpItems', function(context, modelInstance, next) {
    HelpCategory.beforeUpdateHook(app.models.helpItem.modelName, 'title', context, modelInstance, next);
  });

  /**
   * After Update Help Item Hook
   */
  HelpCategory.afterRemote('prototype.__updateById__helpItems', function (context, modelInstance, next) {
    HelpCategory.afterUpdateHook(app.models.helpItem.modelName, 'title', context, modelInstance, next);
  });
};
