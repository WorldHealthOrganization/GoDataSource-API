'use strict';

const templateParser = require('./../../components/templateParser');

module.exports = function (Template) {
  /**
   * Before create hook
   */
  Template.beforeRemote('create', function (context, modelInstance, next) {
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    // parse template
    templateParser.beforeHook(context, modelInstance, next);
  });

  /**
   * After create hook
   */
  Template.afterRemote('create', function (context, modelInstance, next) {
    // after successfully creating template, also create translations for it.
    templateParser.afterHook(context, modelInstance, next);
  });

  /**
   * Before update hook
   */
  Template.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    // parse template
    templateParser.beforeHook(context, modelInstance, next);
  });

  /**
   * After update hook
   */
  Template.afterRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // after successfully creating template, also create translations for it.
    templateParser.afterHook(context, modelInstance, next);
  });
};
