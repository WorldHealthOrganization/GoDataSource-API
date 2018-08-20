'use strict';

const moment = require('moment');
const app = require('../../server/server');
const _ = require('lodash');
const rr = require('rr');
const templateParser = require('./../../components/templateParser');
const referenceDataParser = require('./../../components/referenceDataParser');
const genericHelpers = require('../../components/helpers');
const async = require('async');

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
    'prototype.__delete__events',
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
    'prototype.__destroyById__followUps',
    'prototype.__create__people',
    'prototype.__delete__people',
    'prototype.__findById__people',
    'prototype.__updateById__people',
    'prototype.__destroyById__people'
  ]);

  // attach search by relation property behavior on get contacts
  app.utils.remote.searchByRelationProperty.attachOnRemotes(Outbreak, [
    'prototype.__get__contacts',
    'prototype.__get__cases',
    'prototype.__get__events',
    'prototype.__get__followUps',
    'prototype.findCaseRelationships',
    'prototype.findContactRelationships',
    'prototype.findEventRelationships'
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
   * Export filtered cases to file
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredCases = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    const _filters = app.utils.remote.mergeFilters({
        where: {
          outbreakId: this.id
        }
      },
      filter || {});
    // get logged in user
    const contextUser = app.utils.remote.getUserFromOptions(options);
    // define header restrictions
    let headerRestrictions;
    // if the user has a list of restricted fields configured
    if (contextUser.settings && Array.isArray(contextUser.settings.caseFields) && contextUser.settings.caseFields.length) {
      // use that list
      headerRestrictions = contextUser.settings.caseFields;
    }

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];

      // file must be either encrypted or anonymized
      if (!encryptPassword) {
        return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
          errorMessages: 'Exported file muse be either encrypted or anonymized. Please either select some fields to be anynomized or provide a password for encryption'
        }));
      }
    }

    app.utils.remote.helpers.exportFilteredModelsList(app, app.models.case, _filters, exportType, 'Case List', encryptPassword, anonymizeFields, options, headerRestrictions, callback);
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
   * @param options
   * @param callback
   */
  Outbreak.prototype.generateFollowups = function (data, options, callback) {
    // sanity checks
    let invalidParams = {};
    if (this.periodOfFollowup <= 0) {
      invalidParams.periodOfFollowup = this.periodOfFollowup;
    }
    if (this.frequencyOfFollowUp <= 0) {
      invalidParams.frequencyOfFollowUp = this.frequencyOfFollowUp;
    }
    if (this.frequencyOfFollowUpPerDay <= 0) {
      invalidParams.frequencyOfFollowUpPerDay = this.frequencyOfFollowUpPerDay;
    }

    // stop follow up generation, if sanity checks failed
    let invalidParamsNames = Object.keys(invalidParams);
    if (invalidParamsNames.length) {
      return callback(
        app.utils.apiError.getError(
          'INVALID_GENERATE_FOLLOWUP_PARAMS',
          {
            details: `Following outbreak params: [${invalidParamsNames.join(',')}] should be greater than 0`
          }
        )
      )
    }

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
                    let eligibleTeams = [];
                    // normalize addresses
                    contact.addresses = contact.addresses || [];

                    // first get the contact's usual place of residence
                    let contactResidence = contact.addresses.find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
                    if (contactResidence) {
                      // try to find index of the address location in teams locations
                      let filteredTeams = teams.filter((team) => team.locations.indexOf(contactResidence.locationId) !== -1);
                      if (filteredTeams.length) {
                        eligibleTeams = filteredTeams.map((team) => team.id);
                      }
                    } else {
                      // check all contact addresses; stop at first address that has a matching team
                      for (let i = 0; i < contact.addresses.length; i++) {
                        // try to find index of the address location in teams locations
                        let filteredTeams = teams.filter((team) => team.locations.indexOf(contact.addresses[i].locationId) !== -1);
                        if (filteredTeams.length) {
                          eligibleTeams = eligibleTeams.concat(filteredTeams.map((team) => team.id));
                          break;
                        }
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
                            }, options)
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
                            }, options)
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
        return app.models.contact.find(app.utils.remote
          .mergeFilters({
            include: ['relationships'],
            where: {
              outbreakId: outbreakId,
              dateOfReporting: {
                gte: now.setDate(now.getDate() - noDaysNewContacts)
              }
            }
          }, filter || {})
        );
      })
      .then(function (contacts) {
        // filter by relation properties
        contacts = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(contacts, filter);
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
          .catch(callback);
      });
  };

  /**
   * Get independent transmission chains
   * @param filter Note: also accepts 'active' boolean on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.getIndependentTransmissionChains = function (filter, callback) {
    // get active filter
    let activeFilter = _.get(filter, 'where.active');
    // if active filter was sent remove it from the filter
    if (typeof activeFilter !== 'undefined') {
      delete filter.where.active;
    }

    const self = this;
    // get transmission chains
    app.models.relationship
      .getTransmissionChains(this.id, this.periodOfFollowup, filter, function (error, transmissionChains) {
        if (error) {
          return callback(error);
        }

        // initialize result
        let result;

        // initialize isolated nodes filter
        let isolatedNodesFilter = {
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
            ]
          }
        };

        // depending on activeFilter we need to filter the transmissionChains
        if (typeof activeFilter !== 'undefined') {
          result = {
            transmissionChains: {
              chains: []
            },
            nodes: {},
            edges: {}
          };

          // initialize helper nodes to select map
          let nodesToSelectMap = {};

          // filter the transmission chains based on the activeFilter
          let chains = _.get(transmissionChains, 'transmissionChains.chains');
          chains.forEach(function (chain) {
            if (chain.active === activeFilter) {
              // add chain in result
              result.transmissionChains.chains.push(chain);

              // get nodes in the chain if not already selected
              chain.chain.forEach(function (edgeComponents) {
                edgeComponents.forEach(function (comp) {
                  if (!nodesToSelectMap[comp]) {
                    nodesToSelectMap[comp] = true;
                  }
                });
              });
            }
          });

          // get chains length
          result.transmissionChains.length = result.transmissionChains.chains.length;

          // select edges/nodes for the required nodes
          let nodesToSelect = Object.keys(nodesToSelectMap);
          if (nodesToSelect.length) {
            // get edges
            let edges = _.get(transmissionChains, 'edges', {});
            Object.keys(edges).forEach(function (edgeId) {
              let edge = edges[edgeId];
              // add edge in result if needed
              if (nodesToSelectMap[edge.persons[0].id] || nodesToSelectMap[edge.persons[1].id]) {
                result.edges[edgeId] = edge
              }
            });

            // get nodes
            let nodes = _.get(transmissionChains, 'nodes', {});
            nodesToSelect.forEach(nodeId => result.nodes[nodeId] = nodes[nodeId]);
          }

          // update isolated nodes filter depending on active filter value
          let followUpPeriod = self.periodOfFollowup;
          // get day of the start of the follow-up period starting from today
          let followUpStartDate = genericHelpers.getUTCDate().subtract(followUpPeriod, 'days');

          if (activeFilter) {
            // get cases/events reported in the last followUpPeriod days
            isolatedNodesFilter = app.utils.remote
              .mergeFilters({
                where: {
                  dateOfReporting: {
                    gte: new Date(followUpStartDate)
                  }
                }
              }, isolatedNodesFilter);
          } else {
            // get cases/events reported earlier than in the last followUpPeriod days
            isolatedNodesFilter = app.utils.remote
              .mergeFilters({
                where: {
                  dateOfReporting: {
                    lt: new Date(followUpStartDate)
                  }
                }
              }, isolatedNodesFilter);
          }
        } else {
          result = transmissionChains;
        }

        // update isolated nodes filter
        isolatedNodesFilter = app.utils.remote
          .mergeFilters({
            where: {
              id: {
                nin: Object.keys(result.nodes)
              }
            }
          }, isolatedNodesFilter);

        // get isolated nodes as well (nodes that were never part of a relationship)
        app.models.person
          .find(isolatedNodesFilter)
          .then(function (isolatedNodes) {
            // add all the isolated nodes to the complete list of nodes
            isolatedNodes.forEach(function (isolatedNode) {
              result.nodes[isolatedNode.id] = isolatedNode;
            });
            callback(null, result);
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
      resultProperty: 'contactsSeenCount'
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
      resultProperty: 'contactsLostToFollowupCount'
    }, filter, callback);
  };

  /**
   * Count new cases in known transmission chains
   * @param filter Besides the default filter properties this request also accepts 'noDaysInChains': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countNewCasesInKnownTransmissionChains = function (filter, callback) {
    // default number of day used to determine new cases
    let noDaysInChains = this.noDaysInChains;
    // check if a different number was sent in the filter
    if (filter && filter.where && filter.where.noDaysInChains) {
      noDaysInChains = filter.where.noDaysInChains;
      delete filter.where.noDaysInChains;
    }
    // start building a result
    const result = {
      newCases: 0,
      total: 0,
      caseIDs: []
    };

    // use a cases index to make sure we don't count a case multiple times
    const casesIndex = {};
    // calculate date used to compare contact date of onset with
    const newCasesFromDate = new Date();
    newCasesFromDate.setDate(newCasesFromDate.getDate() - noDaysInChains);

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
                // check if the case is new (date of reporting is later than the threshold date)
                if ((new Date(person.dateOfReporting)) >= newCasesFromDate) {
                  result.newCases++;
                  result.caseIDs.push(person.id);
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

    // create filter as we need to use it also after the relationships are found
    let _filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          and: [
            {'persons.type': 'contact'},
            {'persons.type': 'event'}
          ]
        },
        include: [{
          relation: 'people',
          scope: {
            where: {
              type: 'contact',
              dateOfReporting: {
                gte: now.setDate(now.getDate() - noDaysNewContacts)
              }
            },
            filterParent: true
          }
        }]
      }, filter || {});

    // get all relationships between events and contacts, where the contacts were created sooner than 'noDaysNewContacts' ago
    app.models.relationship.find(_filter)
      .then(function (relationships) {
        // filter by relation properties
        relationships = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, _filter);
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
        // filter by relation properties
        followUps = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followUps, filter);
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

    // get all cases that were reported sooner or have 'dateBecomeCase' sooner than 'noDaysAmongContacts' ago
    app.models.case.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          or: [{
            dateOfReporting: {
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
        // filter by relation properties
        followUps = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followUps, filter);
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
   * Count the contacts that have followups scheduled and the contacts with successful followups
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsWithSuccessfulFollowups = function (filter, callback) {
    // initialize result
    let result = {
      totalContactsWithFollowupsCount: 0,
      contactsWithSuccessfulFollowupsCount: 0,
      teams: [],
      contacts: []
    };

    // get outbreakId
    let outbreakId = this.id;

    // get all the followups for the filtered period
    app.models.followUp.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId
        }
      }, filter || {}))
      .then(function (followups) {
        // filter by relation properties
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);

        // initialize teams map and contacts map as the request needs to count contacts
        let teamsMap = {};
        let contactsMap = {};
        // initialize helper contacts to team map
        let contactsTeamMap = {};

        followups.forEach(function (followup) {
          // get contactId
          let contactId = followup.personId;
          // get teamId; there might be no team id, set null
          let teamId = followup.teamId || null;

          // check if a followup for the same contact was already parsed
          if (contactsTeamMap[contactId]) {
            // check if there was another followup for the same team
            // if so check for the performed flag;
            // if the previous followup was performed there is no need to update any team contacts counter;
            // total and successful counters were already updated
            if (contactsTeamMap[contactId].teams[teamId]) {
              // new follow-up for the contact from the same team is performed; update flag and increase succcessful counter
              if (!contactsTeamMap[contactId].teams[teamId].performed && followup.performed === true) {
                // update performed flag
                contactsTeamMap[contactId].teams[teamId].performed = true;
                // increase successful counter for team
                teamsMap[teamId].contactsWithSuccessfulFollowupsCount++;
                // update followedUpContactsIDs/missedContactsIDs lists
                teamsMap[teamId].followedUpContactsIDs.push(contactId);
                teamsMap[teamId].missedContactsIDs.splice(teamsMap[teamId].missedContactsIDs.indexOf(contactId), 1);
              }
            } else {
              // new teamId
              // cache followup performed information for contact in team
              contactsTeamMap[contactId].teams[teamId] = {
                performed: followup.performed
              };

              // initialize team entry if doesn't already exist
              if (!teamsMap[teamId]) {
                teamsMap[teamId] = {
                  id: teamId,
                  totalContactsWithFollowupsCount: 0,
                  contactsWithSuccessfulFollowupsCount: 0,
                  followedUpContactsIDs: [],
                  missedContactsIDs: []
                };
              }

              // increase team counters
              teamsMap[teamId].totalContactsWithFollowupsCount++;
              if (followup.performed) {
                teamsMap[teamId].contactsWithSuccessfulFollowupsCount++;
                // keep contactId in the followedUpContactsIDs list
                teamsMap[teamId].followedUpContactsIDs.push(contactId);
              } else {
                // keep contactId in the missedContactsIDs list
                teamsMap[teamId].missedContactsIDs.push(contactId);
              }
            }
          } else {
            // first followup for the contact; add it in the contactsMap
            contactsMap[contactId] = {
              id: contactId,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0
            };

            // cache followup performed information for contact in team and overall
            contactsTeamMap[contactId] = {
              teams: {
                [teamId]: {
                  performed: followup.performed
                }
              },
              performed: followup.performed,
            };

            // increase overall counters
            result.totalContactsWithFollowupsCount++;

            // initialize team entry if doesn't already exist
            if (!teamsMap[teamId]) {
              teamsMap[teamId] = {
                id: teamId,
                totalContactsWithFollowupsCount: 0,
                contactsWithSuccessfulFollowupsCount: 0,
                followedUpContactsIDs: [],
                missedContactsIDs: []
              };
            }

            // increase team counters
            teamsMap[teamId].totalContactsWithFollowupsCount++;
            if (followup.performed) {
              teamsMap[teamId].contactsWithSuccessfulFollowupsCount++;
              // keep contactId in the followedUpContactsIDs list
              teamsMap[teamId].followedUpContactsIDs.push(contactId);
              // increase total successful total counter
              result.contactsWithSuccessfulFollowupsCount++;
            } else {
              // keep contactId in the missedContactsIDs list
              teamsMap[teamId].missedContactsIDs.push(contactId);
            }
          }

          // update total follow-ups counter for contact
          contactsMap[contactId].totalFollowupsCount++;
          if (followup.performed) {
            // update counter for contact successful follow-ups
            contactsMap[contactId].successfulFollowupsCount++;

            // check if contact didn't have a succesful followup and the current one was performed
            // as specified above for teams this is the only case where updates are needed
            if (!contactsTeamMap[contactId].performed) {
              // update overall performed flag
              contactsTeamMap[contactId].performed = true;
              // increase total successful total counter
              result.contactsWithSuccessfulFollowupsCount++;
            }
          }
        });

        // update results; sending array with teams and contacts information
        result.teams = Object.values(teamsMap);
        result.contacts = Object.values(contactsMap);

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

  /**
   * Count the followups per team per day
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countFollowUpsPerTeamPerDay = function (filter, callback) {
    // initialize result
    let result = {
      totalFollowupsCount: 0,
      successfulFollowupsCount: 0,
      teams: []
    };

    // get outbreakId
    let outbreakId = this.id;

    // initialize default filter
    let defaultFilter = {
      where: {
        outbreakId: outbreakId
      },
      order: 'date ASC'
    };

    // check if the filter includes date; if not, set the filter to get all the follow-ups from today by default
    if (!filter || !filter.where || JSON.stringify(filter.where).indexOf('date') === -1) {
      // to get the entire day today, filter between today 00:00 and tomorrow 00:00
      let today = genericHelpers.getUTCDate().toString();
      let tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow = genericHelpers.getUTCDate(tomorrow).toString();

      defaultFilter.where.date = {
        between: [today, tomorrow]
      }
    }

    // get all the followups for the filtered period
    app.models.followUp.find(app.utils.remote
      .mergeFilters(defaultFilter, filter || {}))
      .then(function (followups) {
        // filter by relation properties
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);
        // initialize teams map
        let teamsMap = {};
        // initialize helper team to date to contacts map
        let teamDateContactsMap = {};

        followups.forEach(function (followup) {
          // get contactId
          let contactId = followup.personId;
          // get teamId; there might be no team id, set null
          let teamId = followup.teamId || null;
          // get date; format it to UTC 00:00:00
          let date = genericHelpers.getUTCDate(followup.date).toString();

          // initialize team entry if not already initialized
          if (!teamsMap[teamId]) {
            teamsMap[teamId] = {
              id: teamId,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0,
              dates: []
            };

            teamDateContactsMap[teamId] = {};
          }

          // initialize variable that will keep the index of the date entry in the team.dates array
          let dateIndexInTeam;

          // initialize date entry for the team if not already initialized
          if ((dateIndexInTeam = teamsMap[teamId].dates.findIndex(dateEntry => dateEntry.date === date)) === -1) {
            // push the entry in the array and keep the index
            dateIndexInTeam = teamsMap[teamId].dates.push({
              date: date,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0,
              contactIDs: []
            }) - 1;

            teamDateContactsMap[teamId][date] = {};
          }

          // increase counters
          teamsMap[teamId].dates[dateIndexInTeam].totalFollowupsCount++;
          teamsMap[teamId].totalFollowupsCount++;

          if (followup.performed) {
            teamsMap[teamId].dates[dateIndexInTeam].successfulFollowupsCount++;
            teamsMap[teamId].successfulFollowupsCount++;
            result.successfulFollowupsCount++;
          }

          // add contactId to the team/date container if not already added
          if (!teamDateContactsMap[teamId][date][contactId]) {
            // keep flag to not add contact twice for team
            teamDateContactsMap[teamId][date][contactId] = true;
            teamsMap[teamId].dates[dateIndexInTeam].contactIDs.push(contactId);
          }
        });

        // update results; sending array with teams and contacts information
        result.teams = Object.values(teamsMap);
        result.totalFollowupsCount = followups.length;

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count the cases per period per classification
   * @param filter Besides the default filter properties this request also accepts
   * 'periodType': enum [day, week, month],
   * 'periodInterval':['date', 'date'],
   * 'includeTotals': boolean (if false 'total' response properties are not calculated),
   * 'includeDeaths': boolean (if false 'death' response properties are not calculated) on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countCasesPerPeriod = function (filter, callback) {
    // initialize periodType filter; default is day; accepting day/week/month
    let periodType;
    let periodTypes = {
      day: 'day',
      week: 'week',
      month: 'month'
    };

    // check if the periodType filter was sent; accepting it only on the first level
    periodType = _.get(filter, 'where.periodType');
    if (typeof periodType !== "undefined") {
      // periodType was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodType;
    }

    // check if the received periodType is accepted
    if (Object.values(periodTypes).indexOf(periodType) === -1) {
      // set default periodType
      periodType = periodTypes.day;
    }

    // initialize periodInterval; keeping it as moment instances we need to use them further in the code
    let periodInterval;
    // check if the periodInterval filter was sent; accepting it only on the first level
    periodInterval = _.get(filter, 'where.periodInterval');
    if (typeof periodInterval !== "undefined") {
      // periodInterval was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodInterval;
      // normalize periodInterval dates
      periodInterval[0] = genericHelpers.getUTCDate(periodInterval[0]);
      periodInterval[1] = genericHelpers.getUTCDateEndOfDay(periodInterval[1]);
    } else {
      // set default periodInterval depending on periodType
      switch (periodType) {
        case periodTypes.day:
          // get interval for today
          let today = genericHelpers.getUTCDate();
          let todayEndOfDay = genericHelpers.getUTCDateEndOfDay();
          periodInterval = [today, todayEndOfDay];
          break;
        case periodTypes.week:
          // get interval for this week
          let mondayStartOfDay = genericHelpers.getUTCDate(null, 1);
          let sundayEndOfDay = genericHelpers.getUTCDateEndOfDay(null, 7);
          periodInterval = [mondayStartOfDay, sundayEndOfDay];
          break;
        case periodTypes.month:
          // get interval for this month
          let firstDayOfMonth = genericHelpers.getUTCDate().startOf('month');
          let lastDayOfMonth = genericHelpers.getUTCDateEndOfDay().endOf('month');
          periodInterval = [firstDayOfMonth, lastDayOfMonth];
          break;
      }
    }

    // initialize includeTotals and includeDeaths flags; default: false
    let includeTotals, includeDeaths;
    // check if the includeTotals filter was sent; accepting it only on the first level
    includeTotals = _.get(filter, 'where.includeTotals');
    if (typeof includeTotals !== "undefined") {
      // includeTotals was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.includeTotals;
    } else {
      // set default
      includeTotals = false;
    }

    // check if the includeDeaths filter was sent; accepting it only on the first level
    includeDeaths = _.get(filter, 'where.includeDeaths');
    if (typeof includeDeaths !== "undefined") {
      // includeDeaths was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.includeDeaths;
    } else {
      // set default
      includeDeaths = false;
    }

    // get outbreakId
    let outbreakId = this.id;

    // initialize result
    let result = {
      totalCasesForIntervalCount: 0,
      totalCasesClassificationCountersForInterval: {},
      totalCasesCountersForIntervalPerLocation: {
        locations: []
      },
      caseIDsForInterval: [],
      period: []
    };

    // initialize default filter
    // depending on includeTotals/includeDeaths filters we will make different queries
    let defaultFilter = {
      where: {
        outbreakId: outbreakId
      },
      order: 'dateOfReporting ASC'
    };

    if (!includeTotals) {
      // don't include totals; get only the cases reported in the periodInterval
      defaultFilter = app.utils.remote
        .mergeFilters({
          where: {
            or: [{
              and: [{
                dateOfReporting: {
                  // clone the periodInterval as it seems that Loopback changes the values in it when it sends the filter to MongoDB
                  between: periodInterval.slice()
                },
                dateBecomeCase: {
                  eq: null
                }
              }]
            }, {
              dateBecomeCase: {
                // clone the periodInterval as it seems that Loopback changes the values in it when it sends the filter to MongoDB
                between: periodInterval.slice()
              }
            }]
          }
        }, defaultFilter);
    } else {
      // totals are included; initialize additional result properties
      Object.assign(result, {
        totalCasesCount: 0,
        totalCasesClassificationCounters: {},
        totalCasesCountersPerLocation: {
          locations: []
        },
        caseIDs: []
      });
    }

    if (!includeDeaths) {
      // don't include deaths; get only the cases that are not dead
      defaultFilter = app.utils.remote
        .mergeFilters({
          where: {
            deceased: false
          }
        }, defaultFilter);
    } else {
      // deaths are included; initialize additional result properties (deaths for interval)
      Object.assign(result, {
        totalDeadCasesForIntervalCount: 0,
        totalDeadConfirmedCasesForIntervalCount: 0,
        deadCaseIDsForInterval: [],
        deadConfirmedCaseIDsForInterval: []
      });

      // check for includeTotals; we might need to add additional properties in the result
      if (includeTotals) {
        Object.assign(result, {
          totalDeadCasesCount: 0,
          totalDeadConfirmedCasesCount: 0,
          deadCaseIDs: [],
          deadConfirmedCaseIDs: []
        });
      }
    }

    // get all the cases for the filtered period
    app.models.case.find(app.utils.remote
      .mergeFilters(defaultFilter, filter || {}))
      .then(function (cases) {
        // get periodMap for interval
        let periodMap = genericHelpers.getChunksForInterval(periodInterval, periodType);
        // fill additional details for each entry in the periodMap
        Object.keys(periodMap).forEach(function (entry) {
          Object.assign(periodMap[entry], {
            totalCasesCount: 0,
            classificationCounters: {},
            countersPerLocation: {
              locations: []
            },
            caseIDs: []
          });

          // check for deaths flag in order to add additional properties to the result
          if (includeDeaths) {
            Object.assign(periodMap[entry], {
              totalDeadCasesCount: 0,
              totalDeadConfirmedCasesCount: 0,
              deadCaseIDs: [],
              deadConfirmedCaseIDs: []
            });
          }
        });

        cases.forEach(function (item) {
          // get case date; it's either dateBecomeCase or dateOfReporting
          let caseDate = item.dateBecomeCase || item.dateOfReporting;
          // get case location
          // normalize addresses
          item.addresses = item.addresses || [];
          let caseLocation = item.addresses.find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
          // use usual place of residence if found else leave the case unassigned to a location
          let caseLocationId = caseLocation && caseLocation.locationId ? caseLocation.locationId : null;
          // get confirmed flag
          let caseConfirmed = item.classification === 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED';

          // in case includeTotals is true, there might be cases that have the date outside of the periodInterval;
          // these cases are not added in any period entry
          // initialize flag to know if the case needs to be added in a period entry
          let addInPeriod = !includeTotals || (periodInterval[0].isSameOrBefore(caseDate) && periodInterval[1].isSameOrAfter(caseDate));

          if (addInPeriod) {
            // get period in which the case needs to be included
            let casePeriodInterval;
            switch (periodType) {
              case periodTypes.day:
                // get interval for today
                let today = genericHelpers.getUTCDate(caseDate).toString();
                let todayEndOfDay = genericHelpers.getUTCDateEndOfDay(caseDate).toString();
                casePeriodInterval = [today, todayEndOfDay];
                break;
              case periodTypes.week:
                // get interval for this week
                let mondayStartOfDay = genericHelpers.getUTCDate(caseDate, 1);
                let sundayEndOfDay = genericHelpers.getUTCDateEndOfDay(caseDate, 7);

                // we should use monday only if it is later than the first date of the periodInterval; else use the first date of the period interval
                mondayStartOfDay = (mondayStartOfDay.isAfter(periodInterval[0]) ? mondayStartOfDay : periodInterval[0]).toString();

                // we should use sunday only if it is earlier than the last date of the periodInterval; else use the last date of the period interval
                sundayEndOfDay = (sundayEndOfDay.isBefore(periodInterval[1]) ? sundayEndOfDay : periodInterval[1]).toString();

                casePeriodInterval = [mondayStartOfDay, sundayEndOfDay];
                break;
              case periodTypes.month:
                // get interval for this month
                let firstDayOfMonth = genericHelpers.getUTCDate(caseDate).startOf('month');
                let lastDayOfMonth = genericHelpers.getUTCDateEndOfDay(caseDate).endOf('month');

                // we should use first day of month only if it is later than the first date of the periodInterval; else use the first date of the period interval
                firstDayOfMonth = (firstDayOfMonth.isAfter(periodInterval[0]) ? firstDayOfMonth : periodInterval[0]).toString();

                // we should use last day of month only if it is earlier than the last date of the periodInterval; else use the last date of the period interval
                lastDayOfMonth = (lastDayOfMonth.isBefore(periodInterval[1]) ? lastDayOfMonth : periodInterval[1]).toString();

                casePeriodInterval = [firstDayOfMonth, lastDayOfMonth];
                break;
            }

            // create a period identifier
            let casePeriodIdentifier = casePeriodInterval.join(' - ');

            // get index of the case location in the period counters per location array
            let periodLocationIndex = periodMap[casePeriodIdentifier].countersPerLocation.locations.findIndex(location => location.id === caseLocationId);
            // initialize location entry is not already initialized
            if (periodLocationIndex === -1) {
              periodLocationIndex = periodMap[casePeriodIdentifier].countersPerLocation.locations.push(
                Object.assign({
                    id: caseLocationId,
                    totalCasesCount: 0,
                    caseIDs: []
                  },
                  // check for includeDeaths flag to add additional properties
                  includeDeaths ? {
                    totalDeadCasesCount: 0,
                    totalDeadConfirmedCasesCount: 0,
                    deadCaseIDs: [],
                    deadConfirmedCaseIDs: []
                  } : {}
                )
              ) - 1;
            }

            // get index of the case location in the entire interval counters per location array
            let entireIntervalLocationIndex = result.totalCasesCountersForIntervalPerLocation.locations.findIndex(location => location.id === caseLocationId);
            // initialize location entry is not already initialized
            if (entireIntervalLocationIndex === -1) {
              entireIntervalLocationIndex = result.totalCasesCountersForIntervalPerLocation.locations.push(
                Object.assign({
                    id: caseLocationId,
                    totalCasesCount: 0,
                    caseIDs: []
                  },
                  // check for includeDeaths flag to add additional properties
                  includeDeaths ? {
                    totalDeadCasesCount: 0,
                    totalDeadConfirmedCasesCount: 0,
                    deadCaseIDs: [],
                    deadConfirmedCaseIDs: []
                  } : {}
                )
              ) - 1;
            }

            // check if case is dead; will not add it to classificationCounters if so
            if (!item.deceased) {
              // period classification
              // initialize counter for period classification if it's not already initialized
              if (!periodMap[casePeriodIdentifier].classificationCounters[item.classification]) {
                periodMap[casePeriodIdentifier].classificationCounters[item.classification] = {
                  count: 0,
                  caseIDs: [],
                  locations: []
                };
              }
              periodMap[casePeriodIdentifier].classificationCounters[item.classification].count++;
              periodMap[casePeriodIdentifier].classificationCounters[item.classification].caseIDs.push(item.id);

              // get index of the case location in the locations array
              let locationIndex = periodMap[casePeriodIdentifier].classificationCounters[item.classification].locations.findIndex(location => location.id === caseLocationId);
              // initialize location entry is not already initialized
              if (locationIndex === -1) {
                locationIndex = periodMap[casePeriodIdentifier].classificationCounters[item.classification].locations.push({
                  id: caseLocationId,
                  totalCasesCount: 0,
                  caseIDs: []
                }) - 1;
              }

              // increase period classification location counters
              periodMap[casePeriodIdentifier].classificationCounters[item.classification].locations[locationIndex].totalCasesCount++;
              periodMap[casePeriodIdentifier].classificationCounters[item.classification].locations[locationIndex].caseIDs.push(item.id);

              // increase period counters outside of case classification
              periodMap[casePeriodIdentifier].totalCasesCount++;
              periodMap[casePeriodIdentifier].caseIDs.push(item.id);

              // increase period location counters
              periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].totalCasesCount++;
              periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].caseIDs.push(item.id);

              // entire interval classification
              // initialize counter for entire interval classification if it's not already initialized
              if (!result.totalCasesClassificationCountersForInterval[item.classification]) {
                result.totalCasesClassificationCountersForInterval[item.classification] = {
                  count: 0,
                  caseIDs: [],
                  locations: []
                };
              }
              result.totalCasesClassificationCountersForInterval[item.classification].count++;
              result.totalCasesClassificationCountersForInterval[item.classification].caseIDs.push(item.id);

              // get index of the case location in the entire interval classification locations array
              let entireIntervalClassificationLocationIndex = result.totalCasesClassificationCountersForInterval[item.classification].locations.findIndex(location => location.id === caseLocationId);
              // initialize location entry is not already initialized
              if (entireIntervalClassificationLocationIndex === -1) {
                entireIntervalClassificationLocationIndex = result.totalCasesClassificationCountersForInterval[item.classification].locations.push({
                  id: caseLocationId,
                  totalCasesCount: 0,
                  caseIDs: []
                }) - 1;
              }

              // increase entire interval classification classification location counters
              result.totalCasesClassificationCountersForInterval[item.classification].locations[entireIntervalClassificationLocationIndex].totalCasesCount++;
              result.totalCasesClassificationCountersForInterval[item.classification].locations[entireIntervalClassificationLocationIndex].caseIDs.push(item.id);

              // increase entire interval counters outside of case classification
              result.totalCasesForIntervalCount++;
              result.caseIDsForInterval.push(item.id);

              // increase entire interval location counters
              result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].totalCasesCount++;
              result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].caseIDs.push(item.id);
            } else {
              // update period counters
              if (caseConfirmed) {
                // update confirmed dead case counters
                periodMap[casePeriodIdentifier].totalDeadConfirmedCasesCount++;
                periodMap[casePeriodIdentifier].deadConfirmedCaseIDs.push(item.id);
                periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].totalDeadConfirmedCasesCount++;
                periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].deadConfirmedCaseIDs.push(item.id);

                result.totalDeadConfirmedCasesForIntervalCount++;
                result.deadConfirmedCaseIDsForInterval.push(item.id);
                result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].totalDeadConfirmedCasesCount++;
                result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].deadConfirmedCaseIDs.push(item.id);
              }

              // update death counters
              periodMap[casePeriodIdentifier].totalDeadCasesCount++;
              periodMap[casePeriodIdentifier].deadCaseIDs.push(item.id);
              periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].totalDeadCasesCount++;
              periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].deadCaseIDs.push(item.id);

              result.totalDeadCasesForIntervalCount++;
              result.deadCaseIDsForInterval.push(item.id);
              result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].totalDeadCasesCount++;
              result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].deadCaseIDs.push(item.id);
            }
          }

          // check for include totals to increase totals counters
          if (includeTotals) {
            // get index of the case location in the total counters per location array
            let totalLocationIndex = result.totalCasesCountersPerLocation.locations.findIndex(location => location.id === caseLocationId);
            // initialize location entry is not already initialized
            if (totalLocationIndex === -1) {
              totalLocationIndex = result.totalCasesCountersPerLocation.locations.push(
                Object.assign({
                    id: caseLocationId,
                    totalCasesCount: 0,
                    caseIDs: []
                  },
                  // check for includeDeaths flag to add additional properties
                  includeDeaths ? {
                    totalDeadCasesCount: 0,
                    totalDeadConfirmedCasesCount: 0,
                    deadCaseIDs: [],
                    deadConfirmedCaseIDs: []
                  } : {}
                )
              ) - 1;
            }

            // check if case is dead; will not add it to classificationCounters if so
            if (!item.deceased) {
              // initialize counter for total classification if it's not already initialized
              if (!result.totalCasesClassificationCounters[item.classification]) {
                result.totalCasesClassificationCounters[item.classification] = {
                  count: 0,
                  caseIDs: [],
                  locations: []
                };
              }
              result.totalCasesClassificationCounters[item.classification].count++;
              result.totalCasesClassificationCounters[item.classification].caseIDs.push(item.id);

              // get index of the case location in the total classification locations array
              let totalClassificationLocationIndex = result.totalCasesClassificationCounters[item.classification].locations.findIndex(location => location.id === caseLocationId);
              // initialize location entry is not already initialized
              if (totalClassificationLocationIndex === -1) {
                totalClassificationLocationIndex = result.totalCasesClassificationCounters[item.classification].locations.push({
                  id: caseLocationId,
                  totalCasesCount: 0,
                  caseIDs: []
                }) - 1;
              }

              // increase period classification location counters
              result.totalCasesClassificationCounters[item.classification].locations[totalClassificationLocationIndex].totalCasesCount++;
              result.totalCasesClassificationCounters[item.classification].locations[totalClassificationLocationIndex].caseIDs.push(item.id);

              // increase counters outside of case classification
              result.totalCasesCount++;
              result.caseIDs.push(item.id);

              // increase location counters
              result.totalCasesCountersPerLocation.locations[totalLocationIndex].totalCasesCount++;
              result.totalCasesCountersPerLocation.locations[totalLocationIndex].caseIDs.push(item.id);
            } else {
              // update period counters
              if (caseConfirmed) {
                // update confirmed dead case counters
                result.totalDeadConfirmedCasesCount++;
                result.deadConfirmedCaseIDs.push(item.id);
                result.totalCasesCountersPerLocation.locations[totalLocationIndex].totalDeadConfirmedCasesCount++;
                result.totalCasesCountersPerLocation.locations[totalLocationIndex].deadConfirmedCaseIDs.push(item.id);
              }

              // update death counters
              result.totalDeadCasesCount++;
              result.deadCaseIDs.push(item.id);
              result.totalCasesCountersPerLocation.locations[totalLocationIndex].totalDeadCasesCount++;
              result.totalCasesCountersPerLocation.locations[totalLocationIndex].deadCaseIDs.push(item.id);
            }
          }
        });

        // update results; sending array with period entries
        result.period = Object.values(periodMap);

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Merge multiple cases and contacts
   * @param data List of records ids, to be merged
   */
  Outbreak.prototype.mergeCasesAndContacts = function (data) {
    data = data || {};
    data.ids = data.ids || [];

    /**
     * Helper function used to retrieve relations for a given case
     * @param personId
     */
    let _findRelations = function (personId) {
      return app.models.relationship.find({
        where: {
          'persons.id': personId
        }
      });
    };

    // retrieve all the case/contacts that should be merged, ordered by their last update date
    return Promise.all([
      app.models.case
        .find(
          {
            where: {
              id: {
                inq: data.ids
              }
            },
            include: ['labResults'],
            order: 'updatedAt DESC'
          }
        ),
      app.models.contact
        .find(
          {
            where: {
              id: {
                inq: data.ids
              }
            },
            include: ['followUps'],
            order: 'updatedAt DESC'
          }
        )
    ])
    // retrieve all relationships belonging to the case/contacts
      .then((listOfCaseAndContacts) => Promise
        .all(listOfCaseAndContacts.map((item) => Promise
          .all(item.map((model) => _findRelations(model.id)
            .then((relations) => {
              model.relationships = relations;
              return model;
            }))))
        )
      )
      .then((items) => {
        // clone the items original array, needed to filter relation from spliced items as well
        let originalList = [].concat(...items.slice(0));

        // create reference for case/contact lists
        let cases = items[0];
        let contacts = items[1];

        // pick the most updated case and contact
        // those will be the base models used in merging
        let baseCase = cases.splice(0, 1)[0];
        let baseContact = contacts.splice(0, 1)[0];

        // if a case is found, then it will be the resulted model of the merging
        // the contact most updated one is used mainly to merge contact's specific properties
        // that eventually will be merged into case result model
        let isCase = !!baseCase;
        let resultModel = baseCase ? baseCase : baseContact;

        // store reference to the properties that belong to the result model
        let resultModelProps = resultModel.__data;

        // start merging basic properties
        // go levels below to the most last updatedAt one, if any property is missing
        // we start with case because it has priority
        // in case, a base case was not found we consider it being a contact to contact merge
        // hence ignoring case merge feature whatsoever
        if (!isCase) {
          resultModel = helpers.mergePersonModels(baseContact, contacts, 'contact');
        } else {
          resultModel = helpers.mergePersonModels(resultModel, cases, 'case');

          // make sure we're not doing anything related to contact merging, if no contact id was given
          if (baseContact) {
            baseContact = helpers.mergePersonModels(baseContact, contacts, 'contact');

            // store ref to base contact props
            let baseContactProps = baseContact.__data;

            // attach predefined contact props on the case model
            ['riskLevel', 'riskReason'].forEach((prop) => {
              resultModelProps[prop] = baseContactProps[prop];
            });

            // also after simple properties merge is done, addresses/documents of the resulted contact should be merged on the base case
            resultModelProps.addresses = resultModelProps.addresses.concat(baseContactProps.addresses);
            resultModelProps.documents = resultModelProps.documents.concat(
              baseContactProps.documents.filter((doc) => resultModelProps.documents.findIndex((resultItem) => {
                return resultItem.type === doc.type && resultItem.number === doc.number;
              }) === -1)
            );
          }
        }

        // strip model related props from documents/addresses entries
        resultModelProps.addresses = resultModelProps.addresses.map((entry) => entry.__data);
        resultModelProps.documents = resultModelProps.documents.map((entry) => entry.__data);

        // make sure, that if the case is the base model, we're collecting followups/relations from base contact as well
        if (isCase) {
          contacts.push(baseContact);
        }

        // get all the ids for case/contact, needed to verify that there are no relations between 2 cases that should be merged
        // also make a list of ids and based on their type, used when updating database records
        let caseIds = cases.map((item) => item.id);
        let contactIds = contacts.map((item) => item.id);

        // take follow ups from all the contacts and change their contact id to point to result model
        let followUps = [];
        contacts.forEach((contact) => {
          if (contact.followUps().length) {
            contact.followUps().forEach((followUp) => {
              followUps.push({
                id: followUp.id,
                personId: resultModel.id
              });
            });
          }
        });

        // prepare lab results
        let labResults = [];
        cases.forEach((caseItem) => {
          if (caseItem.labResults().length) {
            caseItem.labResults().forEach((labResult) => {
              labResults.push({
                id: labResult.id,
                personId: resultModel.id
              });
            });
          }
        });

        // prepare relations
        let relations = [];

        // build a list of all ids, used to filter any relationship between them
        let ids = originalList.map((item) => item.id);

        // filter relations from case/contacts
        // item points to either case or contact list
        originalList.forEach((entry) => {
          entry.relationships.forEach((relation) => {
            let firstMember = ids.indexOf(relation.persons[0].id);
            let secondMember = ids.indexOf(relation.persons[1].id);

            // if there is a relation between 2 merge candidates skip it
            if (firstMember !== -1 && secondMember !== -1) {
              return;
            }

            // otherwise try check which of the candidates is a from the merging list and replace it with base's id
            firstMember = firstMember === -1 ? relation.persons[0].id : resultModel.id;
            secondMember = secondMember === -1 ? relation.persons[1].id : resultModel.id;

            relations.push({
              id: relation.id,
              persons: [
                {
                  id: firstMember,
                  type: firstMember === resultModel.id ? resultModel.type : relation.persons[0].type
                },
                {
                  id: secondMember,
                  type: firstMember === resultModel.id ? resultModel.type : relation.persons[1].type
                }
              ]
            });
          });
        });

        // type of model that updates the record
        let updateBaseRecord = resultModel.type === 'case' ? app.models.case : app.models.contact;

        // make changes into database
        return Promise
          .all([
            // soft delete merged contacts/cases
            app.models.case.destroyAll({id: {inq: caseIds}}),
            app.models.contact.destroyAll({id: {inq: contactIds}}),
            // update base record
            updateBaseRecord.upsertWithWhere({id: resultModel.id}, resultModelProps),
            // update lab results
            Promise.all(labResults.map((labResult) => app.models.labResult.upsertWithWhere(
              {
                id: labResult.id
              },
              labResult))
            ),
            // update relations
            Promise.all(relations.map((relation) => app.models.relationship.upsertWithWhere(
              {
                id: relation.id
              },
              relation))
            ),
            // update follow ups
            Promise.all(followUps.map((followUp) => app.models.followUp.upsertWithWhere(
              {
                id: followUp.id
              },
              followUp))
            )
          ])
          // return the base model
          .then((result) => result[2]);
      });
  };

  /**
   * List the latest follow-ups for contacts if were not performed
   * The request doesn't return a missed follow-up if there is a new one for the same contact that was performed
   * @param filter
   * @param callback
   */
  Outbreak.prototype.listLatestFollowUpsForContactsIfNotPerformed = function (filter, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // get all the followups for the filtered period
    app.models.followUp.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId
        },
        // order by date as we need to check the follow-ups from the oldest to the most new
        order: 'date ASC'
      }, filter || {}))
      .then(function (followups) {
        // initialize contacts map as the request needs to return the latest follow-up for the contact if not performed
        let contactsMap = {};

        followups.forEach(function (followup) {
          // get contactId
          let contactId = followup.personId;

          // add in the contacts map the entire follow-up if it was not perfomed
          if (!followup.performed) {
            contactsMap[contactId] = followup;
          } else {
            // reset the contactId entry in the map to null if the newer follow-up was performed
            contactsMap[contactId] = null;
          }
        });

        // get the follow-ups from the contact map
        let result = Object.values(contactsMap).filter(followUp => followUp);

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Convert any date attribute that is string to 'Date' instance
   * Needed because mongodb doesn't always filter as expected when date is string
   */
  Outbreak.beforeRemote('**', function (context, modelInstance, next) {
    if (context.args.filter) {
      genericHelpers.convertPropsToDate(context.args.filter);
    }
    return next();
  });

  /**
   * List of contacts/cases where inconsistencies were found between dates.
   * Besides the contact/case properties each entry will also contain an 'inconsistencies' property (array of inconsistencies)
   * @param filter
   * @param callback
   */
  Outbreak.prototype.listInconsistenciesInKeyDates = function (filter, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // get all the followups for the filtered period
    app.models.person.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          // getting only the cases and contacts as there are no inconsistencies to check for events
          or: [{
            // for contacts only get the ones where dateDeceased < date of birth; this check also applies for cases
            $where: 'this.dateDeceased < this.dob',
            type: {
              in: ['contact', 'case']
            }
          }, {
            // for case: compare against dob
            type: 'case',
            // first check for is dob exists to not make the other checks
            dob: {
              neq: null
            },
            or: [{
              // dateOfInfection < date of birth
              $where: 'this.dateOfInfection < this.dob',
            }, {
              // dateOfOnset < date of birth
              $where: 'this.dateOfOnset < this.dob',
            }, {
              // dateBecomeCase < date of birth
              $where: 'this.dateBecomeCase < this.dob',
            }, {
              // dateOfOutcome < date of birth
              $where: 'this.dateOfOutcome < this.dob',
            }]
          }, {
            // for case: compare against dateDeceased
            type: 'case',
            // first check for is dob exists to not make the other checks
            dateDeceased: {
              neq: null
            },
            or: [{
              // dateOfInfection > dateDeceased
              $where: 'this.dateOfInfection > this.dateDeceased',
            }, {
              // dateOfOnset > dateDeceased
              $where: 'this.dateOfOnset > this.dateDeceased',
            }, {
              // dateBecomeCase > dateDeceased
              $where: 'this.dateBecomeCase > this.dateDeceased',
            }, {
              // dateOfOutcome > dateDeceased
              $where: 'this.dateOfOutcome > this.dateDeceased',
            }]
          }, {
            // for case: compare dateOfInfection, dateOfOnset, dateBecomeCase, dateOfOutcome
            type: 'case',
            or: [{
              // dateOfInfection > dateOfOnset
              $where: 'this.dateOfInfection > this.dateOfOnset',
            }, {
              // dateOfInfection > dateBecomeCase
              $where: 'this.dateOfInfection > this.dateBecomeCase',
            }, {
              // dateOfInfection > dateOfOutcome
              $where: 'this.dateOfInfection > this.dateOfOutcome',
            }, {
              // dateOfOnset > dateBecomeCase
              $where: 'this.dateOfOnset > this.dateBecomeCase',
            }, {
              // dateOfOnset > dateOfOutcome
              $where: 'this.dateOfOnset > this.dateOfOutcome',
            }, {
              // dateBecomeCase > dateOfOutcome
              $where: 'this.dateBecomeCase > this.dateOfOutcome',
            }]
          }, {
            // for case: compare isolationDates, hospitalizationDates, incubationDates startDate/endDate for each item in them and against the date of birth and dateDeceased
            type: 'case',
            $where: `function () {
              // initialize check result
              var inconsistencyInKeyDates = false;
              // get date of birth and dateDeceased
              var dob = this.dob;
              var dateDeceased = this.dateDeceased;

              // loop through the isolationDates, hospitalizationDates, incubationDates and make comparisons
              var datesContainers = ['isolationDates', 'hospitalizationDates', 'incubationDates'];
              for (var i = 0; i < datesContainers.length; i++) {
                // check if the datesContainer exists on the model
                var datesContainer = datesContainers[i];
                if (this[datesContainer] && this[datesContainer].length) {
                  // loop through the dates; comparison stops at first successful check
                  for (var j = 0; j < this[datesContainer].length; j++) {
                    var dateEntry = this[datesContainer][j];

                    // compare startDate with endDate
                    inconsistencyInKeyDates = dateEntry.startDate > dateEntry.endDate ? true : false;

                    // check for dob; both startDate and endDate must be after dob
                    if (!inconsistencyInKeyDates && dob) {
                      inconsistencyInKeyDates = dateEntry.startDate < dob ? true : false;
                      inconsistencyInKeyDates = inconsistencyInKeyDates || (dateEntry.endDate < dob ? true : false);
                    }

                    // check for dateDeceased; both startDate and endDate must be before dob
                    if (!inconsistencyInKeyDates && dateDeceased) {
                      inconsistencyInKeyDates = dateEntry.startDate > dateDeceased ? true : false;
                      inconsistencyInKeyDates = inconsistencyInKeyDates || (dateEntry.endDate > dateDeceased ? true : false);
                    }

                    // stop checks if an inconsistency was found
                    if (inconsistencyInKeyDates) {
                      break;
                    }
                  }
                }

                // stop checks if an inconsistency was found
                if (inconsistencyInKeyDates) {
                  break;
                }
              }
              
              return inconsistencyInKeyDates;
            }`
          }]
        }
      }, filter || {}))
      .then(function (people) {
        // loop through the people to add the inconsistencies array
        people.forEach(function (person, index) {
          // initialize inconsistencies
          let inconsistencies = [];

          // get dob and dateDeceased since they are used in the majority of comparisons
          let dob = person.dob ? moment(person.dob) : null;
          let dateDeceased = person.dateDeceased ? moment(person.dateDeceased) : null;
          // also get the other dates
          let dateOfInfection = person.dateOfInfection ? moment(person.dateOfInfection) : null;
          let dateOfOnset = person.dateOfOnset ? moment(person.dateOfOnset) : null;
          let dateBecomeCase = person.dateBecomeCase ? moment(person.dateBecomeCase) : null;
          let dateOfOutcome = person.dateOfOutcome ? moment(person.dateOfOutcome) : null;

          // for contacts only get the ones where dateDeceased < date of birth; this check also applies for cases
          // no need to check for person type as the query was done only for contacts/cases
          if (dob && dateDeceased && dob.isAfter(dateDeceased)) {
            inconsistencies.push(['dob', 'dateDeceased']);
          }

          // for case:
          if (person.type === 'case') {
            // compare against dob
            if (dob) {
              // dateOfInfection < date of birth
              if (dateOfInfection && dob.isAfter(dateOfInfection)) {
                inconsistencies.push(['dob', 'dateOfInfection']);
              }

              // dateOfOnset < date of birth
              if (dateOfOnset && dob.isAfter(dateOfOnset)) {
                inconsistencies.push(['dob', 'dateOfOnset']);
              }

              // dateBecomeCase < date of birth
              if (dateBecomeCase && dob.isAfter(dateBecomeCase)) {
                inconsistencies.push(['dob', 'dateBecomeCase']);
              }

              // dateOfOutcome < date of birth
              if (dateOfOutcome && dob.isAfter(dateOfOutcome)) {
                inconsistencies.push(['dob', 'dateOfOutcome']);
              }
            }

            // compare against dateDeceased
            if (dateDeceased) {
              // dateOfInfection > dateDeceased
              if (dateOfInfection && dateOfInfection.isAfter(dateDeceased)) {
                inconsistencies.push(['dateDeceased', 'dateOfInfection']);
              }

              // dateOfOnset > dateDeceased
              if (dateOfOnset && dateOfOnset.isAfter(dateDeceased)) {
                inconsistencies.push(['dateDeceased', 'dateOfOnset']);
              }

              // dateBecomeCase > dateDeceased
              if (dateBecomeCase && dateBecomeCase.isAfter(dateDeceased)) {
                inconsistencies.push(['dateDeceased', 'dateBecomeCase']);
              }

              // dateOfOutcome > dateDeceased
              if (dateOfOutcome && dateOfOutcome.isAfter(dateDeceased)) {
                inconsistencies.push(['dateDeceased', 'dateOfOutcome']);
              }
            }

            // compare dateOfInfection, dateOfOnset, dateBecomeCase, dateOfOutcome
            // dateOfInfection > dateOfOnset
            if (dateOfInfection && dateOfOnset && dateOfInfection.isAfter(dateOfOnset)) {
              inconsistencies.push(['dateOfInfection', 'dateOfOnset']);
            }

            // dateOfInfection > dateBecomeCase
            if (dateOfInfection && dateBecomeCase && dateOfInfection.isAfter(dateBecomeCase)) {
              inconsistencies.push(['dateOfInfection', 'dateBecomeCase']);
            }

            // dateOfInfection > dateOfOutcome
            if (dateOfInfection && dateOfOutcome && dateOfInfection.isAfter(dateOfOutcome)) {
              inconsistencies.push(['dateOfInfection', 'dateOfOutcome']);
            }

            // dateOfOnset > dateBecomeCase
            if (dateOfOnset && dateBecomeCase && dateOfOnset.isAfter(dateBecomeCase)) {
              inconsistencies.push(['dateOfOnset', 'dateBecomeCase']);
            }

            // dateOfOnset > dateOfOutcome
            if (dateOfOnset && dateOfOutcome && dateOfOnset.isAfter(dateOfOutcome)) {
              inconsistencies.push(['dateOfOnset', 'dateOfOutcome']);
            }

            // dateBecomeCase > dateOfOutcome
            if (dateBecomeCase && dateOfOutcome && dateBecomeCase.isAfter(dateOfOutcome)) {
              inconsistencies.push(['dateBecomeCase', 'dateOfOutcome']);
            }

            // compare isolationDates, hospitalizationDates, incubationDates startDate/endDate for each item in them and against the date of birth and dateDeceased
            // loop through the isolationDates, hospitalizationDates, incubationDates and make comparisons
            var datesContainers = ['isolationDates', 'hospitalizationDates', 'incubationDates'];
            datesContainers.forEach(function (datesContainer) {
              if (person[datesContainer] && person[datesContainer].length) {
                // loop through the datesto find inconsistencies
                person[datesContainer].forEach(function (dateEntry, dateEntryIndex) {
                  // get startDate and endDate
                  let startDate = moment(dateEntry.startDate);
                  let endDate = moment(dateEntry.endDate);

                  // compare startDate with endDate
                  if (startDate.isAfter(endDate)) {
                    inconsistencies.push([`${datesContainer}.${dateEntryIndex}.startDate`, `${datesContainer}.${dateEntryIndex}.endDate`]);
                  }

                  // check for dob; both startDate and endDate must be after dob
                  if (dob) {
                    if (dob.isAfter(startDate)) {
                      inconsistencies.push(['dob', `${datesContainer}.${dateEntryIndex}.startDate`]);
                    }

                    if (dob.isAfter(endDate)) {
                      inconsistencies.push(['dob', `${datesContainer}.${dateEntryIndex}.endDate`]);
                    }
                  }

                  // check for dateDeceased; both startDate and endDate must be before dob
                  if (dateDeceased) {
                    if (startDate.isAfter(dateDeceased)) {
                      inconsistencies.push(['dateDeceased', `${datesContainer}.${dateEntryIndex}.startDate`]);
                    }

                    if (endDate.isAfter(dateDeceased)) {
                      inconsistencies.push(['dateDeceased', `${datesContainer}.${dateEntryIndex}.endDate`]);
                    }
                  }
                });
              }
            });
          }

          // add inconsistencies in the person entry
          people[index].inconsistencies = inconsistencies;
        });

        // send response
        callback(null, people);
      })
      .catch(callback);
  };

  /**
   * Restore a deleted reference data
   * @param caseId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreReferenceData = function (referenceDataId, options, callback) {
    app.models.referenceData
      .findOne({
        deleted: true,
        where: {
          id: referenceDataId,
          outbreakId: this.id,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.referenceData.modelName,
            id: referenceDataId
          });
        }

        // undo reference data delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Upload an importable file
   * @param req
   * @param file
   * @param modelName
   * @param decryptPassword
   * @param options
   * @param callback
   */
  Outbreak.prototype.importableFileUpload = function (req, file, modelName, decryptPassword, options, callback) {
    app.controllers.importableFile.upload(req, file, modelName, decryptPassword, options, this.id, callback);
  };

  /**
   * Get an importable file (contents) using file id
   * @param id
   * @param callback
   */
  Outbreak.prototype.getImportableFileJsonById = function (id, callback) {
    app.controllers.importableFile.getJsonById(id, callback);
  };

  /**
   * Import an importable lab results file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableLabResultsFileUsingMap = function (body, options, callback) {
    const self = this;
    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // get importable file
    app.models.importableFile
      .getTemporaryFileById(body.fileId, function (error, file) {
        // handle errors
        if (error) {
          return callback(error);
        }
        try {
          // parse file content
          const rawlabResultsList = JSON.parse(file);
          // remap properties & values
          const labResultsList = app.utils.helpers.remapProperties(rawlabResultsList, body.map, body.valuesMap);
          // build a list of create lab results operations
          const createLabResults = [];
          // define a container for error results
          const createErrors = [];
          // define a toString function to be used by error handler
          createErrors.toString = function () {
            return JSON.stringify(this);
          };
          // go through all entries
          labResultsList.forEach(function (labResult, index) {
            createLabResults.push(function (callback) {
              // first check if the case id (person id) is valid
              app.models.case
                .findOne({
                  where: {
                    id: labResult.personId,
                    outbreakId: self.id
                  }
                })
                .then(function (caseInstance) {
                  // if the person was not found, don't sync the lab result, stop with error
                  if (!caseInstance) {
                    throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
                      model: app.models.case.modelName,
                      id: labResult.personId
                    });
                  }
                  // sync the record
                  return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.labResult, labResult, options)
                    .then(function (result) {
                      callback(null, result.record);
                    });
                })
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  createErrors.push({
                    message: `Failed to import lab result ${index + 1}`,
                    error: error,
                    recordNo: index + 1
                  });
                  callback(null, null);
                });
            });
          });
          // start importing lab results
          async.parallelLimit(createLabResults, 10, function (error, results) {
            // handle errors (should not be any)
            if (error) {
              return callback(error);
            }
            // if import errors were found
            if (createErrors.length) {
              // remove results that failed to be added
              results = results.filter(result => result !== null);
              // define a toString function to be used by error handler
              results.toString = function () {
                return JSON.stringify(this);
              };
              // return error with partial success
              return callback(app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
                model: app.models.labResult.modelName,
                failed: createErrors,
                success: results
              }));
            }
            // send the result
            callback(null, results);
          });
        } catch (error) {
          // handle parse error
          callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
            contentType: 'JSON',
            details: error.message
          }));
        }
      });
  };

  /**
   * Import an importable cases file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableCasesFileUsingMap = function (body, options, callback) {
    const self = this;
    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // get importable file
    app.models.importableFile
      .getTemporaryFileById(body.fileId, function (error, file) {
        // handle errors
        if (error) {
          return callback(error);
        }
        try {
          // parse file content
          const rawCasesList = JSON.parse(file);
          // remap properties & values
          const casesList = app.utils.helpers.remapProperties(rawCasesList, body.map, body.valuesMap);
          // build a list of create operations
          const createCases = [];
          // define a container for error results
          const createErrors = [];
          // define a toString function to be used by error handler
          createErrors.toString = function () {
            return JSON.stringify(this);
          };
          // go through all entries
          casesList.forEach(function (caseData, index) {
            createCases.push(function (callback) {
              // set outbreak id
              caseData.outbreakId = self.id;
              // sync the case
              return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.case, caseData, options)
                .then(function (result) {
                  callback(null, result.record);
                })
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  createErrors.push({
                    message: `Failed to import case ${index + 1}`,
                    error: error,
                    recordNo: index + 1
                  });
                  callback(null, null);
                });
            });
          });
          // start importing cases
          async.parallelLimit(createCases, 10, function (error, results) {
            // handle errors (should not be any)
            if (error) {
              return callback(error);
            }
            // if import errors were found
            if (createErrors.length) {
              // remove results that failed to be added
              results = results.filter(result => result !== null);
              // define a toString function to be used by error handler
              results.toString = function () {
                return JSON.stringify(this);
              };
              // return error with partial success
              return callback(app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
                model: app.models.case.modelName,
                failed: createErrors,
                success: results
              }));
            }
            // send the result
            callback(null, results);
          });
        } catch (error) {
          // handle parse error
          callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
            contentType: 'JSON',
            details: error.message
          }));
        }
      });
  };

  /**
   * Import an importable contacts file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableContactsFileUsingMap = function (body, options, callback) {
    const self = this;
    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // get importable file
    app.models.importableFile
      .getTemporaryFileById(body.fileId, function (error, file) {
        // handle errors
        if (error) {
          return callback(error);
        }
        try {
          // parse file content
          const rawContactList = JSON.parse(file);
          // remap properties & values
          const contactsList = app.utils.helpers.remapProperties(rawContactList, body.map, body.valuesMap);
          // build a list of create operations
          const createContacts = [];
          // define a container for error results
          const createErrors = [];
          // define a toString function to be used by error handler
          createErrors.toString = function () {
            return JSON.stringify(this);
          };
          // go through all entries
          contactsList.forEach(function (recordData, index) {
            createContacts.push(function (callback) {
              // extract relationship data
              const relationshipData = app.utils.helpers.extractImportableFields(app.models.relationship, recordData.relationship);
              // extract contact data
              const contactData = app.utils.helpers.extractImportableFields(app.models.contact, recordData);
              // set outbreak ids
              contactData.outbreakId = self.id;
              relationshipData.outbreakId = self.id;
              // sync the contact
              return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.contact, contactData, options)
                .then(function (syncResult) {
                  const contactRecord = syncResult.record;
                  // promisify next step
                  return new Promise(function (resolve, reject) {
                    // normalize people
                    Outbreak.helpers.validateAndNormalizePeople(contactRecord.id, 'contact', relationshipData, false, function (error, persons) {
                      if (error) {
                        return reject(error);
                      }
                      // update persons with normalized persons
                      relationshipData.person = persons;
                      // sync relationship
                      return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.relationship, relationshipData, options)
                        .then(function (syncedRelationship) {
                          // relationship successfully created, move to tne next one
                          callback(null, Object.assign({}, contactRecord.toJSON(), {relationships: [syncedRelationship.record.toJSON()]}));
                        })
                        .catch(function (error) {
                          // failed to create relationship, remove the contact if it was created during sync
                          if (syncResult.flag === app.utils.dbSync.syncRecordFlags.CREATED) {
                            contactRecord.destroy();
                          }
                          reject(error);
                        });
                    });
                  });
                })
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  createErrors.push({
                    message: `Failed to import contact ${index + 1}`,
                    error: error,
                    recordNo: index + 1
                  });
                  callback(null, null);
                });
            });
          });
          // start importing contacts
          async.parallelLimit(createContacts, 10, function (error, results) {
            // handle errors (should not be any)
            if (error) {
              return callback(error);
            }
            // if import errors were found
            if (createErrors.length) {
              // remove results that failed to be added
              results = results.filter(result => result !== null);
              // define a toString function to be used by error handler
              results.toString = function () {
                return JSON.stringify(this);
              };
              // return error with partial success
              return callback(app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
                model: app.models.contact.modelName,
                failed: createErrors,
                success: results
              }));
            }
            // send the result
            callback(null, results);
          });
        } catch (error) {
          // handle parse error
          callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
            contentType: 'JSON',
            details: error.message
          }));
        }
      });
  };


  /**
   * Import an importable outbreaks file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.importImportableOutbreaksFileUsingMap = function (body, options, callback) {
    const self = this;
    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // get importable file
    app.models.importableFile
      .getTemporaryFileById(body.fileId, function (error, file) {
        // handle errors
        if (error) {
          return callback(error);
        }
        try {
          // parse file content
          const rawOutbreakList = JSON.parse(file);
          // remap properties & values
          const outbreaksList = app.utils.helpers.remapProperties(rawOutbreakList, body.map, body.valuesMap);
          // build a list of create operations
          const createOutbreaks = [];
          // define a container for error results
          const createErrors = [];
          // define a toString function to be used by error handler
          createErrors.toString = function () {
            return JSON.stringify(this);
          };
          // go through all entries
          outbreaksList.forEach(function (outbreakData, index) {
            createOutbreaks.push(function (callback) {
              // sync the outbreak
              return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.outbreak, outbreakData, options)
                .then(function (syncResult) {
                  callback(null, syncResult.record);
                })
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  createErrors.push({
                    message: `Failed to import outbreak ${index + 1}`,
                    error: error,
                    recordNo: index + 1
                  });
                  callback(null, null);
                });
            });
          });
          // start importing outbreaks
          async.parallelLimit(createOutbreaks, 10, function (error, results) {
            // handle errors (should not be any)
            if (error) {
              return callback(error);
            }
            // if import errors were found
            if (createErrors.length) {
              // remove results that failed to be added
              results = results.filter(result => result !== null);
              // define a toString function to be used by error handler
              results.toString = function () {
                return JSON.stringify(this);
              };
              // return error with partial success
              return callback(app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
                model: app.models.outbreak.modelName,
                failed: createErrors,
                success: results
              }));
            }
            // send the result
            callback(null, results);
          });
        } catch (error) {
          // handle parse error
          callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
            contentType: 'JSON',
            details: error.message
          }));
        }
      });
  };

  /**
   * Build and return a pdf containing case investigation template
   * @param request
   * @param callback
   */
  Outbreak.prototype.exportCaseInvestigationTemplate = function (request, callback) {
    const models = app.models;
    const pdfUtils = app.utils.pdfDoc;
    let template = this.caseInvestigationTemplate;

    // authenticated user's language, used to know in which language to translate
    let languageId = request.remotingContext.req.authData.userInstance.languageId;

    // load user language dictionary
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      // handle errors
      if (error) {
        return callback(error);
      }

      // translate case, lab results, contact fields
      let caseModel = Object.assign({}, models.case.fieldLabelsMap);

      // remove array properties from model definition (they are handled separately)
      Object.keys(caseModel).forEach(function (property) {
        if (property.indexOf('[]') !== -1) {
          delete caseModel[property];
        }
      });

      caseModel.addresses = [models.address.fieldLabelsMap];
      caseModel.documents = [models.document.fieldLabelsMap];

      let caseFields = helpers.translateFieldLabels(caseModel, 'case', languageId, dictionary);
      let contactFields = helpers.translateFieldLabels(models.contact.fieldLabelsMap, 'contact', languageId, dictionary);

      // remove not needed properties from lab result/relationship field maps
      let relationFieldsMap = Object.assign({}, models.relationship.fieldLabelsMap);
      let labResultFieldsMap = Object.assign({}, models.labResult.fieldLabelsMap);
      delete labResultFieldsMap.personId;
      delete relationFieldsMap.persons;

      let labResultsFields = helpers.translateFieldLabels(labResultFieldsMap, 'labResult', languageId, dictionary);
      let relationFields = helpers.translateFieldLabels(relationFieldsMap, 'relationship', languageId, dictionary);

      // translate template questions
      let questions = Outbreak.helpers.parseTemplateQuestions(template, languageId, dictionary);

      // generate pdf document
      let doc = pdfUtils.createPdfDoc({
        fontSize: 11,
        layout: 'portrait'
      });

      // add a top margin of 2 lines for each page
      doc.on('pageAdded', () => {
        doc.moveDown(2);
      });

      // set margin top for first page here, to not change the entire createPdfDoc functionality
      doc.moveDown(2);

      // add case profile fields (empty)
      pdfUtils.createPersonProfile(doc, caseFields, false, dictionary.getTranslation('LNG_PAGE_TITLE_CASE_DETAILS'));

      // add case investigation questionnaire into the pdf in a separate page
      doc.addPage();
      pdfUtils.createQuestionnaire(doc, questions, dictionary.getTranslation('LNG_PAGE_TITLE_CASE_QUESTIONNAIRE'));

      // add lab results information into a separate page
      doc.addPage();
      pdfUtils.createPersonProfile(doc, labResultsFields, false, dictionary.getTranslation('LNG_PAGE_TITLE_LAB_RESULTS_DETAILS'));
      doc.addPage();
      pdfUtils.createQuestionnaire(doc, questions, dictionary.getTranslation('LNG_PAGE_TITLE_LAB_RESULTS_QUESTIONNAIRE'));

      // add contact relation template
      doc.addPage();
      pdfUtils.createPersonProfile(doc, contactFields, false, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_DETAILS'));
      pdfUtils.createPersonProfile(doc, relationFields, false, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_RELATIONSHIP'));

      // end the document stream
      // to convert it into a buffer
      doc.end();

      // convert pdf stream to buffer and send it as response
      genericHelpers.streamToBuffer(doc, (err, buffer) => {
        if (err) {
          callback(err);
        } else {
          app.utils.remote.helpers.offerFileToDownload(buffer, 'application/pdf', `case_investigation.pdf`, callback);
        }
      });
    });
  };

  /**
   * Count the total number of contacts per location; Include counters for contacts under follow-up, contacts seen on date, contacts released as well as date for expected release of last contact
   * @param filter This request also accepts 'date': 'date', 'locationId': 'locationId' on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countContactsPerLocation = function (filter, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // initialize filter to be sent to mongo
    let _filter = {
      where: {
        outbreakId: outbreakId
      }
    };

    // initialize dateToFilter and locationToFilter filters
    let dateToFilter, locationToFilter;
    // check if the dateToFilter filter was sent; accepting it only on the first level
    dateToFilter = _.get(filter, 'where.date', null);
    if (dateToFilter !== null) {
      // add date to filter if it is valid; else use today
      dateToFilter = moment(dateToFilter).isValid() ? genericHelpers.getUTCDateEndOfDay(dateToFilter) : genericHelpers.getUTCDateEndOfDay();

      // date was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.date;
    } else {
      // use today as default filter
      dateToFilter = genericHelpers.getUTCDateEndOfDay();
    }

    // add date to filter
    // also in order to see if a contact was seen on the day get the latest follow-up that should have occurred
    _filter = app.utils.remote
      .mergeFilters({
        where: {
          dateOfReporting: {
            lte: new Date(dateToFilter)
          }
        },
        include: {
          relation: 'followUps',
          scope: {
            where: {
              date: {
                // filter until date as follow-ups can be scheduled in the future
                lte: new Date(dateToFilter)
              }
            },
            order: 'date DESC',
            limit: 1
          }
        }
      }, _filter);

    // check if the locationToFilter filter was sent; accepting it only on the first level
    locationToFilter = _.get(filter, 'where.locationId', null);
    if (locationToFilter !== null) {
      // add location to filter
      _filter = app.utils.remote
        .mergeFilters({
          where: {
            'addresses': {
              'elemMatch': {
                typeId: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
                locationId: locationToFilter
              }
            }
          }
        }, _filter);

      // locationId was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.locationId;
    }

    // initialize result
    let result = {
      totalRegisteredContactsCount: 0,
      releasedContactsCount: 0,
      contactsUnderFollowUpCount: 0,
      contactsSeenOnDateCount: 0,
      lastContactDateOfRelease: null
    };

    // get all the contacts using sent and created filters
    app.models.contact.find(app.utils.remote
      .mergeFilters(_filter, filter || {}))
      .then(function (contacts) {
        // initialize locations map
        let locationMap = {};

        // loop through all contacts and update counters
        contacts.forEach(function (contact) {
          // get contactId
          let contactId = contact.id;

          // get location
          let contactLocationId;
          if (locationToFilter) {
            // a filter for location was sent and the contact was found means that the contact location is the filtered location
            contactLocationId = locationToFilter;
          } else {
            // get the contact's usual place of residence
            // normalize addresses
            contact.addresses = contact.addresses || [];
            let contactResidence = contact.addresses.find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
            // use usual place of residence if found else leave the contact unassigned to a location
            contactLocationId = contactResidence && contactResidence.locationId ? contactResidence.locationId : null;
          }

          // initialize location entry if not already initialized
          if (!locationMap[contactLocationId]) {
            locationMap[contactLocationId] = {
              id: contactLocationId,
              totalRegisteredContactsCount: 0,
              releasedContactsCount: 0,
              contactsUnderFollowUpCount: 0,
              contactsSeenOnDateCount: 0,
              lastContactDateOfRelease: null,
              contactIDs: []
            };
          }

          // increase counters
          locationMap[contactLocationId].totalRegisteredContactsCount++;

          // check if the contact is still under follow-up
          // get end date of contact follow-ups
          // not having an end date should not be encountered; considering this case as still under follow-up
          let followUpEndDate = moment(_.get(contact, 'followUp.endDate', null));
          followUpEndDate = genericHelpers.getUTCDateEndOfDay(followUpEndDate);
          if (!followUpEndDate.isValid() || followUpEndDate.isSameOrAfter(dateToFilter)) {
            // update contactsUnderFollowUpCount
            locationMap[contactLocationId].contactsUnderFollowUpCount++;
            result.contactsUnderFollowUpCount++;

            // get retrieved follow-up; is the latest that should have been performed
            let followUp = contact.toJSON().followUps[0];
            // check if the follow-up was performed
            if (followUp && followUp.performed) {
              // update contactsSeenOnDateCount
              locationMap[contactLocationId].contactsSeenOnDateCount++;
              result.contactsSeenOnDateCount++;
            }
          } else {
            // update releasedContactsCount
            locationMap[contactLocationId].releasedContactsCount++;
            result.releasedContactsCount++;
          }

          // add the contact ID in the array
          locationMap[contactLocationId].contactIDs.push(contactId);

          // update lastContactDateOfRelease if not set or contact follow-up end date is after
          if (!locationMap[contactLocationId].lastContactDateOfRelease || followUpEndDate.isAfter(locationMap[contactLocationId].lastContactDateOfRelease)) {
            locationMap[contactLocationId].lastContactDateOfRelease = followUpEndDate;
          }
          // same for general result
          if (!result.lastContactDateOfRelease || followUpEndDate.isAfter(result.lastContactDateOfRelease)) {
            result.lastContactDateOfRelease = followUpEndDate;
          }
        });

        // add totalRegisteredContactsCount
        result.totalRegisteredContactsCount = contacts.length;

        // get the locations
        result.locations = Object.values(locationMap);

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Export filtered contacts to file
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredContacts = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    const _filters = app.utils.remote.mergeFilters({
        where: {
          outbreakId: this.id
        }
      },
      filter || {});

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];

      // file must be either encrypted or anonymized
      if (!encryptPassword) {
        return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
          errorMessages: 'Exported file muse be either encrypted or anonymized. Please either select some fields to be anynomized or provide a password for encryption'
        }));
      }
    }

    app.utils.remote.helpers.exportFilteredModelsList(app, app.models.contact, _filters, exportType, 'Contacts List', encryptPassword, anonymizeFields, options, null, callback);
  };

  /**
   * Export filtered outbreaks to file
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.exportFilteredOutbreaks = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {

    /**
     * Translate the template
     * @param template
     * @param dictionary
     */
    function translateTemplate(template, dictionary) {
      // go trough all questions
      template.forEach(function (question) {
        // translate text and answer type
        ['text', 'answerType'].forEach(function (itemToTranslate) {
          if (question[itemToTranslate]) {
            question[itemToTranslate] = dictionary.getTranslation(question[itemToTranslate]);
          }
        });
        // translate answers (if present)
        if (question.answers) {
          question.answers.forEach(function (answer) {
            if (answer.label) {
              answer.label = dictionary.getTranslation(answer.label);
            }
            // translate additional questions (if present)
            if (answer.additionalQuestions) {
              translateTemplate(answer.additionalQuestions, dictionary);
            }
          });
        }
      });
    }

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];

      // file must be either encrypted or anonymized
      if (!encryptPassword) {
        return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
          errorMessages: 'Exported file muse be either encrypted or anonymized. Please either select some fields to be anynomized or provide a password for encryption'
        }));
      }
    }

    // export outbreaks list
    app.utils.remote.helpers.exportFilteredModelsList(app, Outbreak, filter, exportType, 'Outbreak List', encryptPassword, anonymizeFields, options, null, function (results, languageDictionary) {
      results.forEach(function (result) {
        // translate templates
        ['caseInvestigationTemplate', 'labResultsTemplate', 'contactFollowUpTemplate'].forEach(function (template) {
          if (result[template]) {
            translateTemplate(result[template], languageDictionary);
          }
        });
      });
      return Promise.resolve(results)
    }, callback);
  };
};
