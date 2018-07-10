'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (HelpCategory) {
  // set flag to not get controller
  HelpCategory.hasController = true;

  /**
   * Replace the translatable fields with language tokens before saving. Save translatable fields values.
   * to create translations later
   * @param modelName
   * @param titleField
   * @param context
   * @param modelInstance
   * @param next
   */
  HelpCategory.beforeCreateHook = function (modelName, titleField, context, modelInstance, next) {
    let identifier = "LNG_" + `${_.snakeCase(modelName).toUpperCase()}_`;
    identifier += `${_.snakeCase(context.args.data[titleField]).toUpperCase()}`;

    context.req._original = {
      [titleField]: context.args.data[titleField]
    };
    context.args.data.id = identifier;
    context.args.data[titleField] = identifier;

    if(modelName === 'helpItem') {
      context.req._original.content = context.args.data.content;
      context.args.data.content = identifier + '_DESCRIPTION';
    }

    next();
  };

  /**
   * Create language token translations for each available language. Defaults to user language at the time of creation.
   * @param modelName
   * @param titleField
   * @param context
   * @param modelInstance
   * @param next
   */
  HelpCategory.afterCreateHook = function (modelName, titleField, context, modelInstance, next) {
    if (context.req._original) {
      let tokenPromises = [];
      app.models.language
        .find()
        .then(function (languages) {
          return languages.forEach((language) => {
            tokenPromises.push(app.models.languageToken
              .create({
                token: modelInstance[titleField],
                languageId: language.id,
                translation: context.req._original[titleField]
              }, context.args.options)
            );
            if(modelName === 'helpItem') {
              tokenPromises.push(app.models.languageToken
                .create({
                  token: modelInstance.content,
                  languageId: language.id,
                  translation: context.req._original.content
                }))
            }
          });
        })
        .then(function () {
          // resolve promises
          return Promise.all(tokenPromises);
        })
        .then(function () {
          next();
        })
        .catch(next);
    }
  };

  /**
   * Do not update translatable fields. Instead, save the values to be passed to the language token translation
   * @param modelName
   * @param titleField
   * @param context
   * @param modelInstance
   * @param next
   */
  HelpCategory.beforeUpdateHook = function (modelName, titleField, context, modelInstance, next) {
    if (context.args.data && (context.args.data[titleField] || context.args.data.content)) {
      let originalValues = {};
      let data = context.args.data;

      if(data[titleField]) {
        originalValues[titleField] = data[titleField];
        delete data[titleField];
      }

      if (modelName === 'helpItem' && data.content) {
        originalValues.content = data.content;
        delete data.content;
      }

      context.req._original = originalValues;
    }
    next();
  };

  /**
   * Update language token translation for the user's current selected language
   * @param modelName
   * @param titleField
   * @param context
   * @param modelInstance
   * @param next
   */
  HelpCategory.afterUpdateHook = function (modelName, titleField, context, modelInstance, next) {
    if (context.req._original) {
      let languageId = context.req.authData.user.languageId;
      let languageToken = modelInstance.id;
      let updateActions = [];

      let updateFields = [titleField];

      if (modelName === 'helpItem' && context.req._original.content) {
        updateFields.push('content');
      }

      updateFields.forEach((updateField) => {
        if(context.req._original[updateField]) {
          updateActions.push(
            app.models.languageToken
              .findOne({
                where: {
                  token: updateField === 'content' ? languageToken + '_DESCRIPTION' : languageToken,
                  languageId: languageId
                }
              })
              .then((languageToken) => {
                  return languageToken.updateAttribute('translation', context.req._original[updateField]);
                }
              )
          )
        }
      });

      Promise.all(updateActions)
        .then(() => {
          next();
        })
        .catch(next);
    } else {
      next();
    }
  }
};
