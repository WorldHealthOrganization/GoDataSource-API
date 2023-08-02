'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (ReferenceData) {

  // define available categories
  ReferenceData.availableCategories = [
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_GENDER_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_STATUS',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_STATUS',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_STATUS_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_LABORATORY',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_LABORATORY',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_LABORATORY_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_RESULT',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_RESULT',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_RESULT_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_DISEASE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_DISEASE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_DISEASE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_INVESTIGATION_STATUS',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_INVESTIGATION_STATUS',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_INVESTIGATION_STATUS_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_EVENT_CATEGORY',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_EVENT_CATEGORY',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_EVENT_CATEGORY_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_COUNTRY',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_COUNTRY',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_COUNTRY_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LOCATION_GEOGRAPHICAL_LEVEL',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LOCATION_GEOGRAPHICAL_LEVEL',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_LOCATION_GEOGRAPHICAL_LEVEL_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE',
      'name': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE',
      'description': 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE',
      'name': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE',
      'description': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_PREGNANCY_STATUS',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_PREGNANCY_STATUS',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_PREGNANCY_STATUS_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_INSTITUTION_NAME',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_INSTITUTION_NAME',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_INSTITUTION_NAME_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_FOLLOWUP_GENERATION_TEAM_ASSIGNMENT_ALGORITHM',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_FOLLOWUP_GENERATION_TEAM_ASSIGNMENT_ALGORITHM',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_FOLLOWUP_GENERATION_TEAM_ASSIGNMENT_ALGORITHM_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_OUTBREAK_MAP_SERVER_TYPE',
      'name': 'LNG_REFERENCE_DATA_OUTBREAK_MAP_SERVER_TYPE',
      'description': 'LNG_REFERENCE_DATA_OUTBREAK_MAP_SERVER_TYPE_DESCRIPTION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_SECURITY_QUESTIONS_QUESTION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_SECURITY_QUESTIONS_QUESTION',
      'description': 'LNG_REFERENCE_DATA_CATEGORY_SECURITY_QUESTIONS_QUESTION_DESCRIPTION'
    }
  ];

  // define available categories per disease
  ReferenceData.availableCategoriesPerDisease = [
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_LABORATORY',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_LABORATORY'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_RESULT',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_LAB_SEQUENCE_RESULT'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS'
    },
    {
      'id': 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME',
      'name': 'LNG_REFERENCE_DATA_CATEGORY_CENTRE_NAME'
    }
  ];

  // map language token labels for model properties
  ReferenceData.fieldLabelsMap = Object.assign({}, ReferenceData.fieldLabelsMap, {
    'categoryId': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_CATEGORY_ID',
    'value': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_VALUE',
    'code': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_CODE',
    'description': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_DESCRIPTION',
    'iconId': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_ICON',
    'order': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_ORDER',
    'colorCode': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_COLOR',
    'active': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_ACTIVE',
    'geoLocation': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_GEO_LOCATION',
    'geoLocation.lat': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_GEO_LOCATION_LAT',
    'geoLocation.lng': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_GEO_LOCATION_LNG',
    'isSystemWide': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_IS_SYSTEM_WIDE',
    'allowedRefDataItems': 'LNG_REFERENCE_DATA_ENTRY_FIELD_LABEL_ALLOWED_REF_DATA_ITEMS'
  });

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  ReferenceData.nestedGeoPoints = [
    'geoLocation'
  ];

  // keep a map of reference data available categories mapped by category id (for easy reference in relations)
  ReferenceData.availableCategoriesMap = {};
  ReferenceData.availableCategories.forEach(function (category) {
    ReferenceData.availableCategoriesMap[category.id] = category;
  });

  // define a list of custom (non-loopback-supported) relations
  ReferenceData.customRelations = {
    category: {
      type: 'function',
      fn: function (instance) {
        return new Promise(function (resolve) {
          let category = null;
          // if the item has a categoryId defined
          if (instance.categoryId) {
            // get the category
            category = ReferenceData.availableCategoriesMap[instance.categoryId];
          }
          resolve(category);
        });
      }
    }
  };

  /**
   * Check if model is editable & model usage before deleting the model
   */
  ReferenceData.observe('before delete', function (context, next) {
    if (context.where.id) {
      // if its not editable, it will send an error to the callback
      ReferenceData.isEntryEditable(context.where.id, next);
    } else {
      next();
    }
  });

  /**
   * Check if an entry is editable (!readOnly + !inUse)
   * @param referenceData|referenceDataId
   * @param callback
   * @return {*}
   */
  ReferenceData.isEntryEditable = function (referenceData, callback) {
    let referenceDataId;

    /**
     * Check if a writable model is in use
     * @param error
     * @param writable
     * @return {*}
     */
    function _callback(error, writable) {
      if (error) {
        return callback(error);
      }
      // if it's not writable, stop here
      if (!writable) {
        return callback(app.utils.apiError.getError('MODEL_NOT_EDITABLE', {
          model: ReferenceData.modelName,
          id: referenceDataId
        }));
      }
      // record is writable, check usage
      ReferenceData
        .isRecordInUse(referenceDataId)
        .then(function (recordInUse) {
          // record in use
          if (recordInUse) {
            // send back an error
            return callback(app.utils.apiError.getError('MODEL_IN_USE', {
              model: ReferenceData.modelName,
              id: referenceDataId
            }));
          }
          return callback(null, true);
        })
        .catch(callback);
    }

    // if this a reference data item, check readOnly field
    if (typeof referenceData === 'object') {
      referenceDataId = referenceData.id;
      // then check usage
      return _callback(null, !referenceData.readOnly);
    }
    // this is only an ID, find the actual record and check if it's writable
    ReferenceData.findById(referenceData)
      .then(function (referenceData) {
        referenceDataId = referenceData.id;
        let writable = true;
        if (!referenceData || referenceData.readOnly) {
          writable = false;
        }
        //then check usage
        _callback(null, writable);
      })
      .catch(_callback);
  };

  /**
   * Generate a language/translatable identifier for a category + value combination
   * @param category
   * @param value
   * @return {string}
   */
  ReferenceData.getTranslatableIdentifierForValue = function (category, value) {
    return `${category}_${_.snakeCase(value).toUpperCase()}`;
  };


  /**
   * Prepare language tokens for translation (before save hook)
   * @param context
   * @param next
   * @return {*}
   */
  function prepareLanguageTokens(context, next) {
    // new record
    if (!context.currentInstance && context.instance.categoryId && context.instance.value) {
      // start building identifier
      let identifier = '';
      // if this belongs to an outbreak
      if (context.instance.outbreakId != null) {
        // include outbreak marker and outbreak id in the identifier
        identifier = `LNG_${app.models.outbreak.modelName.toUpperCase()}_${context.instance.outbreakId.toUpperCase()}_`;
      }
      // update identifier based on the available data
      identifier += ReferenceData.getTranslatableIdentifierForValue(context.instance.categoryId, context.instance.value);
      // store original values
      const original = {
        value: context.instance.value,
        description: context.instance.description,
      };
      // replace data with identifiers
      context.instance.id = identifier;
      context.instance.value = identifier;
      // update description only if value was sent to not set a language token for an non-existent value
      if (context.instance.description) {
        context.instance.description = `${identifier}_DESCRIPTION`;
      }
      // store original values
      _.set(context, `options.${ReferenceData.modelName}._original[${context.instance.id}]`, original);

    } else if (context.currentInstance && context.data && (context.data.value || context.data.description)) {
      // record is being updated

      // initialize original values storage
      const original = {};
      // look for changes in value or description
      ['value', 'description'].forEach(function (property) {
        // if the property was sent (changed)
        if (context.data[property]) {
          // get its original value
          original[property] = context.data[property];
          // remove the value from data (prevent updates) - only translations will be updated
          delete context.data[property];
          // description is optional, if it was sent and not present
          if (property === 'description' && !context.currentInstance.description) {
            // add it
            context.data[property] = `${context.currentInstance.id}_DESCRIPTION`;
          }
        }
      });
      // store original values
      _.set(context, `options.${ReferenceData.modelName}._original[${context.currentInstance.id}]`, original);
    }
    next();
  }

  /**
   * Translate language tokens (after save hook)
   * @param context
   * @param next
   * @return {*}
   */
  function translateLanguageTokens(context, next) {

    // do not execute hooks on save
    if (context.options && context.options._sync) {
      return next();
    }

    // get original values
    const original = _.get(context, `options.${ReferenceData.modelName}._original[${context.instance.id}]`);

    // check if there were any original values stored
    if (original) {
      // get logged user languageId
      const languageId = context.options.remotingContext.req.authData.user.languageId;
      // build a list of update actions
      const updateActions = [];

      // create update promises
      ['value', 'description'].forEach(function (property) {
        // if a value was sent
        if (original[property] != null) {
          // build token
          let token = context.instance.id;
          // for description property
          if (property === 'description') {
            // add description suffix
            token += '_DESCRIPTION';
          }

          // find the token associated with the value
          updateActions.push(
            // try to find the language token
            app.models.languageToken
              .findOne({
                where: {
                  token: token,
                  languageId: languageId
                }
              })
              .then(function (languageToken) {
                // if found
                if (languageToken) {
                  // update its translation
                  return languageToken
                    .updateAttributes({
                      translation: original[property]
                    }, context.options);
                  // token not found
                } else {
                  // get installed languages and create description tokens for each one that does not have the token
                  return app.models.language
                    .find()
                    .then(function (languages) {
                      // loop through all the languages and create new token promises for each language that does not have the token for each new token
                      return Promise.all(languages.map((language) => {
                        // try to find the token
                        return app.models.languageToken
                          .findOne({
                            where: {
                              token: token,
                              languageId: language.id
                            }
                          })
                          .then(function (languageToken) {
                            // if the token was not found
                            if (!languageToken) {
                              // create it
                              return app.models.languageToken
                                .create({
                                  token: token,
                                  languageId: language.id,
                                  translation: original[property]
                                }, context.options);
                            } else {
                              // token found, nothing to do, translation is meant for a different language
                            }
                          });
                      }));
                    });
                }
              })
          );
        }
      });

      // perform update operations
      Promise.all(updateActions)
        .then(function () {
          next();
        })
        .catch(next);

    } else {
      return next();
    }
  }


  // add before save hooks
  ReferenceData.observe('before save', function (context, next) {
    // do not execute hooks on sync
    if (context.options && context.options._sync) {
      return next();
    }

    let checkInstanceUniqueness = Promise.resolve();

    // normalize geo-points
    normalizeGeolocationCoordinates(context);

    // get data from context
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    if (
      // should check for uniqueness when
      // not in init/migrate database
      (
        !context.options ||
        !context.options._init
      ) &&
      // instance is not being deleted
      !data.target.deleted
    ) {
      // on update if the label is not sent we need to get it from the language token as on the original instance we have the actual token
      if (!context.isNewInstance && !data.target.value) {
        checkInstanceUniqueness = app.models.languageToken
          .rawFind({
            token: data.source.existing.value,
            languageId: context.options.remotingContext.req.authData.user.languageId
          }, {
            projection: {translation: 1}
          })
          .then(result => {
            if (!result.length) {
              // token not found; should never get here
              return Promise.reject(app.utils.apiError.getError('MODEL_NOT_FOUND', {
                model: app.models.languageToken.modelName,
                id: data.source.existing.value
              }));
            }

            return result[0].translation;
          });
      }

      // check if the combination of value and category already exists
      checkInstanceUniqueness = checkInstanceUniqueness
        .then(translation => {
          // get translation; is either returned in the promise on update or is in sent data on create
          !translation && (translation = data.target.value);

          // check for tokens with the same translation; on update don't search for the updated token
          const tokensQuery = {
            translation: translation,
            languageId: context.options.remotingContext.req.authData.user.languageId
          };
          !context.isNewInstance && (tokensQuery.token = {
            $ne: data.source.existing.value
          });

          return app.models.languageToken
            .rawFind(tokensQuery, {
              projection: {token: 1}
            });
        })
        .then(tokensWithSameLabel => {
          if (!tokensWithSameLabel.length) {
            // no tokens with the same translation; continue
            return Promise.resolve({
              count: 0
            });
          }

          return app.models.referenceData.rawCountDocuments({
            where: {
              value: {
                $in: tokensWithSameLabel.map(token => token.token)
              },
              // category is in source for both create/update
              categoryId: data.source.existing.categoryId
            }
          });
        })
        .then(result => {
          if (result.count) {
            // there are tokens with the same label and categoryId
            return Promise.reject(app.utils.apiError.getError('MODEL_CONFLICT', {
              id: data.value
            }));
          }
        });
    }

    checkInstanceUniqueness
      .then(() => {
        // check if the reference data is editable
        if (!context.isNewInstance) {
          // if its not editable, it will send an error to the callback
          ReferenceData.isEntryEditable(context.currentInstance, function (error) {
            // if the error says the instance is not editable
            if (error && ['MODEL_NOT_EDITABLE', 'MODEL_IN_USE'].indexOf(error.code) !== -1) {
              // and if data was sent
              if (context.data) {
                // in case we're trying to delete this record there is no point in setting data since that won't be saved
                if (context.data.deleted) {
                  return next(error);
                }

                // allow customizing some safe properties
                const customizableProperties = ['iconId', 'colorCode', 'order', 'code', 'geoLocation', 'isSystemWide', 'allowedRefDataItems'];

                // if model is editable but in use, also let it change the 'active', 'value', 'description' fields
                if (error.code === 'MODEL_IN_USE') {
                  customizableProperties.push('active', 'value', 'description');
                }

                const data = {};
                // exclude all unsafe properties from request
                Object.keys(context.data).forEach(function (property) {
                  if (customizableProperties.indexOf(property) !== -1) {
                    data[property] = context.data[property];
                  }
                });
                context.data = data;
              }
            } else if (error) {
              // unhandled error
              return next(error);
            }
            // prepare language tokens for translation
            prepareLanguageTokens(context, next);
          });
        } else {
          // prepare language tokens for translation
          prepareLanguageTokens(context, next);
        }
      })
      .catch(next);
  });

  /**
   * Normalize GeoLocation Coordinates (make sure they are numbers)
   * @param context
   */
  function normalizeGeolocationCoordinates(context) {
    // if this is a new record
    let entryInstance;
    if (context.isNewInstance) {
      // get instance data from the instance
      entryInstance = context.instance;
    } else {
      // existing instance, we're interested only in what is modified
      entryInstance = context.data;
    }

    // check if both coordinates are available and not numbers; make sure they are numbers
    if (
      entryInstance.geoLocation &&
      entryInstance.geoLocation.lat &&
      entryInstance.geoLocation.lng &&
      (
        isNaN(entryInstance.geoLocation.lat) ||
        isNaN(entryInstance.geoLocation.lng)
      )
    ) {
      entryInstance.geoLocation.lat = parseFloat(entryInstance.geoLocation.lat);
      entryInstance.geoLocation.lng = parseFloat(entryInstance.geoLocation.lng);
    }
  }

  // add after save hooks
  ReferenceData.observe('after save', function (context, next) {
    // set up translations for language tokens
    translateLanguageTokens(context, next);
  });
};
