'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (HelpCategory) {
  // set flag to not get controller
  HelpCategory.hasController = true;

  /**
   * Replace the translatable fields with language tokens before saving
   * Save translatable fields values, to create translations later
   */
  HelpCategory.observe('before save', function (context, next) {
    if (context.isNewInstance) {
      let identifier = `LNG_${_.snakeCase(HelpCategory.name).toUpperCase()}_${_.snakeCase(context.args.data.name).toUpperCase()}`;

      context.req._original = {
        name: context.args.data.name,
        description: context.args.data.description
      };

      context.args.data.id = identifier;
      context.args.data.name = identifier;
      context.args.data.description = identifier + '_DESCRIPTION';
    } else {
      if (context.args.data && (context.args.data.name || context.args.data.description)) {
        let originalValues = {};
        let data = context.args.data;

        if (data.name) {
          originalValues.name = data.name;
          delete data.name;
        }

        if (data.description) {
          originalValues.description = data.description;
          delete data.description;
        }

        context.req._original = originalValues;
      }
    }

    return next();
  });

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
            if(modelName === 'helpCategory') {
              tokenPromises.push(app.models.languageToken
                .create({
                  token: modelInstance.description,
                  languageId: language.id,
                  translation: context.req._original.description ? context.req._original.description : ' '
                }, context.args.options)
              );
            }
            if(modelName === 'helpItem') {
              tokenPromises.push(app.models.languageToken
                .create({
                  token: modelInstance.content,
                  languageId: language.id,
                  translation: context.req._original.content
                }, context.args.options));
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
    if (context.args.data && (context.args.data[titleField] || context.args.data.description || context.args.data.content)) {
      let originalValues = {};
      let data = context.args.data;

      if(data[titleField]) {
        originalValues[titleField] = data[titleField];
        delete data[titleField];
      }

      if(data.description) {
        originalValues.description = data.description;
        delete data.description;
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

      if (modelName === 'helpCategory' && context.req._original.description) {
        updateFields.push('description');
      }

      if (modelName === 'helpItem' && context.req._original.content) {
        updateFields.push('content');
      }

      updateFields.forEach((updateField) => {
        if(context.req._original[updateField]) {
          updateActions.push(
            app.models.languageToken
              .findOne({
                where: {
                  token: ['content', 'description'].indexOf(updateField) !== -1 ? languageToken + '_DESCRIPTION' : languageToken,
                  languageId: languageId
                }
              })
              .then((languageToken) => {
                return languageToken.updateAttribute('translation', context.req._original[updateField], context.args.options);
              })
          );
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
  };
};
