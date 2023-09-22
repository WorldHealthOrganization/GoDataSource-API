'use strict';

const app = require('../../server/server');
const casesWorker = require('../../components/workerRunner').cases;
const _ = require('lodash');
const helpers = require('../../components/helpers');
const async = require('async');
const caseConstants = require('../../components/baseModelOptions/case').constants;
const localizationHelper = require('../../components/localizationHelper');

module.exports = function (Case) {
  Case.getIsolatedContacts = function (caseId, callback) {
    // get all relations with a contact
    return app.models.relationship
      .rawFind({
        // required to use index to improve greatly performance
        'persons.id': caseId,

        // filter
        $or: [
          {
            'persons.0.id': caseId,
            'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          },
          {
            'persons.1.id': caseId,
            'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          }
        ]
      }, {
        projection: {
          persons: 1
        },
        // required to use index to improve greatly performance
        hint: {
          'persons.id': 1
        }
      })
      .then((relationships) => {
        async.parallelLimit(relationships.map((rel) => {
          const contact = rel.persons.find((p) => p.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT');
          return (cb) => {
            app.models.contact
              .findOne({
                where: {
                  id: contact.id
                }
              })
              .then((contact) => {
                // contact missing ?
                if (!contact) {
                  cb(null, {isValid: false});
                  return;
                }

                // get all relations of the contact that are not with this case
                app.models.relationship
                  .rawFind({
                    // required to use index to improve greatly performance
                    'persons.id': contact.id,

                    // filter
                    $or: [
                      {
                        'persons.0.id': contact.id,
                        'persons.1.id': {
                          $ne: caseId
                        },
                        'persons.1.type': {
                          inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                        }
                      },
                      {
                        'persons.0.id': {
                          $ne: caseId
                        },
                        'persons.0.type': {
                          inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                        },
                        'persons.1.id': contact.id
                      }
                    ]
                  }, {
                    projection: {
                      _id: 1
                    },
                    // required to use index to improve greatly performance
                    hint: {
                      'persons.id': 1
                    }
                  })
                  .then((relationships) => cb(null, {contact: contact, isValid: !relationships.length}));
              })
              .catch((error) => cb(error));
          };
        }), 10, (err, possibleIsolatedContacts) => {
          if (err) {
            return callback(err);
          }
          return callback(null, possibleIsolatedContacts.filter((entry) => entry.isValid));
        });
      });
  };

  /**
   * Case after delete
   * Actions:
   * Remove any contacts that remain isolated after the case deletion
   */
  Case.observe('after delete', (context, next) => {
    if (context.options.mergeDuplicatesAction) {
      // don't remove isolated contacts when merging two cases
      return next();
    }

    const caseId = context.instance.id;
    Case.getIsolatedContacts(caseId, (err, isolatedContacts) => {
      if (err) {
        return next(err);
      }

      // construct the list of contacts that we need to remove
      const contactsJobs = [];
      isolatedContacts.forEach((isolatedContact) => {
        if (isolatedContact.isValid) {
          // remove contact job
          contactsJobs.push((function (contactModel) {
            return (callback) => {
              contactModel.destroy(
                {
                  extraProps: {
                    deletedByParent: caseId
                  }
                },
                callback
              );
            };
          })(isolatedContact.contact));
        }
      });

      // delete each isolated contact & and its relationship
      async.parallelLimit(contactsJobs, 10, function (error) {
        next(error);
      });
    });
  });

  // set flag to not get controller
  Case.hasController = false;

  // list of case classifications that are discarded
  Case.discardedCaseClassifications = caseConstants.discardedCaseClassifications;

  // merge merge properties so we don't remove anything from a array / properties defined as being "mergeble" in case we don't send the entire data
  // this is relevant only when we update a record since on create we don't have old data that we need to merge
  Case.mergeFieldsOnUpdate = [
    'questionnaireAnswers'
  ];

  Case.sectionsFieldLabels = {
    personalInformation: {
      title: 'LNG_FORM_CASE_QUICK_LABEL_PERSONAL',
      labels: [
        'LNG_CASE_FIELD_LABEL_FIRST_NAME',
        'LNG_CASE_FIELD_LABEL_MIDDLE_NAME',
        'LNG_CASE_FIELD_LABEL_LAST_NAME',
        'LNG_CASE_FIELD_LABEL_GENDER',
        'LNG_CASE_FIELD_LABEL_OCCUPATION',
        'LNG_CASE_FIELD_LABEL_AGE',
        'LNG_CASE_FIELD_LABEL_DOB',
        'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
        'LNG_CASE_FIELD_LABEL_RISK_REASON',
        'LNG_CASE_FIELD_LABEL_DATE_OF_REPORTING',
        'LNG_CASE_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
        'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED'
      ]
    },
    addresses: {
      title: 'LNG_CASE_FIELD_LABEL_ADDRESSES',
      labels: [
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
        'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
        'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
        'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
        'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS'
      ]
    },
    documents: {
      title: 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
      labels: [
        'LNG_CASE_FIELD_LABEL_DOCUMENT_TYPE',
        'LNG_CASE_FIELD_LABEL_DOCUMENT_NUMBER'
      ]
    },
    epidemiology: {
      title: 'LNG_PAGE_CREATE_CASE_TAB_INFECTION_TITLE',
      labels: [
        'LNG_CASE_FIELD_LABEL_CLASSIFICATION',
        'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
        'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET_APPROXIMATE',
        'LNG_CASE_FIELD_LABEL_DATE_BECOME_CASE',
        'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
        'LNG_CASE_FIELD_LABEL_OUTCOME_ID',
        'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME'
      ]
    }
  };

  // map language token labels for model properties
  Case.fieldLabelsMap = caseConstants.fieldLabelsMap;

  // map language token labels for export fields group
  Case.exportFieldsGroup = {
    'LNG_COMMON_LABEL_EXPORT_GROUP_RECORD_CREATION_AND_UPDATE_DATA': {
      properties: [
        'id',
        'createdAt',
        'createdBy',
        'updatedAt',
        'updatedBy',
        'deleted',
        'deletedAt',
        'createdOn'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_CORE_DEMOGRAPHIC_DATA': {
      properties: [
        'firstName',
        'middleName',
        'lastName',
        'gender',
        'occupation',
        'age',
        'age.years',
        'age.months',
        'dob',
        'visualId',
        'documents',
        'documents[].type',
        'documents[].number',
        'dateOfReporting',
        'isDateOfReportingApproximate',
        'pregnancyStatus'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_EPIDEMIOLOGICAL_DATA': {
      properties: [
        'type',
        'wasCase',
        'dateBecomeCase',
        'wasContact',
        'dateBecomeContact',
        'wasContactOfContact',
        'dateBecomeContactOfContact',
        'classification',
        'dateOfInfection',
        'dateOfOnset',
        'isDateOfOnsetApproximate',
        'riskLevel',
        'riskReason',
        'investigationStatus',
        'dateInvestigationCompleted',
        'outcomeId',
        'dateOfOutcome',
        'transferRefused',
        'deathLocationId',
        'safeBurial',
        'dateOfBurial',
        'burialLocationId',
        'burialPlaceName',
        'responsibleUser',
        'responsibleUser.id',
        'responsibleUser.firstName',
        'responsibleUser.lastName',
        'numberOfExposures',
        'numberOfContacts'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_VACCINATION_DATA': {
      properties: [
        'vaccinesReceived',
        'vaccinesReceived[].vaccine',
        'vaccinesReceived[].date',
        'vaccinesReceived[].status'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_HOSPITALIZATION_DATA': {
      properties: [
        'dateRanges',
        'dateRanges[].typeId',
        'dateRanges[].startDate',
        'dateRanges[].endDate',
        'dateRanges[].centerName',
        'dateRanges[].locationId',
        'dateRanges[].comments'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_ADDRESS_AND_LOCATION_DATA': {
      properties: [
        'addresses',
        'addresses[].typeId',
        'addresses[].country',
        'addresses[].city',
        'addresses[].addressLine1',
        'addresses[].postalCode',
        'addresses[].locationId',
        'addresses[].geoLocation',
        'addresses[].geoLocation.lat',
        'addresses[].geoLocation.lng',
        'addresses[].geoLocationAccurate',
        'addresses[].date',
        'addresses[].phoneNumber',
        'addresses[].emailAddress'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA': {
      properties: [
        // the ids and identifiers fields for a location are added custom
      ],
      required: [
        'LNG_COMMON_LABEL_EXPORT_GROUP_ADDRESS_AND_LOCATION_DATA'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_QUESTIONNAIRE_DATA': {
      properties: [
        'questionnaireAnswers'
      ]
    }
  };

  Case.exportFieldsOrder = caseConstants.exportFieldsOrder;

  Case.arrayProps = caseConstants.arrayProps;

  Case.referenceDataFieldsToCategoryMap = caseConstants.referenceDataFieldsToCategoryMap;

  Case.referenceDataFields = caseConstants.referenceDataFields;

  Case.extendedForm = {
    template: 'caseInvestigationTemplate',
    containerProperty: 'questionnaireAnswers',
    isBasicArray: (variable) => {
      return variable.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS';
    }
  };

  Case.printFieldsinOrder = [
    'visualId',
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'dob',
    'age',
    'occupation',
    'addresses',
    'documents',
    'type',
    'classification',
    'riskLevel',
    'riskReason',
    'wasContact',
    'dateOfReporting',
    'isDateOfReportingApproximate',
    'dateBecomeCase',
    'dateOfInfection',
    'dateOfOnset',
    'investigationStatus',
    'dateInvestigationCompleted',
    'outcomeId',
    'dateOfOutcome',
    'dateRanges',
    'transferRefused',
    'deathLocationId',
    'safeBurial',
    'dateOfBurial',
    'burialLocationId',
    'burialPlaceName',
    'vaccinesReceived',
    'pregnancyStatus'
  ];

  Case.locationFields = caseConstants.locationFields;

  Case.foreignKeyResolverMap = caseConstants.foreignKeyResolverMap;

  // used on importable file logic
  Case.foreignKeyFields = {
    'responsibleUserId': {
      modelName: 'user',
      collectionName: 'user',
      labelProperty: [
        'firstName',
        'lastName',
        'email'
      ]
    }
  };

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Case.nestedGeoPoints = [
    'addresses[].geoLocation'
  ];

  Case.invalidCaseClassificationsForReports = [
    'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_NOT_A_CASE_DISCARDED'
  ];

  // this is solely used for attaching parent locations custom fields in prints
  // addresses and dateRanges location ids are being handled inside their own models
  Case.locationsFieldsMap = {
    deathLocationId: 'LNG_CASE_FIELD_LABEL_DEATH_LOCATION_ID',
    burialLocationId: 'LNG_CASE_FIELD_LABEL_BURIAL_LOCATION_ID'
  };

  /**
   * Archive case classification changes, when detected
   * @param context
   */
  function archiveClassificationChanges(context) {
    // get data from context
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    // get data source
    const dataSource = data.source.all;
    // start with unknown last classification
    let lastKnownClassification;
    // if there is a non-empty classification history
    if (Array.isArray(dataSource.classificationHistory) && dataSource.classificationHistory.length) {
      // find the last known case classification
      lastKnownClassification = dataSource.classificationHistory.find(classification => classification.endDate == null);
    }
    // if the last known classification was found
    if (lastKnownClassification) {
      // if it's different than current classification
      if (dataSource.classification !== lastKnownClassification.classification) {
        // end last known classification entry
        lastKnownClassification.endDate = localizationHelper.now().toDate();
        // add the new classification in the history
        dataSource.classificationHistory.push({
          classification: dataSource.classification,
          startDate: lastKnownClassification.endDate
        });
      }
      // update classification history
      data.target.classificationHistory = dataSource.classificationHistory;

    } else {
      // no last known classification, get existing classification history (if any)
      data.target.classificationHistory = dataSource.classificationHistory;
      // if there is no classification history
      if (!Array.isArray(data.target.classificationHistory)) {
        // start it now
        data.target.classificationHistory = [];
      }
      // add current classification to history
      data.target.classificationHistory.push({
        classification: dataSource.classification,
        startDate: localizationHelper.now().toDate()
      });
    }
  }

  /**
   * Before save hooks
   */
  Case.observe('before save', function (context, next) {
    // archive
    archiveClassificationChanges(context);

    // sort multi answer questions
    const data = context.isNewInstance ? context.instance : context.data;
    helpers.sortMultiAnswerQuestions(data);

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
          model.caseInvestigationTemplate :
          null
      )
      .then(() => {
        // finished
        next();
      })
      .catch(next);
  });

  /**
   * Count cases stratified by category over time
   * @param outbreak
   * @param referenceDataCategoryId
   * @param timePropertyName
   * @param exportedPropertyName
   * @param counterFn
   * @param filter
   * @param options Options from request
   * @returns {PromiseLike<any | never>}
   */
  Case.countStratifiedByCategoryOverTime = function (outbreak, referenceDataCategoryId, timePropertyName, exportedPropertyName, counterFn, filter, options) {
    !filter && (filter = {});

    // initialize periodType filter; default is day; accepting day/week/month
    let periodType, weekType, endDate;
    let periodTypes = {
      day: 'day',
      week: 'week',
      month: 'month'
    };

    // check if the periodType filter was sent; accepting it only on the first level
    periodType = _.get(filter, 'where.periodType');
    if (typeof periodType !== 'undefined') {
      // periodType was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodType;
    }

    // check if the received periodType is accepted
    if (Object.values(periodTypes).indexOf(periodType) === -1) {
      // set default periodType
      periodType = periodTypes.day;
    }

    // check if the periodType filter was sent; accepting it only on the first level
    endDate = _.get(filter, 'where.endDate');
    if (typeof endDate !== 'undefined') {
      // periodType was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.endDate;
    }

    // check if we received weekType filter
    weekType = _.get(filter, 'where.weekType');
    if (typeof weekType !== 'undefined') {
      delete filter.where.weekType;
    }

    // always work with end of day
    if (endDate) {
      // get end of day for specified date
      endDate = localizationHelper.getDateEndOfDay(endDate).toISOString();
    } else {
      // nothing sent, use current day's end of day
      endDate = localizationHelper.getDateEndOfDay().toISOString();
    }

    // add geographical restrictions if needed
    return Case.addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter.where if needed
        updatedFilter && (filter.where = updatedFilter);

        // determine projection so we don't retrieve what isn't necessary
        let caseProjection = {
          _id: 1
        };
        const caseSort = {
          [timePropertyName]: 1
        };
        switch (timePropertyName) {
          case 'dateOfOnset':
            // fields
            caseProjection = {
              dateOfOnset: 1,
              classification: 1
            };

            // finished
            break;
          case 'dateOfOutcome':
            // fields
            caseProjection = {
              dateOfOutcome: 1,
              outcomeId: 1
            };

            // finished
            break;
          case 'dateOfReporting':
            // fields
            caseProjection = {
              dateOfReporting: 1,
              classification: 1
            };

            // finished
            break;
        }

        // find cases that have <timePropertyName> earlier then end of the period interval
        return app.models.case
          .rawFind(
            app.utils.remote.convertLoopbackFilterToMongo(
              app.utils.remote.mergeFilters({
                where: {
                  outbreakId: outbreak.id,
                  [timePropertyName]: {
                    lte: endDate,
                    ne: null
                  },
                  dateOfReporting: {
                    lte: endDate
                  }
                }
              }, filter || {}).where
            ), {
              projection: caseProjection,
              sort: caseSort
            }
          )
          .then(function (cases) {
            // if there are not cases, use end date
            const startDate = cases.length > 0 ?
              localizationHelper.getDateEndOfDay(cases[0][timePropertyName]).toISOString() :
              endDate;

            // define period interval
            const periodInterval = [
              startDate,
              endDate
            ];

            // build period map
            const periodMap = app.utils.helpers.getChunksForInterval(periodInterval, periodType, weekType);

            // get available case categories
            return app.models.referenceData
              .find({
                where: {
                  categoryId: referenceDataCategoryId
                },
                fields: {
                  id: true
                }
              })
              .then(function (categoryItems) {
                // get available case categories
                const categoryList = {};

                // add default entries for all categoryItems
                categoryItems.forEach(function (categoryItem) {
                  categoryList[categoryItem.id] = 0;
                });
                // add case categoryItems to periodMap
                Object.keys(periodMap)
                  .forEach(function (periodMapIndex) {
                    Object.assign(periodMap[periodMapIndex], {
                      [exportedPropertyName]: Object.assign({}, categoryList),
                      total: 0
                    });
                  });

                return categoryList;
              })
              .then(function (categoryList) {
                return new Promise(function (resolve, reject) {
                  // count categories over time
                  counterFn(
                    cases,
                    periodInterval,
                    periodType,
                    weekType,
                    periodMap,
                    categoryList,
                    function (error, periodMap) {
                      // handle errors
                      if (error) {
                        return reject(error);
                      }
                      // send back the result
                      return resolve(periodMap);
                    }
                  );
                });
              });
          });
      });
  };


  /**
   * Count cases stratified by classification over time
   * @param outbreak
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param options Options from request
   * @return {PromiseLike<T | never>}
   */
  Case.countStratifiedByClassificationOverTime = function (outbreak, filter, options) {
    return Case.countStratifiedByCategoryOverTime(
      outbreak,
      'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
      'dateOfOnset',
      'classification',
      casesWorker.countStratifiedByClassificationOverTime,
      filter,
      options
    );
  };

  /**
   * Count cases stratified by outcome over time
   * @param outbreak
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param options Options from request
   * @return {PromiseLike<T | never>}
   */
  Case.countStratifiedByOutcomeOverTime = function (outbreak, filter, options) {
    return Case.countStratifiedByCategoryOverTime(
      outbreak,
      'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
      'dateOfOutcome',
      'outcome',
      casesWorker.countStratifiedByOutcomeOverTime,
      filter,
      options
    );
  };

  /**
   * Count cases stratified by classification over reporting time
   * @param outbreak
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param options Options from request
   * @return {PromiseLike<T | never>}
   */
  Case.countStratifiedByClassificationOverReportingTime = function (outbreak, filter, options) {
    return Case.countStratifiedByCategoryOverTime(
      outbreak,
      'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION',
      'dateOfReporting',
      'classification',
      casesWorker.countStratifiedByClassificationOverReportingTime,
      filter,
      options
    );
  };

  /**
   * Get a list of entries that show the delay between date of symptom onset and the lab testing for a case
   * @param outbreakId
   * @param filter
   * @param options Options from request
   * @return {*}
   */
  Case.delayBetweenOnsetAndLabTesting = function (outbreakId, filter, options) {
    !filter && (filter = {});

    // add geographical restrictions if needed
    return Case
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter.where if needed
        updatedFilter && (filter.where = updatedFilter);

        // find all cases that have date of onset defined and include their first lab result
        return Case
          .rawFind(
            app.utils.remote.convertLoopbackFilterToMongo(
              app.utils.remote.mergeFilters({
                where: {
                  outbreakId: outbreakId,
                  dateOfOnset: {
                    ne: null
                  }
                }
              }, filter || {})
            ).where, {
              order: {
                dateOfOnset: 1
              },
              projection: {
                _id: 1,
                dateOfOnset: 1,
                firstName: 1,
                lastName: 1
              }
            }
          );
      })
      .then(function (cases) {
        // build a list of caseIds to get their lab results
        const caseIds = cases.map(caseRecord => caseRecord.id);
        // do a raw find for lab results
        return app.models.labResult.rawFind(
          {
            personId: {
              inq: caseIds
            }
          },
          {
            order: {dateSampleTaken: 1},
            projection: {personId: 1, dateSampleTaken: 1}
          })
          .then(function (labResults) {
            // build a map of personId to oldest lab result
            const labResultsMap = {};
            // go through all lab results
            labResults.forEach(function (labResult) {
              // initialize case group if necessary
              if (!labResultsMap[labResult.personId]) {
                labResultsMap[labResult.personId] = [];
              }

              // keep all lab tests for each case
              labResultsMap[labResult.personId].push(labResult);
            });

            // go through case records & build the list of results
            const results = [];
            cases.forEach(function (caseRecord) {
              // get case lab results if we have any
              const labResultData = labResultsMap[caseRecord.id] ? labResultsMap[caseRecord.id] : [];

              // go through each lab data & get lab result's dateSampleTaken
              // we need to use DO...WHILE because even if we don't have lab data for a case, we still need to send back an empty result
              let labResultIndex = 0;
              do {
                // get lab result if we have one
                const labResultDate = labResultData[labResultIndex] ? labResultData[labResultIndex].dateSampleTaken : null;

                // build each result
                const result = {
                  dateOfOnset: caseRecord.dateOfOnset,
                  dateSampleTaken: labResultDate,
                  delay: null,
                  case: caseRecord
                };

                // calculate delay if both dates are available (onset is ensured by the query)
                if (labResultDate) {
                  const onset = localizationHelper.toMoment(result.dateOfOnset);
                  const labTest = localizationHelper.toMoment(result.dateSampleTaken);
                  result.delay = labTest.diff(onset, 'days');
                }

                // add result to list
                results.push(result);

                // next lab result for this case
                labResultIndex++;
              } while (labResultIndex < labResultData.length);
            });

            // return the list of results
            return results;
          });
      });
  };


  /**
   * Get a list of entries that show the delay between date of symptom onset and the hospitalization/isolation dates a case
   * @param outbreakId
   * @param filter
   * @param options Options from request
   * @returns {Promise<Array | never>}
   */
  Case.delayBetweenOnsetAndHospitalisationIsolation = function (outbreakId, filter, options) {
    !filter && (filter = {});

    // add geographical restrictions if needed
    return Case
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter.where if needed
        updatedFilter && (filter.where = updatedFilter);

        // find all cases that have date of onset defined
        return Case
          .rawFind(
            app.utils.remote.convertLoopbackFilterToMongo(
              app.utils.remote.mergeFilters({
                where: {
                  outbreakId: outbreakId,
                  dateOfOnset: {
                    ne: null
                  }
                }
              }, filter || {})
            ).where, {
              order: {
                dateOfOnset: 1
              },
              projection: {
                _id: 1,
                dateOfOnset: 1,
                dateRanges: 1,
                firstName: 1,
                lastName: 1
              }
            }
          );
      })
      .then(function (cases) {
        // build the list of results
        const results = [];
        // go through case records
        cases.forEach(function (caseRecord) {
          // get first hospitalisation/isolation date (if any)
          let hospitalizationIsolationDate;
          // hospitalization/isolation dates are types of date ranges, look for them in dateRanges list
          if (Array.isArray(caseRecord.dateRanges) && caseRecord.dateRanges.length) {
            hospitalizationIsolationDate = caseRecord.dateRanges
              // we need the earliest one, make sure the list is sorted accordingly
              .sort(function (a, b) {
                return a.startDate - b.startDate;
              })
              .find(function (dateRange) {
                return [
                  'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE_HOSPITALIZATION',
                  'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE_ISOLATION']
                  .includes(dateRange.typeId);
              });
          }
          // build each result
          const result = {
            dateOfOnset: caseRecord.dateOfOnset,
            hospitalizationIsolationDate: hospitalizationIsolationDate ? hospitalizationIsolationDate.startDate : undefined,
            delay: null,
            case: caseRecord
          };
          // calculate delay if both dates are available (onset is ensured by the query)
          if (hospitalizationIsolationDate) {
            const onset = localizationHelper.toMoment(result.dateOfOnset);
            const hospitalisationIsolation = localizationHelper.toMoment(hospitalizationIsolationDate.startDate);
            result.delay = hospitalisationIsolation.diff(onset, 'days');
          }
          results.push(result);
        });
        // return the list of results
        return results;
      });
  };

  /**
   * Pre-filter cases for an outbreak
   * Pre-filter for geographical restrictions
   * Pre-filter using related models (relationship, labResult)
   * @param outbreak
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param options
   * @return {Promise<void | never>}
   */
  Case.preFilterForOutbreak = function (outbreak, filter, options) {
    // set a default filter
    filter = filter || {};

    // get relationship query, if any
    let relationshipQuery = _.get(filter, 'where.relationship');
    // if found, remove it form main query
    if (relationshipQuery) {
      delete filter.where.relationship;
    }

    // get labResults query, if any
    let labResultsQuery = _.get(filter, 'where.labResult');
    // if found, remove it form main query
    if (labResultsQuery) {
      delete filter.where.labResult;
    }

    // get main cases query
    let casesQuery = _.get(filter, 'where', {});

    // start with the geographical restrictions promise (so we can link others)
    let buildQuery = Case.addGeographicalRestrictions(options.remotingContext, casesQuery)
      .then(updatedFilter => {
        // update casesQuery if needed
        updatedFilter && (casesQuery = updatedFilter);
      });

    // if a relationship query is present
    if (relationshipQuery) {
      // restrict query to current outbreak
      relationshipQuery = {
        $and: [
          relationshipQuery,
          {
            outbreakId: outbreak.id
          }
        ]
      };
      // filter relationships based on query
      buildQuery = buildQuery
        .then(function () {
          return app.models.relationship
            .rawFind(relationshipQuery, {projection: {persons: 1}})
            .then(function (relationships) {
              let caseIds = [];
              // build a list of caseIds that passed the filter
              relationships.forEach(function (relation) {
                relation.persons.forEach(function (person) {
                  if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE') {
                    caseIds.push(person.id);
                  }
                });
              });
              return Array.from(new Set(caseIds));
            });
        });
    }

    // if lab results query is present
    if (labResultsQuery) {
      // filter lab results based on query
      buildQuery = buildQuery
        .then(function (caseIds) {
          // restrict lab results to current outbreak
          labResultsQuery = {
            and: [
              labResultsQuery,
              {
                outbreakId: outbreak.id
              }
            ]
          };
          // if case ids were found at previous step
          if (caseIds) {
            // restrict to only those people
            labResultsQuery.and.push(
              {
                personId: {
                  inq: caseIds
                }
              }
            );
          }
          // find lab results based on the query
          return app.models.labResult
            .rawFind(labResultsQuery, {projection: {personId: 1}})
            .then(function (labResults) {
              // return the list of caseIds associated with the found lab results
              return Array.from(new Set(labResults.map(labResult => labResult.personId)));
            });
        });
    }

    return buildQuery
      .then(function (caseIds) {
        // if caseIds filter present
        if (caseIds) {
          // update cases query to filter based on caseIds
          casesQuery = {
            and: [
              casesQuery,
              {
                id: {
                  inq: caseIds
                }
              }
            ]
          };
        }

        // restrict cases query to current outbreak
        casesQuery = {
          and: [
            casesQuery,
            {
              outbreakId: outbreak.id
            }
          ]
        };
        // return updated filter
        return Object.assign(filter, {where: casesQuery});
      });
  };

  /**
   * Count hospitalized cases
   */
  Case.countCasesHospitalized = (
    options,
    outbreakId,
    filter
  ) => {
    // initialization
    filter = filter || {};
    filter.where = filter.where || {};

    // date limit
    const dateLimitEndOfDay = localizationHelper.getDateEndOfDay(filter.flags ? filter.flags.date : undefined).toDate();
    const dateLimitStartOfDay = localizationHelper.getDateStartOfDay(filter.flags ? filter.flags.date : undefined).toDate();

    // update filter for geographical restriction if needed
    const refItems = [];
    return Case
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where
      )
      .then((updatedFilter) => {
        // retrieve reference data
        return app.models.referenceData
          .rawFind({
            categoryId: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_DATE_TYPE'
          }, {
            projection: {
              value: 1
            }
          })
          .then((referenceEntries) => {
            // map ref items
            (referenceEntries || []).forEach((item) => {
              refItems.push({
                type: item.value,
                key: item.value
              });
            });

            // return updated filter
            return updatedFilter;
          });
      })
      .then((updatedFilter) => {
        // update casesQuery if needed
        updatedFilter && (filter.where = updatedFilter);

        // attach prefilters
        filter.where.outbreakId = outbreakId;
        filter.where.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';
        if (!filter.deleted) {
          filter.where.deleted = false;
        }

        // convert to mongo filter
        const mongoFilter = app.utils.remote.convertLoopbackFilterToMongo(filter);

        // construct aggregate filter
        const aggregateFilters = [];

        // query
        aggregateFilters.push({
          $match: mongoFilter.where
        });

        // count hospitalized, isolated records
        const groupQuery = {
          $group: {
            _id: null
          }
        };

        // group
        aggregateFilters.push(groupQuery);

        // count hospitalized & isolated
        refItems.forEach((dateRangeData) => {
          groupQuery.$group[dateRangeData.key] = {
            $sum: {
              $cond: {
                if: {
                  $gt: [
                    {
                      $let: {
                        vars: {
                          dateRangesMatch: {
                            $ifNull: [
                              {
                                $filter: {
                                  input: '$dateRanges',
                                  as: 'item',
                                  cond: {
                                    $and: [
                                      {
                                        $eq: [
                                          '$$item.typeId',
                                          dateRangeData.type
                                        ]
                                      }, {
                                        $or: [
                                          {
                                            $not: [
                                              '$$item.startDate'
                                            ]
                                          }, {
                                            $lte: [
                                              '$$item.startDate',
                                              dateLimitEndOfDay
                                            ]
                                          }
                                        ]
                                      }, {
                                        $or: [
                                          {
                                            $not: [
                                              '$$item.endDate'
                                            ]
                                          }, {
                                            $gte: [
                                              '$$item.endDate',
                                              dateLimitStartOfDay
                                            ]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                }
                              },
                              []
                            ]
                          }
                        },
                        in: {
                          $size: '$$dateRangesMatch'
                        }
                      }
                    },
                    0
                  ]
                },
                then: 1,
                else: 0
              }
            }
          };
        });

        // determine total too
        groupQuery.$group.total = {
          $sum: 1
        };

        // retrieve data
        return app.dataSources.mongoDb.connector
          .collection('person')
          .aggregate(
            aggregateFilters, {
              allowDiskUse: true
            }
          )
          .toArray()
          .then((data) => {
            // determine not hospitalized
            data = data && data.length > 0 ?
              data[0] : {};

            // cleanup
            delete data._id;

            // add missing keys
            refItems.forEach((item) => {
              if (data[item.key] === undefined) {
                data[item.key] = 0;
              }
            });

            // finished
            return data;
          });
      });
  };
};
