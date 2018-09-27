'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const helpers = require('../../components/helpers');

module.exports = function (HelpCategory) {
  // set flag to not get controller
  HelpCategory.hasController = true;

  /**
   * Replace the translatable fields with language tokens before saving
   * Save translatable fields values, to create translations later
   */
  HelpCategory.observe('before save', function (context, next) {
    if (context.isNewInstance) {
      let instance = context.instance;
      let identifier = `LNG_${_.snakeCase(HelpCategory.name).toUpperCase()}_${_.snakeCase(instance.name).toUpperCase()}`;

      // set instance id, before setting the original context
      // because the setter takes in account the current instance id
      instance.id = identifier;

      // cache original values used to generate the identifier
      helpers.setOriginalValueInContextOptions(context, 'name', instance.name);
      helpers.setOriginalValueInContextOptions(context, 'description', instance.description);

      // update instance with generated identifier
      instance.name = identifier;
      instance.description = identifier + '_DESCRIPTION';
    } else {
      if (context.data && (context.data.name || context.data.description)) {
        let originalValues = {};
        let data = context.data;

        if (data.name) {
          originalValues.name = data.name;
          delete data.name;
        }

        if (data.description) {
          originalValues.description = data.description;
          delete data.description;
        }

        // cache original values used to generate the identifier
        helpers.setOriginalValueInContextOptions(context, 'name', originalValues.name);
        helpers.setOriginalValueInContextOptions(context, 'description', originalValues.description);
      }
    }

    next();
  });

  /**
   * Create language token translations for each available language
   * Defaults to user language at the time of creation
   */
  HelpCategory.observe('after save', function (context, next) {
    const models = app.models;
    const languageTokenModel = models.languageToken;

    // retrieve original values
    let originalName = helpers.getOriginalValueFromContextOptions(context, 'name');
    let originalDescription = helpers.getOriginalValueFromContextOptions(context, 'description') || '';

    if (context.isNewInstance) {
      // description is optional
      if (originalName) {
        let tokenPromises = [];
        models.language
          .find()
          .then(function (languages) {
            return languages.forEach((language) => {
              tokenPromises.push(
                languageTokenModel
                  .create({
                    token: context.instance.name,
                    languageId: language.id,
                    translation: originalName
                  }, context.options),
                languageTokenModel
                  .create({
                    token: context.instance.description,
                    languageId: language.id,
                    translation: originalDescription
                  }, context.options)
              );
            });
          })
          .then(() => Promise.all(tokenPromises))
          .then(() => next())
          .catch((err) => next(err));
      } else {
        next();
      }
    } else {
      if (originalName || originalDescription) {
        let languageId = context.options.remotingContext.req.authData.user.languageId;
        let languageToken = context.instance.id;
        let updateActions = [];

        let updateFields = [];

        if (originalName) {
          updateFields.push('name');
        }

        if (originalDescription) {
          updateFields.push('description');
        }

        updateFields.forEach((updateField) => {
            updateActions.push(
              languageTokenModel
                .findOne({
                  where: {
                    token: updateField === 'description' ? languageToken + '_DESCRIPTION' : languageToken,
                    languageId: languageId
                  }
                })
                .then((languageToken) => {
                  return languageToken.updateAttribute(
                    'translation',
                    helpers.getOriginalValueFromContextOptions(context, updateField),
                    context.options
                  );
                })
            );
        });

        Promise.all(updateActions)
          .then(() => next())
          .catch(next);
      } else {
        next();
      }
    }
  });
};
