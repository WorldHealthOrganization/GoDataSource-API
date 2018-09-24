'use strict';

const templateParser = require('./../../components/templateParser');

module.exports = function (Template) {
  // set flag to not get controller
  Template.hasController = false;


  Template.referenceDataFieldsToCategoryMap = {
    disease: 'LNG_REFERENCE_DATA_CATEGORY_DISEASE'
  };

  Template.referenceDataFields = Object.keys(Template.referenceDataFieldsToCategoryMap);

  /**
   * On create/update parse questions/answers
   */
  Template.observe('before save', function (context, next) {
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    // parse template
    templateParser.beforeHook(context, next);
  });

  /**
   * On create/update save questions/answers tokens
   */
  Template.observe('after save', function (context, next) {
    // after successfully creating template, also create translations for it.
    templateParser.afterHook(context, next);
  });
};
