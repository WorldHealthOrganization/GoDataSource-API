'use strict';

/*eslint no-extra-boolean-cast: "off"*/

const app = require('../../../../server/server');
const async = require('async');
const _ = require('lodash');
const randomize = require('randomatic');
const localizationHelper = require('../../../../components/localizationHelper');

// initialize action options; set _init, _sync flags to prevent execution of some after save scripts
let options = {
  _init: true,
  _sync: true
};

// variables for names generation
const charsetType = ['default', 'french', 'chinese'];
const charsetMap = {
  default: 'abcdefghijklmnopqrstuvwxyz',
  french: `${this.default}çàèîûôöïüù`,
  chinese: '常用國字標準字體表形表'
};
const charsetsNo = charsetType.length;

// variables for outbreak templates
const questionsTypesToAnswers = {
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FREE_TEXT': false,
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_NUMERIC': false,
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_DATE_TIME': false,
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER': true,
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS': true,
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD': false,
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MARKUP': false
};
const questionsTypes = Object.keys(questionsTypesToAnswers);
const questionsTypesNo = questionsTypes.length;
const questionCategories = [
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_CLINICAL',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_A_0_INTERVIEW_RESPONDENT_INFORMATION',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_A_0_OUCOME_S_TATUS',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_A_0_PATIENT_SYMPTOMS',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_CLINICAL_COURSE_COMPLICATIONS',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_CONTACT_DETAILS',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_CONTACT_WITH_CONFIRMED_PATIENT',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_DROMEDARY_CAMEL_CONTACT',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_EPIDEMIOLOGY_AND_EXPOSURE',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_EXPOSURE_RISK',
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_CATEGORY_FORM_COMPLETION'
];
const questionCategoriesNo = questionCategories.length;

// outbreak constants
const outbreakStartDatePastMonths = 6;

// generate random numbers between min & max
const randomFloatBetween = (
  minValue,
  maxValue,
  precision
) => {
  if (typeof (precision) === 'undefined') {
    precision = 2;
  }
  return parseFloat(Math.min(minValue + (Math.random() * (maxValue - minValue)), maxValue).toFixed(precision));
};

/**
 * Generate random string for given charset
 * @param charset If not present the charset will be chose randomly
 * @return {String}
 */
const randomString = (charset) => {
  if (!charset) {
    charset = charsetType[randomFloatBetween(0, charsetsNo - 1, 0)];
  }

  return randomize('?', randomFloatBetween(5, 10, 0), {chars: charsetMap[charset]});
};

/**
 * Convert a mongo point to a json point since loopback doesn't do it
 * @param location
 */
function convertNestedGeoPointsToLatLng(location) {
  if (
    location.geoLocation &&
    location.geoLocation.coordinates &&
    location.geoLocation.coordinates[0] != null &&
    location.geoLocation.coordinates[1] != null
  ) {
    // convert it
    location.geoLocation = {
      lat: location.geoLocation.coordinates[1],
      lng: location.geoLocation.coordinates[0]
    };
  }
}

/**
 * Parse value to integer if possible or return 0
 * @param value
 * @return {number}
 */
const parseIntArgValue = function (value) {
  let intValue = parseInt(value);
  return isNaN(intValue) ? 0 : intValue;
};

/**
 * Returns object containing generated createdAt/updatedAt
 * Note: Outbreak date is set to outbreakStartDatePastMonths months ago; generate createdAt/updatedAt randomly in the last outbreakStartDatePastMonths months
 * @return {{createdAt: string, updatedAt: string}}
 */
const getTimestamps = function () {
  // get days past since outbreak start (round month days to 30)
  const daysPastSinceOutbreakStart = outbreakStartDatePastMonths * 30;

  // get a random number between 0 and daysPastSinceOutbreakStart to be used as number of days in the past
  let noDaysCreated = Math.ceil(Math.random() * daysPastSinceOutbreakStart);
  let noDaysUpdated = Math.ceil(Math.random() * noDaysCreated);

  return {
    createdAt: localizationHelper.now().subtract(noDaysCreated, 'days'),
    updatedAt: localizationHelper.now().subtract(noDaysUpdated, 'days')
  };
};

/**
 * Generate template for given parameters
 * @param options
 * @return {{}[]}
 */
const generateTemplateQuestions = function (options) {
  if (!options.questionsNoPerLevel || !options.answersNoPerLevel) {
    return [];
  }

  const questionsNoPerLevel = options.questionsNoPerLevel;
  const answersNoPerLevel = options.answersNoPerLevel;
  const levelsNo = questionsNoPerLevel.length;

  /**
   * Generate questions for level
   * @param parentAnswerLabel
   * @param level
   * @return {Array}
   */
  const addSubQuestionsForLevel = function (parentAnswerLabel = '', level) {
    if (level > levelsNo) {
      return [];
    }

    // increase level that will be used for subquestions
    let nextLevel = level + 1;

    // initialize level questions container
    let result = [];

    // add required number of questions
    for (let questionNo = 1; questionNo <= questionsNoPerLevel[level - 1]; questionNo++) {
      let questionType = questionsTypes[randomFloatBetween(0, questionsTypesNo - 1, 0)];
      let questionText = `${parentAnswerLabel.length ? `${parentAnswerLabel} - ` : ''}Q${questionNo}`;

      let question = {
        // multiAnswer can be true only on 1st level
        multiAnswer: level === 1 ? (randomFloatBetween(0, 10, 0) <= 2) : false,
        inactive: randomFloatBetween(1, 10, 0) > 9 ? true : false,
        text: questionText,
        variable: questionText,
        category: questionCategories[randomFloatBetween(0, questionCategoriesNo - 1, 0)],
        required: randomFloatBetween(0, 10, 0) <= 3,
        order: questionNo,
        answerType: questionType,
        answersDisplay: !!randomFloatBetween(0, 1, 0) ?
          'LNG_OUTBREAK_QUESTIONNAIRE_ANSWERS_DISPLAY_ORIENTATION_VERTICAL' :
          'LNG_OUTBREAK_QUESTIONNAIRE_ANSWERS_DISPLAY_ORIENTATION_HORIZONTAL'
      };

      // check if we need to add answers
      if (questionsTypesToAnswers[questionType]) {
        question.answers = [];

        for (let answerNo = 1; answerNo <= answersNoPerLevel[level - 1]; answerNo++) {
          let answerLabel = `${question.text} - A${answerNo}`;

          let answer = {
            label: answerLabel,
            value: answerLabel,
            alert: !!randomFloatBetween(0, 1, 0),
            additionalQuestions: !!randomFloatBetween(0, 1, 0) ? addSubQuestionsForLevel(answerLabel, nextLevel) : []
          };

          question.answers.push(answer);
        }
      }

      result.push(question);
    }

    return result;
  };

  return addSubQuestionsForLevel('', 1);
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // retrieve config data
  const outbreakName = module.methodRelevantArgs.outbreakName;
  /**
   * type = caseInvestigationTemplate / contactInvestigationTemplate / contactFollowUpTemplate / labResultsTemplate
   * {
   *   [type]: {
   *     questionsNoPerLevel: [ number of questions for each needed level ], // eg: [100, 2, 2]
   *     answersNoPerLevel: [ number answers for single/multi asnwer questions for each needed level ] // eg: [5, 2, 3]
   *   }
   * }
   *
   */
  const outbreakSettings = module.methodRelevantArgs.outbreakSettings || {};
  const casesNo = parseIntArgValue(module.methodRelevantArgs.casesNo);
  const contactsNo = parseIntArgValue(module.methodRelevantArgs.contactsNo);
  const eventsNo = parseIntArgValue(module.methodRelevantArgs.eventsNo);
  const locationsNo = parseIntArgValue(module.methodRelevantArgs.locationsNo);
  const subLocationsPerLocationNo = parseIntArgValue(module.methodRelevantArgs.subLocationsPerLocationNo);
  const subLocationsLevelsNo = parseIntArgValue(module.methodRelevantArgs.subLocationsLevelsNo);
  const minNoRelationshipsForEachRecord = parseIntArgValue(module.methodRelevantArgs.minNoRelationshipsForEachRecord);
  const maxNoRelationshipsForEachRecord = parseIntArgValue(module.methodRelevantArgs.maxNoRelationshipsForEachRecord);
  const relationshipsForAlreadyAssociatedPerson = module.methodRelevantArgs.relationshipsForAlreadyAssociatedPerson &&
  ['true', true].indexOf(module.methodRelevantArgs.relationshipsForAlreadyAssociatedPerson) !== -1 ? true : false;
  const batchSize = parseIntArgValue(module.methodRelevantArgs.batchSize) || 10;

  // default geo location range
  const geoLocationRange = {
    lat: {
      min: -10,
      max: 10
    },
    lng: {
      min: 2,
      max: 20
    },
    subLocationError: {
      lat: {
        min: -0.2,
        max: 0.2
      },
      lng: {
        min: -0.2,
        max: 0.2
      }
    },
    caseLocationError: {
      lat: {
        min: -0.2,
        max: 0.2
      },
      lng: {
        min: -0.2,
        max: 0.2
      }
    },
    contactLocationError: {
      lat: {
        min: -0.2,
        max: 0.2
      },
      lng: {
        min: -0.2,
        max: 0.2
      }
    }
  };

  // age restrictions
  const ageRange = {
    min: 5,
    max: 70
  };

  // default number of things
  const today = localizationHelper.now().startOf('day');
  const todayString = today.toISOString();
  const defaultCitiesNo = 10;
  const defaultAddressLineNo = 5;
  const defaultPostalCodeRange = {
    min: 10000,
    max: 20000
  };
  const defaultPhoneNo = 10;

  // default outbreak template
  const outbreakStartDate = localizationHelper.now().add(-outbreakStartDatePastMonths, 'months').startOf('day');
  const outbreakAdminLevel = 'LNG_REFERENCE_DATA_CATEGORY_LOCATION_GEOGRAPHICAL_LEVEL_ADMIN_LEVEL_0';
  const defaultOutbreakTemplate = {
    description: 'Created by populate script',
    disease: 'LNG_REFERENCE_DATA_CATEGORY_DISEASE_EBOLA_VIRUS_DISEASE',
    countries: [],
    locationIds: [],
    startDate: outbreakStartDate.toISOString(),
    endDate: undefined,
    longPeriodsBetweenCaseOnset: 7,
    periodOfFollowup: 1,
    frequencyOfFollowUp: 1,
    frequencyOfFollowUpPerDay: 1,
    noDaysAmongContacts: 3,
    noDaysInChains: 1,
    noDaysNotSeen: 3,
    noLessContacts: 1,
    noDaysNewContacts: 3,
    caseInvestigationTemplate: [],
    contactInvestigationTemplate: [],
    contactFollowUpTemplate: [],
    labResultsTemplate: [],
    caseIdMask: '*',
    contactIdMask: '*',
    reportingGeographicalLevelId: outbreakAdminLevel
  };

  // initialize outbreak update boolean
  let outbreakRequiresUpdate = false;
  let newTemplates = {};
  // check given outbreak settings
  [
    'caseInvestigationTemplate',
    'contactInvestigationTemplate',
    'contactFollowUpTemplate',
    'labResultsTemplate'
  ].forEach(templateType => {
    if (outbreakSettings[templateType]) {
      let template = generateTemplateQuestions(outbreakSettings[templateType]);
      if (template.length) {
        outbreakRequiresUpdate = true;
        defaultOutbreakTemplate[templateType] = newTemplates[templateType] = template;
      }
    }
  });

  // default location template
  const defaultLocationTemplate = {
    synonyms: [],
    identifiers: [],
    active: true,
    populationDensity: undefined,
    parentLocationId: undefined
  };

  // default case template
  const defaultCaseTemplate = {
    visualId: undefined,
    middleName: undefined,
    description: 'Created by populate script',
    occupation: undefined,
    documents: [],
    isDateOfReportingApproximate: false,
    dateOfInfection: undefined,
    dateBecomeCase: undefined,
    dateRanges: [],
    classificationHistory: [],
    dateBecomeContact: undefined,
    followUp: undefined,
    wasContact: false,
    safeBurial: false,
    riskReason: undefined,
    transferRefused: false,
    questionnaireAnswers: undefined
  };

  // default contact template
  const defaultContactTemplate = {
    visualId: undefined,
    middleName: undefined,
    description: 'Created by populate script',
    occupation: undefined,
    documents: [],
    followUp: undefined,
    riskReason: undefined,
    isDateOfReportingApproximate: false,
    followUpHistory: []
  };

  // default event template
  const defaultEventTemplate = {
    description: 'Created by populate script',
    isDateOfReportingApproximate: false
  };

  // default relationship template
  const defaultRelationshipTemplate = {
    contactDateEstimated: false
    // clusterId: undefined,
    // socialRelationshipTypeId: undefined,
    // socialRelationshipDetail: undefined
  };

  // initialize containers for generated data
  // keeping data separate in order to allow Javascript to clear memory when a variable is no longer used
  let outbreakDataContainer;
  let locationsDataContainer;
  let parentLocationsIdsContainer;
  let parentLocationsNumberContainer;
  let casesContainer;
  let contactsContainer;
  let eventsContainer;

  // create or update existing outbreak
  // an existing outbreak should be used when additional data needs to be added to it
  app.logger.debug(`Creating/finding outbreak ${outbreakName}`);
  app.models.outbreak
    .findOrCreate({
      where: {
        name: outbreakName
      }
    }, Object.assign(
      defaultOutbreakTemplate, {
        name: outbreakName
      },
      getTimestamps()
    ), options)
    .then((result) => {
      let outbreakData = result[0];

      // outbreak created
      app.logger.debug(`Outbreak '${outbreakData.name}' ${result[1] ? 'created' : 'found'} => '${outbreakData.id}'`);

      // check if outbreak was found and if we need to update it
      // currently we just need to update the templates
      if (!result[1] && outbreakRequiresUpdate) {
        return outbreakData
          .updateAttributes(newTemplates, options)
          .then(outbreakData => {
            app.logger.debug(`Outbreak '${outbreakData.name}' updated => '${outbreakData.id}'`);
            return outbreakData;
          });
      }

      return outbreakData;
    })

    // start creating locations
    .then((outbreakData) => {
      // cache outbreak data
      outbreakDataContainer = outbreakData.toJSON();

      if (
        locationsNo === 0 &&
        casesNo === 0 &&
        contactsNo === 0 &&
        eventsNo === 0
      ) {
        // no locations need to be added/retrieved
        app.logger.debug('Skipping locations as they are not needed');
        return Promise.resolve();
      }

      // retrieve current parent locations
      return app.models.location
        .rawFindWithLoopbackFilter({
          where: {
            parentLocationId: null
          }
        })
        .then(parentLocations => {
          // cache useful variables
          locationsDataContainer = {};
          parentLocationsIdsContainer = [];
          parentLocations.forEach(location => {
            convertNestedGeoPointsToLatLng(location);
            locationsDataContainer[location.id] = location;
            parentLocationsIdsContainer.push(location.id);
          });
          parentLocationsNumberContainer = parentLocations.length;
        })
        .then(() => {
          // check if other locations need to be added
          if (locationsNo === 0) {
            app.logger.debug('No need to add new locations. Skip');
            return Promise.resolve();
          }

          // display log
          app.logger.debug('Creating locations');

          // create locations jobs so we can create them in parallel
          let newLocationsIds = [];
          const locationsJobs = [];
          for (let index = 0; index < locationsNo; index++) {
            locationsJobs.push((cb) => {
              // get charset to be used for location name
              const locationCharset = charsetType[randomFloatBetween(0, charsetsNo - 1, 0)];
              const locationName = randomString(locationCharset);
              app.logger.debug(`Creating location '${locationName}'`);

              // generate geo location
              const geoLocation = {
                lat: randomFloatBetween(
                  geoLocationRange.lat.min,
                  geoLocationRange.lat.max,
                  3
                ),
                lng: randomFloatBetween(
                  geoLocationRange.lng.min,
                  geoLocationRange.lng.max,
                  3
                )
              };

              // create location
              app.models.location
                .create(Object.assign(
                  defaultLocationTemplate, {
                    name: locationName,
                    parentLocationId: undefined,
                    geoLocation: geoLocation,
                    geographicalLevelId: outbreakAdminLevel
                  },
                  getTimestamps()
                ), options)
                .then((locationData) => {
                  // log
                  app.logger.debug(`Location '${locationData.name}' created => '${locationData.id}'`);

                  // map location for later use
                  locationsDataContainer[locationData.id] = locationData.toJSON();
                  // cache charset to be used on sublocations
                  locationsDataContainer[locationData.id].locationCharset = locationCharset;
                  newLocationsIds.push(locationData.id);
                  // finished
                  cb();
                })
                .catch(cb);
            });
          }

          // execute jobs
          return new Promise((resolve, reject) => {
            // wait for all operations to be done
            async.parallelLimit(locationsJobs, batchSize, function (error) {
              // error
              if (error) {
                return reject(error);
              }

              // display log
              app.logger.debug('Finished creating locations');

              // add useful variables in data
              parentLocationsIdsContainer = Object.keys(locationsDataContainer);
              parentLocationsNumberContainer = parentLocationsIdsContainer.length;

              // finished
              resolve(newLocationsIds);
            });
          });
        });
    })
    // populate sub-locations
    .then((newLocationsIds) => {
      if (!locationsDataContainer) {
        // no parent locations were create/retrieved then no sublocations need to be created/retrieved
        app.logger.debug('Skipping subLocations as they are not needed');
        return Promise.resolve();
      }

      // retrieve current 1st level sublocations
      return app.models.location
        .rawFindWithLoopbackFilter({
          where: {
            parentLocationId: {
              inq: Object.keys(locationsDataContainer)
            }
          }
        })
        .then(subLocations => {
          subLocations.forEach(location => {
            convertNestedGeoPointsToLatLng(location);
            if (!locationsDataContainer[location.parentLocationId].subLocations) {
              locationsDataContainer[location.parentLocationId].subLocations = [];
            }
            locationsDataContainer[location.parentLocationId].subLocations.push(location);
          });
        })
        .then(() => {
          // check if we need to add additional sublocations
          if (subLocationsPerLocationNo === 0) {
            app.logger.debug('No new subLocations need to be added. Skip');
            return Promise.resolve();
          }

          // display log
          app.logger.debug('Creating sub-locations');

          /**
           * Given a location data create sublocations payload and add them to queue if needed
           * @param location
           */
          function createSubLocationsPayload(location, queue) {
            if (location.level >= subLocationsLevelsNo) {
              // no additional sublocations need to be created
              return;
            }

            const subLocationLevel = location.level + 1;

            // create sublocations
            for (let index = 0; index < subLocationsPerLocationNo; index++) {
              const parentLocationData = location.data;
              // generate sublocation name; use same charset as parent location
              const locationName = randomString(location.locationCharset);

              // generate geo location
              const geoLocation = {
                lat: randomFloatBetween(
                  parentLocationData.geoLocation.lat + geoLocationRange.subLocationError.lat.min,
                  parentLocationData.geoLocation.lat + geoLocationRange.subLocationError.lat.max,
                  3
                ),
                lng: randomFloatBetween(
                  parentLocationData.geoLocation.lng + geoLocationRange.subLocationError.lng.min,
                  parentLocationData.geoLocation.lng + geoLocationRange.subLocationError.lng.max,
                  3
                )
              };

              const payload = {
                level: subLocationLevel,
                locationCharset: location.locationCharset,
                data: Object.assign({},
                  defaultLocationTemplate, {
                    name: locationName,
                    parentLocationId: parentLocationData.id,
                    geoLocation: geoLocation,
                    geographicalLevelId: outbreakAdminLevel
                  },
                  getTimestamps()
                )
              };

              // add sublocation in queue
              queue.push(payload);
            }
          }

          return new Promise((resolve, reject) => {
            let subLocationQueue = async.queue(function (payload, callback) {
              let location = payload.data;

              app.logger.debug(`Creating location '${location.name}'`);

              // create sub-location
              app.models.location
                .create(location, options)
                .then((locationData) => {
                  // log
                  app.logger.debug(`Location '${locationData.name}' created => '${locationData.id}'`);

                  // map only 1st level sublocations for later use
                  if (payload.level === 1) {
                    if (!locationsDataContainer[locationData.parentLocationId].subLocations) {
                      locationsDataContainer[locationData.parentLocationId].subLocations = [];
                    }
                    locationsDataContainer[locationData.parentLocationId].subLocations.push(locationData.toJSON());
                  }

                  createSubLocationsPayload({
                    level: payload.level,
                    locationCharset: payload.locationCharset,
                    data: locationData
                  }, subLocationQueue);

                  // finished
                  callback();
                })
                .catch(callback);
            }, batchSize);

            subLocationQueue.drain(function () {
              // display log
              app.logger.debug('Finished creating sub-locations');
              resolve();
            });

            subLocationQueue.error(reject);

            // create sublocations only for the newly created locations
            _.each(
              newLocationsIds,
              (parentLocationId) => {
                createSubLocationsPayload({
                  level: 0,
                  locationCharset: locationsDataContainer[parentLocationId].locationCharset,
                  data: locationsDataContainer[parentLocationId]
                }, subLocationQueue);
              });
          });
        });
    })

    // populate cases
    .then(() => {
      if (casesNo === 0) {
        // no new cases need to be created
        app.logger.debug('No new cases need to be created. Skip');
        return Promise.resolve();
      }

      // display log
      app.logger.debug('Creating cases');

      // create cases jobs so we can create them in parallel
      const casesJobs = [];
      for (let index = 0; index < casesNo; index++) {
        casesJobs.push((cb) => {
          const namesCharset = charsetType[randomFloatBetween(0, charsetsNo - 1, 0)];
          // determine first name
          const firstName = randomString(namesCharset);

          // determine last name - we might have the same name...same family
          const lastName = randomString(namesCharset);

          // generate dob
          let dob, age;
          if (Math.random() >= 0.3) {
            dob = localizationHelper.now()
              .startOf('day')
              .add(-randomFloatBetween(ageRange.min, ageRange.max, 0), 'years')
              .add(randomFloatBetween(0, 10, 0), 'months')
              .add(randomFloatBetween(0, 28, 0), 'days');

            // determine age
            age = {
              years: localizationHelper.now().startOf('day').diff(dob, 'years'),
              months: 0
            };
          }

          // determine gender
          const gender = Math.random() < 0.5 ?
            'LNG_REFERENCE_DATA_CATEGORY_GENDER_FEMALE' :
            'LNG_REFERENCE_DATA_CATEGORY_GENDER_MALE';

          // determine current address - some have an address while others don't
          // 90% have an address
          const addresses = [];
          if (Math.random() >= 0.1) {
            // determine location
            const parentLocationId = parentLocationsIdsContainer[index % parentLocationsNumberContainer];

            // use main location or child location ?
            let location;
            if (
              !locationsDataContainer[parentLocationId].subLocations ||
              !locationsDataContainer[parentLocationId].subLocations.length ||
              Math.random() < 0.5
            ) {
              location = locationsDataContainer[parentLocationId];
            } else {
              // use child location if we have one
              const childLocationIndex = randomFloatBetween(0, locationsDataContainer[parentLocationId].subLocations.length - 1, 0);
              location = locationsDataContainer[parentLocationId].subLocations[childLocationIndex];
            }

            // generate geo location
            const geoLocation = {
              lat: randomFloatBetween(
                location.geoLocation.lat + geoLocationRange.caseLocationError.lat.min,
                location.geoLocation.lat + geoLocationRange.caseLocationError.lat.max,
                3
              ),
              lng: randomFloatBetween(
                location.geoLocation.lng + geoLocationRange.caseLocationError.lng.min,
                location.geoLocation.lng + geoLocationRange.caseLocationError.lng.max,
                3
              )
            };

            // create address
            addresses.push({
              typeId: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
              city: `City ${randomFloatBetween(1, defaultCitiesNo, 0)}`,
              addressLine1: `Street ${randomFloatBetween(1, defaultAddressLineNo, 0)}`,
              postalCode: randomFloatBetween(defaultPostalCodeRange.min, defaultPostalCodeRange.max, 0).toString(),
              locationId: location.id,
              geoLocation: geoLocation,
              geoLocationAccurate: false,
              date: todayString,
              phoneNumber: `Phone ${randomFloatBetween(1, defaultPhoneNo, 0)}`,
            });
          }

          // determine dates
          const dateOfOnset = outbreakStartDate.clone().add(randomFloatBetween(1, 120, 0), 'days');
          const dateOfReporting = dateOfOnset.clone().add(1, 'days');
          const dateOfOutcome = dateOfReporting.clone().add(1, 'days');

          // determine outcome
          let outcomeId = 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED';
          if (Math.random() >= 0.1) {
            outcomeId = [
              'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_ALIVE',
              'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_RECOVERED'
            ][randomFloatBetween(0, 1, 0)];
          }

          // determine classification
          let classification = 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_NOT_A_CASE_DISCARDED';
          if (
            outcomeId === 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED' ||
            Math.random() >= 0.1
          ) {
            classification = [
              'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED',
              'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_PROBABLE',
              'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_SUSPECT'
            ][randomFloatBetween(0, 2, 0)];
          }

          // determine date of burial
          let dateOfBurial;
          if (
            outcomeId === 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED' &&
            Math.random() >= 0.3
          ) {
            dateOfBurial = dateOfOutcome.clone().add(7, 'days');
          }

          // determine risk level
          const riskLevel = [
            'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_1_LOW',
            'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_2_MEDIUM',
            'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_3_HIGH'
          ][randomFloatBetween(0, 2, 0)];

          // display log
          app.logger.debug(`Creating case '${lastName} ${firstName}'`);

          // create case
          app.models.case
            .create(Object.assign(
              defaultCaseTemplate, {
                outbreakId: outbreakDataContainer.id,
                firstName: firstName,
                lastName: lastName,
                dob: dob ? dob.toISOString() : dob,
                age: age,
                gender: gender,
                addresses: addresses,
                dateOfLastContact: todayString,
                dateOfOnset: dateOfOnset ? dateOfOnset.toISOString() : dateOfOnset,
                dateOfReporting: dateOfReporting ? dateOfReporting.toISOString() : dateOfReporting,
                dateOfOutcome: dateOfOutcome ? dateOfOutcome.toISOString() : dateOfOutcome,
                outcomeId: outcomeId,
                classification: classification,
                dateOfBurial: dateOfBurial ? dateOfBurial.toISOString() : dateOfBurial,
                riskLevel: riskLevel
              },
              getTimestamps()
            ), options)
            .then((caseData) => {
              // log
              app.logger.debug(`Case '${caseData.lastName} ${caseData.firstName}' created => '${caseData.id}'`);

              // finished
              cb();
            })
            .catch(cb);
        });
      }

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(casesJobs, batchSize, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating cases');

          // finished
          resolve();
        });
      });
    })

    // populate contacts
    .then(() => {
      if (contactsNo === 0) {
        // no new contacts need to be created
        app.logger.debug('No new contacts need to be created. Skip');
        return Promise.resolve();
      }

      // display log
      app.logger.debug('Creating contacts');

      // create contacts jobs so we can create them in parallel
      const contactsJobs = [];
      for (let index = 0; index < contactsNo; index++) {
        contactsJobs.push((cb) => {
          const namesCharset = charsetType[randomFloatBetween(0, charsetsNo - 1, 0)];
          // determine first name
          const firstName = randomString(namesCharset);

          // determine last name - we might have the same name...same family
          const lastName = randomString(namesCharset);

          // generate dob
          let dob, age;
          if (Math.random() >= 0.3) {
            dob = localizationHelper.now()
              .startOf('day')
              .add(-randomFloatBetween(ageRange.min, ageRange.max, 0), 'years')
              .add(randomFloatBetween(0, 10, 0), 'months')
              .add(randomFloatBetween(0, 28, 0), 'days');

            // determine age
            age = {
              years: localizationHelper.now().startOf('day').diff(dob, 'years'),
              months: 0
            };
          }

          // determine gender
          const gender = Math.random() < 0.5 ?
            'LNG_REFERENCE_DATA_CATEGORY_GENDER_FEMALE' :
            'LNG_REFERENCE_DATA_CATEGORY_GENDER_MALE';

          // determine current address - some have an address while others don't
          // 90% have an address
          const addresses = [];
          if (Math.random() >= 0.1) {
            // determine location
            const parentLocationId = parentLocationsIdsContainer[index % parentLocationsNumberContainer];

            // use main location or child location ?
            let location;
            if (
              !locationsDataContainer[parentLocationId].subLocations ||
              !locationsDataContainer[parentLocationId].subLocations.length ||
              Math.random() < 0.5
            ) {
              location = locationsDataContainer[parentLocationId];
            } else {
              // use child location if we have one
              const childLocationIndex = randomFloatBetween(0, locationsDataContainer[parentLocationId].subLocations.length - 1, 0);
              location = locationsDataContainer[parentLocationId].subLocations[childLocationIndex];
            }

            // generate geo location
            const geoLocation = {
              lat: randomFloatBetween(
                location.geoLocation.lat + geoLocationRange.contactLocationError.lat.min,
                location.geoLocation.lat + geoLocationRange.contactLocationError.lat.max,
                3
              ),
              lng: randomFloatBetween(
                location.geoLocation.lng + geoLocationRange.contactLocationError.lng.min,
                location.geoLocation.lng + geoLocationRange.contactLocationError.lng.max,
                3
              )
            };

            // create address
            addresses.push({
              typeId: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
              city: `City ${randomFloatBetween(1, defaultCitiesNo, 0)}`,
              addressLine1: `Street ${randomFloatBetween(1, defaultAddressLineNo, 0)}`,
              postalCode: randomFloatBetween(defaultPostalCodeRange.min, defaultPostalCodeRange.max, 0).toString(),
              locationId: location.id,
              geoLocation: geoLocation,
              geoLocationAccurate: false,
              date: todayString,
              phoneNumber: `Phone ${randomFloatBetween(1, defaultPhoneNo, 0)}`,
            });
          }

          // determine dates
          const dateOfReporting = outbreakStartDate.clone().add(randomFloatBetween(1, 120, 0), 'days');

          // determine risk level
          const riskLevel = [
            'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_1_LOW',
            'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_2_MEDIUM',
            'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_3_HIGH'
          ][randomFloatBetween(0, 2, 0)];

          // display log
          app.logger.debug(`Creating contact '${lastName} ${firstName}'`);

          // create contact
          app.models.contact
            .create(Object.assign(
              defaultContactTemplate, {
                outbreakId: outbreakDataContainer.id,
                firstName: firstName,
                lastName: lastName,
                dob: dob ? dob.toISOString() : dob,
                age: age,
                gender: gender,
                addresses: addresses,
                dateOfReporting: dateOfReporting ? dateOfReporting.toISOString() : dateOfReporting,
                riskLevel: riskLevel
              },
              getTimestamps()
            ), options)
            .then((contactData) => {
              // log
              app.logger.debug(`Contact '${contactData.lastName} ${contactData.firstName}' created => '${contactData.id}'`);

              // finished
              cb();
            })
            .catch(cb);
        });
      }

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(contactsJobs, batchSize, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating contacts');

          // finished
          resolve();
        });
      });
    })

    // populate events
    .then(() => {
      if (eventsNo === 0) {
        // no new events need to be created
        app.logger.debug('No new events need to be added. Skip');
        return Promise.resolve();
      }

      // display log
      app.logger.debug('Creating events');

      // create events jobs so we can create them in parallel
      const eventsJobs = [];
      for (let index = 0; index < eventsNo; index++) {
        eventsJobs.push((cb) => {
          // determine event name
          const name = randomString(charsetType[randomFloatBetween(0, charsetsNo - 1, 0)]);

          // determine current address - some have an address while others don't
          // 90% have an address
          let address;
          if (Math.random() >= 0.1) {
            // determine location
            const parentLocationId = parentLocationsIdsContainer[index % parentLocationsNumberContainer];

            // use main location or child location ?
            let location;
            if (
              !locationsDataContainer[parentLocationId].subLocations ||
              !locationsDataContainer[parentLocationId].subLocations.length ||
              Math.random() < 0.5
            ) {
              location = locationsDataContainer[parentLocationId];
            } else {
              // use child location if we have one
              const childLocationIndex = randomFloatBetween(0, locationsDataContainer[parentLocationId].subLocations.length - 1, 0);
              location = locationsDataContainer[parentLocationId].subLocations[childLocationIndex];
            }

            // generate geo location
            const geoLocation = {
              lat: randomFloatBetween(
                location.geoLocation.lat + geoLocationRange.contactLocationError.lat.min,
                location.geoLocation.lat + geoLocationRange.contactLocationError.lat.max,
                3
              ),
              lng: randomFloatBetween(
                location.geoLocation.lng + geoLocationRange.contactLocationError.lng.min,
                location.geoLocation.lng + geoLocationRange.contactLocationError.lng.max,
                3
              )
            };

            // create address
            address = {
              typeId: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
              city: `City ${randomFloatBetween(1, defaultCitiesNo, 0)}`,
              addressLine1: `Street ${randomFloatBetween(1, defaultAddressLineNo, 0)}`,
              postalCode: randomFloatBetween(defaultPostalCodeRange.min, defaultPostalCodeRange.max, 0).toString(),
              locationId: location.id,
              geoLocation: geoLocation,
              geoLocationAccurate: false,
              date: todayString,
              phoneNumber: `Phone ${randomFloatBetween(1, defaultPhoneNo, 0)}`,
            };
          }

          // determine dates
          const date = outbreakStartDate.clone().add(randomFloatBetween(1, 120, 0), 'days');
          const dateOfReporting = date.clone().add(5, 'days');

          // display log
          app.logger.debug(`Creating event '${name}'`);

          // create event
          app.models.event
            .create(Object.assign(
              defaultEventTemplate, {
                outbreakId: outbreakDataContainer.id,
                name: name,
                address: address,
                dateOfReporting: dateOfReporting ? dateOfReporting.toISOString() : dateOfReporting,
                date: date ? date.toISOString() : date
              },
              getTimestamps()
            ), options)
            .then((eventData) => {
              // log
              app.logger.debug(`Event '${eventData.name}' created => '${eventData.id}'`);

              // finished
              cb();
            })
            .catch(cb);
        });
      }

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(eventsJobs, batchSize, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating events');

          // finished
          resolve();
        });
      });
    })

    // create relationships
    .then(() => {
      if (
        minNoRelationshipsForEachRecord === 0 &&
        maxNoRelationshipsForEachRecord === 0
      ) {
        // no relations need to be created/retrieved
        app.logger.debug('No relations need to be added. Skip');
        return Promise.resolve();
      }

      // display log
      app.logger.debug('Creating relationships');

      // initialize map of resources for which to create relationships to type
      let resourcesMap = {
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE': 'case',
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT': 'contact',
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT': 'event'
      };
      let resources = Object.values(resourcesMap);

      // initialize filter for counting and filtering persons
      let personsFilter = {};

      resources.forEach(res => {
        personsFilter[res] = {
          outbreakId: outbreakDataContainer.id
        };

        // depending on relationshipsForAlreadyAssociatedPerson we will only create relationships for not already associated person or for all
        if (!relationshipsForAlreadyAssociatedPerson) {
          personsFilter[res].hasRelationships = {
            ne: true
          };
        }
      });

      // get number of cases, contacts, events and split relationship creation in multiple batches to avoid loading entire DB in memory
      let countJobs = {};
      resources.forEach(res => {
        countJobs[res] = (cb) => {
          return app.models[res]
            .count(personsFilter[res])
            .then(count => {
              cb(null, count);
            })
            .catch(cb);
        };
      });

      return new Promise((resolveCounters, rejectCounters) => {
        async.parallel(countJobs, (err, countersMap) => {
          if (err) {
            return rejectCounters(err);
          }

          // initialize resources in DB array
          let resourcesInDb = [];

          // get maximum number of resources
          let maxResNo = 0;
          let resWithMaxNo;
          resources.forEach(res => {
            // remove resource types which don't exist in DB
            if (countersMap[res] === 0) {
              delete countersMap[res];
              return;
            }

            // use resource in future calculations
            resourcesInDb.push(res);

            if (maxResNo < countersMap[res]) {
              maxResNo = countersMap[res];
              resWithMaxNo = res;
            }
          });

          if (!resourcesInDb.length) {
            return rejectCounters('No resources exist in DB for which to create relations');
          }

          // get a maximum of 1000 resources per type at a time
          let resourcesPerBatch = 1000;
          // no need to check if additional items remain after the batches as we will get all remaining data in last batch
          let batches = Math.floor(maxResNo / resourcesPerBatch);
          // don't allow 0
          batches === 0 && (batches++);

          // get limits for all resources pe batch
          let limits = {};
          resourcesInDb.forEach(res => {
            if (resWithMaxNo === res) {
              limits[res] = resourcesPerBatch;
            } else {
              limits[res] = Math.floor(countersMap[res] / batches);
              // don't allow 0
              (limits[res] === 0) && limits[res]++;
            }
          });

          // cache existing relationships
          const existingRelationships = {};

          // create batches jobs
          let batchesJobs = [];

          // cache last batch data as for some resource there might not be enough items to get in all batches
          let retrievedLastBatchData = {};

          for (let jobNo = 1; jobNo <= batches; jobNo++) {
            batchesJobs.push(batchJobCB => {
              // retrieve data
              let retrieveDataJobs = {};
              resourcesInDb.forEach(res => {
                retrieveDataJobs[res] = (retrieveDataCB) => {
                  let retrieveDataPromise;

                  if (
                    // need to execute at least once
                    jobNo > 1 &&
                    (jobNo * limits[res]) > countersMap[res]
                  ) {
                    // no additional data to retrieve; use last batch data
                    retrieveDataPromise = Promise.resolve(retrievedLastBatchData[res]);
                  } else {
                    retrieveDataPromise = app.models[res]
                      .rawFindWithLoopbackFilter({
                        where: personsFilter[res],
                        fields: ['id', 'type', 'classification'],
                        skip: (jobNo - 1) * limits[res],
                        // no limit on last batch
                        limit: jobNo !== batches ? limits[res] : null,
                        order: ['createdAt ASC']
                      });
                  }

                  return retrieveDataPromise
                    .then(resources => {
                      // cache batch data
                      retrievedLastBatchData[res] && (delete retrievedLastBatchData[res]);
                      retrievedLastBatchData[res] = resources;

                      return retrieveDataCB(null, resources);
                    })
                    .catch(retrieveDataCB);
                };
              });

              app.logger.debug(`Starting relations job ${jobNo}`);

              return new Promise((resolveRetrieveJobs, rejectRetrieveJobs) => {
                async.series(retrieveDataJobs, (err, resources) => {
                  if (err) {
                    return rejectRetrieveJobs(err);
                  }

                  // map received data
                  let resourcesContainer = {};
                  let resourcesIdsContainer = {};
                  resourcesInDb.forEach(res => {
                    resourcesContainer[res] = {};
                    resourcesIdsContainer[res] = [];
                    resources[res].forEach(item => {
                      resourcesContainer[res][item.id] = item;
                      resourcesIdsContainer[res].push(item.id);
                    });
                  });

                  // contacts
                  contactsContainer = resourcesContainer.contact || {};

                  // cases
                  casesContainer = resourcesContainer.case || {};

                  // events
                  eventsContainer = resourcesContainer.event || {};

                  const caseIds = resourcesIdsContainer.case || [];
                  const contactIds = resourcesIdsContainer.contact || [];
                  const eventIds = resourcesIdsContainer.event || [];
                  const caseAndEventsIds = [
                    ...caseIds,
                    ...eventIds
                  ];
                  const personIds = [
                    ...caseAndEventsIds,
                    ...contactIds
                  ];

                  // create relationships
                  const relationshipsJobs = [];

                  const createRelationshipJobs = (personData) => {
                    // how many relationships do we need to create
                    let relationshipsNo = randomFloatBetween(minNoRelationshipsForEachRecord, maxNoRelationshipsForEachRecord);

                    // each contact must have at least one relationship
                    relationshipsNo = personData.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' ?
                      (
                        // handle case where required relationships number is bigger than actual pool
                        relationshipsNo < caseAndEventsIds.length ?
                          Math.max(relationshipsNo, 1) :
                          caseAndEventsIds.length
                      ) : (
                        // handle case where required relationships number is bigger than actual pool
                        relationshipsNo < personIds.length ?
                          relationshipsNo :
                          personIds.length
                      );

                    // create relationships
                    for (let index = 0; index < relationshipsNo; index++) {
                      // check if person already has existing relationships
                      let personExistingRelationships = existingRelationships[personData.id] || {};
                      let personExistingRelationshipsNo = Object.keys(personExistingRelationships).length;

                      // check if additional relationships can be created
                      if (
                        (
                          personData.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' &&
                          personExistingRelationshipsNo >= caseAndEventsIds.length
                        ) || (
                          (
                            personData.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' ||
                            personData.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                          ) &&
                          personExistingRelationshipsNo >= personIds.length - 1
                        )
                      ) {
                        // there are no persons with which the person doesn't have relationships
                        return;
                      }

                      // determine the other person
                      // - exclude teh same person
                      // - exclude duplicate relationships
                      let otherPerson;
                      while (
                        otherPerson === undefined ||
                        otherPerson.id === personData.id || (
                          existingRelationships[otherPerson.id] &&
                          existingRelationships[otherPerson.id][personData.id]
                        )
                      ) {
                        // case / event / contact ?
                        const idsPool = personData.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' ?
                          caseAndEventsIds :
                          personIds;

                        // determine id
                        let index = randomFloatBetween(0, idsPool.length, 0);
                        // handle low probability of actually getting the max value from randomFloatBetween
                        (index === idsPool.length) && index--;
                        const otherId = idsPool[index];
                        otherPerson = casesContainer[otherId] ?
                          casesContainer[otherId] : (
                            contactsContainer[otherId] ?
                              contactsContainer[otherId] :
                              eventsContainer[otherId]
                          );
                      }

                      // determine persons
                      const persons = [];

                      // contact always needs to be target
                      if (personData.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                        persons.push({
                          id: personData.id,
                          type: personData.type,
                          target: true
                        }, {
                          id: otherPerson.id,
                          type: otherPerson.type,
                          source: true
                        });
                      } else if (otherPerson.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                        persons.push({
                          id: otherPerson.id,
                          type: otherPerson.type,
                          target: true
                        }, {
                          id: personData.id,
                          type: personData.type,
                          source: true
                        });
                      } else {
                        // relation between cases & events
                        // determine who is source
                        if (Math.random() < 0.5) {
                          persons.push({
                            id: personData.id,
                            type: personData.type,
                            target: true
                          }, {
                            id: otherPerson.id,
                            type: otherPerson.type,
                            source: true
                          });
                        } else {
                          persons.push({
                            id: otherPerson.id,
                            type: otherPerson.type,
                            target: true
                          }, {
                            id: personData.id,
                            type: personData.type,
                            source: true
                          });
                        }
                      }

                      // add relationship to list of existing relationships
                      if (!existingRelationships[persons[1].id]) {
                        existingRelationships[persons[1].id] = {};
                      }
                      existingRelationships[persons[1].id][persons[0].id] = true;

                      // and the reverse
                      if (!existingRelationships[persons[0].id]) {
                        existingRelationships[persons[0].id] = {};
                      }
                      existingRelationships[persons[0].id][persons[1].id] = true;

                      // determine active flag
                      const active = (personData.classification === 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_NOT_A_CASE_DISCARDED' ||
                        otherPerson.classification === 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_NOT_A_CASE_DISCARDED') ? false : true;

                      // determine dates
                      const contactDate = outbreakStartDate.clone().add(randomFloatBetween(1, 120, 0), 'days');

                      // determine certainty
                      const certaintyLevelId = [
                        'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL_1_LOW',
                        'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL_2_MEDIUM',
                        'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL_3_HIGH'
                      ][randomFloatBetween(0, 2, 0)];

                      // only some have exposure type
                      let exposureTypeId;
                      if (Math.random() >= 0.5) {
                        exposureTypeId = [
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE_DIRECT_PHYSICAL_CONTACT',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE_SLEPT_ATE_OR_SPEND_TIME_IN_SAME_HOUSEHOLD',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE_TOUCHED_BODY_FLUIDS'
                        ][randomFloatBetween(0, 3, 0)];
                      }

                      // only some have exposure frequency
                      let exposureFrequencyId;
                      if (Math.random() >= 0.5) {
                        exposureFrequencyId = [
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY_11_20_TIMES',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY_1_5_TIMES',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY_6_10_TIMES',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY_OVER_21_TIMES',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY_UNKNOWN'
                        ][randomFloatBetween(0, 4, 0)];
                      }

                      // only some have exposure duration
                      let exposureDurationId;
                      if (Math.random() >= 0.5) {
                        exposureDurationId = [
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION_LONG_DAYS',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION_MEDIUM_HOURS',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION_SHORT_MINUTES',
                          'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION_VERY_SHORT_SECONDS'
                        ][randomFloatBetween(0, 3, 0)];
                      }

                      // create relationship
                      relationshipsJobs.push((cb) => {
                        // create relationship
                        app.models.relationship
                          .create(Object.assign(
                            defaultRelationshipTemplate, {
                              outbreakId: outbreakDataContainer.id,
                              persons: persons,
                              active: active,
                              contactDate: contactDate ? contactDate.toISOString() : contactDate,
                              certaintyLevelId: certaintyLevelId,
                              exposureTypeId: exposureTypeId,
                              exposureFrequencyId: exposureFrequencyId,
                              exposureDurationId: exposureDurationId
                            },
                            getTimestamps()
                          ), options)
                          .then((relationshipData) => {
                            // log
                            app.logger.debug(`Relationship created => '${relationshipData.id}'`);

                            // create update participant jobs
                            let updateParticipantsJobs = relationshipData.persons.map((person, index) => {
                              // get other participant
                              let otherParticipant = relationshipData.persons[index === 0 ? 1 : 0];

                              // update relationship participants with hasRelationship flag
                              return app.dataSources.mongoDb.connector.collection('person')
                                .updateOne({
                                  _id: person.id
                                }, {
                                  '$set': {
                                    hasRelationships: true,

                                    // #TODO - must update script to count person relationships to determine no. of exposures and contacts
                                    numberOfContacts: 0,
                                    numberOfExposures: 0
                                  },
                                  '$addToSet': {
                                    relationshipsRepresentation: {
                                      id: relationshipData._id,
                                      active: relationshipData.active,
                                      otherParticipantType: otherParticipant.type,
                                      otherParticipantId: otherParticipant.id,
                                      target: person.target,
                                      source: person.source
                                    }
                                  }
                                });
                            });

                            // update relationship participants
                            return Promise.all(updateParticipantsJobs);
                          })
                          .then(() => {
                            // finished
                            cb();
                          })
                          .catch(cb);
                      });
                    }
                  };

                  // contacts
                  contactIds.length && _.each(contactsContainer, createRelationshipJobs);

                  // cases
                  caseIds.length && _.each(casesContainer, createRelationshipJobs);

                  // events
                  eventIds.length && _.each(eventsContainer, createRelationshipJobs);

                  app.logger.debug(`Relationships to create: ${relationshipsJobs.length}`);

                  // execute jobs
                  return new Promise((resolveRelationships, rejectRelationships) => {
                    async.parallelLimit(relationshipsJobs, batchSize, (err) => {
                      if (err) {
                        return rejectRelationships(err);
                      }
                      // display log
                      app.logger.debug(`Finished creating relationships batch ${jobNo}`);
                      resolveRelationships();
                    });
                  })
                    .then(() => {
                      resolveRetrieveJobs();
                    })
                    .catch(rejectRetrieveJobs);
                });
              })
                .then(() => {
                  batchJobCB();
                })
                .catch(batchJobCB);
            });
          }

          return new Promise((resolveBatches, rejectBatches) => {
            async.series(batchesJobs, (err) => {
              if (err) {
                return rejectBatches(err);
              }

              return resolveBatches();
            });
          })
            .then(() => {
              resolveCounters();
            })
            .catch(rejectCounters);
        });
      });
    })

    // finished
    .then(() => {
      // log
      app.logger.debug('Finished populating database');

      // finished
      callback();
    })
    .catch(callback);
}

module.exports = (methodRelevantArgs) => {
  // keep arguments
  module.methodRelevantArgs = methodRelevantArgs;

  // finished
  return run;
};
