'use strict';

const _ = require('lodash');
const templateParser = require('./../../components/templateParser');

module.exports = function (Template) {
  /**
   * Before create hook
   */
  Template.beforeRemote('create', function (context, modelInstance, next) {
    // initialize identifier
    let identifier = `LNG_TEMPLATE_${_.snakeCase(context.args.data.name).toUpperCase()}`;
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    // parse template
    templateParser.beforeCreateHook(context, modelInstance, identifier, next);
  });

  /**
   * After update hook
   */
  Template.afterRemote('create', function (context, modelInstance, next) {
    // after successfully creating template, also create translations for it.
    templateParser.afterCreateHook(context, modelInstance, next);
  });
};
