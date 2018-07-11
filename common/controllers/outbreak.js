'use strict';

const moment = require('moment');
const app = require('../../server/server');
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
    'prototype.__get__contacts',
    'prototype.__get__cases'
  ]);

  /**
   * Allows count requests with advanced filters (like the ones we can use on GET requests)
   * to be made on outbreak/{id}/cases.
   */
  Outbreak.prototype.filteredCountCases = function (filter, callback) {
    this.__get__cases(filter, function (err, res) {
      if (err) {
        return callback(err);
      }
      callback(null, app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(res, filter).length);
    })
  };

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
      // make sure the visual id is unique in the given outbreak, otherwise stop with error
      Outbreak.helpers
        .validateVisualIdUniqueness(context.instance.id, context.args.data.visualId)
        .then(next)
        .catch(next);
    }
  });

  /**
   * Handle visual identifier (uniqueness and generation)
   */
  Outbreak.beforeRemote('prototype.__create__contacts', function (context, modelInstance, next) {
    // if the visual id was not passed
    if (context.args.data.visualId === undefined) {
      // set it automatically
      Outbreak.helpers.getAvailableVisualId(context.instance, function (error, visualId) {
        context.args.data.visualId = visualId;
        return next(error);
      });
    } else {
      // make sure the visual id is unique in the given outbreak, otherwise stop with error
      Outbreak.helpers
        .validateVisualIdUniqueness(context.instance.id, context.args.data.visualId)
        .then(next)
        .catch(next);
    }
  });

  /**
   * Parsing the properties that are of type '["date"]' as Loopback doesn't save them correctly
   * Validate visual identifier (optional)
   */
  Outbreak.beforeRemote('prototype.__updateById__cases', function (context, modelInstance, next) {
    // parse array of dates properties
    helpers.parseArrayOfDates(context.args.data);

    // if visual id was sent in request, check for uniqueness
    if (context.args.data.visualId !== undefined) {
      // retrieve the instance that will be updated
      // if visual id's are the same, no need to check for uniqueness
      app.models.case
        .findOne({
          where: {
            id: context.args.fk
          }
        })
        .then((caseModel) => {
          if (caseModel.visualId === context.args.data.visualId) {
            return next();
          }
          // make sure the visual id is unique in the given outbreak, otherwise stop with error
          return Outbreak.helpers
            .validateVisualIdUniqueness(context.instance.id, context.args.data.visualId)
            .then(next);
        })
        .catch(next);
    } else {
      return next();
    }
  });

  /**
   * Make sure visual identifier is unique, if its sent in request
   */
  Outbreak.beforeRemote('prototype.__updateById__contacts', function (context, modelInstance, next) {
    // if visual id was sent in request, check for uniqueness
    if (context.args.data.visualId !== undefined) {
      // retrieve the instance that will be updated
      // if visual id's are the same, no need to check for uniqueness
      app.models.contact
        .findOne({
          where: {
            id: context.args.fk
          }
        })
        .then((contact) => {
          if (contact.visualId === context.args.data.visualId) {
            return next();
          }
          // make sure the visual id is unique in the given outbreak, otherwise stop with error
          return Outbreak.helpers
            .validateVisualIdUniqueness(context.instance.id, context.args.data.visualId)
            .then(next);
        })
        .catch(next);
    } else {
      return next();
    }
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
   * @param options
   * @param callback
   */
  Outbreak.prototype.createCaseRelationship = function (caseId, data, options, callback) {
    // make sure case is valid, before trying to create any relations
    app.models.case
      .findById(caseId)
      .then((caseModel) => {
        if (!caseModel) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          }));
        }
        helpers.createPersonRelationship(this.id, caseId, 'case', data, options, callback);
      })
      .catch(callback);
  };

  /**
   * Create relation for a contact
   * @param contactId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createContactRelationship = function (contactId, data, options, callback) {
    // make sure contact is valid, before trying to create any relations
    app.models.contact
      .findById(contactId)
      .then((contact) => {
        if (!contact) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: contactId
          }));
        }
        helpers.createPersonRelationship(this.id, contactId, 'contact', data, options, callback);
      })
      .catch(callback);
  };

  /**
   * Create relation for a event
   * @param eventId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createEventRelationship = function (eventId, data, options, callback) {
    // make sure event is valid, before trying to create any relations
    app.models.event
      .findById(eventId)
      .then((event) => {
        if (!event) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.event.modelName,
            id: eventId
          }));
        }
        helpers.createPersonRelationship(this.id, eventId, 'event', data, options, callback);
      })
      .catch(callback);
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
   * @param options
   * @param callback
   */
  Outbreak.prototype.updateCaseRelationship = function (caseId, relationshipId, data, options, callback) {
    helpers.updatePersonRelationship(caseId, relationshipId, 'case', data, options, callback);
  };

  /**
   * Update a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.updateContactRelationship = function (contactId, relationshipId, data, options, callback) {
    helpers.updatePersonRelationship(contactId, relationshipId, 'contact', data, options, callback);
  };

  /**
   * Update a relation for a event
   * @param eventId
   * @param relationshipId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.updateEventRelationship = function (eventId, relationshipId, data, options, callback) {
    helpers.updatePersonRelationship(eventId, relationshipId, 'event', data, options, callback);
  };

  /**
   * Delete a relation for a case
   * @param caseId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteCaseRelationship = function (caseId, relationshipId, options, callback) {
    helpers.deletePersonRelationship(caseId, relationshipId, options, callback);
  };

  /**
   * Delete a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteContactRelationship = function (contactId, relationshipId, options, callback) {
    helpers.deletePersonRelationship(contactId, relationshipId, options, callback);
  };

  /**
   * Delete a relation for a event
   * @param eventId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteEventRelationship = function (eventId, relationshipId, options, callback) {
    helpers.deletePersonRelationship(eventId, relationshipId, options, callback);
  };

  /**
   * Count relations for a case
   * @param caseId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countCaseRelationships = function (caseId, where, callback) {
    // make sure case is valid
    app.models.case
      .findById(caseId)
      .then((caseModel) => {
        if (!caseModel) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          }));
        }
        helpers.countPersonRelationships(caseId, where, callback);
      })
      .catch(callback);
  };

  /**
   * Count relations for a contact
   * @param contactId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countContactRelationships = function (contactId, where, callback) {
    // make sure contact is valid
    app.models.contact
      .findById(contactId)
      .then((contact) => {
        if (!contact) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: contactId
          }));
        }
        helpers.countPersonRelationships(contactId, where, callback);
      })
      .catch(callback);
  };

  /**
   * Count relations for a event
   * @param eventId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countEventRelationships = function (eventId, where, callback) {
    // make sure event is valid
    app.models.event
      .findById(eventId)
      .then((event) => {
        if (!event) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.event.modelName,
            id: eventId
          }));
        }
        helpers.countPersonRelationships(eventId, where, callback);
      })
      .catch(callback);
  };

  /**
   * Convert a contact to a case
   * @param contactId
   * @param params Case specific params
   * @param options
   * @param callback
   */
  Outbreak.prototype.convertContactToCase = function (contactId, params, options, callback) {
    let updateRelations = [];
    let convertedCase;

    // parse case specific params, if not available fallback on default values
    params = params || {};
    params.type = 'case';
    params.dateBecomeCase = params.dateBecomeCase || new Date();
    params.classification = params.classification || 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_SUSPECT';

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
        return contact.updateAttributes(params, options);
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
          updateRelations.push(relation.updateAttributes({persons: persons}, options));
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
   * @param options
   * @param callback
   */
  Outbreak.prototype.convertCaseToContact = function (caseId, options, callback) {
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
        return caseInstance.updateAttribute('type', 'contact', options);
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
          updateRelations.push(relation.updateAttributes({persons: persons}, options));
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
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreCase = function (caseId, options, callback) {
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
        instance.undoDelete(options, callback);
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
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContactFollowUp = function (contactId, followUpId, options, callback) {
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
        instance.undoDelete(options, callback);
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
   * @param filter Besides the default filter properties this request also accepts 'noDaysNewContacts': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countNewContactsByExposure = function (filter, callback) {
    // initialize noDaysNewContacts filter
    let noDaysNewContacts;
    // check if the noDaysNewContacts filter was sent; accepting it only on the first level
    noDaysNewContacts = _.get(filter, 'where.noDaysNewContacts');
    if (typeof noDaysNewContacts !== "undefined") {
      // noDaysNewContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysNewContacts;
    } else {
      // get the outbreak noDaysNewContacts as the default noDaysNewContacts value
      noDaysNewContacts = this.noDaysNewContacts;
    }

    // get outbreak ID
    let outbreakId = this.id;

    // initialize exposureType map
    let exposureTypeMap = {};

    // get exposureTypes from reference data
    helpers.getSystemAndOwnReferenceData(outbreakId, {
      where: {
        categoryId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE'
      }
    })
      .then(function (exposureTypes) {
        // loop through exposure types and initialize the exposureTypeMap entry
        exposureTypes.forEach(function (exposureType) {
          exposureTypeMap[exposureType.value] = {
            id: exposureType.value,
            count: 0,
            contactIDs: []
          };
        });

        // get now date
        let now = new Date();

        // get the new contacts in the outbreak
        return app.models.contact.find({
          include: ['relationships'],
          where: {
            outbreakId: outbreakId,
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
            // Note: The result counters total will not equal number of contacts as contacts may have multiple relationships
            // counting only if contact wasn't already added for the exposure type
            // also checking if set exposureTypeId is known; if not known, relations is skipped
            if (exposureTypeMap[relationship.exposureTypeId] && exposureTypeMap[relationship.exposureTypeId].contactIDs.indexOf(contact.id) === -1) {
              // increasing counter for exposure type
              exposureTypeMap[relationship.exposureTypeId].count++;
              // kepp contact ID
              exposureTypeMap[relationship.exposureTypeId].contactIDs.push(contact.id);
            }
          });
        });

        // initialize result
        let result = {
          newContactsCount: contacts.length,
          exposureType: Object.values(exposureTypeMap)
        };

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
    const self = this;
    // count transmission chains
    app.models.relationship
      .countTransmissionChains(this.id, this.periodOfFollowup, filter, function (error, noOfChains) {
        if (error) {
          return callback(error);
        }
        // get node IDs
        const nodeIds = Object.keys(noOfChains.nodes);
        // count isolated nodes
        const isolatedNodesNo = Object.keys(noOfChains.isolatedNodes).reduce(function (accumulator, currentValue) {
          if (noOfChains.isolatedNodes[currentValue]) {
            accumulator++;
          }
          return accumulator;
        }, 0);
        // find other isolated nodes (nodes that were never in a relationship)
        app.models.person
          .count({
            outbreakId: self.id,
            or: [
              {
                type: 'case',
                classification: {
                  inq: app.models.case.nonDiscardedCaseClassifications
                }
              },
              {
                type: 'event'
              }
            ],
            id: {
              nin: nodeIds
            }
          })
          .then(function (isolatedNodesCount) {
            // total list of isolated nodes is composed by the nodes that were never in a relationship + the ones that
            // come from relationships that were invalidated as part of the chain
            noOfChains.isolatedNodesCount = isolatedNodesCount + isolatedNodesNo;
            delete noOfChains.isolatedNodes;
            delete noOfChains.nodes;
            callback(null, noOfChains);
          })
          .catch(callback)
      });
  };

  /**
   * Get independent transmission chains
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getIndependentTransmissionChains = function (filter, callback) {
    const self = this;
    // get transmission chains
    app.models.relationship
      .getTransmissionChains(this.id, this.periodOfFollowup, filter, function (error, transmissionChains) {
        if (error) {
          return callback(error);
        }
        // get isolated nodes as well (nodes that were never part of a relationship)
        app.models.person
          .find({
            where: {
              outbreakId: self.id,
              or: [
                {
                  type: 'case',
                  classification: {
                    inq: app.models.case.nonDiscardedCaseClassifications
                  }
                },
                {
                  type: 'event'
                }
              ],
              id: {
                nin: Object.keys(transmissionChains.nodes)
              }
            }
          })
          .then(function (isolatedNodes) {
            // add all the isolated nodes to the complete list of nodes
            isolatedNodes.forEach(function (isolatedNode) {
              transmissionChains.nodes[isolatedNode.id] = isolatedNode;
            });
            callback(null, transmissionChains);
          })
          .catch(callback);
      });
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
    helpers.countContactsByFollowUpFlag({
      outbreakId: this.id,
      followUpFlag: 'performed',
      resultProperty: 'contactsSeen'
    }, filter, callback);
  };

  /**
   * Count the contacts that are lost to follow-up
   * Note: The contacts are counted in total and per team. If a contact is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsLostToFollowup = function (filter, callback) {
    helpers.countContactsByFollowUpFlag({
      outbreakId: this.id,
      followUpFlag: 'lostToFollowUp',
      resultProperty: 'contactsLostToFollowup'
    }, filter, callback);
  };

  /**
   * Count new cases in known transmission chains
   * @param filter Besides the default filter properties this request also accepts 'noDaysDaysInChains': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countNewCasesInKnownTransmissionChains = function (filter, callback) {
    // default number of day used to determine new cases
    let noDaysDaysInChains = this.noDaysDaysInChains;
    // check if a different number was sent in the filter
    if (filter && filter.where && filter.where.noDaysDaysInChains) {
      noDaysDaysInChains = filter.where.noDaysDaysInChains;
      delete filter.where.noDaysDaysInChains;
    }
    // start building a result
    const result = {
      newCases: 0,
      total: 0
    };

    // use a cases index to make sure we don't count a case multiple times
    const casesIndex = {};
    // calculate date used to compare contact date of onset with
    const newCasesFromDate = new Date();
    newCasesFromDate.setDate(newCasesFromDate.getDate() - noDaysDaysInChains);

    // get known transmission chains (case-case relationships)
    app.models.relationship
      .filterKnownTransmissionChains(this.id, filter)
      .then(function (relationships) {
        // go trough all relations
        relationships.forEach(function (relation) {
          // go trough all the people
          if (Array.isArray(relation.people)) {
            relation.people.forEach(function (person) {
              // count each case only once
              if (!casesIndex[person.id]) {
                casesIndex[person.id] = true;
                result.total++;
                // check if the case is new (date of symptoms is later than the threshold date)
                if ((new Date(person.dateOfOnset)) >= newCasesFromDate) {
                  result.newCases++;
                }
              }
            })
          }
        });
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count the cases with less than X contacts
   * Note: Besides the count the response also contains a list with the counted cases IDs
   * @param filter Besides the default filter properties this request also accepts 'noLessContacts': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countCasesWithLessThanXContacts = function (filter, callback) {
    // initialize noLessContacts filter
    let noLessContacts;
    // check if the noLessContacts filter was sent; accepting it only on the first level
    noLessContacts = _.get(filter, 'where.noLessContacts');
    if (typeof noLessContacts !== "undefined") {
      // noLessContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noLessContacts;
    } else {
      // get the outbreak noLessContacts as the default noLessContacts value
      noLessContacts = this.noLessContacts;
    }

    // get outbreakId
    let outbreakId = this.id;

    // get cases with contacts
    app.models.relationship
      .getCasesWithContacts(outbreakId, filter)
      .then(function (casesWithContacts) {
        // initialize result
        let result = {
          cases: Object.values(casesWithContacts.cases)
        };

        // get all the found cases IDs
        let allCasesIDs = Object.keys(casesWithContacts.cases);
        let allCasesInfo = Object.values(casesWithContacts.cases);

        // get the caseIDs with less than noLessContacts contacts
        result.caseIDs = allCasesIDs.filter(caseId => casesWithContacts.cases[caseId].contactsCount < noLessContacts);
        result.cases = allCasesInfo.filter(item => result.caseIDs.indexOf(item.id) !== -1);
        result.casesCount = result.caseIDs.length;

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count the new contacts for each event
   * @param filter Besides the default filter properties this request also accepts 'noDaysNewContacts': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countEventNewContacts = function (filter, callback) {
    // initialize noDaysNewContacts filter
    let noDaysNewContacts;
    // check if the noDaysNewContacts filter was sent; accepting it only on the first level
    noDaysNewContacts = _.get(filter, 'where.noDaysNewContacts');
    if (typeof noDaysNewContacts !== "undefined") {
      // noDaysNewContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysNewContacts;
    } else {
      // get the outbreak noDaysNewContacts as the default noDaysNewContacts value
      noDaysNewContacts = this.noDaysNewContacts;
    }

    // get now date
    let now = new Date();

    // initialize results
    let results = {
      newContactsCount: 0,
      events: {}
    };

    // get outbreakId
    let outbreakId = this.id;

    // get all relationships between events and contacts which were created sooner than 'noDaysNewContacts' ago
    app.models.relationship.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          and: [
            {'persons.type': 'contact'},
            {'persons.type': 'event'}
          ],
          contactDate: {
            gte: now.setDate(now.getDate() - noDaysNewContacts)
          }
        }
      }, filter || {})
    )
      .then(function (relationships) {
        // initialize events map and contacts map
        let eventsMap = {};
        let contactsMap = {};
        // helper property to keep the contacts already counted
        let eventContactsMap = {};

        // loop through the relationships and populate the eventsMap;
        // Note: This loop will only add the events that have relationships. Will need to do another query to get the events without relationships
        relationships.forEach(function (relationship) {
          // get event index from persons
          let eventIndex = relationship.persons.findIndex(elem => elem.type === 'event');
          // get eventId, contactId
          // there are only 2 persons so the indexes are 0 or 1
          let eventId = relationship.persons[eventIndex].id;
          let contactId = relationship.persons[eventIndex ? 0 : 1].id;

          // create entry for the event in the eventsMap if not already created
          if (!eventsMap[eventId]) {
            eventsMap[eventId] = {
              id: eventId,
              newContactsCount: 0,
              contactIDs: []
            };

            // also create entry for the eventContactsMap
            eventContactsMap[eventId] = {};
          }

          // count the contact only if not already counted
          if (!eventContactsMap[eventId][contactId]) {
            // get contactId flag in order to not count it twice for the event
            eventContactsMap[eventId][contactId] = true;
            // increase counter
            eventsMap[eventId].newContactsCount++;
            // add contactId
            eventsMap[eventId].contactIDs.push(contactId);
          }

          if (!contactsMap[contactId]) {
            // get contactId flag in order to not count it twice in total
            contactsMap[contactId] = true;
            // increase total counter
            results.newContactsCount++;
          }
        });

        // update results.events; sending array with events information
        results.events = _.values(eventsMap);

        // get events without relationships
        return app.models.event.find({
          where: {
            outbreakId: outbreakId,
            id: {
              nin: Object.keys(eventContactsMap)
            }
          },
          fields: {
            id: true
          }
        });
      })
      .then(function (events) {
        // parse the events to create entries for the result
        let parsedEvents = events.map(event => {
          return {
            id: event.id,
            newContactsCount: 0,
            contactIDs: []
          }
        });

        // add the parsed events in the result
        results.events = results.events.concat(parsedEvents);

        // send response
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Get a list of relationships that links cases with long periods between the dates of onset
   * @param filter
   * @param callback
   */
  Outbreak.prototype.longPeriodsBetweenDatesOfOnsetInTransmissionChains = function (filter, callback) {
    // get longPeriodsBetweenCaseOnset
    const longPeriodsBetweenCaseOnset = this.longPeriodsBetweenCaseOnset;
    // keep a list of relations that match the criteria
    const relationshipsWithLongPeriodsBetweenDatesOfOnset = [];
    // get known transmission chains
    app.models.relationship
      .filterKnownTransmissionChains(this.id, app.utils.remote
      // were only interested in cases
        .mergeFilters({
          where: {
            'persons.0.type': {
              inq: ['case']
            },
            'persons.1.type': {
              inq: ['case']
            }
          },
          // we're only interested in the cases that have dateOfOnset set
          include: {
            relation: 'people',
            scope: {
              where: {
                dateOfOnset: {
                  neq: null
                }
              },
              filterParent: true
            }
          }
        }, filter || {}))
      .then(function (relationships) {
        // go trough all relations
        relationships.forEach(function (relation) {
          // we're only interested in the cases that have dateOfOnset set (this should be already done by the query, but double-check)
          if (relation.people[0].dateOfOnset && relation.people[1].dateOfOnset) {
            const case1Date = new Date(relation.people[0].dateOfOnset);
            const case2Date = new Date(relation.people[1].dateOfOnset);
            // get time difference in days
            const timeDifferenceInDays = Math.ceil(Math.abs(case1Date.getTime() - case2Date.getTime()) / (1000 * 3600 * 24));
            // if the time difference is bigger then the threshold
            if (timeDifferenceInDays > longPeriodsBetweenCaseOnset) {
              // add time difference information
              relation.differenceBetweenDatesOfOnset = timeDifferenceInDays;
              // and save the relation
              relationshipsWithLongPeriodsBetweenDatesOfOnset.push(relation);
            }
          }
        });
        callback(null, relationshipsWithLongPeriodsBetweenDatesOfOnset);
      })
      .catch(callback);
  };

  /**
   * Build new transmission chains from registered contacts who became cases
   * @param filter
   * @param callback
   */
  Outbreak.prototype.buildNewChainsFromRegisteredContactsWhoBecameCases = function (filter, callback) {
    Outbreak.helpers.buildOrCountNewChainsFromRegisteredContactsWhoBecameCases(this, filter, false, callback);
  };

  /**
   * Count new transmission chains from registered contacts who became cases
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countNewChainsFromRegisteredContactsWhoBecameCases = function (filter, callback) {
    Outbreak.helpers.buildOrCountNewChainsFromRegisteredContactsWhoBecameCases(this, filter, true, function (error, result) {
      if (error) {
        return callback(error);
      }
      // there is no need for the nodes, it's just a count
      delete result.nodes;
      // count isolated nodes
      result.isolatedNodesCount = Object.keys(result.isolatedNodes).reduce(function (accumulator, currentValue) {
        if (result.isolatedNodes[currentValue]) {
          accumulator++;
        }
        return accumulator;
      }, 0);
      delete result.isolatedNodes;
      callback(null, result);
    });
  };


  /**
   * Count the contacts for each case; Also calculate mean/median
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countCasesContacts = function (filter, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // get cases with contacts
    app.models.relationship
      .getCasesWithContacts(outbreakId, filter)
      .then(function (casesWithContacts) {
        // initialize result
        let result = {
          casesCount: casesWithContacts.casesCount,
          contactsCount: casesWithContacts.contactsCount,
          cases: Object.values(casesWithContacts.cases)
        };

        // calculate average/mean/median
        // get an array with sorted contact numbers; sort is needed for median
        let contactCountList = result.cases.map(item => item.contactsCount).sort((a, b) => a - b);
        let contactCountListLength = contactCountList.length;

        // calculate mean number of contacts per case; sum the number of contacts per case and split to number of cases
        // Note: the value is rounded to 1 decimal
        result.meanNoContactsPerCase = parseFloat((contactCountList.reduce((totalNo, noContactsPerCase) => totalNo + noContactsPerCase, 0) / contactCountListLength).toFixed(1));

        // calculate median; it's either the middle element of the array in case the length is uneven or the average of the two middle elements for even length
        result.medianNoContactsPerCase = contactCountListLength % 2 === 0 ?
          (contactCountList[contactCountListLength / 2 - 1] + contactCountList[contactCountListLength / 2]) / 2 :
          contactCountList[Math.floor(contactCountListLength / 2)];

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count the contacts on follow-up list
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countFollowUpContacts = function (filter, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // get follow-ups
    app.models.followUp.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          // get follow-ups that are scheduled later than today 00:00 hours
          date: {
            gte: (new Date()).setHours(0, 0, 0, 0)
          }
        }
      }, filter || {}))
      .then(function (followUps) {
        // initialize contacts map; helper to not count contacts twice
        let contactsMap = {};

        // loop through the followups to get unique contacts
        followUps.forEach(function (followUp) {
          if (!contactsMap[followUp.personId]) {
            contactsMap[followUp.personId] = true;
          }
        });

        // get contacts IDs
        let contactIDs = Object.keys(contactsMap);

        // create result
        let result = {
          contactsCount: contactIDs.length,
          followUpsCount: followUps.length,
          contactIDs: contactIDs
        };

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Get a list of secondary cases that have date of onset before the date of onset of primary cases
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findSecondaryCasesWithDateOfOnsetBeforePrimaryCase = function (filter, callback) {
    const results = [];
    // get known transmission chains
    app.models.relationship
      .filterKnownTransmissionChains(this.id, app.utils.remote
      // were only interested in cases
        .mergeFilters({
          where: {
            'persons.0.type': {
              inq: ['case']
            },
            'persons.1.type': {
              inq: ['case']
            }
          },
          // we're only interested in the cases that have dateOfOnset set
          include: {
            relation: 'people',
            scope: {
              where: {
                dateOfOnset: {
                  neq: null
                }
              },
              filterParent: true
            }
          }
        }, filter || {}))
      .then(function (relationships) {
        // go trough all relations
        relationships.forEach(function (relationship) {
          // we're only interested in the cases that have dateOfOnset set (this should be already done by the query, but double-check)
          if (relationship.people[0].dateOfOnset && relationship.people[1].dateOfOnset) {
            // find source person index (in persons)
            const _sourceIndex = relationship.persons.findIndex(person => person.source);
            // find source person index
            const sourceIndex = relationship.people.findIndex(person => person.id === relationship.persons[_sourceIndex].id);
            // find source person
            const sourcePerson = relationship.people[sourceIndex];
            // get target person (the other person from people list)
            const targetPerson = relationship.people[sourceIndex ? 0 : 1];
            // if target person's date of onset is earlier than the source's person
            if ((new Date(targetPerson.dateOfOnset)) < (new Date(sourcePerson.dateOfOnset))) {
              //store info about both people and their relationship
              const result = {
                primaryCase: sourcePerson,
                secondaryCase: targetPerson,
                relationship: Object.assign({}, relationship)
              };
              // remove extra info
              delete result.relationship.people;
              results.push(result);
            }
          }
        });
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Count the new cases in the previous X days detected among known contacts
   * @param filter Besides the default filter properties this request also accepts 'noDaysAmongContacts': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countNewCasesInThePreviousXDaysDetectedAmongKnownContacts = function (filter, callback) {
    // initialize noDaysAmongContacts filter
    let noDaysAmongContacts;
    // check if the noDaysAmongContacts filter was sent; accepting it only on the first level
    noDaysAmongContacts = _.get(filter, 'where.noDaysAmongContacts');
    if (typeof noDaysAmongContacts !== "undefined") {
      // noDaysAmongContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysAmongContacts;
    } else {
      // get the outbreak noDaysAmongContacts as the default noDaysNewContacts value
      noDaysAmongContacts = this.noDaysAmongContacts;
    }

    // get now date
    let now = new Date();

    // get from noDaysAmongContacts ago
    let xDaysAgo = new Date((new Date()).setHours(0, 0, 0, 0)).setDate(now.getDate() - noDaysAmongContacts);

    // get outbreakId
    let outbreakId = this.id;

    // get all cases that were created sooner or have 'dateBecomeCase' sooner than 'noDaysAmongContacts' ago
    app.models.case.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          or: [{
            createdAt: {
              gte: xDaysAgo
            }
          }, {
            dateBecomeCase: {
              gte: xDaysAgo
            }
          }]
        }
      }, filter || {})
    )
      .then(function (cases) {
        // initialize result
        let result = {
          newCasesCount: cases.length,
          newCasesAmongKnownContactsCount: 0,
          newCasesAmongKnownContactsIDs: []
        };

        // get the newCasesAmongKnownContactsIDs
        result.newCasesAmongKnownContactsIDs = cases.filter(item => new Date(item.dateBecomeCase) >= xDaysAgo).map(item => item.id);
        result.newCasesAmongKnownContactsCount = result.newCasesAmongKnownContactsIDs.length;

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count the contacts not seen in the past X days
   * @param filter Besides the default filter properties this request also accepts 'noDaysNotSeen': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countContactsNotSeenInXDays = function (filter, callback) {
    // initialize noDaysNotSeen filter
    let noDaysNotSeen;
    // check if the noDaysNotSeen filter was sent; accepting it only on the first level
    noDaysNotSeen = _.get(filter, 'where.noDaysNotSeen');
    if (typeof noDaysNotSeen !== "undefined") {
      // noDaysNotSeen was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysNotSeen;
    } else {
      // get the outbreak noDaysNotSeen as the default noDaysNotSeen value
      noDaysNotSeen = this.noDaysNotSeen;
    }

    // get outbreakId
    let outbreakId = this.id;

    // get current date
    let now = new Date();
    // get date from noDaysNotSeen days ago
    let xDaysAgo = new Date((new Date()).setHours(0, 0, 0, 0)).setDate(now.getDate() - noDaysNotSeen);

    // get follow-ups
    app.models.followUp.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          // get follow-ups that were scheduled in the past noDaysNotSeen days
          date: {
            between: [xDaysAgo, now]
          }
        },
        // order by date as we need to check the follow-ups from the oldest to the most new
        order: 'date ASC'
      }, filter || {}))
      .then(function (followUps) {
        // initialize contacts map; helper to not count contacts twice and keep the seen value;
        // once a contact is seen the newer follow-ups for the same contact don't matter
        let contactsMap = {};

        // loop through the followups to get unique contacts
        followUps.forEach(function (followUp) {
          // check if there is an entry for the personId or if it is false; In this case, override with current seen flag
          if (!contactsMap[followUp.personId]) {
            // set value in the contacts map as the performed flag
            contactsMap[followUp.personId] = followUp.performed;
          }
        });

        // get the contacts not seen from the contacts map
        let notSeenContactsIDs = Object.keys(contactsMap).filter(contactId => !contactsMap[contactId]);

        // create result
        let result = {
          contactsCount: notSeenContactsIDs.length,
          contactIDs: notSeenContactsIDs
        };

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Handle visual identifier (uniqueness and generation)
   */
  Outbreak.beforeRemote('prototype.__create__events', function (context, modelInstance, next) {
    // if the visual id was not passed
    if (context.args.data.visualId === undefined) {
      // set it automatically
      Outbreak.helpers.getAvailableVisualId(context.instance, function (error, visualId) {
        context.args.data.visualId = visualId;
        return next(error);
      });
    } else {
      // make sure the visual id is unique in the given outbreak, otherwise stop with error
      Outbreak.helpers
        .validateVisualIdUniqueness(context.instance.id, context.args.data.visualId)
        .then(next)
        .catch(next);
    }
  });

  /**
   * Validate visual identifier (optional)
   */
  Outbreak.beforeRemote('prototype.__updateById__events', function (context, modelInstance, next) {
    // if visual id was sent in request, check for uniqueness
    if (context.args.data.visualId !== undefined) {
      // retrieve the instance that will be updated
      // if visual id's are the same, skip validation
      app.models.event
        .findOne({
          where: {
            id: context.args.fk
          }
        })
        .then((event) => {
          if (event.visualId === context.args.data.visualId) {
            return next();
          }
          // make sure the visual id is unique in the given outbreak, otherwise stop with error
          return Outbreak.helpers
            .validateVisualIdUniqueness(context.instance.id, context.args.data.visualId)
            .then(next);
        })
        .catch(next);
    } else {
      return next();
    }
  });
};
