'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const helpers = require('../../components/helpers');
const Platform = require('../../components/platform');
const importableFile = require('./../../components/importableFile');
const Config = require('../../server/config.json');

// used in lab result import
const labResultImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

module.exports = function (LabResult) {
  // set flag to not get controller
  LabResult.hasController = false;

  // initialize model helpers
  LabResult.helpers = {};

  LabResult.fieldLabelsMap = Object.assign({}, LabResult.fieldLabelsMap, {
    personId: 'LNG_LAB_RESULT_FIELD_LABEL_PERSON_ID',
    dateSampleTaken: 'LNG_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_TAKEN',
    dateSampleDelivered: 'LNG_LAB_RESULT_FIELD_LABEL_DATE_SAMPLE_DELIVERED',
    dateTesting: 'LNG_LAB_RESULT_FIELD_LABEL_DATE_TESTING',
    dateOfResult: 'LNG_LAB_RESULT_FIELD_LABEL_DATE_OF_RESULT',
    labName: 'LNG_LAB_RESULT_FIELD_LABEL_LAB_NAME',
    sampleIdentifier: 'LNG_LAB_RESULT_FIELD_LABEL_SAMPLE_LAB_ID',
    sampleType: 'LNG_LAB_RESULT_FIELD_LABEL_SAMPLE_TYPE',
    testType: 'LNG_LAB_RESULT_FIELD_LABEL_TEST_TYPE',
    testedFor: 'LNG_LAB_RESULT_FIELD_LABEL_TESTED_FOR',
    result: 'LNG_LAB_RESULT_FIELD_LABEL_RESULT',
    quantitativeResult: 'LNG_LAB_RESULT_FIELD_LABEL_QUANTITATIVE_RESULT',
    notes: 'LNG_LAB_RESULT_FIELD_LABEL_NOTES',
    status: 'LNG_LAB_RESULT_FIELD_LABEL_STATUS',

    // must be last item from the list
    questionnaireAnswers: 'LNG_LAB_RESULT_FIELD_LABEL_QUESTIONNAIRE_ANSWERS'
  });

  // merge merge properties so we don't remove anything from a array / properties defined as being "mergeble" in case we don't send the entire data
  // this is relevant only when we update a record since on create we don't have old data that we need to merge
  LabResult.mergeFieldsOnUpdate = [
    'questionnaireAnswers'
  ];

  LabResult.referenceDataFieldsToCategoryMap = {
    labName: 'LNG_REFERENCE_DATA_CATEGORY_LAB_NAME',
    sampleType: 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE',
    testType: 'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST',
    result: 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT',
    status: 'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_STATUS',
    // person properties
    'person.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    'person.address.typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE'
  };

  LabResult.referenceDataFields = Object.keys(LabResult.referenceDataFieldsToCategoryMap);

  LabResult.printFieldsinOrder = [
    'status',
    'labName',
    'testType',
    'testedFor',
    'dateTesting',
    'result',
    'dateOfResult',
    'sampleType',
    'dateSampleTaken',
    'dateSampleDelivered',
    'sampleIdentifier',
    'quantitativeResult',
    'notes'
  ];

  LabResult.locationFields = [
    // person field
    'person.address.locationId'
  ];

  LabResult.foreignKeyResolverMap = {
    // person properties
    'person.address.locationId': {
      modelName: 'location',
      collectionName: 'location',
      useProperty: 'name'
    }
  };

  LabResult.extendedForm = {
    template: 'labResultsTemplate',
    containerProperty: 'questionnaireAnswers',
    isBasicArray: (variable) => {
      return variable.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS';
    }
  };

  LabResult.exportAddressField = 'person.address';

  /**
   * Return a list of field labels map that are allowed for export
   */
  LabResult.helpers.sanitizeFieldLabelsMapForExport = () => {
    // make sure we don't alter the original array
    const fieldLabelsMap = {};

    // relationship person labels
    const personFieldLabelsMap = {
      'visualId': 'LNG_ENTITY_FIELD_LABEL_VISUAL_ID',
      'type': 'LNG_ENTITY_FIELD_LABEL_TYPE',
      'lastName': 'LNG_ENTITY_FIELD_LABEL_LAST_NAME',
      'firstName': 'LNG_ENTITY_FIELD_LABEL_FIRST_NAME',
      'middleName': 'LNG_ENTITY_FIELD_LABEL_MIDDLE_NAME',
      'dateOfOnset': 'LNG_ENTITY_FIELD_LABEL_DATE_OF_ONSET',
      'dateOfReporting': 'LNG_ENTITY_FIELD_LABEL_DATE_OF_REPORTING',
      'address': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
      'address.typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
      'address.country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
      'address.city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
      'address.addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
      'address.postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
      'address.locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
      'address.geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
      'address.geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
      'address.geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
      'address.geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
      'address.date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
      'address.phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
      'address.emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS'
    };

    // append person export fields
    Object.assign(
      fieldLabelsMap,
      LabResult.fieldLabelsMap,
      _.transform(
        personFieldLabelsMap,
        (tokens, token, property) => {
          tokens[`person.${property}`] = token;
        },
        {}
      ), {
        'person': 'LNG_LAB_RESULT_FIELD_LABEL_PERSON'
      }
    );

    // finished
    return fieldLabelsMap;
  };

  /**
   * Pre-filter lab-results for an outbreak using related models (case)
   * @param outbreak
   * @param filter Supports 'where.case' MongoDB compatible queries
   * @param options Options from request
   * @return {Promise<void | never>}
   */
  LabResult.preFilterForOutbreak = function (outbreak, filter, options) {
    // set a default filter
    filter = filter || {};
    let contactQuery = _.get(filter, 'where.contact');
    if (contactQuery) {
      delete filter.where.contact;
    }
    // get case query, if any
    let caseQuery = _.get(filter, 'where.case');
    // if found, remove it form main query
    if (caseQuery) {
      delete filter.where.case;
    }
    // this query is used mainly for pre filtering lab results before reaching aggregate
    let personQuery = _.get(filter, 'where.person');
    if (personQuery) {
      delete filter.where.person;
    }
    // get main lab results query
    let labResultsQuery = _.get(filter, 'where', {});
    // start with a resolved promise (so we can link others)
    let buildQuery = Promise.resolve();

    const personIds = [];

    // check for personId filter; if not present we need to check if geographical restriction need to be applied
    if (!_.get(filter, 'where.personId')) {
      // start with the geographical restrictions promise (so we can link others)
      buildQuery = app.models.person
        .addGeographicalRestrictions(options.remotingContext);
    }

    return buildQuery
      .then(geographicalRestrictionQuery => {
        // initialize person IDs gathering promise
        let getPersonIds = Promise.resolve();
        if (caseQuery || contactQuery || personQuery) {
          // if a case query is present
          if (caseQuery) {
            // restrict query to current outbreak
            caseQuery = {
              $and: [
                caseQuery,
                {
                  outbreakId: outbreak.id
                }
              ]
            };

            // add geographical restriction query
            geographicalRestrictionQuery && (caseQuery['$and'].push(geographicalRestrictionQuery));

            // filter cases based on query
            getPersonIds = getPersonIds
              .then(function () {
                return app.models.case
                  .rawFind(caseQuery, {projection: {_id: 1}})
                  .then(function (cases) {
                    // build a list of case ids that passed the filter
                    personIds.push(...cases.map(caseRecord => caseRecord.id));
                  });
              });
          }
          // if a contact query is present
          if (contactQuery) {
            // restrict query to current outbreak
            contactQuery = {
              $and: [
                contactQuery,
                {
                  outbreakId: outbreak.id
                }
              ]
            };

            // add geographical restriction query
            geographicalRestrictionQuery && (contactQuery['$and'].push(geographicalRestrictionQuery));

            // filter cases based on query
            getPersonIds = getPersonIds
              .then(function () {
                return app.models.contact
                  .rawFind(contactQuery, {projection: {_id: 1}})
                  .then(function (contacts) {
                    // build a list of case ids that passed the filter
                    personIds.push(...contacts.map(contact => contact.id));
                  });
              });
          }
          // if a person query is present
          if (personQuery) {
            // restrict query to current outbreak
            personQuery = {
              $and: [
                personQuery,
                {
                  outbreakId: outbreak.id
                }
              ]
            };

            // add geographical restriction query
            geographicalRestrictionQuery && (personQuery['$and'].push(geographicalRestrictionQuery));

            // filter people based on query
            getPersonIds = getPersonIds
              .then(() => {
                return app.models.person
                  .rawFind(personQuery, {projection: {_id: 1}})
                  .then(people => {
                    personIds.push(...people.map(person => person.id));
                  });
              });
          }
        } else if (geographicalRestrictionQuery) {
          // no queries are being done on related person; we need to add default query for geographical restriction
          personQuery = geographicalRestrictionQuery;
          // filter people based on query
          getPersonIds = getPersonIds
            .then(() => {
              return app.models.person
                .rawFind(personQuery, {projection: {_id: 1}})
                .then(people => {
                  personIds.push(...people.map(person => person.id));
                });
            });
        }

        return getPersonIds;
      })
      .then(() => {
        // if person ids filter present
        if (personQuery || contactQuery || caseQuery) {
          // update lab results query to filter based on caseIds
          labResultsQuery = {
            $and: [
              labResultsQuery,
              {
                personId: {
                  $in: personIds
                }
              }
            ]
          };
        }

        // restrict lab results query to current outbreak
        const labResultsDefaultQuery = {
          outbreakId: outbreak.id
        };
        labResultsQuery = _.isEmpty(labResultsQuery) ?
          labResultsDefaultQuery : {
            $and: [
              labResultsQuery,
              labResultsDefaultQuery
            ]
          };

        // finished
        return Object.assign(filter, app.utils.remote.convertLoopbackFilterToMongo({where: labResultsQuery}));
      });
  };

  /**
   * Aggregate find lab-results
   * @param outbreak
   * @param filter
   * @param countOnly
   * @param callback
   */
  LabResult.retrieveAggregateLabResults = (
    outbreak,
    filter,
    countOnly,
    callback
  ) => {
    // make sure we have a default filter
    filter = filter || {};

    // retrieve records from this outbreak
    const predefinedConditions = {
      outbreakId: outbreak.id
    };
    if (!outbreak.isContactLabResultsActive) {
      predefinedConditions.personType = {
        neq: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
      };
    }
    filter.where = _.isEmpty(filter.where) ?
      predefinedConditions : {
        and: [
          predefinedConditions,
          filter.where
        ]
      };

    // filter lab results
    app.models.labResult
      .rawFindAggregate(
        filter, {
          countOnly: countOnly,
          relations: [{
            lookup: {
              from: 'person',
              localField: 'personId',
              foreignField: '_id',
              as: 'person'
            },
            unwind: true,
            map: (record) => {
              // replace id
              record.id = record._id;
              delete record._id;

              // finished
              return record;
            }
          }]
        }
      )
      .then((labResults) => {
        callback(null, labResults);
      })
      .catch(callback);
  };

  /**
   * Before save hooks
   */
  LabResult.observe('before save', function (context, next) {
    // sort multi answer questions
    const data = context.isNewInstance ? context.instance : context.data;
    helpers.sortMultiAnswerQuestions(data);

    const promiseChain = Promise.resolve();
    promiseChain
      .then(() => {
        const instanceData = context.isNewInstance ? context.instance : context.currentInstance;

        // add the custom helper property person type
        // mainly used for filtering lab results based on the type
        if (
          !instanceData.personType &&
          instanceData.personId
        ) {
          return app.models.person
            .findOne({
              deleted: true,
              where: {
                id: instanceData.personId
              }
            })
            .then((person) => {
              data.personType = person ? person.type : undefined;
            });
        }

        // we can't or don't need to update personType
        return null;
      })
      .then(() => {
        // retrieve outbreak data
        let model = _.get(context, 'options.remotingContext.instance');
        if (model) {
          if (!(model instanceof app.models.outbreak)) {
            model = undefined;
          }
        }

        // convert date fields to date before saving them in database
        helpers
          .convertQuestionStringDatesToDates(
            data,
            model ?
              model.labResultsTemplate :
              null
          )
          .then(() => {
            // finished
            next();
          })
          .catch(next);
      });
  });

  /**
   * Import an importable lab results file using file ID and a map to remap parameters & reference data values
   * @param {string} outbreakId - Outbreak ID
   * @param {Object} body - Request body
   * @param {Object} personModel - Person model to be used when finding the person for the lab result
   * @param {Object} options - Request options
   * @param {Function} callback
   */
  LabResult.helpers.importImportableLabResultsFileUsingMap = (outbreakId, body, personModel, options, callback) => {
    // create a transaction logger as the one on the req will be destroyed once the response is sent
    const logger = app.logger.getTransactionLogger(options.remotingContext.req.transactionId);

    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // inject platform identifier
    options.platform = Platform.IMPORT;

    /**
     * Create array of actions that will be executed in series for each batch
     * Note: Failed items need to have success: false and any other data that needs to be saved on error needs to be added in a error container
     * @param {Array} batchData - Batch data
     * @returns {[]}
     */
    const createBatchActions = function (batchData) {
      // build a list of create operations for this batch
      const createLabResults = [];

      // go through all batch entries
      batchData.forEach(function (labResultData) {
        createLabResults.push(function (asyncCallback) {
          // first check if the person id is valid
          personModel
            .findOne({
              where: {
                or: [
                  {id: labResultData.save.personId},
                  {visualId: labResultData.save.personId}
                ],
                outbreakId: outbreakId
              }
            })
            .then(function (personInstance) {
              // if the person was not found, don't sync the lab result, stop with error
              if (!personInstance) {
                return Promise.reject(app.utils.apiError.getError('PERSON_NOT_FOUND', {
                  model: personModel.modelName,
                  id: labResultData.save.personId
                }));
              }

              // make sure we map it to the parent case in case we retrieved the case using visual id
              labResultData.save.personId = personInstance.id;

              // sync the record
              return app.utils.dbSync.syncRecord(logger, app.models.labResult, labResultData.save, options)
                .then(function () {
                  asyncCallback();
                });
            })
            .catch(function (error) {
              asyncCallback(null, {
                success: false,
                error: {
                  error: error,
                  data: {
                    file: labResultData.raw,
                    save: labResultData.save
                  }
                }
              });
            });
        });
      });

      return createLabResults;
    };

    // construct options needed by the formatter worker
    if (!app.models.labResult._booleanProperties) {
      app.models.labResult._booleanProperties = app.utils.helpers.getModelBooleanProperties(app.models.labResult);
    }

    const formatterOptions = Object.assign({
      dataType: 'labResult',
      batchSize: labResultImportBatchSize,
      outbreakId: outbreakId,
      modelBooleanProperties: app.models.labResult._booleanProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.labResult.modelName,
      outbreakId: outbreakId,
      logger: logger,
      parallelActionsLimit: 10
    }, formatterOptions, createBatchActions, callback);
  };
};
