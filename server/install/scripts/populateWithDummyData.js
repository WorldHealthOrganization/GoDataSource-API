'use strict';

const app = require('../../server');
const common = require('./_common');
const async = require('async');
const moment = require('moment');
const _ = require('lodash');

// initialize action options; set _init, _sync flags to prevent execution of some after save scripts
let options = {
  _init: true,
  _sync: true
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // retrieve config data
  const outbreakName = module.methodRelevantArgs.outbreakName;
  const casesNo = module.methodRelevantArgs.casesNo;
  const contactsNo = module.methodRelevantArgs.contactsNo;
  const eventsNo = module.methodRelevantArgs.eventsNo;
  const locationsNo = module.methodRelevantArgs.locationsNo;
  const subLocationsPerLocationNo = module.methodRelevantArgs.subLocationsPerLocationNo;
  const minNoRelationshipsForEachRecord = module.methodRelevantArgs.minNoRelationshipsForEachRecord;
  const maxNoRelationshipsForEachRecord = module.methodRelevantArgs.maxNoRelationshipsForEachRecord;

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
  const today = moment.utc().startOf('day');
  const todayString = today.toISOString();
  const defaultCitiesNo = 10;
  const defaultAddressLineNo = 5;
  const defaultPostalCodeRange = {
    min: 10000,
    max: 20000
  };
  const defaultPhoneNo = 10;
  const lastNameError = 3;

  // default outbreak template
  const outbreakStartDate = moment().utc().add(-6, 'months').startOf('day');
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
    contactFollowUpTemplate: [],
    labResultsTemplate: [],
    caseIdMask: '*',
    contactIdMask: '*',
    reportingGeographicalLevelId: outbreakAdminLevel
  };

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
  };

  // default event template
  const defaultEventTemplate = {
    description: 'Created by populate script',
    isDateOfReportingApproximate: false
  };

  // default relationship template
  const defaultRelationshipTemplate = {
    contactDateEstimated: false,
    active: true,
    clusterId: undefined,
    socialRelationshipTypeId: undefined,
    socialRelationshipDetail: undefined
  };

  // generate random numbers between min & max
  const randomFloatBetween = (
    minValue,
    maxValue,
    precision
  ) => {
    if(typeof(precision) === 'undefined') {
      precision = 2;
    }
    return parseFloat(Math.min(minValue + (Math.random() * (maxValue - minValue)),maxValue).toFixed(precision));
  };

  // create outbreak
  app.logger.debug(`Creating outbreak ${outbreakName}`);
  app.models.outbreak
    .create(Object.assign(
      defaultOutbreakTemplate, {
        name: outbreakName
      },
      common.install.timestamps
    ), options)
    .then((outbreakData) => {
      // outbreak created
      app.logger.debug(`Outbreak '${outbreakData.name}' created => '${outbreakData.id}'`);

      // start creating locations
      return {
        outbreakData: outbreakData.toJSON()
      };
    })

    // populate locations
    .then((data) => {
      // display log
      app.logger.debug('Creating locations');

      // create locations jobs so we can create them in parallel
      data.locations = {};
      const locationsJobs = [];
      for (let index = 0; index < locationsNo; index++) {
        locationsJobs.push((cb) => {
          // display log
          const locationName = `${outbreakName} location ${index + 1}`;
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
              common.install.timestamps
            ), options)
            .then((locationData) => {
              // log
              app.logger.debug(`Location '${locationData.name}' created => '${locationData.id}'`);

              // map location for later use
              data.locations[locationData.id] = locationData.toJSON();

              // finished
              cb();
            })
            .catch(cb);
        });
      }

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(locationsJobs, 10, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating locations');

          // finished
          resolve(data);
        });
      });
    })

    // populate sub-locations
    .then((data) => {
      // display log
      app.logger.debug('Creating sub-locations');

      // create locations jobs so we can create them in parallel
      const locationsJobs = [];
      _.each(
        data.locations,
        (parentLocationData) => {
          for (let index = 0; index < subLocationsPerLocationNo; index++) {
            locationsJobs.push((cb) => {
              // display log
              const locationName = `${parentLocationData.name} sub ${index + 1}`;
              app.logger.debug(`Creating location '${locationName}'`);

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

              // create sub-location
              app.models.location
                .create(Object.assign(
                  defaultLocationTemplate, {
                    name: locationName,
                    parentLocationId: parentLocationData.id,
                    geoLocation: geoLocation,
                    geographicalLevelId: outbreakAdminLevel
                  },
                  common.install.timestamps
                ), options)
                .then((locationData) => {
                  // log
                  app.logger.debug(`Location '${locationData.name}' created => '${locationData.id}'`);

                  // map location for later use
                  if (!data.locations[locationData.parentLocationId].subLocations) {
                    data.locations[locationData.parentLocationId].subLocations = [];
                  }
                  data.locations[locationData.parentLocationId].subLocations.push(locationData.toJSON());

                  // finished
                  cb();
                })
                .catch(cb);
            });
          }
        }
      );

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(locationsJobs, 10, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating sub-locations');

          // finished
          resolve(data);
        });
      });
    })

    // populate cases
    .then((data) => {
      // display log
      app.logger.debug('Creating cases');

      // create cases jobs so we can create them in parallel
      data.cases = {};
      const casesJobs = [];
      const parentLocationIds = Object.keys(data.locations);
      for (let index = 0; index < casesNo; index++) {
        casesJobs.push((cb) => {
          // determine first name ( unique )
          const firstName = `CaseFirst${index + 1}`;

          // determine last name - we might have the same name...same family
          const lastName = `CaseLast${randomFloatBetween(Math.max(index - lastNameError, 0), index + lastNameError,0)}`;

          // generate dob
          let dob, age;
          if (Math.random() >= 0.3) {
            dob = moment().utc()
              .startOf('day')
              .add(-randomFloatBetween(ageRange.min, ageRange.max, 0), 'years')
              .add(randomFloatBetween(0, 10, 0), 'months')
              .add(randomFloatBetween(0, 28, 0), 'days');

            // determine age
            age = {
              years: moment().utc().startOf('day').diff(dob, 'years'),
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
            const parentLocationId = parentLocationIds[index % locationsNo];

            // use main location or child location ?
            let location;
            if (
              subLocationsPerLocationNo < 1 ||
              Math.random() < 0.5
            ) {
              location = data.locations[parentLocationId];
            } else {
              // use child location if we have one
              const childLocationIndex = randomFloatBetween(0, subLocationsPerLocationNo - 1, 0);
              location = data.locations[parentLocationId].subLocations[childLocationIndex];
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
          const dateOfOnset = outbreakStartDate.add(randomFloatBetween(1, 120, 0), 'days');
          const dateOfReporting = dateOfOnset.add(1, 'days');
          const dateOfOutcome = dateOfReporting.add(1, 'days');

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
            dateOfBurial = dateOfOutcome.add(7, 'days');
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
                outbreakId: data.outbreakData.id,
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
              common.install.timestamps
            ), options)
            .then((caseData) => {
              // log
              app.logger.debug(`Case '${caseData.lastName} ${caseData.firstName}' created => '${caseData.id}'`);

              // map case for later use
              data.cases[caseData.id] = {
                id: caseData.id,
                type: caseData.type
              };

              // finished
              cb();
            })
            .catch(cb);
        });
      }

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(casesJobs, 10, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating cases');

          // finished
          resolve(data);
        });
      });
    })

    // populate contacts
    .then((data) => {
      // display log
      app.logger.debug('Creating contacts');

      // create contacts jobs so we can create them in parallel
      data.contacts = {};
      const contactsJobs = [];
      const parentLocationIds = Object.keys(data.locations);
      for (let index = 0; index < contactsNo; index++) {
        contactsJobs.push((cb) => {
          // determine first name ( unique )
          const firstName = `ContactFirst${index + 1}`;

          // determine last name - we might have the same name...same family
          const lastName = `ContactLast${randomFloatBetween(Math.max(index - lastNameError, 0), index + lastNameError,0)}`;

          // generate dob
          let dob, age;
          if (Math.random() >= 0.3) {
            dob = moment().utc()
              .startOf('day')
              .add(-randomFloatBetween(ageRange.min, ageRange.max, 0), 'years')
              .add(randomFloatBetween(0, 10, 0), 'months')
              .add(randomFloatBetween(0, 28, 0), 'days');

            // determine age
            age = {
              years: moment().utc().startOf('day').diff(dob, 'years'),
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
            const parentLocationId = parentLocationIds[index % locationsNo];

            // use main location or child location ?
            let location;
            if (
              subLocationsPerLocationNo < 1 ||
              Math.random() < 0.5
            ) {
              location = data.locations[parentLocationId];
            } else {
              // use child location if we have one
              const childLocationIndex = randomFloatBetween(0, subLocationsPerLocationNo - 1, 0);
              location = data.locations[parentLocationId].subLocations[childLocationIndex];
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
          const dateOfReporting = outbreakStartDate.add(randomFloatBetween(1, 120, 0), 'days');

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
                outbreakId: data.outbreakData.id,
                firstName: firstName,
                lastName: lastName,
                dob: dob ? dob.toISOString() : dob,
                age: age,
                gender: gender,
                addresses: addresses,
                dateOfReporting: dateOfReporting ? dateOfReporting.toISOString() : dateOfReporting,
                riskLevel: riskLevel
              },
              common.install.timestamps
            ), options)
            .then((contactData) => {
              // log
              app.logger.debug(`Contact '${contactData.lastName} ${contactData.firstName}' created => '${contactData.id}'`);

              // map contact for later use
              data.contacts[contactData.id] = {
                id: contactData.id,
                type: contactData.type
              };

              // finished
              cb();
            })
            .catch(cb);
        });
      }

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(contactsJobs, 10, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating contacts');

          // finished
          resolve(data);
        });
      });
    })

    // populate events
    .then((data) => {
      // display log
      app.logger.debug('Creating events');

      // create events jobs so we can create them in parallel
      data.events = {};
      const eventsJobs = [];
      const parentLocationIds = Object.keys(data.locations);
      for (let index = 0; index < eventsNo; index++) {
        eventsJobs.push((cb) => {
          // determine event name
          const name = `Event${index + 1}`;

          // determine current address - some have an address while others don't
          // 90% have an address
          let address;
          if (Math.random() >= 0.1) {
            // determine location
            const parentLocationId = parentLocationIds[index % locationsNo];

            // use main location or child location ?
            let location;
            if (
              subLocationsPerLocationNo < 1 ||
              Math.random() < 0.5
            ) {
              location = data.locations[parentLocationId];
            } else {
              // use child location if we have one
              const childLocationIndex = randomFloatBetween(0, subLocationsPerLocationNo - 1, 0);
              location = data.locations[parentLocationId].subLocations[childLocationIndex];
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
          const date = outbreakStartDate.add(randomFloatBetween(1, 120, 0), 'days');
          const dateOfReporting = date.add(5, 'days');

          // display log
          app.logger.debug(`Creating event '${name}'`);

          // create event
          app.models.event
            .create(Object.assign(
              defaultEventTemplate, {
                outbreakId: data.outbreakData.id,
                name: name,
                address: address,
                dateOfReporting: dateOfReporting ? dateOfReporting.toISOString() : dateOfReporting,
                date: date ? date.toISOString() : date
              },
              common.install.timestamps
            ), options)
            .then((eventData) => {
              // log
              app.logger.debug(`Event '${eventData.name}' created => '${eventData.id}'`);

              // map event for later use
              data.events[eventData.id] = {
                id: eventData.id,
                type: eventData.type
              };

              // finished
              cb();
            })
            .catch(cb);
        });
      }

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(eventsJobs, 10, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating events');

          // finished
          resolve(data);
        });
      });
    })

    // create relationships
    .then((data) => {
      // display log
      app.logger.debug('Creating relationships');

      // create relationships
      const relationshipsJobs = [];
      const existingRelationships = {};
      const caseIds = Object.keys(data.cases);
      const contactIds = Object.keys(data.contacts);
      const eventIds = Object.keys(data.events);
      const caseAndEventsIds = [
        ...caseIds,
        ...eventIds
      ];
      const personIds = [
        ...caseAndEventsIds,
        ...contactIds
      ];
      const createRelationshipJobs = (personData) => {
        // how many relationships do we need to create
        let relationshipsNo = randomFloatBetween(minNoRelationshipsForEachRecord, maxNoRelationshipsForEachRecord);

        // each contact must have at least one relationship
        relationshipsNo = personData.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' ?
          Math.max(relationshipsNo, 1) :
          relationshipsNo;

        // create relationships
        for (let index = 0; index < relationshipsNo; index++) {
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
            const otherId = idsPool[randomFloatBetween(0, idsPool.length - 1, 0)];
            otherPerson = data.cases[otherId] ?
              data.cases[otherId]: (
                data.contacts[otherId] ?
                  data.contacts[otherId] :
                  data.events[otherId]
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

          // and teh reverse
          if (!existingRelationships[persons[0].id]) {
            existingRelationships[persons[0].id] = {};
          }
          existingRelationships[persons[0].id][persons[1].id] = true;

          // determine dates
          const contactDate = outbreakStartDate.add(randomFloatBetween(1, 120, 0), 'days');

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
              'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE_TOUCHED_BODY_FLUIDS',
              'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE_TOUCHED_OR_SHARED_LINENS_CLOTHES_DISHES'
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
                  outbreakId: data.outbreakData.id,
                  persons: persons,
                  contactDate: contactDate ? contactDate.toISOString() : contactDate,
                  certaintyLevelId: certaintyLevelId,
                  exposureTypeId: exposureTypeId,
                  exposureFrequencyId: exposureFrequencyId,
                  exposureDurationId: exposureDurationId
                },
                common.install.timestamps
              ), options)
              .then((relationshipData) => {
                // log
                app.logger.debug(`Relationship created => '${relationshipData.id}'`);

                // finished
                cb();
              })
              .catch(cb);
          });
        }
      };

      // contacts
      _.each(data.contacts, createRelationshipJobs);

      // cases
      _.each(data.cases, createRelationshipJobs);

      // events
      _.each(data.contacts, createRelationshipJobs);

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(relationshipsJobs, 10, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // display log
          app.logger.debug('Finished creating relationships');

          // finished
          resolve(data);
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
