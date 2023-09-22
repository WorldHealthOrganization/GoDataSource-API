'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with contact related actions
 */

const app = require('../../server/server');
const genericHelpers = require('../../components/helpers');
const WorkerRunner = require('./../../components/workerRunner');
const pdfUtils = app.utils.pdfDoc;
const _ = require('lodash');
const tmp = require('tmp');
const fs = require('fs');
const AdmZip = require('adm-zip');
const localizationHelper = require('../../components/localizationHelper');
const fork = require('child_process').fork;
const Config = require('../../server/config.json');
const Platform = require('../../components/platform');
const importableFile = require('./../../components/importableFile');
const apiError = require('../../components/apiError');
const exportHelper = require('./../../components/exportHelper');

// used in contact import
const contactImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

module.exports = function (Outbreak) {
  /**
   * Attach before remote (GET outbreaks/{id}/contacts) hooks
   */
  Outbreak.beforeRemote('prototype.findContacts', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', context);
    next();
  });
  Outbreak.beforeRemote('prototype.findContacts', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });

  /**
   * Find outbreak contacts
   * @param filter Supports 'where.case', 'where.followUp' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.findContacts = function (filter, options, callback) {
    // pre-filter using related data (case, followUps)
    app.models.contact
      .preFilterForOutbreak(this, filter, options)
      .then(function (filter) {
        // find follow-ups using filter
        return app.models.contact.find(filter);
      })
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Before remote hook for GET /contacts/daily-followup-form/export
   */
  Outbreak.beforeRemote('prototype.exportContactFollowUpListPerDay', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });

  /**
   * Export contact follow-up list for one day or case follow-up list registered as a contact
   * @param res
   * @param date
   * @param contactId
   * @param groupBy
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportContactFollowUpListPerDay = function (res, date, contactId, groupBy, filter, options, callback) {
    // make context available
    const self = this;
    // get language id
    const languageId = options.remotingContext.req.authData.user.languageId;
    if (!['place', 'case'].includes(groupBy)) {
      groupBy = 'place';
    }

    /**
     * Flow control, make sure callback is not called multiple times
     * @param error
     * @param result
     */
    function cb(error, result) {
      // execute callback
      callback(error, result);
      // replace callback with no-op to prevent calling it multiple times
      callback = function noOp() {
      };
    }

    // make sure we have either date or contactId
    if (
      !date &&
      !contactId
    ) {
      // return validation error: at least one of these two must be provided
      const error = new Error('Either date or contactId must be provided');
      res.req.logger.error(JSON.stringify(error));
      return cb(error);
    }

    // load language dictionary
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      // handle errors
      if (error) {
        return cb(error);
      }

      // start the builder
      const dailyFollowUpListBuilder = fork(`${__dirname}../../../components/workers/buildDailyFollowUpList`,
        [], {
          execArgv: [],
          windowsHide: true
        }
      );

      /**
       * Event listener handler
       */
      function eventListener() {
        const error = new Error(`Processing failed. Worker stopped. Event Details: ${JSON.stringify(arguments)}`);
        res.req.logger.error(JSON.stringify(error));
        cb(error);
      }

      // listen to exit events
      ['error', 'exit'].forEach(function (event) {
        dailyFollowUpListBuilder.on(event, eventListener);
      });

      // listen to builder messages
      dailyFollowUpListBuilder.on('message', function (args) {
        // first argument is an error
        if (args[0]) {
          // handle it
          cb(args[0]);
        }
        // if the message is a chunk
        if (args[1] && args[1].chunk) {
          // write it on the response
          res.write(Buffer.from(args[1].chunk.data));
        }
        // if the worker finished
        if (args[1] && args[1].end) {
          // end the response
          res.end();
          // process will be closed gracefully, remove listeners
          ['error', 'exit'].forEach(function (event) {
            dailyFollowUpListBuilder.removeListener(event, eventListener);
          });
          // stop the builder
          dailyFollowUpListBuilder.kill();
        }
      });

      // set appropriate headers
      res.set('Content-type', 'application/pdf');
      res.set('Content-disposition', 'attachment;filename=Daily Contact Follow-up.pdf');

      // define start date, end date for follow-ups
      let startDate;
      let endDate;
      let dateCondition = {};
      // set them according to date
      if (date) {
        // determine start & end dates
        startDate = localizationHelper.getDateStartOfDay(date.startDate);
        endDate = localizationHelper.getDateEndOfDay(date.endDate);

        // determine date condition that will be added when retrieving follow-ups
        dateCondition = {
          date: {
            gte: startDate.toDate(),
            lte: endDate.toDate()
          }
        };
      }

      // determine contact condition that will be added when retrieving follow-ups
      let contactCondition = {};
      let contactData;
      if (contactId) {
        contactCondition = {
          personId: contactId
        };
      }

      // keep a list of locations to resolve
      const locationsToResolve = [];
      // pre-filter using related data (case, contact)
      app.models.followUp
        .preFilterForOutbreak(self, filter)
        .then(function (filter) {
          // add geographical restriction to filter if needed
          return app.models.followUp
            .addGeographicalRestrictions(options.remotingContext, filter.where)
            .then(updatedFilter => {
              // update where if needed
              updatedFilter && (filter.where = updatedFilter);

              // finished
              return filter;
            });

        })
        .then(function (filter) {
          // find follow-ups using filter
          return app.models.followUp.rawFind({
            $and: [
              filter.where, Object.assign(
                {
                  outbreakId: self.id
                },
                dateCondition,
                contactCondition
              )
            ]
          }, {
            projection: {
              personId: 1,
              statusId: 1,
              date: 1,
              address: 1,
              index: 1,
              targeted: 1
            }
          });
        })
        .then(function (followUps) {
          // find contacts for the found follow-ups
          return app.models.person
            .rawFind({
              _id: contactId ? contactId : {
                inq: [...new Set(followUps.map(followUp => followUp.personId))]
              },
              outbreakId: self.id
            }, {
              projection: {
                followUp: 1,
                firstName: 1,
                middleName: 1,
                lastName: 1,
                gender: 1,
                age: 1,
                dateOfLastContact: 1,
                addresses: 1
              }
            })
            .then(function (contacts) {
              // map the contacts to easily reference them after
              const contactsMap = {};
              contacts.forEach(function (contact) {
                contactsMap[contact.id] = contact;
              });

              // keep contact data to use later when generating pdf
              contactData = contactsMap[contactId];

              // add contact information for each follow-up
              followUps.forEach(function (followUp) {
                followUp.contact = contactsMap[followUp.personId];

                // assume unknown location
                let locationId = 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION';

                // try to get location from the follow-up
                if (followUp.address && followUp.address.locationId) {
                  locationId = followUp.address.locationId;
                }

                // if location was not found
                if (locationId === 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION') {
                  // try to get location from the contact
                  let currentAddress = app.models.person.getCurrentAddress(followUp.contact || {});
                  // if location was found
                  if (currentAddress) {
                    // use it
                    currentAddress.locationId = currentAddress.locationId ?
                      currentAddress.locationId :
                      'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION';

                    // update follow-up address
                    followUp.address = currentAddress;
                  }
                }

                // retrieve locations
                if (locationId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION') {
                  locationsToResolve.push(locationId);
                }
              });

              // build groups (grouped by place/case)
              const groups = {};
              switch (groupBy) {
                case 'place':
                  // group follow-ups by place (location)
                  followUps.forEach(function (followUp) {
                    // assume unknown location
                    let locationId = 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION';

                    // try to get location from the follow-up
                    if (followUp.address && followUp.address.locationId) {
                      locationId = followUp.address.locationId;
                    }

                    // init group (if not present)
                    if (!groups[locationId]) {
                      groups[locationId] = {
                        records: []
                      };
                    }
                    // add follow-up  to the group
                    groups[locationId].records.push(followUp);
                  });

                  // no need to return locations grouped by outbreak admin level locations
                  // that is how it was the old logic, which was removed after discussing with WHO in WGD-2000
                  return groups;
                case 'case':
                  // group by case, first find relationships of a contact
                  return app.models.relationship
                    .rawFind({
                      outbreakId: self.id,
                      'persons.id': {
                        inq: Object.keys(contactsMap)
                      }
                    }, {
                      projection: {
                        persons: 1
                      },
                      order: {contactDate: 1}
                    })
                    .then(function (relationships) {
                      // map contacts to cases
                      const contactToCaseMap = {};
                      relationships.forEach(function (relationship) {
                        let contactId;
                        let caseId;
                        // find contact and case
                        // Note: need to also check for contact -> contact of contact relationship; will not take those relationships into account
                        Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
                          if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                            contactId = person.id;
                          } else if (person.type !== 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT') {
                            caseId = person.id;
                          }
                        });
                        // if found, add them to the map
                        if (contactId && caseId) {
                          contactToCaseMap[contactId] = caseId;
                        }
                      });
                      // find people (cases)
                      return app.models.person
                        .rawFind({
                          _id: {
                            inq: Object.values(contactToCaseMap)
                          },
                          outbreakId: self.id,
                        }, {
                          projection: {
                            type: 1,
                            firstName: 1,
                            middleName: 1,
                            lastName: 1,
                            name: 1
                          }
                        })
                        .then(function (people) {
                          // build people map to easily reference people by id
                          const peopleMap = {};
                          people.forEach(function (person) {
                            peopleMap[person.id] = person;
                          });
                          // go through all follow-ups
                          followUps.forEach(function (followUp) {
                            // init group if not already initialized
                            if (!groups[contactToCaseMap[followUp.personId]]) {
                              // get person information from the map
                              const person = peopleMap[contactToCaseMap[followUp.personId]] || {};
                              // add group information
                              groups[contactToCaseMap[followUp.personId]] = {
                                name: person.name ? person.name.trim() : `${person.firstName || ''} ${person.middleName || ''} ${person.lastName || ''}`.trim(),
                                records: []
                              };
                            }
                            // add follow-up to the group
                            groups[contactToCaseMap[followUp.personId]].records.push(followUp);
                          });
                          return groups;
                        });
                    });
              }
            })
            .then(function (groups) {
              // if the grouping is done by place
              if (groupBy === 'place') {
                // add group ids to the list of locations that need to be resolved
                locationsToResolve.push(...Object.keys(groups));
              }
              // find locations
              return app.models.location
                .rawFind({
                  id: {
                    inq: locationsToResolve,
                  }
                }, {
                  projection: {
                    name: 1
                  }
                })
                .then(function (locations) {
                  // build a map of locations to easily reference them by id
                  const locationsMap = {};
                  const data = {};
                  locations.forEach(function (location) {
                    locationsMap[location.id] = location;
                  });

                  // unknown translated name
                  const unknownLocationName = dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION');
                  const yesLabel = dictionary.getTranslation('LNG_COMMON_LABEL_YES');
                  const noLabel = dictionary.getTranslation('LNG_COMMON_LABEL_NO');

                  // go through the groups
                  Object.keys(groups).forEach(function (groupId) {
                    // build data sets
                    data[groupId] = {
                      name: groups[groupId].name,
                      records: [],
                    };

                    // if the grouping is by place
                    if (groupBy === 'place') {
                      // and group id contains a location id
                      if (groupId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION') {
                        // resolve group name
                        data[groupId].name = _.get(locationsMap, `${groupId}.name`);
                      } else {
                        // otherwise add Unknown Location label
                        data[groupId].name = unknownLocationName;
                      }
                    }

                    // go through all records
                    groups[groupId].records.forEach(function (record) {
                      // translate gender
                      record.gender = dictionary.getTranslation(_.get(record, 'contact.gender'));

                      // build record entry
                      const recordEntry = {
                        lastName: _.get(record, 'contact.lastName', ''),
                        firstName: _.get(record, 'contact.firstName', ''),
                        middleName: _.get(record, 'contact.middleName', ''),
                        age: pdfUtils.displayAge(record.contact, dictionary),
                        gender: record.gender,
                        location: record.address && record.address.locationId && record.address.locationId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION' && locationsMap[record.address.locationId] ?
                          locationsMap[record.address.locationId].name :
                          unknownLocationName,
                        address: app.models.address.getHumanReadableAddress(record.address),
                        phoneNumber: _.get(record, 'address.phoneNumber', ''),
                        day: record.index,
                        from: localizationHelper.toMoment(_.get(record, 'contact.followUp.startDate')).format('YYYY-MM-DD'),
                        to: localizationHelper.toMoment(_.get(record, 'contact.followUp.endDate')).format('YYYY-MM-DD'),
                        date: record.date ? localizationHelper.toMoment(record.date).format('YYYY-MM-DD') : undefined,
                        targeted: record.targeted ? yesLabel : noLabel
                      };

                      // mark appropriate status as done
                      recordEntry[record.statusId] = 'X';
                      // add record entry to dataset
                      data[groupId].records.push(recordEntry);
                    });
                  });
                  return data;
                });
            });
        })
        .then(function (data) {
          // get available follow-up statuses from reference data
          return app.models.referenceData
            .rawFind({
              categoryId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE',
              value: {
                neq: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED'
              }
            }, {
              projection: {
                value: 1
              }
            })
            .then(function (referenceData) {
              // build table headers
              const headers = [
                ...(contactData ? [{
                  id: 'date',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_DATE')
                }] : [{
                  id: 'firstName',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_FIRST_NAME')
                }, {
                  id: 'lastName',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_LAST_NAME')
                }, {
                  id: 'middleName',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_MIDDLE_NAME')
                }, {
                  id: 'age',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_AGE')
                }, {
                  id: 'gender',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_GENDER')
                }]),
                ...(groupBy === 'case' ? [{
                  id: 'location',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_LOCATION')
                }] : []),
                ...[{
                  id: 'address',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_ADDRESS')
                }, {
                  id: 'phoneNumber',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_PHONE_NUMBER')
                }, {
                  id: 'day',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_DAY')
                }, {
                  id: 'from',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_FROM')
                }, {
                  id: 'to',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_TO')
                }, {
                  id: 'targeted',
                  header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_TARGETED')
                }]
              ];

              // also add follow-up statuses to table headers
              referenceData.forEach(function (referenceDataItem) {
                headers.push({
                  id: referenceDataItem.value,
                  header: dictionary.getTranslation(referenceDataItem.value)
                });
              });
              // define a list of common labels
              const commonLabels = {
                title: `${dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_TITLE')}: ${contactData ? app.models.person.getDisplayName(contactData) : localizationHelper.toMoment(startDate).format('YYYY-MM-DD')}`,
                groupTitle: dictionary.getTranslation(groupBy === 'place' ? 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_GROUP_TITLE_LOCATION' : 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_GROUP_TITLE_CASE'),
                total: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_TOTAL')
              };

              // process groups in batches
              (function processInBatches(commonLabels, headers, dataSet) {
                // get the list of keys
                let setKeys = Object.keys(dataSet);

                // sort by location name ascending
                setKeys.sort((locationId1, locationId2) => {
                  return dataSet[locationId2].name.toLowerCase().localeCompare(dataSet[locationId1].name.toLowerCase());
                });

                // get max batch size
                let maxBatchSize = setKeys.length;
                // no records left to be processed
                if (maxBatchSize === 0) {
                  // all records processed, inform the worker that is time to finish
                  return dailyFollowUpListBuilder.send({fn: 'finish', args: []});
                } else if (maxBatchSize > 100) {
                  // too many records left, limit batch size to 100
                  maxBatchSize = 100;
                }
                // build a subset of data
                const dataSubSet = {};
                // add data to the subset until the sub-set is full
                for (let i = 0; i < maxBatchSize; i++) {
                  dataSubSet[setKeys[i]] = dataSet[setKeys[i]];
                  delete dataSet[setKeys[i]];
                }

                // worker communicates via messages, listen to them
                function listener(args) {
                  // first argument is an error
                  if (args[0]) {
                    // handle it
                    return cb(args[0]);
                  }
                  // if the worker is ready for the next batch
                  if (args[1] && args[1].readyForNextBatch) {
                    // remove current listener
                    dailyFollowUpListBuilder.removeListener('message', listener);
                    // send move to next step
                    processInBatches(commonLabels, headers, dataSet);
                  }
                }

                // listen to worker messages
                dailyFollowUpListBuilder.on('message', listener);
                // build follow-up list
                dailyFollowUpListBuilder.send({
                  fn: 'sendData',
                  args: [commonLabels, headers, dataSubSet, Object.keys(dataSet).length === 0]
                });
              })(commonLabels, headers, data);
            });
        })
        .catch(cb);
    });
  };

  /**
   * Before remote hook fot GET /contacts/daily-list/export
   */
  Outbreak.beforeRemote('prototype.exportDailyContactFollowUpList', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });

  /**
   * Export a daily contact follow-up form for every contact.
   * @param res
   * @param groupBy
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportDailyContactFollowUpList = function (res, groupBy, filter, options, callback) {
    let self = this;
    app.models.contact
      .preFilterForOutbreak(this, filter, options)
      .then(function (filter) {
        // get language id
        const languageId = options.remotingContext.req.authData.user.languageId;
        if (!['place', 'case'].includes(groupBy)) {
          groupBy = 'place';
        }

        /**
         * Flow control, make sure callback is not called multiple times
         * @param error
         * @param result
         */
        function cb(error, result) {
          // execute callback
          callback(error, result);
          // replace callback with no-op to prevent calling it multiple times
          callback = function noOp() {
          };
        }

        // load language dictionary
        app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
          // handle errors
          if (error) {
            return cb(error);
          }

          // start the builder
          const dailyFollowUpListBuilder = fork(`${__dirname}../../../components/workers/buildDailyContactList`,
            [], {
              execArgv: [],
              windowsHide: true
            }
          );

          /**
           * Event listener handler
           */
          function eventListener() {
            const error = new Error(`Processing failed. Worker stopped. Event Details: ${JSON.stringify(arguments)}`);
            res.req.logger.error(JSON.stringify(error));
            cb(error);
          }

          // listen to exit events
          ['error', 'exit'].forEach(function (event) {
            dailyFollowUpListBuilder.on(event, eventListener);
          });

          // listen to builder messages
          dailyFollowUpListBuilder.on('message', function (args) {
            // first argument is an error
            if (args[0]) {
              // handle it
              cb(args[0]);
            }
            // if the message is a chunk
            if (args[1] && args[1].chunk) {
              // write it on the response
              res.write(Buffer.from(args[1].chunk.data));
            }
            // if the worker finished
            if (args[1] && args[1].end) {
              // end the response
              res.end();
              // process will be closed gracefully, remove listeners
              ['error', 'exit'].forEach(function (event) {
                dailyFollowUpListBuilder.removeListener(event, eventListener);
              });
              // stop the builder
              dailyFollowUpListBuilder.kill();
            }
          });

          // set appropriate headers
          res.set('Content-type', 'application/pdf');
          res.set('Content-disposition', 'attachment;filename=Daily Contact List.pdf');

          // keep a list of locations to resolve
          const locationsToResolve = [];
          // find contacts for the found follow-ups
          return app.models.contact
            .rawFind(filter.where, {
              projection: {
                followUp: 1,
                firstName: 1,
                middleName: 1,
                lastName: 1,
                gender: 1,
                age: 1,
                dateOfLastContact: 1,
                addresses: 1
              }
            })
            .then(function (contacts) {
              // map the contacts to easily reference them after
              const contactsMap = {};
              contacts.forEach(function (contact) {
                contactsMap[contact.id] = contact;
              });

              // find all follow ups for all contacts and group them by contact
              return app.models.followUp
                .rawFind({
                  personId: {
                    $in: Object.keys(contactsMap)
                  }
                })
                .then((followUps) => {
                  const groupedFollowups = _.groupBy(followUps, (f) => f.personId);

                  contacts = contacts.map((contact) => {
                    // sort by index and remove duplicates from the same day
                    let contactFollowUps = groupedFollowups[contact.id] || [];
                    contactFollowUps = _.uniqBy(contactFollowUps, 'index').sort((a, b) => a.index - b.index);
                    contact.followUps = contactFollowUps;
                    return contact;
                  });

                  // build groups (grouped by place/case)
                  const groups = {};
                  if (groupBy === 'place') {
                    // group contacts by place (location)
                    contacts.forEach((contact) => {
                      // assume unknown location
                      let locationId = 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION';

                      // try to get location from the contact
                      let currentAddress = app.models.person.getCurrentAddress(contact);

                      // if location was found
                      if (currentAddress) {
                        // use it
                        currentAddress.locationId = currentAddress.locationId ?
                          currentAddress.locationId :
                          'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION';
                        locationId = currentAddress.locationId;
                      }

                      // init group (if not present)
                      if (!groups[locationId]) {
                        groups[locationId] = {
                          records: []
                        };
                      }

                      // to easily resolve it
                      contact.currentAddress = currentAddress || {
                        locationId: locationId
                      };

                      // add contact to the group
                      groups[locationId].records.push(contact);
                    });

                    // no need to return locations grouped by outbreak admin level locations
                    // that is how it was the old logic, which was removed after discussing with WHO in WGD-2000
                    return groups;
                  } else {
                    // group by case, first find relationships
                    return app.models.relationship
                      .rawFind({
                        outbreakId: self.id,
                        'persons.id': {
                          inq: Object.keys(contactsMap)
                        }
                      }, {
                        projection: {
                          persons: 1
                        },
                        order: {contactDate: 1}
                      })
                      .then(function (relationships) {
                        // map contacts to cases
                        const contactToCaseMap = {};
                        relationships.forEach(function (relationship) {
                          let contactId;
                          let caseId;
                          // find contact and case
                          Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
                            if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                              contactId = person.id;
                            } else {
                              caseId = person.id;
                            }
                          });
                          // if found, add them to the map
                          if (contactId && caseId) {
                            contactToCaseMap[contactId] = caseId;
                          }
                        });
                        // find people (cases)
                        return app.models.person
                          .rawFind({
                            _id: {
                              inq: Object.values(contactToCaseMap)
                            },
                            outbreakId: self.id,
                          }, {
                            projection: {
                              type: 1,
                              firstName: 1,
                              middleName: 1,
                              lastName: 1,
                              name: 1
                            }
                          })
                          .then(function (cases) {
                            // build people map to easily reference people by id
                            const casesMap = {};
                            cases.forEach(function (caseItem) {
                              casesMap[caseItem.id] = caseItem;
                            });

                            // go through all contacts
                            contacts.forEach((contact) => {
                              // init group if not already initiated
                              if (!groups[contactToCaseMap[contact.id]]) {
                                // get person information from the map
                                const person = casesMap[contactToCaseMap[contact.id]] || {};
                                // add group information
                                groups[contactToCaseMap[contact.id]] = {
                                  name: `${person.firstName || ''} ${person.middleName || ''} ${person.lastName || ''}`.trim(),
                                  records: []
                                };
                              }
                              // add follow-up to the group
                              groups[contactToCaseMap[contact.id]].records.push(contact);
                            });
                            return groups;
                          });
                      });
                  }
                })
                .then(function (groups) {
                  // if the grouping is done by place
                  if (groupBy === 'place') {
                    // add group ids to the list of locations that need to be resolved
                    locationsToResolve.push(...Object.keys(groups));
                  } else {
                    const locationsToRetrieve = {};
                    Object.keys(groups).forEach(function (groupId) {
                      groups[groupId].records.forEach(function (record) {
                        if (!record.currentAddress) {
                          record.currentAddress = app.models.person.getCurrentAddress(record);
                          if (
                            record.currentAddress &&
                            record.currentAddress.locationId &&
                            record.currentAddress.locationId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION'
                          ) {
                            locationsToRetrieve[record.currentAddress.locationId] = true;
                          }
                        }
                      });
                    });
                    locationsToResolve.push(...Object.keys(locationsToRetrieve));
                  }

                  // find locations
                  return app.models.location
                    .rawFind({
                      id: {
                        inq: locationsToResolve,
                      }
                    }, {
                      projection: {
                        name: 1
                      }
                    })
                    .then(function (locations) {
                      // build a map of locations to easily reference them by id
                      const locationsMap = {};
                      const data = {};
                      locations.forEach(function (location) {
                        locationsMap[location.id] = location;
                      });

                      // store unknown location translation
                      const unknownLocationTranslation = dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION');

                      // go through the groups
                      Object.keys(groups).forEach(function (groupId) {
                        // build data sets
                        data[groupId] = {
                          name: groups[groupId].name,
                          records: [],
                        };
                        // if the grouping is by place
                        if (groupBy === 'place') {
                          // and group id contains a location id
                          if (groupId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION') {
                            // resolve group name
                            data[groupId].name = _.get(locationsMap, `${groupId}.name`);
                          } else {
                            // otherwise add Unknown Location label
                            data[groupId].name = unknownLocationTranslation;
                          }
                        }

                        // go through all records
                        groups[groupId].records.forEach(function (record) {
                          if (!record.currentAddress) {
                            record.currentAddress = app.models.person.getCurrentAddress(record) || {
                              locationId: 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION'
                            };
                          }

                          // build record entry
                          const recordEntry = {
                            lastName: _.get(record, 'lastName', ''),
                            firstName: _.get(record, 'firstName', ''),
                            middleName: _.get(record, 'middleName', ''),
                            age: pdfUtils.displayAge(record, dictionary),
                            gender: dictionary.getTranslation(_.get(record, 'gender')),
                            location: record.currentAddress && record.currentAddress.locationId && record.currentAddress.locationId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION' && locationsMap[record.currentAddress.locationId] ?
                              locationsMap[record.currentAddress.locationId].name :
                              unknownLocationTranslation,
                            address: app.models.address.getHumanReadableAddress(record.currentAddress),
                            from: localizationHelper.toMoment(_.get(record, 'followUp.startDate')).format('YYYY-MM-DD'),
                            to: localizationHelper.toMoment(_.get(record, 'followUp.endDate')).format('YYYY-MM-DD'),
                            // needed for building tables
                            followUps: record.followUps,
                            followUp: record.followUp
                          };

                          // add record entry to dataset
                          data[groupId].records.push(recordEntry);
                        });
                      });
                      return data;
                    });
                })
                .then(function (groups) {
                  // translate follow ups status acronyms here
                  // to pass it to the worker
                  const followUpStatusAcronyms = app.models.followUp.statusAcronymMap;
                  const translatedFollowUpAcronyms = {};
                  const translatedFollowUpAcronymsAndIds = {};
                  for (let prop in followUpStatusAcronyms) {
                    const translatedProp = dictionary.getTranslation(prop);
                    const translatedValue = dictionary.getTranslation(followUpStatusAcronyms[prop]);
                    translatedFollowUpAcronyms[prop] = translatedValue;
                    translatedFollowUpAcronymsAndIds[translatedProp] = translatedValue;
                  }

                  // used to fit the table on one page
                  const standardHeaderSize = 40;

                  // build table headers
                  const headers = [
                    ...([{
                      id: 'firstName',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_FIRST_NAME'),
                      width: standardHeaderSize
                    }, {
                      id: 'lastName',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_LAST_NAME'),
                      width: standardHeaderSize
                    }, {
                      id: 'middleName',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_MIDDLE_NAME'),
                      width: standardHeaderSize + 10
                    }, {
                      id: 'age',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_AGE'),
                      width: standardHeaderSize
                    }, {
                      id: 'gender',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_GENDER'),
                      width: standardHeaderSize
                    }]),
                    ...(groupBy === 'case' ? [{
                      id: 'location',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_LOCATION'),
                      width: standardHeaderSize
                    }] : []),
                    ...([{
                      id: 'address',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_ADDRESS'),
                      width: standardHeaderSize
                    }, {
                      id: 'from',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_FROM'),
                      width: standardHeaderSize - 5
                    }, {
                      id: 'to',
                      header: dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_TO'),
                      width: standardHeaderSize - 5
                    }])
                  ];


                  // group by title translation
                  const groupTitle = dictionary.getTranslation(groupBy === 'place' ?
                    'LNG_REPORT_DAILY_FOLLOW_UP_LIST_GROUP_TITLE_LOCATION' :
                    'LNG_REPORT_DAILY_FOLLOW_UP_LIST_GROUP_TITLE_CASE');

                  // total title translation
                  const totalTitle = dictionary.getTranslation('LNG_LIST_HEADER_TOTAL');

                  // start document title
                  const pdfTitle = dictionary.getTranslation('LNG_PAGE_TITLE_DAILY_CONTACTS_LIST');
                  const legendTitle = dictionary.getTranslation('LNG_FOLLOW_UP_STATUS_LEGEND');

                  // flag that indicates that start document props were added
                  let startDocumentAdded = false;

                  // process groups in batches
                  (function processInBatches(defaultHeaders, groups) {
                    // we process the first group always
                    const groupsKeys = Object.keys(groups);
                    if (!groupsKeys.length) {
                      // all records processed, inform the worker that is time to finish
                      return dailyFollowUpListBuilder.send({fn: 'finish', args: []});
                    }

                    const targetGroup = groups[groupsKeys[0]];
                    delete groups[groupsKeys[0]];

                    const listener = function (args) {
                      // first argument is an error
                      if (args[0]) {
                        // handle it
                        return cb(args[0]);
                      }
                      // if the worker is ready for the next batch
                      if (args[1] && args[1].readyForNextBatch) {
                        // remove current listener
                        dailyFollowUpListBuilder.removeListener('message', listener);
                        // send move to next step
                        processInBatches(headers, groups);
                      }
                    };

                    // listen to worker messages
                    dailyFollowUpListBuilder.on('message', listener);

                    // custom options to be sent over to the worker
                    const customOpts = {
                      groupTitle: groupTitle,
                      totalTitle: totalTitle
                    };

                    if (!startDocumentAdded) {
                      customOpts.startDocument = {
                        title: pdfTitle,
                        legend: {
                          title: legendTitle,
                          values: translatedFollowUpAcronymsAndIds
                        }
                      };
                    }

                    // build the group
                    dailyFollowUpListBuilder.send({
                      fn: 'sendData',
                      args: [
                        customOpts,
                        defaultHeaders,
                        targetGroup,
                        translatedFollowUpAcronyms
                      ]
                    });

                    // do not add start document opts on next call
                    startDocumentAdded = true;

                  })(headers, groups);
                });
            })
            .catch(cb);
        });
      });
  };

  /**
   * Build and return a pdf containing a contact's information, relationships and follow ups (dossier)
   * @param contacts
   * @param anonymousFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.contactDossier = function (contacts, anonymousFields, options, callback) {
    const models = app.models;
    const followUpQuestionnaire = this.contactFollowUpTemplate.toJSON();
    let questions = [];
    let tmpDir = tmp.dirSync({unsafeCleanup: true});
    let tmpDirName = tmpDir.name;

    let contactQuery = {
      id: {
        inq: contacts
      }
    };

    let that = this;

    // add geographical restriction to filter if needed
    app.models.contact
      .addGeographicalRestrictions(options.remotingContext, contactQuery)
      .then(updatedFilter => {
        updatedFilter && (contactQuery = updatedFilter);

        return new Promise((resolve, reject) => {
          // Get all requested contacts, including their relationships and followUps
          that.__get__contacts({
            where: contactQuery,
            include: [
              {
                relation: 'relationships',
                scope: {
                  include: [
                    {
                      relation: 'people'
                    },
                    {
                      relation: 'cluster'
                    }
                  ]
                }
              },
              {
                relation: 'followUps'
              }
            ]
          }, function (error, results) {
            if (error) {
              return reject(error);
            }

            return resolve(results);
          });
        });
      })
      .then(results => {
        const pdfUtils = app.utils.pdfDoc;
        const languageId = options.remotingContext.req.authData.user.languageId;
        let sanitizedContacts = [];

        genericHelpers.attachLocations(
          app.models.case,
          app.models.location,
          results,
          (err, result) => {
            if (!err) {
              result = result || {};
              results = result.records || results;
            }

            // Get the language dictionary
            app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
              // handle errors
              if (error) {
                return callback(error);
              }

              // Transform all DB models into JSONs for better handling
              results.forEach((contact, contactIndex) => {
                results[contactIndex] = contact.toJSON();

                // this is needed because loopback doesn't return hidden fields from definition into the toJSON call
                // might be removed later
                results[contactIndex].type = contact.type;

                // since relationships is a custom relation, the relationships collection is included differently in the case model,
                // and not converted by the initial toJSON method.
                contact.relationships.forEach((relationship, relationshipIndex) => {
                  contact.relationships[relationshipIndex] = relationship.toJSON();
                  contact.relationships[relationshipIndex].people.forEach((member, memberIndex) => {
                    contact.relationships[relationshipIndex].people[memberIndex] = member.toJSON();
                  });
                });
              });

              // Replace all foreign keys with readable data
              genericHelpers.resolveModelForeignKeys(app, app.models.contact, results, dictionary)
                .then((results) => {
                  results.forEach((contact, contactIndex) => {
                    // keep the initial data of the contact (we currently use it to generate the QR code only)
                    sanitizedContacts[contactIndex] = {
                      rawData: contact
                    };

                    // Anonymize the required fields and prepare the fields for print (currently, that means eliminating undefined values,
                    // and format date type fields
                    if (anonymousFields) {
                      app.utils.anonymizeDatasetFields.anonymize(contact, anonymousFields);
                    }
                    app.utils.helpers.formatDateFields(contact, app.models.person.dossierDateFields);
                    app.utils.helpers.formatUndefinedValues(contact);

                    // Prepare the contact's relationships for printing
                    contact.relationships.forEach((relationship, relationshipIndex) => {
                      sanitizedContacts[contactIndex].relationships = [];

                      // extract the person with which the contact has a relationship
                      let relationshipMember = _.find(relationship.people, (member) => {
                        return member.id !== contact.id;
                      });

                      // if relationship member was not found
                      if (!relationshipMember) {
                        // stop here (invalid relationship)
                        return;
                      }

                      // needed for checks below
                      const relationshipMemberType = relationshipMember.type;
                      const isEvent = relationshipMember.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT';

                      // for events, keep only the properties needed to be printed
                      // because we don't ever fill inherited person's properties for events
                      if (isEvent) {
                        let tmpObject = {};
                        for (let prop in relationshipMember) {
                          if (app.models.event.printFieldsinOrder.indexOf(prop) !== -1) {
                            tmpObject[prop] = relationshipMember[prop];
                          }
                        }
                        relationshipMember = tmpObject;
                      }

                      // translate the values of the fields marked as reference data fields on the case/contact/event model
                      app.utils.helpers.translateDataSetReferenceDataValues(
                        relationshipMember,
                        models[models.person.typeToModelMap[relationshipMemberType]].referenceDataFields,
                        dictionary
                      );

                      relationshipMember = app.utils.helpers.translateFieldLabels(
                        app,
                        relationshipMember,
                        models[models.person.typeToModelMap[relationshipMemberType]].modelName,
                        dictionary
                      );

                      // Translate the values of the fields marked as reference data fields on the relationship model
                      app.utils.helpers.translateDataSetReferenceDataValues(
                        relationship,
                        models.relationship.referenceDataFields,
                        dictionary
                      );

                      // Translate all remaining keys of the relationship model
                      relationship = app.utils.helpers.translateFieldLabels(
                        app,
                        relationship,
                        models.relationship.modelName,
                        dictionary
                      );

                      relationship[dictionary.getTranslation('LNG_RELATIONSHIP_PDF_FIELD_LABEL_PERSON')] = relationshipMember;

                      // Add the sanitized relationship to the object to be printed
                      sanitizedContacts[contactIndex].relationships[relationshipIndex] = relationship;
                    });

                    // Prepare the contact's followUps for printing
                    contact.followUps.forEach((followUp, followUpIndex) => {
                      sanitizedContacts[contactIndex].followUps = [];

                      // Translate the values of the fields marked as reference data fields on the lab result model
                      app.utils.helpers.translateDataSetReferenceDataValues(followUp, app.models.followUp.referenceDataFields, dictionary);

                      // Translate the questions and the answers from the follow up
                      questions = Outbreak.helpers.parseTemplateQuestions(followUpQuestionnaire, dictionary);

                      // translate follow up questionnaire answers to general format
                      let followUpAnswers = followUp.questionnaireAnswers || {};

                      // Since we are presenting all the answers, mark the one that was selected, for each question
                      questions = Outbreak.helpers.prepareQuestionsForPrint(followUpAnswers, questions);

                      // Translate the remaining fields on the follow up model
                      followUp = app.utils.helpers.translateFieldLabels(app, followUp, app.models.followUp.modelName, dictionary);

                      // Add the questionnaire separately (after field translations) because it will be displayed separately
                      followUp.questionnaire = questions;

                      // Add the sanitized follow ups to the object to be printed
                      sanitizedContacts[contactIndex].followUps[followUpIndex] = followUp;
                    });

                    // Translate all remaining keys
                    contact = app.utils.helpers.translateFieldLabels(
                      app,
                      contact,
                      app.models.contact.modelName,
                      dictionary,
                      true
                    );

                    // Add the sanitized contact to the object to be printed
                    sanitizedContacts[contactIndex].data = contact;
                  });

                  const relationshipsTitle = dictionary.getTranslation('LNG_PAGE_ACTION_RELATIONSHIPS');
                  const followUpsTitle = dictionary.getTranslation('LNG_PAGE_CONTACT_WITH_FOLLOWUPS_FOLLOWUPS_TITLE');
                  const followUpQuestionnaireTitle = dictionary.getTranslation('LNG_PAGE_CREATE_FOLLOW_UP_TAB_QUESTIONNAIRE_TITLE');

                  let pdfPromises = [];

                  // Print all the data
                  sanitizedContacts.forEach((sanitizedContact) => {
                    pdfPromises.push(
                      new Promise((resolve, reject) => {
                        // generate pdf document
                        let doc = pdfUtils.createPdfDoc({
                          fontSize: 7,
                          layout: 'portrait',
                          margin: 20,
                          lineGap: 0,
                          wordSpacing: 0,
                          characterSpacing: 0,
                          paragraphGap: 0
                        });

                        // add a top margin of 2 lines for each page
                        doc.on('pageAdded', () => {
                          doc.moveDown(2);
                        });

                        // set margin top for first page here, to not change the entire createPdfDoc functionality
                        doc.moveDown(2);
                        // write this as a separate function to easily remove it's listener
                        let addQrCode = function () {
                          app.utils.qrCode.addPersonQRCode(doc, sanitizedContact.rawData.outbreakId, 'contact', sanitizedContact.rawData);
                        };

                        // add the QR code to the first page (this page has already been added and will not be covered by the next line)
                        addQrCode();

                        // set a listener on pageAdded to add the QR code to every new page
                        doc.on('pageAdded', addQrCode);

                        pdfUtils.displayModelDetails(doc, sanitizedContact.data, true, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_DETAILS'));
                        pdfUtils.displayPersonRelationships(doc, sanitizedContact.relationships, relationshipsTitle);
                        pdfUtils.displayPersonSectionsWithQuestionnaire(doc, sanitizedContact.followUps, followUpsTitle, followUpQuestionnaireTitle);

                        // add an additional empty page that contains only the QR code as per requirements
                        doc.addPage();

                        // stop adding this QR code. The next contact will need to have a different QR code
                        doc.removeListener('pageAdded', addQrCode);
                        doc.end();

                        // convert pdf stream to buffer and send it as response
                        genericHelpers.streamToBuffer(doc, (err, buffer) => {
                          if (err) {
                            callback(err);
                          } else {
                            const fileName = exportHelper.getNameForExportedDossierFile(sanitizedContact, anonymousFields);

                            fs.writeFile(`${tmpDirName}/${fileName}`, buffer, (err) => {
                              if (err) {
                                reject(err);
                              } else {
                                resolve();
                              }
                            });
                          }
                        });
                      })
                    );
                  });
                  return Promise.all(pdfPromises);
                })
                .then(() => {
                  let archiveName = `contactDossiers_${localizationHelper.now().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
                  let archivePath = `${tmpDirName}/${archiveName}`;
                  let zip = new AdmZip();

                  zip.addLocalFolder(tmpDirName);
                  zip.writeZip(archivePath);

                  fs.readFile(archivePath, (err, data) => {
                    if (err) {
                      callback(apiError.getError('FILE_NOT_FOUND'));
                    } else {
                      tmpDir.removeCallback();
                      app.utils.remote.helpers.offerFileToDownload(data, 'application/zip', archiveName, callback);
                    }
                  });
                })
                .catch(callback);
            });
          });
      })
      .catch(callback);
  };

  /**
   * Before remote hook for GET /contacts/export
   */
  Outbreak.beforeRemote('prototype.exportFilteredContacts', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};

    Outbreak.helpers.findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });

  /**
   * Export filtered contacts to file
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredContacts = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // parse includeCaseFields query param
    let includeCaseFields = false;
    if (filter.where.hasOwnProperty('includeCaseFields')) {
      includeCaseFields = filter.where.includeCaseFields;
      delete filter.where.includeCaseFields;
    }

    // parse includeContactOfContactFields query param
    let includeContactOfContactFields = false;
    if (filter.where.hasOwnProperty('includeContactOfContactFields')) {
      includeContactOfContactFields = filter.where.includeContactOfContactFields;
      delete filter.where.includeContactOfContactFields;
    }

    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

    // parse useDbColumns query param
    let useDbColumns = false;
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }

    // parse dontTranslateValues query param
    let dontTranslateValues = false;
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // parse jsonReplaceUndefinedWithNull query param
    let jsonReplaceUndefinedWithNull = false;
    if (filter.where.hasOwnProperty('jsonReplaceUndefinedWithNull')) {
      jsonReplaceUndefinedWithNull = filter.where.jsonReplaceUndefinedWithNull;
      delete filter.where.jsonReplaceUndefinedWithNull;
    }

    // parse includePersonExposureFields query param
    let includePersonExposureFields = false;
    if (filter.where.hasOwnProperty('includePersonExposureFields')) {
      includePersonExposureFields = filter.where.includePersonExposureFields;
      delete filter.where.includePersonExposureFields;
    }

    // parse retrieveOldestExposure query param
    let retrieveOldestExposure = false;
    if (filter.where.hasOwnProperty('retrieveOldestExposure')) {
      retrieveOldestExposure = filter.where.retrieveOldestExposure;
      delete filter.where.retrieveOldestExposure;
    }

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // prefilters
    const prefilters = exportHelper.generateAggregateFiltersFromNormalFilter(
      filter, {
        outbreakId: this.id
      }, {
        followUp: {
          collection: 'followUp',
          queryPath: 'where.followUp',
          localKey: '_id',
          foreignKey: 'personId'
        },
        case: {
          collection: 'person',
          queryPath: 'where.case',
          queryAppend: {
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
          },
          localKey: '_id',
          // #TODO
          // - must implement later
          ignore: true
          // foreignKey: '....ce vine din relationship'
          // prefilters: {
          //   relationship: {
          //     collection: 'relationship',
          //     queryPath: 'where.relationship',
          //     localKey: '_id',
          //     foreignKey: 'persons[].id',
          //     foreignKeyArraySize: 2
          //   }
          // }
        }
      }
    );

    // do we need to include case/contact of contact data in contact exported data if contact was a case/contact of contact ?
    let additionalFieldsToExport;
    if (
      includeCaseFields ||
      includeContactOfContactFields
    ) {
      // initialize additional fields to export
      additionalFieldsToExport = {
        fields: {},
        arrayProps: {},
        locationFields: []
      };

      // determine contact fields
      const contactFields = {};
      _.each(
        app.models.contact.fieldLabelsMap,
        (contactFieldToken, contactField) => {
          // should exclude or include ?
          let shouldExclude = false;
          if (app.models.contact.definition.settings.excludeBaseProperties) {
            for (let index = 0; index < app.models.contact.definition.settings.excludeBaseProperties.length; index++) {
              let excludedField = app.models.contact.definition.settings.excludeBaseProperties[index];
              if (
                contactField === excludedField ||
                contactField.startsWith(`${excludedField}.`) ||
                contactField.startsWith(`${excludedField}[]`)
              ) {
                // must exclude field
                shouldExclude = true;

                // no need to check further
                break;
              }
            }
          }

          // should exclude or include field ?
          if (!shouldExclude) {
            contactFields[contactField] = contactFieldToken;
          }
        }
      );

      // include case fields ?
      if (includeCaseFields) {
        // determine case fields
        const caseFields = {};
        _.each(
          app.models.case.fieldLabelsMap,
          (caseFieldToken, caseField) => {
            // should exclude or include ?
            let shouldExclude = false;
            if (app.models.case.definition.settings.excludeBaseProperties) {
              for (let index = 0; index < app.models.case.definition.settings.excludeBaseProperties.length; index++) {
                let excludedField = app.models.case.definition.settings.excludeBaseProperties[index];
                if (
                  caseField === excludedField ||
                  caseField.startsWith(`${excludedField}.`) ||
                  caseField.startsWith(`${excludedField}[]`)
                ) {
                  // must exclude field
                  shouldExclude = true;

                  // no need to check further
                  break;
                }
              }
            }

            // should exclude or include field ?
            if (!shouldExclude) {
              caseFields[caseField] = caseFieldToken;
            }
          }
        );

        // determine what fields from case are missing from contact
        _.each(
          caseFields,
          (caseFieldToken, caseField) => {
            if (!contactFields[caseField]) {
              // add field
              additionalFieldsToExport.fields[caseField] = caseFieldToken;

              // is array property ?
              if (app.models.case.arrayProps[caseField]) {
                additionalFieldsToExport.arrayProps[caseField] = app.models.case.arrayProps[caseField];
              }

              // is location property ?
              if (app.models.case.locationFields.indexOf(caseField) > -1) {
                additionalFieldsToExport.locationFields.push(caseField);
              }
            }
          }
        );
      }

      // include contact of contact fields ?
      if (includeContactOfContactFields) {
        // determine contact of contact fields
        const contactOfContactFields = {};
        _.each(
          app.models.contactOfContact.fieldLabelsMap,
          (contactOfContactFieldToken, contactOfContactField) => {
            // should exclude or include ?
            let shouldExclude = false;
            if (app.models.contactOfContact.definition.settings.excludeBaseProperties) {
              for (let index = 0; index < app.models.contactOfContact.definition.settings.excludeBaseProperties.length; index++) {
                let excludedField = app.models.contactOfContact.definition.settings.excludeBaseProperties[index];
                if (
                  contactOfContactField === excludedField ||
                  contactOfContactField.startsWith(`${excludedField}.`) ||
                  contactOfContactField.startsWith(`${excludedField}[]`)
                ) {
                  // must exclude field
                  shouldExclude = true;

                  // no need to check further
                  break;
                }
              }
            }

            // should exclude or include field ?
            if (!shouldExclude) {
              contactOfContactFields[contactOfContactField] = contactOfContactFieldToken;
            }
          }
        );

        // determine what fields from contact of contact are missing from contact
        _.each(
          contactOfContactFields,
          (contactOfContactFieldToken, contactOfContactField) => {
            if (!contactFields[contactOfContactField]) {
              // add field
              additionalFieldsToExport.fields[contactOfContactField] = contactOfContactFieldToken;

              // is array property ?
              if (app.models.contactOfContact.arrayProps[contactOfContactField]) {
                additionalFieldsToExport.arrayProps[contactOfContactField] = app.models.contactOfContact.arrayProps[contactOfContactField];
              }

              // is location property ?
              if (app.models.contactOfContact.locationFields.indexOf(contactOfContactField) > -1) {
                additionalFieldsToExport.locationFields.push(contactOfContactField);
              }
            }
          }
        );
      }
    }

    // prefilter
    app.models.contact
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where
      )
      .then((updatedFilter) => {
        // update casesQuery if needed
        updatedFilter && (filter.where = updatedFilter);

        // determine fields that should be used at export
        let fieldLabelsMapOptions = app.models.contact.helpers.sanitizeFieldLabelsMapForExport();
        if (!includePersonExposureFields) {
          fieldLabelsMapOptions = _.transform(
            fieldLabelsMapOptions,
            (acc, token, field) => {
              // nothing to do ?
              if (
                field === 'relationship.relatedPersonData' ||
                field.startsWith('relationship.relatedPersonData.')
              ) {
                return;
              }

              // add to list
              acc[field] = token;
            },
            {}
          );
        }

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'person',
            modelName: app.models.contact.modelName,
            scopeQuery: app.models.contact.definition.settings.scope,
            excludeBaseProperties: app.models.contact.definition.settings.excludeBaseProperties,
            arrayProps: app.models.contact.arrayProps,
            fieldLabelsMap: fieldLabelsMapOptions,
            exportFieldsGroup: app.models.contact.exportFieldsGroup,
            exportFieldsOrder: app.models.contact.exportFieldsOrder,
            locationFields: app.models.contact.locationFields,
            additionalFieldsToExport,

            // fields that we need to bring from db, but we might not include in the export (you can still include it since we need it on import)
            // - responsibleUserId might be included since it is used on import, otherwise we won't have the ability to map this field
            projection: [
              'responsibleUserId'
            ]
          },
          filter,
          exportType,
          encryptPassword,
          anonymizeFields,
          fieldsGroupList,
          {
            userId: _.get(options, 'accessToken.userId'),
            outbreakId: this.id,
            questionnaire: this.contactInvestigationTemplate ?
              this.contactInvestigationTemplate.toJSON() :
              undefined,
            useQuestionVariable,
            useDbColumns,
            dontTranslateValues,
            jsonReplaceUndefinedWithNull,
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
          },
          prefilters, {
            followUpTeam: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'team',
              project: [
                '_id',
                'name'
              ],
              key: '_id',
              keyValue: `(contact) => {
                return contact && contact.followUpTeamId ?
                  contact.followUpTeamId :
                  undefined;
              }`,
              replace: {
                'followUpTeamId': {
                  value: 'followUpTeam.name'
                }
              }
            },
            relationship: {
              type: exportHelper.RELATION_TYPE.GET_ONE,
              collection: 'relationship',
              project: [
                '_id',
                'contactDate',
                'contactDateEstimated',
                'certaintyLevelId',
                'exposureTypeId',
                'exposureFrequencyId',
                'exposureDurationId',
                'socialRelationshipTypeId',
                'socialRelationshipDetail',
                'clusterId',
                'comment',
                'createdAt',
                'createdBy',
                'updatedAt',
                'updatedBy',
                'deleted',
                'deletedAt',
                'createdOn',
                'persons'
              ],
              query: `(person) => {
                return person ?
                  {
                    outbreakId: '${this.id}',
                    deleted: false,
                    $or: [
                      {
                        'persons.0.id': person._id,
                        'persons.0.target': true,
                        'persons.1.type': {
                            $in: [
                                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                                'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                            ]
                        }
                      }, {
                          'persons.1.id': person._id,
                          'persons.1.target': true,
                          'persons.0.type': {
                              $in: [
                                  'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                                  'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                              ]
                          }
                      }
                    ]
                  } :
                  undefined;
              }`,
              sort: {
                createdAt: retrieveOldestExposure ?
                  1 :
                  -1
              },
              after: `(person) => {
                // nothing to do ?
                if (
                  !person.relationship ||
                  !person.relationship.persons ||
                  person.relationship.persons.length !== 2
                ) {
                  return;
                }

                // determine related person
                person.relationship.relatedId = person.relationship.persons[0].id === person._id ?
                  person.relationship.persons[1].id :
                  person.relationship.persons[0].id;

                // cleanup
                delete person.relationship.persons;
                person.relationship.id = person.relationship._id;
                delete person.relationship._id;
              }`,
              relations: includePersonExposureFields ? {
                relatedPersonData: {
                  type: exportHelper.RELATION_TYPE.HAS_ONE,
                  collection: 'person',
                  project: [
                    '_id',
                    // event
                    'name',
                    // case
                    'firstName',
                    'lastName',
                    'visualId'
                  ],
                  key: '_id',
                  keyValue: `(person) => {
                    return person && person.relationship && person.relationship.relatedId ?
                      person.relationship.relatedId :
                      undefined;
                  }`,
                  after: `(person) => {
                    // nothing to do ?
                    if (!person.relatedPersonData) {
                      // then we shouldn't have relationship either because probably person was deleted
                      // - for now we shouldn't delete it because we will have no relationship to use on import
                      // - the correct way would be to retrieve the relationship if person not deleted, but now that isn't easily possible
                      // delete person.relationship;

                      // not found
                      return;
                    }

                    // move from root level to relationship
                    person.relationship.relatedPersonData = person.relatedPersonData;
                    delete person.relatedPersonData;
                  }`
                }
              } : undefined
            },
            responsibleUser: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'user',
              project: [
                '_id',
                'firstName',
                'lastName'
              ],
              key: '_id',
              keyValue: `(item) => {
                return item && item.responsibleUserId ?
                  item.responsibleUserId :
                  undefined;
              }`
            }
          }
        );
      })
      .then((exportData) => {
        // send export id further
        callback(
          null,
          exportData
        );
      })
      .catch(callback);
  };

  /**
   * Export list of contacts where each contact has a page with follow up questionnaire and answers
   * @param response
   * @param filter
   * @param reqOptions
   * @param callback
   */
  Outbreak.prototype.exportDailyContactFollowUpForm = function (response, filter, reqOptions, callback) {
    // selected outbreak data
    const outbreak = this;

    /**
     * Flow control, make sure callback is not called multiple times
     * @param error
     * @param result
     */
    const responseCallback = function (error, result) {
      // execute callback
      callback(error, result);
      // replace callback with no-op to prevent calling it multiple times
      callback = () => {
      };
    };

    // construct contacts query
    let contactQuery = app.utils.remote.mergeFilters({
      where: {
        outbreakId: outbreak.id,
      }
    }, filter || {}).where;

    // add geographical restriction to filter if needed
    app.models.contact
      .addGeographicalRestrictions(reqOptions.remotingContext, contactQuery)
      .then(updatedFilter => {
        // update contactQuery if needed
        updatedFilter && (contactQuery = updatedFilter);

        // get list of contacts based on the filter passed on request
        return app.models.contact
          .rawFind(contactQuery, {
            projection: {
              id: 1,
              firstName: 1,
              middleName: 1,
              lastName: 1,
              gender: 1,
              age: 1,
              addresses: 1
            }
          });
      })
      .then((contacts) => {
        // map contacts
        const contactsMap = {};
        (contacts || []).forEach((contact) => {
          contactsMap[contact.id] = contact;
        });

        // finished
        return contactsMap;
      })
      .then((contactsMap) => {
        // construct relationship filter
        // retrieve relationships for specific contacts
        // and retrieve only the last contact date
        const matchFilter = app.utils.remote.convertLoopbackFilterToMongo({
          $and: [
            // make sure we're only retrieving relationships from the current outbreak
            // retrieve only non-deleted records
            {
              outbreakId: outbreak.id,
              active: true,
              deleted: false
            },
            // and for the contacts desired
            {
              'persons.id': {
                $in: Object.keys(contactsMap)
              },
              'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
            }
          ]
        });

        // get the latest date of contact for the each contact
        return app.dataSources.mongoDb.connector
          .collection('relationship')
          .aggregate([
            {
              // filter
              $match: matchFilter
            }, {
              // split persons into two records since we need to determine contact date for each one of teh involved persons al long as they both are conatcts
              $unwind: '$persons'
            }, {
              // keep only records that are contacts
              $match: {
                'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
              }
            }, {
              // determine max contact ate for each contact
              $group: {
                _id: '$persons.id',
                lastContactDate: {
                  $max: '$contactDate'
                }
              }
            }
          ], {
            allowDiskUse: true
          })
          .toArray()
          .then((relationshipData) => {
            // map relationship data
            (relationshipData || []).forEach((data) => {
              if (contactsMap[data._id]) {
                contactsMap[data._id].lastContactDate = localizationHelper.getDateStartOfDay(data.lastContactDate);
              }
            });

            // finished
            return contactsMap;
          });
      })
      .then((contactsMap) => {
        // get all follow ups belonging to any of the contacts that matched the filter
        const followUpsFilter = app.utils.remote.convertLoopbackFilterToMongo(
          {
            $and: [
              // make sure we're only retrieving follow ups from the current outbreak
              // and for the contacts desired
              // retrieve only non-deleted records
              {
                outbreakId: this.id,
                personId: {
                  $in: Object.keys(contactsMap)
                },
                deleted: false
              }
            ]
          });

        // run the aggregation against database
        return app.dataSources.mongoDb.connector
          .collection('followUp')
          .aggregate([
            {
              $match: followUpsFilter
            }, {
              $sort: {
                date: -1
              }
            },
            // group follow ups by person id
            // structure after grouping (_id -> personId, followUps -> list of follow ups)
            {
              $group: {
                _id: '$personId',
                followUps: {
                  $push: '$$ROOT'
                }
              }
            }
          ], {
            allowDiskUse: true
          })
          .toArray()
          .then((followUpData) => {
            // go though each group of follow-ups and assighn it to the proper contact
            (followUpData || []).forEach((groupData) => {
              if (
                !contactsMap[groupData._id] ||
                !contactsMap[groupData._id].lastContactDate
              ) {
                return;
              }

              // we start follow up period from next day after last contact date
              const firstFollowUpDay = contactsMap[groupData._id].lastContactDate.clone().add(1, 'days');

              // calculate end day of follow up by taking the last contact day and adding the outbreak period of follow up to it
              const lastFollowUpDay = localizationHelper.getDateEndOfDay(firstFollowUpDay.clone().add(outbreak.periodOfFollowup, 'days'));

              // determine relevant follow-ups
              // those that are in our period of interest
              contactsMap[groupData._id].followUps = _.filter(groupData.followUps, (followUpData) => {
                return followUpData.date && localizationHelper.toMoment(followUpData.date).isBetween(firstFollowUpDay, lastFollowUpDay, undefined, '[]');
              });
            });

            // finished
            return contactsMap;
          });
      })
      .then((contactsMap) => {
        // generate pdf
        return new Promise((resolve, reject) => {
          const languageId = reqOptions.remotingContext.req.authData.user.languageId;
          app.models.language.getLanguageDictionary(languageId, (err, dictionary) => {
            // error ?
            if (err) {
              return reject(err);
            }

            // build common labels (page title, comments title, contact details title)
            const commonLabels = {
              pageTitle: dictionary.getTranslation('LNG_PAGE_LIST_CONTACTS_EXPORT_DAILY_FOLLOW_UP_LIST_TITLE'),
              contactTitle: dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_DETAILS'),
              commentsTitle: dictionary.getTranslation('LNG_DATE_FIELD_LABEL_COMMENTS')
            };

            // build table data and contact details section properties
            const entries = [];
            _.each(contactsMap, (contactData) => {
              // table headers, first header has no name (it contains the questions)
              const tableHeaders = [
                {
                  id: 'description',
                  header: ''
                }
              ];

              // do we have last contact date ?
              if (contactData.lastContactDate) {
                // we start follow up period from next day after last contact date
                const firstFollowUpDay = contactData.lastContactDate.clone().add(1, 'days');

                // calculate end day of follow up by taking the last contact day and adding the outbreak period of follow up to it
                const lastFollowUpDay = localizationHelper.getDateEndOfDay(
                  firstFollowUpDay.clone().add(
                    // last contact date is inclusive
                    outbreak.periodOfFollowup > 0 ? outbreak.periodOfFollowup - 1 : 0, 'days'
                  )
                );

                // dates headers
                let dayIndex = 1;
                for (let date = firstFollowUpDay.clone(); date.isSameOrBefore(lastFollowUpDay); date.add(1, 'day')) {
                  tableHeaders.push({
                    id: date.format('YYYY-MM-DD'),
                    header: dayIndex
                  });
                  dayIndex++;
                }
              }

              // table data, each index is a row
              const tableData = [];

              // build the contact name, doing this to avoid unnecessary spaces, where a name is not defined
              const names = [
                contactData.firstName,
                contactData.middleName,
                contactData.lastName
              ];

              // final construct name structure that is displayed
              let displayedName = '';
              names.forEach((name) => {
                if (name) {
                  displayedName = displayedName + ' ' + pdfUtils.displayValue(name);
                }
              });

              // contact details section
              // will be displayed in the order they are defined
              const contactDetails = [
                {
                  label: dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_NAME'),
                  value: displayedName
                },
                {
                  label: dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_GENDER'),
                  value: dictionary.getTranslation(contactData.gender)
                },
                {
                  label: dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_AGE'),
                  value: pdfUtils.displayAge(contactData, dictionary)
                },
                {
                  label: dictionary.getTranslation('LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE'),
                  value: contactData.lastContactDate ?
                    localizationHelper.toMoment(contactData.lastContactDate).format('YYYY-MM-DD') :
                    ''
                },
                {
                  label: dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_ADDRESSES'),
                  value: app.models.address.getHumanReadableAddress(app.models.person.getCurrentAddress(contactData))
                },
                {
                  label: dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_PHONE_NUMBER'),
                  value: app.models.person.getCurrentAddress(contactData) ? app.models.person.getCurrentAddress(contactData).phoneNumber : ''
                }
              ];

              // add question to pdf form
              const addQuestionToForm = (question) => {
                // ignore irrelevant questions
                if (
                  [
                    'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_FILE_UPLOAD'
                  ].indexOf(question.answerType) >= 0
                ) {
                  return;
                }

                // add question texts as first row
                tableData.push({
                  description: dictionary.getTranslation(question.text)
                });

                // add answers for each follow up day
                (contactData.followUps || []).forEach((followUp) => {
                  // add follow-up only if there isn't already one on that date
                  // if there is, it means that that one is newer since follow-ups are sorted by date DESC and we don't need to set this one
                  const dateFormated = localizationHelper.toMoment(followUp.date).format('YYYY-MM-DD');
                  if (!tableData[tableData.length - 1][dateFormated]) {
                    // format questionnaire answers to old format so we can use the old functionality & also use the latest value
                    followUp.questionnaireAnswers = followUp.questionnaireAnswers || {};
                    followUp.questionnaireAnswers = genericHelpers.convertQuestionnaireAnswersToOldFormat(followUp.questionnaireAnswers);

                    // add cell data
                    tableData[tableData.length - 1][dateFormated] = genericHelpers.translateQuestionAnswers(
                      question,
                      question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_DATE_TIME' ?
                        (followUp.questionnaireAnswers[question.variable] ? localizationHelper.toMoment(followUp.questionnaireAnswers[question.variable]).format('YYYY-MM-DD') : '') :
                        followUp.questionnaireAnswers[question.variable],
                      dictionary
                    );
                  }
                });

                // add aditional questions
                (question.answers || []).forEach((answer) => {
                  (answer.additionalQuestions || []).forEach((childQuestion) => {
                    // add child question
                    addQuestionToForm(childQuestion);
                  });
                });
              };

              // add all questions as rows
              outbreak.contactFollowUpTemplate.forEach((question) => {
                // add main question
                addQuestionToForm(question);
              });

              // add to list of pages
              entries.push({
                contactDetails: contactDetails,
                tableHeaders: tableHeaders,
                tableData: tableData
              });
            });

            // finished
            resolve({
              commonLabels: commonLabels,
              entries: entries
            });
          });
        });
      })
      .then((data) => {
        const pdfBuilder = fork(`${__dirname}../../../components/workers/buildDailyFollowUpForm`,
          [], {
            execArgv: [],
            windowsHide: true
          }
        );

        // error event listener, stop the whole request cycle
        const eventListener = function () {
          const error = new Error(`Processing failed. Worker stopped. Event Details: ${JSON.stringify(arguments)}`);
          response.req.logger.error(JSON.stringify(error));
          return responseCallback(error);
        };

        // listen to exit/error events
        ['error', 'exit'].forEach((event) => {
          pdfBuilder.on(event, eventListener);
        });

        // listen to builder messages
        pdfBuilder.on('message', (args) => {
          // first argument is an error
          if (args[0]) {
            return responseCallback(args[0]);
          }
          // if the message is a chunk
          if (args[1] && args[1].chunk) {
            // write it on the response
            response.write(Buffer.from(args[1].chunk.data));
          }
          // if the worker finished, end the response as well
          if (args[1] && args[1].end) {
            // end the response
            response.end();

            // process will be closed gracefully, remove listeners
            ['error', 'exit'].forEach(function (event) {
              pdfBuilder.removeListener(event, eventListener);
            });

            // kill the builder process
            pdfBuilder.kill();
          }
        });

        // set headers related to files download
        response.set('Content-type', 'application/pdf');
        response.set('Content-disposition', `attachment;filename=${data.commonLabels.pageTitle}.pdf`);

        // process contacts in batches
        (function nextBatch(commonLabels, data) {
          // get current set size
          let currentSetSize = data.length;
          // no records left to be processed
          if (currentSetSize === 0) {
            // all records processed, inform the worker that is time to finish
            return pdfBuilder.send({fn: 'finish', args: []});
          } else if (currentSetSize > 100) {
            // too many records left, limit batch size to 100
            currentSetSize = 100;
          }
          // build a subset of data
          const dataSubset = data.splice(0, currentSetSize);

          // worker communicates via messages, listen to them
          const messageListener = function (args) {
            // first argument is an error
            if (args[0]) {
              return responseCallback(args[0]);
            }
            // if the worker is ready for the next batch
            if (args[1] && args[1].readyForNextBatch) {
              // remove current listener
              pdfBuilder.removeListener('message', messageListener);
              // send move to next step
              nextBatch(commonLabels, data);
            }
          };

          // listen to worker messages
          pdfBuilder.on('message', messageListener);

          // build pdf
          pdfBuilder.send({
            fn: 'sendData',
            args: [commonLabels, dataSubset, !data.length]
          });
        })(data.commonLabels, data.entries);
      })
      .catch(responseCallback);
  };

  /**
   * Before remote hook for GET /contacts/filtered-count
   */
  Outbreak.beforeRemote('prototype.filteredCountContacts', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};

    Outbreak.helpers.findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });

  /**
   * Count outbreak contacts
   * @param filter Supports 'where.case', 'where.followUp' MongoDB compatible queries
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountContacts = function (filter, options, callback) {
    // pre-filter using related data (case, followUps)
    app.models.contact
      .preFilterForOutbreak(this, filter, options)
      .then(function (filter) {
        // replace nested geo points filters
        filter.where = app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.contact,
          filter.where || {},
          true,
          undefined,
          true,
          true
        );

        // count using query
        return app.models.contact.rawCountDocuments(filter);
      })
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Get contacts follow up report per date range
   * @param dateRange
   * @param callback
   */
  Outbreak.prototype.getContactFollowUpReport = function (filter, dateRange, options, callback) {
    // endData can be received from filter or body
    // body has priority
    let endDate = dateRange.endDate || _.get(filter, 'where.endDate', null);
    if (_.get(filter, 'where.endDate')) {
      delete filter.where.endDate;
    }

    // add geographical restriction to filter if needed
    app.models.followUp
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update where if needed
        updatedFilter && (filter.where = updatedFilter);

        WorkerRunner
          .getContactFollowUpReport(
            this.id,
            dateRange.startDate,
            endDate,
            _.get(filter, 'where')
          )
          .then(result => callback(null, result))
          .catch(callback);
      });
  };

  /**
   * Count contacts that are on the follow up list when generating
   * Also custom filtered
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountContactsOnFollowUpList = function (filter = {}, options, callback) {
    // defensive checks
    filter.where = filter.where || {};
    let startDate = localizationHelper.getDateStartOfDay().toDate();
    let endDate = localizationHelper.getDateEndOfDay().toDate();
    if (filter.where.startDate) {
      startDate = localizationHelper.getDateStartOfDay(filter.where.startDate).toDate();
      delete filter.where.startDate;
    }
    if (filter.where.endDate) {
      endDate = localizationHelper.getDateEndOfDay(filter.where.endDate).toDate();
      delete filter.where.endDate;
    }

    // filter by classification ?
    const classification = _.get(filter, 'where.classification');
    if (classification) {
      delete filter.where.classification;
    }

    // merge filter props from request with the built-in filter
    // there is no way to reuse the filter from follow up generation filter
    // this is slightly modified to accustom the needs and also inconclusive/valid contacts are merged in one op here
    const mergedFilter = app.utils.remote.mergeFilters({
      where: {
        outbreakId: this.id,
        followUp: {
          $ne: null
        },
        // only contacts that are under follow up
        'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP',
        $or: [
          {
            // eligible for follow ups
            $and: [
              {
                $or: [
                  {
                    // follow up period is inside contact's follow up period
                    $and: [
                      {
                        'followUp.startDate': {
                          $lte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $gte: endDate
                        }
                      }
                    ]
                  },
                  {
                    // period starts before contact's start date but ends before contact's end date
                    $and: [
                      {
                        'followUp.startDate': {
                          $gte: startDate
                        }
                      },
                      {
                        'followUp.startDate': {
                          $lte: endDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $gte: endDate
                        }
                      }
                    ]
                  },
                  {
                    // period starts before contact's end date and after contact's start date
                    // but stops after contact's end date
                    $and: [
                      {
                        'followUp.startDate': {
                          $lte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $gte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $lte: endDate
                        }
                      }
                    ]
                  },
                  {
                    // contact's period is inside follow up period
                    $and: [
                      {
                        'followUp.startDate': {
                          $gte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $gte: startDate
                        }
                      },
                      {
                        'followUp.endDate': {
                          $lte: endDate
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }, filter);

    // add geographical restriction to filter if needed
    let promise = app.models.contact
      .addGeographicalRestrictions(options.remotingContext, mergedFilter.where)
      .then(updatedFilter => {
        updatedFilter && (mergedFilter.where = updatedFilter);
      });

    // do we need to filter contacts by case classification ?
    if (classification) {
      // retrieve cases
      promise = promise
        .then(() => {
          return app.models.case
            .rawFind({
              outbreakId: this.id,
              deleted: false,
              classification: app.utils.remote.convertLoopbackFilterToMongo(classification)
            }, {projection: {'_id': 1}});
        })
        .then((caseData) => {
          // no case data, so there is no need to retrieve relationships
          if (_.isEmpty(caseData)) {
            return [];
          }

          // retrieve list of cases for which we need to retrieve contacts relationships
          const caseIds = caseData.map((caseModel) => caseModel.id);

          // retrieve relationships
          return app.models.relationship
            .rawFind({
              outbreakId: this.id,
              deleted: false,
              $or: [
                {
                  'persons.0.source': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.0.id': {
                    $in: caseIds
                  }
                }, {
                  'persons.1.source': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.id': {
                    $in: caseIds
                  }
                }
              ]
            }, {projection: {persons: 1}});
        })
        .then((relationshipData) => {
          // determine contacts which can be retrieved
          let contactIds = {};
          (relationshipData || []).forEach((contact) => {
            const id = contact.persons[0].target ?
              contact.persons[0].id :
              contact.persons[1].id;
            contactIds[id] = true;
          });
          contactIds = Object.keys(contactIds);

          // filter contacts
          mergedFilter.where = {
            $and: [
              mergedFilter.where, {
                _id: {
                  $in: contactIds
                }
              }
            ]
          };
        });
    }

    // get contacts that are available for follow up generation
    promise
      .then(() => {
        return app.models.contact
          .rawFind(mergedFilter.where, {projection: {'_id': 1}})
          .then((ids) => callback(null, ids.length, ids.map(obj => obj.id)))
          .catch(callback);
      });
  };

  /**
   * Returns a pdf list, containing the outbreak's contacts, distributed by location and follow-up status
   * @param filter -> accepts custom parameter <dateOfFollowUp>. It mentions the date for which we are checking if the contact has been seen or not
   * @param options
   * @param callback
   */
  Outbreak.prototype.downloadContactTracingPerLocationLevelReport = function (filter, options, callback) {
    const self = this;
    const languageId = options.remotingContext.req.authData.user.languageId;

    // set default filter values
    filter = filter || {};
    filter.where = filter.where || {};

    // set default dateOfFollowUp
    if (
      !filter.dateOfFollowUp &&
      !filter.where.dateOfFollowUp
    ) {
      filter.dateOfFollowUp = localizationHelper.now().toDate();
    }

    // got dateOfFollowUp in where as it should be and not under filter ?
    if (filter.where.dateOfFollowUp) {
      filter.dateOfFollowUp = filter.where.dateOfFollowUp;
      delete filter.where.dateOfFollowUp;
    }

    // Get the date of the selected day for report to add to the pdf title (by default, current day)
    let selectedDayForReport = localizationHelper.toMoment(filter.dateOfFollowUp).format('ll');

    // Get the dictionary so we can translate the case classifications and other neccessary fields
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      app.models.person.getPeoplePerLocation('contact', filter, self, options)
        .then((result) => {
          // Initiate the headers for the contact tracing per location pdf list
          let headers = [
            {
              id: 'location',
              header: dictionary.getTranslation(self.reportingGeographicalLevelId)
            },
            {
              id: 'underFollowUp',
              header: dictionary.getTranslation('LNG_LIST_HEADER_UNDER_FOLLOWUP')
            },
            {
              id: 'seenOnDay',
              header: dictionary.getTranslation('LNG_LIST_HEADER_SEEN_ON_DAY')
            },
            {
              id: 'coverage',
              header: '%'
            },
            {
              id: 'registered',
              header: dictionary.getTranslation('LNG_LIST_HEADER_REGISTERED')
            },
            {
              id: 'released',
              header: dictionary.getTranslation('LNG_LIST_HEADER_RELEASED')
            },
            {
              id: 'expectedRelease',
              header: dictionary.getTranslation('LNG_LIST_HEADER_EXPECTED_RELEASE')
            }
          ];

          let data = [];
          result.peopleDistribution.forEach((dataObj) => {
            // Define the base form of the data for one row of the pdf list
            // Keep the values as strings so that 0 actually gets displayed in the table
            let row = {
              location: dataObj.location.name,
              underFollowUp: '0',
              seenOnDay: '0',
              coverage: '0',
              registered: '0',
              released: '0',
              expectedRelease: dataObj.people.length && dataObj.people[0].followUp ? localizationHelper.toMoment(dataObj.people[0].followUp.endDate).format('ll') : '-'
            };

            // Update the row's values according to each contact's details
            dataObj.people.forEach((contact) => {
              row.registered = +row.registered + 1;

              // Any status other than under follow-up will make the contact be considered as released.
              if (contact.followUp && contact.followUp.status === 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP') {
                row.underFollowUp = +row.underFollowUp + 1;

                // The contact can be seen only if he is under follow
                if (contact.followUps.length) {
                  let completedFollowUp = _.find(contact.followUps, function (followUp) {
                    return ['LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_OK',
                      'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_NOT_OK'].includes(followUp.statusId);
                  });
                  if (completedFollowUp) {
                    row.seenOnDay = +row.seenOnDay + 1;
                  }

                  // What percentage of the contacts under followUp have been seen on the specified date.
                  row.coverage = +row.seenOnDay / +row.underFollowUp * 100;
                }

              } else {
                row.released = +row.released + 1;
              }
            });
            data.push(row);
          });

          // Create the pdf list file
          return app.utils.helpers.exportListFile(headers, data, 'pdf', `Contact tracing ${selectedDayForReport}`);
        })
        .then(function (file) {
          // and offer it for download
          app.utils.remote.helpers.offerFileToDownload(file.data, file.mimeType, `Contact tracing report.${file.extension}`, callback);
        })
        .catch((error) => {
          callback(error);
        });
    });
  };

  /**
   * Before remote hook for GET /contacts/per-risk-level/count
   */
  Outbreak.beforeRemote('prototype.countContactsPerRiskLevel', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });

  /**
   * Count contacts by case risk level
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactsPerRiskLevel = function (filter, options, callback) {
    app.models.person
      .groupCount(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
        filter,
        'riskLevel',
        'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_UNCLASSIFIED'
      )
      .then((result) => {
        callback(
          null,
          result
        );
      })
      .catch(callback);
  };

  /**
   * Export range list of contacts and follow ups
   * Grouped by case/place
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportRangeListOfContacts = function (body, options, callback) {
    // shortcut for safe display a value in the document
    const display = pdfUtils.displayValue;

    // application model's reference
    const models = app.models;

    let standardFormat = 'YYYY-MM-DD';
    let startDate = localizationHelper.getDateStartOfDay(body.startDate);
    let endDate = localizationHelper.getDateStartOfDay(body.endDate);

    // make sure range dates are valid or single date
    if (!startDate.isValid() || !endDate.isValid()) {
      return callback(app.utils.apiError.getError('INVALID_DATES'));
    }

    // follow up statuses map
    let followUpStatusMap = app.models.followUp.statusAcronymMap;

    // case id value maps
    // mainly used to know which value should be set into document for each case id
    let caseIdValueMap = {};

    // get list of contacts
    models.contact
      .getGroupedByDate(
        this, {
          startDate: body.startDate,
          endDate: body.endDate
        },
        body.groupBy,
        options
      )
      .then((contactGroups) => {
        // create a map of group id and corresponding value that should be displayed
        if (body.groupBy === 'case') {
          let groupNameResolvePromise = [];
          for (let groupId in contactGroups) {
            if (contactGroups.hasOwnProperty(groupId)) {
              groupNameResolvePromise.push(
                new Promise((resolve, reject) => {
                  return app.models.person
                    .findById(groupId)
                    .then((caseModel) => {
                      // if case is somehow deleted, to not display the contacts in the group altogether
                      if (!caseModel) {
                        delete contactGroups[groupId];
                      } else {
                        caseIdValueMap[groupId] = `${display(caseModel.firstName)} ${display(caseModel.middleName)} ${display(caseModel.lastName)}`;
                      }
                      return resolve();
                    })
                    .catch(reject);
                })
              );
            }
          }
          return Promise
            .all(groupNameResolvePromise)
            .then(() => contactGroups);
        }
        return contactGroups;
      })
      .then((contactGroups) => {
        return new Promise((resolve, reject) => {
          // resolve location names if contacts are being grouped by case
          if (body.groupBy === 'case') {
            let groupContactLocationMap = {};
            let allLocationsIds = [];

            for (let group in contactGroups) {
              if (contactGroups.hasOwnProperty(group)) {
                groupContactLocationMap[group] = contactGroups[group].map((contact, index) => {
                  let address = models.person.getCurrentAddress(contact);

                  if (address) {
                    allLocationsIds.push(address.locationId);

                    return {
                      locationId: address.locationId,
                      arrayIndex: index
                    };
                  }

                  return {
                    locationId: null,
                    arrayIndex: index
                  };
                });
              }
            }

            // retrieve locations
            return models.location
              .rawFind({
                id: {
                  $in: allLocationsIds
                }
              })
              .then((locations) => {
                // map locations
                const locationsMap = _.transform(
                  locations,
                  (accumulator, value) => {
                    accumulator[value.id] = value;
                  },
                  {}
                );

                // add locations to each group
                for (let group in groupContactLocationMap) {
                  groupContactLocationMap[group].map((groupItem) => {
                    if (
                      groupItem.locationId &&
                      locationsMap[groupItem.locationId]
                    ) {
                      contactGroups[group][groupItem.arrayIndex].locationName = locationsMap[groupItem.locationId].name;
                    }
                  });
                }

                // finished
                resolve(contactGroups);
              })
              .catch(reject);
          }
          return resolve(contactGroups);
        });
      })
      .then((contactGroups) => {
        const languageId = options.remotingContext.req.authData.user.languageId;
        app.models.language
          .getLanguageDictionary(
            languageId,
            (err, dictionary) => {
              if (err) {
                return callback(err);
              }

              // generate pdf document
              let doc = pdfUtils.createPdfDoc();
              pdfUtils.addTitle(doc, dictionary.getTranslation('LNG_PAGE_TITLE_RANGE_CONTACTS_LIST'));
              doc.moveDown();


              // follow up status legend
              pdfUtils.addTitle(doc, dictionary.getTranslation('LNG_FOLLOW_UP_STATUS_LEGEND'), 12);
              for (let statusId in followUpStatusMap) {
                if (followUpStatusMap.hasOwnProperty(statusId)) {
                  pdfUtils.addTitle(doc, `${dictionary.getTranslation(statusId)} = ${dictionary.getTranslation(followUpStatusMap[statusId])}`, 8);
                }
              }
              doc.moveDown();
              let groupIndex = 0;
              // build tables for each group item
              for (let groupName in contactGroups) {
                if (contactGroups.hasOwnProperty(groupName)) {
                  // if contacts are grouped by case search the group name in the configured map
                  // otherwise use group id as title
                  let groupTitle = groupName;
                  if (body.groupBy === 'case') {
                    groupTitle = caseIdValueMap[groupName];
                  }
                  // risk level title is a token, should be translated
                  if (body.groupBy === 'riskLevel') {
                    groupTitle = dictionary.getTranslation(groupName);
                  }

                  // after first group, each group goes on different page
                  if (groupIndex > 0) {
                    doc.addPage();
                    doc.moveDown(2);
                  }

                  pdfUtils.addTitle(doc, groupTitle, 12);

                  // common headers
                  let headers = [
                    {
                      id: 'contact',
                      header: dictionary.getTranslation('LNG_FOLLOW_UP_FIELD_LABEL_CONTACT')
                    },
                    {
                      id: 'age',
                      header: dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_AGE')
                    },
                    {
                      id: 'gender',
                      header: dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_GENDER')
                    },
                    {
                      id: 'place',
                      header: dictionary.getTranslation('LNG_ENTITY_FIELD_LABEL_PLACE')
                    },
                    {
                      id: 'city',
                      header: dictionary.getTranslation('LNG_ADDRESS_FIELD_LABEL_CITY')
                    },
                    {
                      id: 'address',
                      header: dictionary.getTranslation('LNG_ENTITY_FIELD_LABEL_ADDRESS')
                    },
                    {
                      id: 'followUpStartDate',
                      header: dictionary.getTranslation('LNG_RANGE_CONTACTS_LIST_HEADER_START_DATE')
                    },
                    {
                      id: 'followUpEndDate',
                      header: dictionary.getTranslation('LNG_RANGE_CONTACTS_LIST_HEADER_END_DATE')
                    }
                  ];

                  // additional tables for many days
                  let additionalTables = [];
                  // allow only 10 days be displayed on the same table with contact information
                  let mainTableMaxCount = 10;
                  // check to know that main table count threshold is overcome
                  let isMainTableFull = false;
                  // allow only 20 days per additional table to be displayed
                  let additionalTableMaxCount = 39;
                  let counter = 1;
                  let insertAdditionalTable = function () {
                    additionalTables.push({
                      headers: [],
                      values: []
                    });
                  };
                  for (let date = startDate.clone(); date.isSameOrBefore(endDate); date.add(1, 'day')) {
                    if (counter <= mainTableMaxCount && !isMainTableFull) {
                      headers.push({
                        id: date.format(standardFormat),
                        header: date.format('YY/MM/DD'),
                        width: 20,
                        isDate: true
                      });

                      if (counter === mainTableMaxCount) {
                        isMainTableFull = true;
                        counter = 1;
                        continue;
                      }
                    }

                    if (counter <= additionalTableMaxCount && isMainTableFull) {
                      if (!additionalTables.length) {
                        insertAdditionalTable();
                      }

                      let lastAdditionalTable = additionalTables[additionalTables.length - 1];
                      lastAdditionalTable.headers.push({
                        id: date.format(standardFormat),
                        header: date.format('YY/MM/DD'),
                        width: 20
                      });

                      if (counter === additionalTableMaxCount) {
                        insertAdditionalTable();
                        counter = 1;
                        continue;
                      }
                    }

                    counter++;
                  }

                  // start building table data
                  let tableData = [];

                  let rowIndex = 0;
                  contactGroups[groupName].forEach((contact) => {
                    let contactInfo = `${display(contact.firstName)} ${display(contact.middleName)} ${display(contact.lastName)}`;

                    let row = {
                      contact: contactInfo,
                      gender: display(dictionary.getTranslation(contact.gender))
                    };

                    let age = '';
                    if (contact.age) {
                      if (contact.age.months > 0) {
                        age = `${display(contact.age.months)} ${dictionary.getTranslation('LNG_AGE_FIELD_LABEL_MONTHS')}`;
                      } else {
                        age = `${display(contact.age.years)} ${dictionary.getTranslation('LNG_AGE_FIELD_LABEL_YEARS')}`;
                      }
                    }
                    row.age = age;

                    if (contact.followUp) {
                      let followUpStartDate = localizationHelper.getDateStartOfDay(contact.followUp.startDate);
                      let followUpEndDate = localizationHelper.getDateStartOfDay(contact.followUp.endDate);

                      row.followUpStartDate = followUpStartDate.format(standardFormat);
                      row.followUpEndDate = followUpEndDate.format(standardFormat);

                      // mark them unusable from startDate to followup start date
                      // and from follow up end date to document end date
                      for (let date = startDate.clone(); date.isBefore(followUpStartDate); date.add(1, 'day')) {
                        row[date.format(standardFormat)] = {
                          value: 'X',
                          isDate: true
                        };
                      }
                      for (let date = followUpEndDate.clone().add(1, 'day'); date.isSameOrBefore(endDate); date.add(1, 'day')) {
                        row[date.format(standardFormat)] = {
                          value: 'X',
                          isDate: true
                        };
                      }
                    }

                    // if contacts are grouped per location
                    // then use the group name which is location name as place for each contact under the group
                    if (body.groupBy === 'place') {
                      row.place = groupName;
                    } else {
                      row.place = display(contact.locationName);
                    }

                    // get contact's current address
                    let contactAddress = models.person.getCurrentAddress(contact);
                    if (contactAddress) {
                      row.city = display(contactAddress.city);
                      row.address = display(contactAddress.addressLine1);
                    }

                    // only the latest follow up will be shown
                    // they are ordered by descending by date prior to this
                    if (contact.followUps.length) {
                      contact.followUps.forEach((followUp) => {
                        let rowId = localizationHelper.toMoment(followUp.date).format(standardFormat);
                        row[rowId] = {
                          value: dictionary.getTranslation(followUpStatusMap[followUp.statusId]) || '',
                          isDate: true
                        };
                      });
                    }

                    // move days that don't belong to main table to additional day tables
                    let mainTableDateHeaders = headers.filter((header) => header.hasOwnProperty('isDate'));
                    let lastDayInMainTable = localizationHelper.getDateStartOfDay(mainTableDateHeaders[mainTableDateHeaders.length - 1].id);

                    // get all date values from row, keep only until last day in the table
                    // rest split among additional tables
                    for (let prop in row) {
                      if (
                        row.hasOwnProperty(prop) &&
                        row[prop] !== null &&
                        row[prop] !== undefined &&
                        row[prop].isDate
                      ) {
                        let parsedDate = localizationHelper.getDateStartOfDay(prop);
                        if (parsedDate.isAfter(lastDayInMainTable)) {
                          // find the suitable additional table
                          let suitableAdditionalTable = additionalTables.filter((tableDef) => {
                            if (tableDef.headers.length) {
                              let lastDay = tableDef.headers[tableDef.headers.length - 1].id;
                              return parsedDate.isSameOrBefore(localizationHelper.getDateStartOfDay(lastDay));
                            }
                            return false;
                          });
                          if (suitableAdditionalTable.length) {
                            suitableAdditionalTable[0].values[rowIndex] = suitableAdditionalTable[0].values[rowIndex] || {};
                            suitableAdditionalTable[0].values[rowIndex][prop] = row[prop].value;
                          }
                          delete row[prop];
                        } else {
                          row[prop] = row[prop].value;
                        }
                      }
                    }

                    tableData.push(row);
                    rowIndex++;
                  });

                  // insert table into the document
                  pdfUtils.createTableInPDFDocument(headers, tableData, doc, null, true);

                  additionalTables.forEach((tableDef) => {
                    pdfUtils.createTableInPDFDocument(tableDef.headers, tableDef.values, doc, null, true);
                  });

                  groupIndex++;
                }
              }

              // end the document stream
              // to convert it into a buffer
              doc.end();

              // send pdf doc as response
              pdfUtils.downloadPdfDoc(doc, dictionary.getTranslation('LNG_FILE_NAME_RANGE_CONTACTS_LIST'), callback);
            }
          );
      });
  };

  /**
   * Retrieve available people for a contact
   * @param contactId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getContactRelationshipsAvailablePeople = function (contactId, filter, options, callback) {
    // retrieve available people
    app.models.person
      .getAvailablePeople(
        this.id,
        contactId,
        filter,
        options
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count available people for a contact
   * @param contactId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactRelationshipsAvailablePeople = function (contactId, filter, options, callback) {
    // count available people
    app.models.person
      .getAvailablePeopleCount(
        this.id,
        contactId,
        filter,
        options
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };

  /**
   * Get all duplicates based on hardcoded rules against a model props
   * @param model
   * @param options
   * @param callback
   */
  Outbreak.prototype.getContactPossibleDuplicates = function (model = {}, options, callback) {
    if (
      Config.duplicate &&
      Config.duplicate.disableContactDuplicateCheck
    ) {
      callback(null, []);
    } else {
      app.models.person
        .findDuplicatesByType(this.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', model, options)
        .then(duplicates => callback(null, duplicates))
        .catch(callback);
    }
  };

  /**
   * Import an importable contacts file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableContactsFileUsingMap = function (body, options, callback) {
    const self = this;

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
      return genericHelpers.fillGeoLocationInformation(batchData, 'save.contact.addresses', app)
        .then(() => {
          // build a list of create operations for this batch
          const createContacts = [];
          // go through all entries
          batchData.forEach(function (recordData) {
            const dataToSave = recordData.save;
            createContacts.push(function (asyncCallback) {
              // sync the contact
              return app.utils.dbSync.syncRecord(app, logger, app.models.contact, dataToSave.contact, options)
                .then(function (syncResult) {
                  const contactRecord = syncResult.record;
                  // promisify next step
                  return new Promise(function (resolve, reject) {
                    // normalize people
                    Outbreak.helpers.validateAndNormalizePeople(self.id, contactRecord.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', dataToSave.relationship, true, function (error) {
                      if (error) {
                        // delete contact since contact was created without an error while relationship failed
                        return app.models.contact.destroyById(
                          contactRecord.id,
                          () => {
                            // return error
                            return reject(error);
                          }
                        );
                      }

                      // sync relationship
                      return app.utils.dbSync.syncRecord(app, logger, app.models.relationship, dataToSave.relationship, options)
                        .then(function () {
                          // relationship successfully created, move to tne next one
                          resolve();
                        })
                        .catch(function (error) {
                          // failed to create relationship, remove the contact if it was created during sync
                          if (syncResult.flag === app.utils.dbSync.syncRecordFlags.CREATED) {
                            contactRecord.destroy(options);
                          }
                          reject(error);
                        });
                    });
                  });
                })
                .then(function () {
                  asyncCallback();
                })
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  asyncCallback(null, {
                    success: false,
                    error: {
                      error: error,
                      data: {
                        file: recordData.raw,
                        save: recordData.save
                      }
                    }
                  });
                });
            });
          });

          return createContacts;
        });
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.contact,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // relationship model boolean properties
    const relationshipModelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.relationship,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    let modelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.contact,
      genericHelpers.DATA_TYPE.DATE
    );

    // add the "date" properties of the questionnaire
    const questionnaireDateProperties = [];
    genericHelpers.getQuestionnaireDateProperties(
      questionnaireDateProperties,
      self.contactInvestigationTemplate ?
        self.contactInvestigationTemplate.toJSON() :
        undefined
    );
    modelDateProperties = modelDateProperties.concat(questionnaireDateProperties);

    // relationship model date properties
    const relationshipModelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.relationship,
      genericHelpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'contact',
      batchSize: contactImportBatchSize,
      outbreakId: self.id,
      contactModelBooleanProperties: modelBooleanProperties,
      relationshipModelBooleanProperties: relationshipModelBooleanProperties,
      contactModelDateProperties: modelDateProperties,
      relationshipModelDateProperties: relationshipModelDateProperties,
      contactImportableTopLevelProperties: app.models.contact._importableTopLevelProperties,
      relationshipImportableTopLevelProperties: app.models.relationship._importableTopLevelProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.contact.modelName,
      outbreakId: self.id,
      logger: logger
    }, formatterOptions, createBatchActions, callback);
  };

  /**
   * Convert a contact to a contact of contact
   * @param contactId
   * @param options
   * @param callback
   */
  Outbreak.prototype.convertContactToContactOfContact = function (contactId, options, callback) {
    let contactInstance, convertedContactOfContact;
    app.models.contact
      .findOne({
        where: {
          id: contactId
        },
        fields: [
          'id',
          'questionnaireAnswers'
        ]
      })
      .then(function (contactModel) {
        if (!contactModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contact.modelName, id: contactId});
        }

        // keep the contactModel as we will do actions on it
        contactInstance = contactModel;

        // in order for a contact to be converted to a contact of contact it must be related to at least another contact and it must be a target in that relationship
        // check relations
        return app.models.relationship
          .rawCountDocuments({
            where: {
              // required to use index to improve greatly performance
              'persons.id': contactId,

              $or: [
                {
                  'persons.0.id': contactId,
                  'persons.0.target': true,
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
                },
                {
                  'persons.1.id': contactId,
                  'persons.1.target': true,
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
                }
              ]
            }
          }, {
            limit: 1,
            // required to use index to improve greatly performance
            hint: {
              'persons.id': 1
            }
          });
      })
      .then(function (response) {
        if (!response.count) {
          // the contact of contact doesn't have relations with other contacts; stop conversion
          throw app.utils.apiError.getError('INVALID_CONTACT_RELATIONSHIP', {id: contactId});
        }

        // define the attributes for update
        const attributes = {
          dateBecomeContactOfContact: localizationHelper.today().toDate(),
          wasContact: true,
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
        };

        // retain data from custom forms upon conversion
        if (!_.isEmpty(contactInstance.questionnaireAnswers)) {
          attributes.questionnaireAnswersContact = Object.assign({}, contactInstance.questionnaireAnswers);
          attributes.questionnaireAnswers = {};
        }

        // the case has relations with other cases; proceed with the conversion
        return app.models.person.rawUpdateOne(
          {
            _id: contactId
          },
          attributes,
          options
        );
      })
      .then(() => {
        return app.models.contactOfContact.findOne({
          where: {
            id: contactId
          }
        });
      })
      .then(function (contactOfContact) {
        if (!contactOfContact) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contactOfContact.modelName, id: contactId});
        }

        // keep the contactOfContact as we will do actions on it
        convertedContactOfContact = contactOfContact;

        // after updating the case, find it's relations
        return app.models.relationship
          .find({
            where: {
              'persons.id': contactId
            }
          });
      })
      .then(function (relations) {
        // check if there are relations
        if (!relations.length) {
          return;
        }

        // update relations
        const updateRelations = [];
        relations.forEach(function (relation) {
          let persons = [];
          relation.persons.forEach(function (person) {
            // for every occurrence of current contact
            if (person.id === contactId) {
              // update type to match the new one
              person.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT';
            }
            persons.push(person);
          });
          updateRelations.push(relation.updateAttributes({persons: persons}, options));
        });
        return Promise.all(updateRelations);
      })
      .then(function () {
        // update personType from lab results
        return app.models.labResult
          .rawBulkUpdate(
            {
              personId: contactId
            },
            {
              personType: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
            },
            options
          );
      })
      .then(function () {
        callback(null, convertedContactOfContact);
      })
      .catch(callback);
  };
};
