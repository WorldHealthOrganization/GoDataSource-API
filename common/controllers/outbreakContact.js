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
    Outbreak.helpers.exportDailyPersonFollowUpList(
      this,
      genericHelpers.PERSON_TYPE.CONTACT,
      res,
      groupBy,
      filter,
      options,
      callback
    );
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
    Outbreak.helpers.exportDailyPersonFollowUpForm(
      this,
      genericHelpers.PERSON_TYPE.CONTACT,
      response,
      filter,
      reqOptions,
      callback
    );
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
    Outbreak.helpers.filteredCountPersonsOnFollowUpList(
      this,
      genericHelpers.PERSON_TYPE.CONTACT,
      filter,
      options,
      callback
    );
  };

  /**
   * Returns a pdf list, containing the outbreak's contacts, distributed by location and follow-up status
   * @param filter -> accepts custom parameter <dateOfFollowUp>. It mentions the date for which we are checking if the contact has been seen or not
   * @param options
   * @param callback
   */
  Outbreak.prototype.downloadContactTracingPerLocationLevelReport = function (filter, options, callback) {
    Outbreak.helpers.downloadPersonTracingPerLocationLevelReport(
      this,
      genericHelpers.PERSON_TYPE.CONTACT,
      filter,
      options, callback
    );
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

    // define specific variables
    let documentTitleToken;
    let entityNameToken;
    let fileName;
    if (body.personType === genericHelpers.PERSON_TYPE.CASE) {
      entityNameToken = 'LNG_RANGE_FOLLOW_UPS_EXPORT_LIST_HEADER_ENTITY_TYPE_CASE';
      documentTitleToken = 'LNG_PAGE_TITLE_RANGE_CASES_LIST';
      fileName = 'Daily Case List.pdf';
    } else {
      // contact
      entityNameToken = 'LNG_RANGE_FOLLOW_UPS_EXPORT_LIST_HEADER_ENTITY_TYPE_CONTACT';
      documentTitleToken = 'LNG_PAGE_TITLE_RANGE_CONTACTS_LIST';
      fileName = 'Daily Contact List.pdf';
    }

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
        this,
        body.personType,
        {
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
              pdfUtils.addTitle(doc, dictionary.getTranslation(documentTitleToken));
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
                      header: dictionary.getTranslation(entityNameToken)
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
              pdfUtils.downloadPdfDoc(doc, dictionary.getTranslation(fileName), callback);
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
                          // check if follow-ups should be generated
                          if (
                            !self.generateFollowUpsWhenCreatingContacts ||
                            syncResult.flag !== app.utils.dbSync.syncRecordFlags.CREATED
                          ) {
                            // relationship successfully created, move to tne next one
                            return;
                          }

                          // generate follow-ups
                          return new Promise((cufResolve, cufReject) => {
                            Outbreak.generateFollowupsForOutbreak(
                              self,
                              {
                                contactIds: [syncResult.record.id]
                              },
                              options,
                              (err, response) => {
                                if (err) {
                                  cufReject(err);
                                } else {
                                  cufResolve(response);
                                }
                              }
                            );
                          });
                        })
                        .then(() => {
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
        // delete all future follow-ups
        return app.models.followUp
          .rawBulkDelete(
            {
              personId: contactId,
              date: {
                $gte: localizationHelper.today().add(1, 'days')
              }
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
