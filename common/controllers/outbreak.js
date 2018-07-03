'use strict';

const moment = require('moment');
const app = require('../../server/server');
const uuid = require('uuid');
const _ = require('lodash');
const rr = require('rr');
const templateParser = require('./../../components/templateParser');
const referenceDataParser = require('./../../components/referenceDataParser');
const genericHelpers = require('../../components/helpers');

module.exports = function (Outbreak) {

  // get model helpers
  const helpers = Outbreak.helpers;

  // disable bulk delete for related models
  app.utils.remote.disableRemoteMethods(Outbreak, [
    'prototype.__delete__cases',
    'prototype.__delete__cases__labResults',
    'prototype.__delete__cases__relationships',
    'prototype.__delete__clusters',
    'prototype.__delete__contacts',
    'prototype.__delete__contacts__followUps',
    'prototype.__delete__contacts__relationships',
    'prototype.__create__clusters__relationships',
    'prototype.__delete__clusters__relationships',
    'prototype.__findById__clusters__relationships',
    'prototype.__updateById__clusters__relationships',
    'prototype.__destroyById__clusters__relationships',
    'prototype.__delete__contacts__relationships',
    'prototype.__get__referenceData',
    'prototype.__delete__referenceData',
    'prototype.__count__referenceData',
    'prototype.__create__followUps',
    'prototype.__delete__followUps',
    'prototype.__updateById__followUps',
    'prototype.__destroyById__followUps'
  ]);

  // attach search by relation property behavior on get contacts
  app.utils.remote.searchByRelationProperty.attachOnRemotes(Outbreak, [
    'prototype.__get__contacts'
  ]);

  /**
   * Do not allow deletion of a active Outbreak
   */
  Outbreak.beforeRemote('deleteById', function (context, modelInstance, next) {
    Outbreak.findById(context.args.id)
      .then(function (outbreak) {
        if (outbreak) {
          return app.models.User.count({
            activeOutbreakId: outbreak.id
          })
        } else {
          return 0;
        }
      })
      .then(function (userCount) {
        if (userCount) {
          throw app.utils.apiError.getError('DELETE_ACTIVE_OUTBREAK', {id: context.args.id}, 422);
        }
        return next();
      })
      .catch(next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/cases) hooks
   */
  Outbreak.beforeRemote('prototype.__get__cases', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('case', context);
    // Enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation('case', context, modelInstance, next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/events) hooks
   */
  Outbreak.beforeRemote('prototype.__get__events', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('event', context);
    // Enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation('event', context, modelInstance, next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/contacts) hooks
   */
  Outbreak.beforeRemote('prototype.__get__contacts', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('contact', context);
    next();
  });

  /**
   * Parsing the properties that are of type '["date"]' as Loopback doesn't save them correctly
   * Also set visual id
   */
  Outbreak.beforeRemote('prototype.__create__cases', function (context, modelInstance, next) {
    // parse array of dates properties
    helpers.parseArrayOfDates(context.args.data);
    // if the visual id was not passed
    if (context.args.data.visualId === undefined) {
      // set it automatically
      Outbreak.helpers.getAvailableVisualId(context.instance, function (error, visualId) {
        context.args.data.visualId = visualId;
        return next(error);
      });
    } else {
      next();
    }
  });

  /**
   * Parsing the properties that are of type '["date"]' as Loopback doesn't save them correctly
   */
  Outbreak.beforeRemote('prototype.__updateById__cases', function (context, modelInstance, next) {
    // parse array of dates properties
    helpers.parseArrayOfDates(context.args.data);

    next();
  });

  /**
   * Restrict the list of outbreaks only to what's accessible to current logged in user
   */
  Outbreak.beforeRemote('find', function (context, modelInstance, next) {
    // get logged in user outbreak restrictions
    const restrictedOutbreakIds = _.get(context, 'req.authData.user.outbreakIds', []);
    // if there are any restrictions set
    if (restrictedOutbreakIds.length) {
      // update filters to search only in the outbreaks accessible to the user
      context.args.filter = app.utils.remote
        .mergeFilters({
          where: {
            id: {
              in: restrictedOutbreakIds
            }
          }
        }, context.args.filter || {});
    }
    next();
  });

  /**
   * Find relations for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findCaseRelationships = function (caseId, filter, callback) {
    helpers.findPersonRelationships(caseId, filter, callback);
  };

  /**
   * Find relations for a contact
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactRelationships = function (contactId, filter, callback) {
    helpers.findPersonRelationships(contactId, filter, callback);
  };

  /**
   * Find relations for a event
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findEventRelationships = function (eventId, filter, callback) {
    helpers.findPersonRelationships(eventId, filter, callback);
  };

  /**
   * Create relation for a case
   * @param caseId
   * @param data
   * @param callback
   */
  Outbreak.prototype.createCaseRelationship = function (caseId, data, callback) {
    helpers.createPersonRelationship(this.id, caseId, 'case', data, callback);
  };

  /**
   * Create relation for a contact
   * @param contactId
   * @param data
   * @param callback
   */
  Outbreak.prototype.createContactRelationship = function (contactId, data, callback) {
    helpers.createPersonRelationship(this.id, contactId, 'contact', data, callback);
  };

  /**
   * Create relation for a event
   * @param eventId
   * @param data
   * @param callback
   */
  Outbreak.prototype.createEventRelationship = function (eventId, data, callback) {
    helpers.createPersonRelationship(this.id, eventId, 'event', data, callback);
  };

  /**
   * Retrieve a relation for a case
   * @param caseId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getCaseRelationship = function (caseId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(caseId, relationshipId, 'case', filter, callback);
  };

  /**
   * Retrieve a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getContactRelationship = function (contactId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(contactId, relationshipId, 'contact', filter, callback);
  };

  /**
   * Retrieve a relation for a event
   * @param eventId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getEventRelationship = function (eventId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(eventId, relationshipId, 'event', filter, callback);
  };

  /**
   * Update a relation for a case
   * @param caseId
   * @param relationshipId
   * @param data
   * @param callback
   */
  Outbreak.prototype.updateCaseRelationship = function (caseId, relationshipId, data, callback) {
    helpers.updatePersonRelationship(caseId, relationshipId, 'case', data, callback);
  };

  /**
   * Update a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param data
   * @param callback
   */
  Outbreak.prototype.updateContactRelationship = function (contactId, relationshipId, data, callback) {
    helpers.updatePersonRelationship(contactId, relationshipId, 'contact', data, callback);
  };

  /**
   * Update a relation for a event
   * @param eventId
   * @param relationshipId
   * @param data
   * @param callback
   */
  Outbreak.prototype.updateEventRelationship = function (eventId, relationshipId, data, callback) {
    helpers.updatePersonRelationship(eventId, relationshipId, 'event', data, callback);
  };

  /**
   * Delete a relation for a case
   * @param caseId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.deleteCaseRelationship = function (caseId, relationshipId, callback) {
    helpers.deletePersonRelationship(caseId, relationshipId, callback);
  };

  /**
   * Delete a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.deleteContactRelationship = function (contactId, relationshipId, callback) {
    helpers.deletePersonRelationship(contactId, relationshipId, callback);
  };

  /**
   * Delete a relation for a event
   * @param eventId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.deleteEventRelationship = function (eventId, relationshipId, callback) {
    helpers.deletePersonRelationship(eventId, relationshipId, callback);
  };

  /**
   * Count relations for a case
   * @param caseId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countCaseRelationships = function (caseId, where, callback) {
    helpers.countPersonRelationships(caseId, where, callback);
  };

  /**
   * Count relations for a contact
   * @param contactId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countContactRelationships = function (contactId, where, callback) {
    helpers.countPersonRelationships(contactId, where, callback);
  };

  /**
   * Count relations for a event
   * @param eventId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countEventRelationships = function (eventId, where, callback) {
    helpers.countPersonRelationships(eventId, where, callback);
  };

  /**
   * Convert a contact to a case
   * @param contactId
   * @param callback
   */
  Outbreak.prototype.convertContactToCase = function (contactId, callback) {
    let updateRelations = [];
    let convertedCase;

    // override default scope to allow switching the type
    const defaultScope = app.models.contact.defaultScope;
    app.models.contact.defaultScope = function () {
    };

    app.models.contact
      .findOne({
        where: {
          type: 'contact',
          id: contactId
        }
      })
      .then(function (contact) {
        if (!contact) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contact.modelName, id: contactId});
        }
        return contact.updateAttributes({
          type: "case",
          dateBecomeCase: new Date()
        });
      })
      .then(function (_case) {
        convertedCase = _case;
        // after updating the contact, find it's relations
        return app.models.relationship
          .find({
            where: {
              "persons.id": contactId
            }
          });
      })
      .then(function (relations) {
        // update relations
        relations.forEach(function (relation) {
          let persons = [];
          relation.persons.forEach(function (person) {
            // for every occurrence of current contact
            if (person.id === contactId) {
              // update type to match the new one
              person.type = 'case';
            }
            persons.push(person);
          });
          updateRelations.push(relation.updateAttributes({persons: persons}));
        });
        return Promise.all(updateRelations);
      })
      .then(function () {
        callback(null, convertedCase);
      })
      .catch(callback)
      .finally(function () {
        // restore default scope
        app.models.contact.defaultScope = defaultScope;
      });
  };

  /**
   * Convert a case to a contact
   * @param caseId
   * @param callback
   */
  Outbreak.prototype.convertCaseToContact = function (caseId, callback) {
    let updateRelations = [];
    let convertedContact;
    let caseInstance;

    // override default scope to allow switching the type
    const defaultScope = app.models.case.defaultScope;
    app.models.case.defaultScope = function () {
    };

    app.models.case
      .findOne({
        where: {
          type: 'case',
          id: caseId
        }
      })
      .then(function (caseModel) {
        if (!caseModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.case.modelName, id: caseId});
        }

        // keep the caseModel as we will do actions on it
        caseInstance = caseModel;

        // in order for a case to be converted to a contact it must be related to at least another case
        // check relations
        return app.models.relationship
          .count({
            'and': [
              {
                'persons.id': caseId
              },
              {
                'persons': {
                  'elemMatch': {
                    'type': 'case',
                    'id': {
                      '$ne': caseId
                    }
                  }
                }
              }
            ]
          });
      })
      .then(function (relationsNumber) {
        if (!relationsNumber) {
          // the case doesn't have relations with other cases; stop conversion
          throw app.utils.apiError.getError('INVALID_CASE_RELATIONSHIP', {id: caseId});
        }

        // the case has relations with other cases; proceed with the conversion
        return caseInstance.updateAttribute('type', 'contact');
      })
      .then(function (contact) {
        convertedContact = contact;
        // after updating the case, find it's relations
        return app.models.relationship
          .find({
            where: {
              "persons.id": caseId
            }
          });
      })
      .then(function (relations) {
        // update relations
        relations.forEach(function (relation) {
          let persons = [];
          relation.persons.forEach(function (person) {
            // for every occurrence of current contact
            if (person.id === caseId) {
              // update type to match the new one
              person.type = 'contact';
            }
            persons.push(person);
          });
          updateRelations.push(relation.updateAttributes({persons: persons}));
        });
        return Promise.all(updateRelations);
      })
      .then(function () {
        callback(null, convertedContact);
      })
      .catch(callback)
      .finally(function () {
        // restore default scope
        app.models.case.defaultScope = defaultScope;
      });
  };

  /**
   * Retrieve the list of location + sublocations for the Outbreak
   * @param callback
   */
  Outbreak.prototype.getLocations = function (callback) {
    app.models.location.getSubLocationsWithDetails([this.locationId], [], callback);
  };

  /**
   * Restore a deleted case
   * @param caseId
   * @param callback
   */
  Outbreak.prototype.restoreCase = function (caseId, callback) {
    app.models.case
      .findOne({
        deleted: true,
        where: {
          id: caseId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.case.modelName, id: caseId});
        }

        // undo case delete
        instance.undoDelete(callback);
      })
      .catch(callback);
  };

  /**
   * Retrieve system and own reference data
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getReferenceData = function (filter, callback) {
    helpers.getSystemAndOwnReferenceData(this.id, filter)
      .then((data) => callback(null, data))
      .catch(callback);
  };

  /**
   * Restore a deleted follow up
   * @param contactId
   * @param followUpId
   * @param callback
   */
  Outbreak.prototype.restoreContactFollowUp = function (contactId, followUpId, callback) {
    app.models.followUp
      .findOne({
        deleted: true,
        where: {
          id: followUpId,
          personId: contactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.followUp.modelName, id: followUpId});
        }
        instance.undoDelete(callback);
      })
      .catch(callback);
  };

  /**
   * Generate list of follow ups
   * @param data Contains number of days used to perform the generation
   * @param callback
   */
  Outbreak.prototype.generateFollowups = function (data, callback) {
    // if no followup period was sent in request, assume its just for one day
    data = data || {};
    data.followUpPeriod = data.followUpPeriod || 1;

    // cache outbreak's follow up options
    let outbreakFollowUpPeriod = ++this.periodOfFollowup;
    let outbreakFollowUpFreq = this.frequencyOfFollowUp;
    let outbreakFollowUpPerDay = this.frequencyOfFollowUpPerDay;

    // list of generated follow ups to be returned in the response
    // grouped per contact
    let generateResponse = [];

    // make sure follow up period given in the request does not exceed outbreak's follow up period
    if (data.followUpPeriod > outbreakFollowUpPeriod) {
      data.followUpPeriod = outbreakFollowUpPeriod;
    }

    // retrieve list of contacts that has a relationship with events/cases and is eligible for generation
    app.models.contact
      .find({
        include: {
          relation: 'relationships',
          scope: {
            where: {
              or: [
                {
                  'persons.type': 'case'
                },
                {
                  'persons.type': 'event'
                }
              ]
            },
            order: 'contactDate DESC'
          }
        }
      })
      .then((contacts) => {
        // follow up add statements
        let followsUpsToAdd = [];

        // filter contacts that have no relationships
        contacts = contacts.filter((item) => item.relationships.length);

        // retrieve the last follow up that is brand new for contacts
        return Promise
          .all(contacts.map((contact) => {
            return app.models.followUp
              .find({
                where: {
                  personId: contact.id
                },
                order: 'createdAt DESC'
              })
              .then((followUps) => {
                contact.followUpsLists = followUps;
                return contact;
              });
          }))
          .then((contacts) => {
            if (contacts.length) {
              // retrieve all teams and their locations/sublocations
              return app.models.team.find()
                .then((teams) => Promise.all(teams.map((team) => {
                  return new Promise((resolve, reject) => {
                    return app.models.location
                      .getSubLocations(team.locationIds, [], (err, locations) => {
                        if (err) {
                          return reject(err);
                        }
                        return resolve(locations);
                      })
                  })
                    .then((locations) => {
                      team.locations = locations;
                      return team;
                    });
                })))
                .then((teams) => {
                  contacts.forEach((contact) => {
                    // generate response entry for the given contact
                    generateResponse.push({
                      contactId: contact.id,
                      followUps: []
                    });

                    // store index of the contact entry in response, to easily reference it down below
                    let genResponseIndex = generateResponse.length - 1;

                    // find all the teams that are matching the contact's location ids from addresses
                    // stop at first address that has a matching team
                    let eligibleTeams = [];
                    for (let i = 0; i < contact.addresses.length; i++) {
                      // try to find index of the address location in teams locations
                      let filteredTeams = teams.filter((team) => team.locations.indexOf(contact.addresses[i].locationId) !== -1);
                      if (filteredTeams.length) {
                        eligibleTeams = eligibleTeams.concat(filteredTeams.map((team) => team.id));
                        break;
                      }
                    }

                    // follow ups to be generated for the given contact
                    // each one contains a specific date
                    let contactFollowUpsToAdd = [];

                    // follow ups to be added for the given contact
                    // choose contact date from the latest relationship with a case/event
                    let lastSickDate = genericHelpers.getUTCDate(contact.relationships[0].contactDate);

                    // build the contact's last date of follow up, based on the days count given in the request
                    let incubationLastDay = genericHelpers.getUTCDate(lastSickDate).add(data.followUpPeriod, 'd');

                    // check a weird case when the last follow up was yesterday and not performed
                    // but today is the last day of incubation
                    // it should generate a follow up for today, no matter the follow up period sent in request
                    if (contact.followUpsLists.length) {
                      let lastFollowUp = contact.followUpsLists[0];

                      // build the contact's last date of follow up, no matter the period given in the request
                      let incubationLastDay = genericHelpers.getUTCDate(lastSickDate).add(outbreakFollowUpPeriod, 'd');

                      // check if last follow up is generated and not performed
                      // also checks that, the scheduled date is the same last day of incubation
                      if (helpers.isNewGeneratedFollowup(lastFollowUp)
                        && genericHelpers.getUTCDate(lastFollowUp.date).isSame(incubationLastDay, 'd')) {

                        contactFollowUpsToAdd.push(
                          app.models.followUp
                            .create({
                              // used to easily trace all follow ups for a given outbreak
                              outbreakId: contact.outbreakId,
                              personId: contact.id,
                              // schedule for today
                              date: genericHelpers.getUTCDate().toDate(),
                              performed: false,
                              // choose first team, it will be only this follow up generated
                              // so no randomness is required
                              teamId: eligibleTeams[0],
                              isGenerated: true
                            })
                            .then((createdFollowUp) => {
                              generateResponse[genResponseIndex].followUps.push(createdFollowUp);
                            })
                        );

                        // skip to next contact
                        return;
                      }
                    }

                    // generate follow up, starting from today
                    for (let now = genericHelpers.getUTCDate(); now <= incubationLastDay; now.add(outbreakFollowUpFreq, 'day')) {
                      let generatedFollowUps = [];
                      for (let i = 0; i < outbreakFollowUpPerDay; i++) {
                        generatedFollowUps.push(
                          app.models.followUp
                            .create({
                              // used to easily trace all follow ups for a given outbreak
                              outbreakId: contact.outbreakId,
                              personId: contact.id,
                              date: now.toDate(),
                              performed: false,
                              // split the follow ups work equally across teams
                              teamId: rr(eligibleTeams),
                              isGenerated: true
                            })
                            .then((createdFollowUp) => {
                              generateResponse[genResponseIndex].followUps.push(createdFollowUp);
                            })
                        );
                      }

                      // if there is generated follow ups on that day, delete it and re-create
                      let existingFollowups = contact.followUpsLists.filter((followUp) => {
                        return moment(followUp.date).isSame(now, 'd') && helpers.isNewGeneratedFollowup(followUp);
                      });

                      if (existingFollowups.length) {
                        // schedule the generated follow up for database add op
                        contactFollowUpsToAdd.push(Promise.all(
                          [
                            app.models.followUp.destroyAll({
                              id: {
                                inq: existingFollowups.map((f) => f.id)
                              }
                            }),
                            Promise.all(generatedFollowUps)
                          ])
                        );
                      } else {
                        contactFollowUpsToAdd.push(...generatedFollowUps);
                      }
                    }

                    if (contactFollowUpsToAdd.length) {
                      followsUpsToAdd.push(Promise.all(contactFollowUpsToAdd));
                    }
                  });

                  return Promise.all(followsUpsToAdd).then(() => generateResponse);
                });
            }
          })
          .then((response) => callback(null, response))
          .catch((err) => callback(err));
      });
  };

  /**
   * Generate (next available) visual id
   * @param callback
   */
  Outbreak.prototype.generateVisualId = function (callback) {
    Outbreak.helpers.getAvailableVisualId(this, callback);
  };

  /**
   * Generate a globally unique id
   * @param callback
   */
  Outbreak.generateUniqueId = function (callback) {
    callback(null, uuid.v4())
  };

  /**
   * Get a resource link embedded in a QR Code Image (png) for a case
   * @param caseId
   * @param callback
   */
  Outbreak.prototype.getCaseQRResourceLink = function (caseId, callback) {
    Outbreak.helpers.getPersonQRResourceLink(this, 'case', caseId, function (error, qrCode) {
      callback(null, qrCode, `image/png`, `attachment;filename=case-${caseId}.png`);
    });
  };

  /**
   * Get a resource link embedded in a QR Code Image (png) for a contact
   * @param contactId
   * @param callback
   */
  Outbreak.prototype.getContactQRResourceLink = function (contactId, callback) {
    Outbreak.helpers.getPersonQRResourceLink(this, 'contact', contactId, function (error, qrCode) {
      callback(null, qrCode, `image/png`, `attachment;filename=contact-${contactId}.png`);
    });
  };

  /**
   * Get a resource link embedded in a QR Code Image (png) for a event
   * @param eventId
   * @param callback
   */
  Outbreak.prototype.getEventQRResourceLink = function (eventId, callback) {
    Outbreak.helpers.getPersonQRResourceLink(this, 'event', eventId, function (error, qrCode) {
      callback(null, qrCode, `image/png`, `attachment;filename=event-${eventId}.png`);
    });
  };

  /**
   * Before create hook
   */
  Outbreak.beforeRemote('create', function (context, modelInstance, next) {
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    // parse outbreak
    templateParser.beforeHook(context, modelInstance, next);
  });

  /**
   * After create hook
   */
  Outbreak.afterRemote('create', function (context, modelInstance, next) {
    // after successfully creating outbreak, also create translations for it.
    templateParser.afterHook(context, modelInstance, next);
  });

  /**
   * Before update hook
   */
  Outbreak.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // in order to translate dynamic data, don't store values in the database, but translatable language tokens
    // parse outbreak
    templateParser.beforeHook(context, modelInstance, next);
  });

  /**
   * After update hook
   */
  Outbreak.afterRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    // after successfully creating outbreak, also create translations for it.
    templateParser.afterHook(context, modelInstance, next);
  });

  /**
   * Before create reference data hook
   */
  Outbreak.beforeRemote('prototype.__create__referenceData', function (context, modelInstance, next) {
    // parse referenceData to create language tokens
    referenceDataParser.beforeCreateHook(context, modelInstance, next);
  });

  /**
   * After create reference data hook
   */
  Outbreak.afterRemote('prototype.__create__referenceData', function (context, modelInstance, next) {
    // after successfully creating reference data, also create translations for it.
    referenceDataParser.afterCreateHook(context, modelInstance, next);
  });

  /**
   * Before update reference data hook
   */
  Outbreak.beforeRemote('prototype.__updateById__referenceData', function (context, modelInstance, next) {
    // parse referenceData to update language tokens
    referenceDataParser.beforeUpdateHook(context, modelInstance, next);
  });

  /**
   * After update reference data hook
   */
  Outbreak.afterRemote('prototype.__updateById__referenceData', function (context, modelInstance, next) {
    // after successfully updating reference data, also update translations for it.
    referenceDataParser.afterUpdateHook(context, modelInstance, next);
  });

  /**
   * Count the new contacts and groups them by exposure type
   * @param callback
   */
  Outbreak.prototype.countNewContactsByExposure = function (callback) {
    // get outbreak
    let outbreak = this;
    // initialize noDaysNewContacts
    let noDaysNewContacts = outbreak.noDaysNewContacts;
    // initialize result
    let result = {};

    // get exposureTypes from reference data
    helpers.getSystemAndOwnReferenceData(outbreak.id, {
      where: {
        categoryId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE'
      }
    })
      .then(function (exposureTypes) {
        // loop through exposure types and initialize the counters in the result
        exposureTypes.forEach(function (exposureType) {
          result[exposureType.value] = 0;
        });

        // get now date
        let now = new Date();

        // get the new contacts in the outbreak
        return app.models.contact.find({
          include: ['relationships'],
          where: {
            createdAt: {
              gte: now.setDate(now.getDate() - noDaysNewContacts)
            }
          }
        });
      })
      .then(function (contacts) {
        // loop through the contacts and check relationships exposure types to increase the counters in the result
        contacts.forEach(function (contact) {
          contact.relationships.forEach(function (relationship) {
            // increasing counter for all the contact relationships
            // Note: The result counters total will not equal number of contacts as contacts may have multiple relationships
            result[relationship.exposureTypeId]++;
          });
        });

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count independent transmission chains
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countIndependentTransmissionChains = function (filter, callback) {
    // build a filter
    filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: this.id
        }
      }, filter || {});

    // search relations
    app.models.relationship
      .find(filter)
      .then(function (relationships) {
        // add 'filterParent' capability
        relationships = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, filter);
        // count transmission chains
        app.models.relationship
          .countTransmissionChains(relationships, function (error, noOfChains) {
            if (error) {
              throw error;
            }
            callback(null, noOfChains)
          });
      })
      .catch(callback);
  };

  /**
   * Get independent transmission chains
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getIndependentTransmissionChains = function (filter, callback) {
    filter = filter || {};
    // start with a basic filter
    let _filter = {
      where: {
        outbreakId: this.id
      }
    };
    // get include filter
    let includeFilter = _.get(filter, 'include', []);
    // normalize filters
    if (!Array.isArray(includeFilter)) {
      includeFilter = [includeFilter];
    }
    // check of the filter has people relation included (is needed for transmission chains)
    let hasPeopleRelation = false;
    includeFilter.forEach(function (singleInclude) {
      if (
        (typeof singleInclude === 'string' && singleInclude === 'people') ||
        (typeof singleInclude === 'object' && singleInclude.relation === 'people')) {
        hasPeopleRelation = true;
      }
    });
    // if the relation was not included
    if (!hasPeopleRelation) {
      // include it
      includeFilter.push('people');
    }
    // update filter
    _.set(filter, 'include', includeFilter);
    // merge filters
    filter = app.utils.remote.mergeFilters(_filter, filter);

    app.models.relationship
      .find(filter)
      .then(function (relationships) {
        // add 'filterParent' capability
        relationships = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, filter);
        // build transmission chains
        app.models.relationship
          .getTransmissionChains(relationships, function (error, transmissionChains) {
            if (error) {
              return callback(error);
            }
            callback(null, transmissionChains)
          });
      })
      .catch(callback);
  };

  /**
   * Set outbreakId for created follow-ups
   */
  Outbreak.beforeRemote('prototype.__create__contacts__followUps', function (context, modelInstance, next) {
    // set outbreakId
    context.args.data.outbreakId = context.instance.id;
    next();
  });

  /**
   * Count the seen contacts
   * Note: The contacts are counted in total and per team. If a contact is seen by 2 teams it will be counted once in total and once per each team.
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsSeen = function (filter, callback) {
    helpers.countContactsByFollowUpFlag({outbreakId: this.id, followUpFlag: 'performed', resultProperty: 'contactsSeen'}, filter, callback);
  };

  /**
   * Count the contacts that are lost to follow-up
   * Note: The contacts are counted in total and per team. If a contact is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsLostToFollowup = function (filter, callback) {
    helpers.countContactsByFollowUpFlag({outbreakId: this.id, followUpFlag: 'lostToFollowUp', resultProperty: 'contactsLostToFollowup'}, filter, callback);
  };
};
