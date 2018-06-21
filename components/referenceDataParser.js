'use strict';

const app = require('./../server/server');
const _ = require('lodash');

/**
 * Generate a language/translatable identifier for a category + value combination
 * @param category
 * @param value
 * @return {string}
 */
function getTranslatableIdentifierForValue(category, value) {
  return `${category}_${_.snakeCase(value).toUpperCase()}`;
}

/**
 * Before create hook
 * @param context
 * @param modelInstance
 * @param next
 */
function beforeCreateHook(context, modelInstance, next) {
  // in order to translate dynamic data, don't store values in the database, but translatable language tokens
  if (context.args.data && context.args.data.categoryId && context.args.data.value) {
    // for outbreak reference data need to create identifier based on outbreak ID in order to allow different value/description for different outbreaks
    // initialize identifier
    let identifier = '';
    if (context.method.sharedClass.name === 'outbreak') {
      identifier = `LNG_${context.method.sharedClass.name.toUpperCase()}_${context.instance.id.toUpperCase()}_`;
    }
    // update identifier based on the available data; no languageId set as we will create a token for each installed language
    identifier += getTranslatableIdentifierForValue(context.args.data.categoryId, context.args.data.value);
    // also store original values to be used for translations
    context.req._original = {
      value: context.args.data.value,
      description: context.args.data.description,
      languageId: context.args.data.languageId
    };
    // update record data with the language tokens
    context.args.data.id = identifier;
    context.args.data.value = identifier;
    context.args.data.description = `${identifier}_DESCRIPTION`;
  }
  next();
}

/**
 * After create hook
 * @param context
 * @param modelInstance
 * @param next
 */
function afterCreateHook(context, modelInstance, next) {
  // after successfully creating reference data record, also create translations for it.
  if (context.req._original) {
    // initialize array that will contain the promises for token creation
    let tokenPromises = [];

    // get installed languages and create tokens for each one
    app.models.language
      .find()
      .then(function (languages) {
        // loop through all the languages and create new token promises for each language for each new token
        return languages.forEach(function (language) {
          // create token for value
          tokenPromises.push(app.models.languageToken
            .create({
              token: modelInstance.id,
              languageId: language.id,
              translation: context.req._original.value
            }));
          // create token for description
          tokenPromises.push(app.models.languageToken
            .create({
              token: modelInstance.description,
              languageId: language.id,
              translation: context.req._original.description
            }));
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
  } else {
    next();
  }
}

/**
 * Before update hook
 * @param context
 * @param modelInstance
 * @param next
 */
function beforeUpdateHook(context, modelInstance, next) {
  // in order to translate dynamic data, don't update values for value and description in the database and update translatable language tokens
  if (context.args.data && (context.args.data.value || context.args.data.description)) {
    let data = context.args.data;
    // initialize original values storage
    let originalValues = {};
    // store original request values and remove them from the body as they shouldn't be changed. Translations will be changed
    ['value', 'description'].forEach(function(prop) {
      if(data[prop]) {
        originalValues[prop] = data[prop];
        delete data[prop];
      }
    });

    context.req._original = originalValues;
  }
  next();
}

/**
 * After update hook
 * @param context
 * @param modelInstance
 * @param next
 */
function afterUpdateHook(context, modelInstance, next) {
  // check if value or description was sent in the req body; context.req._original exists only if at leaset one of these properties were sent
  if(context.req._original) {
    // get logged user languageId
    let languageId = context.req.authData.user.languageId;
    // get language token; depending on model it is either the ID (for system reference data) or the FK (for outbreak reference data)
    let languageToken = context.method.sharedClass.name === 'outbreak' ? context.args.fk : context.instance.id;
    // initialize array of promises to be executed for updating language tokens
    let updateActions = [];

    // create update promises
    ['value', 'description'].forEach(function(prop) {
      if(context.req._original[prop]) {
        // find the token associated with the value
        updateActions.push(
          app.models.languageToken
            .findOne({
              where: {
                token: languageToken + (prop === 'value' ? '' : '_DESCRIPTION'),
                languageId: languageId
              }
            })
            .then(function (languageToken) {
              // and update it's translation. Do not handle 'not found' case, it should be internal system error
              return languageToken.updateAttributes({
                translation: context.req._original[prop]
              });
            })
        );
      }
    });

    // perform update operations
    Promise.all(updateActions)
      .then(function() {
        next();
      })
      .catch(next);
  } else {
    next();
  }
}

module.exports = {
  beforeCreateHook: beforeCreateHook,
  afterCreateHook: afterCreateHook,
  beforeUpdateHook: beforeUpdateHook,
  afterUpdateHook: afterUpdateHook,
  getTranslatableIdentifierForValue: getTranslatableIdentifierForValue
};
