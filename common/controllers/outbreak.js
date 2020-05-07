'use strict';

const moment = require('moment');
const app = require('../../server/server');
const _ = require('lodash');
const genericHelpers = require('../../components/helpers');
const async = require('async');
const pdfUtils = app.utils.pdfDoc;
const searchByRelationProperty = require('../../components/searchByRelationProperty');
const FollowupGeneration = require('../../components/followupGeneration');
const fs = require('fs');
const AdmZip = require('adm-zip');
const tmp = require('tmp');
const Uuid = require('uuid');
const templateParser = require('./../../components/templateParser');
const PromisePool = require('es6-promise-pool');
const fork = require('child_process').fork;
const WorkerRunner = require('./../../components/workerRunner');
const Platform = require('../../components/platform');

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
    'prototype.__delete__contacts__labResults',
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
    'prototype.__create__referenceData',
    'prototype.__findById__referenceData',
    'prototype.__updateById__referenceData',
    'prototype.__destroyById__referenceData',
    'prototype.__create__followUps',
    'prototype.__delete__followUps',
    'prototype.__updateById__followUps',
    'prototype.__destroyById__followUps',
    'prototype.__create__people',
    'prototype.__delete__people',
    'prototype.__findById__people',
    'prototype.__updateById__people',
    'prototype.__destroyById__people',
    'prototype.__create__labResults',
    'prototype.__delete__labResults',
    'prototype.__create__attachments',
    'prototype.__get__attachments',
    'prototype.__delete__attachments',
    'prototype.__updateById__attachments',
    'prototype.__count__attachments',
    'prototype.__get__followUps',
    'prototype.__get__labResults',
    'prototype.__get__cases',
    'prototype.__get__contacts',
    'prototype.__get__events',
    'prototype.__count__contacts',
    'prototype.__get__contactsOfContacts',
  ]);

  // attach search by relation property behavior on get contacts
  app.utils.remote.searchByRelationProperty.attachOnRemotes(Outbreak, [
    'prototype.findCaseRelationships',
    'prototype.findContactRelationships',
    'prototype.findEventRelationships'
  ]);

  // load controller extensions (other files that contain outbreak related actions)
  require('./outbreakRelationship')(Outbreak);

  /**
   * Allow changing follow-up status (only status property)
   */
  Outbreak.beforeRemote('prototype.__updateById__contacts', function (context, modelInstance, next) {
    // get follow-up status property
    const followUpStatus = _.get(context, 'args.data.followUp.status');
    // if status was provided
    if (followUpStatus) {
      // load contact instance
      app.models.contact
        .findById(context.args.fk)
        .then(function (contact) {
          // get instance data
          const instance = contact.toJSON();
          // update follow-up status
          Object.assign(context.args.data.followUp, instance.followUp, {status: followUpStatus});
          // move along
          next();
        });
    } else {
      next();
    }
  });

  /**
   * Allows count requests with advanced filters (like the ones we can use on GET requests)
   * to be mode on outbreak/{id}/events.
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountEvents = function (filter, callback) {
    // set default filter value
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // check if deep count should be used (this is expensive, should be avoided if possible)
    if (app.utils.remote.searchByRelationProperty.shouldUseDeepCount(filter)) {
      this.findEvents(filter, function (err, res) {
        if (err) {
          return callback(err);
        }
        callback(null, app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(res, filter).length);
      });
    } else {
      return app.models.event.count(filter.where);
    }
  };

  /**
   * Attach before remote (GET outbreaks/{id}/cases) hooks
   */
  Outbreak.beforeRemote('prototype.findCases', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', context);
    // enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation(
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
      context,
      modelInstance,
      next
    );
  });
  Outbreak.beforeRemote('prototype.findCases', (context, modelInstance, next) => {
    findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/events) hooks
   */
  Outbreak.beforeRemote('prototype.findEvents', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', context);
    // Enhance events list request to support optional filtering of events that don't have any relations
    Outbreak.helpers.attachFilterPeopleWithoutRelation('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', context, modelInstance, next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/contacts) hooks
   */
  Outbreak.beforeRemote('prototype.findContacts', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', context);
    next();
  });

  /**
   * Attach before remote (GET outbreaks/{id}/contacts-of-contacts) hooks
   */
  Outbreak.beforeRemote('prototype.findContactsOfContacts', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT', context);
    next();
  });

  /**
   * Attach before remote (GET outbreaks/{id}/cases/filtered-count) hooks
   */
  Outbreak.beforeRemote('prototype.filteredCountCases', function (context, modelInstance, next) {
    Outbreak.helpers.attachFilterPeopleWithoutRelation('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.filteredCountCases', (context, modelInstance, next) => {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = genericHelpers.removeFilterOptions(context.args.filter, ['countRelations']);

    findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/cases/per-classification/count) hooks
   */
  Outbreak.beforeRemote('prototype.countCasesPerClassification', function (context, modelInstance, next) {
    Outbreak.helpers.attachFilterPeopleWithoutRelation('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', context, modelInstance, next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/cases/export) hooks
   */
  Outbreak.beforeRemote('prototype.exportFilteredCases', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = genericHelpers.removeFilterOptions(context.args.filter, ['countRelations']);

    Outbreak.helpers.attachFilterPeopleWithoutRelation('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', context, modelInstance, next);
  });

  /**
   * Attach before remote (GET outbreaks/{id}/events/filtered-count) hooks
   */
  Outbreak.beforeRemote('prototype.filteredCountEvents', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = genericHelpers.removeFilterOptions(context.args.filter, ['countRelations']);
    // handle custom filter options
    context.args.filter = genericHelpers.attachCustomDeleteFilterOption(context.args.filter);

    Outbreak.helpers.attachFilterPeopleWithoutRelation('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', context, modelInstance, next);
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

  Outbreak.beforeRemote('count', function (context, modelInstance, next) {
    const restrictedOutbreakIds = _.get(context, 'req.authData.user.outbreakIds', []);
    if (restrictedOutbreakIds.length) {
      let filter = {where: _.get(context, 'args.where', {})};
      filter = app.utils.remote
        .mergeFilters({
          where: {
            id: {
              in: restrictedOutbreakIds
            }
          }
        }, filter || {});
      context.args.where = filter.where;
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
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          });
        }
        if (app.models.case.discardedCaseClassifications.includes(caseModel.classification)) {
          throw app.utils.apiError.getError('INVALID_RELATIONSHIP_WITH_DISCARDED_CASE', {
            id: caseId
          });
        }
        helpers.createPersonRelationship(this.id, caseId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', data, options, callback);
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
        helpers.createPersonRelationship(this.id, contactId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', data, options, callback);
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
        helpers.createPersonRelationship(this.id, eventId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', data, options, callback);
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
    helpers.getPersonRelationship(caseId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', filter, callback);
  };

  /**
   * Retrieve a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getContactRelationship = function (contactId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(contactId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', filter, callback);
  };

  /**
   * Retrieve a relation for a event
   * @param eventId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getEventRelationship = function (eventId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(eventId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', filter, callback);
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
    // make sure case is valid, before trying to update any relations
    app.models.case
      .findById(caseId)
      .then((caseModel) => {
        if (!caseModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          });
        }
        // do not allow relationships with discarded cases
        if (app.models.case.discardedCaseClassifications.includes(caseModel.classification)) {
          throw app.utils.apiError.getError('INVALID_RELATIONSHIP_WITH_DISCARDED_CASE', {
            id: caseId
          });
        }
        helpers.updatePersonRelationship(caseId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', data, options, callback);
      })
      .catch(callback);
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
    helpers.updatePersonRelationship(contactId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', data, options, callback);
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
    helpers.updatePersonRelationship(eventId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', data, options, callback);
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
   * Count filtered relations for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountCaseRelationships = function (caseId, filter, callback) {
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
        helpers.filteredCountPersonRelationships(caseId, filter, callback);
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
   * Count filtered relations for a contact
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountContactRelationships = function (contactId, filter, callback) {
    // make sure case is valid
    app.models.contact
      .findById(contactId)
      .then((contact) => {
        if (!contact) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: contactId
          }));
        }
        helpers.filteredCountPersonRelationships(contactId, filter, callback);
      })
      .catch(callback);
  };

  /**
   * Count relations for an event
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
   * Count filtered relations for an event
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountEventRelationships = function (eventId, filter, callback) {
    // make sure case is valid
    app.models.event
      .findById(eventId)
      .then((event) => {
        if (!event) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.event.modelName,
            id: eventId
          }));
        }
        helpers.filteredCountPersonRelationships(eventId, filter, callback);
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
    params.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';
    params.dateBecomeCase = params.dateBecomeCase || app.utils.helpers.getDate().toDate();
    params.wasContact = true;
    params.classification = params.classification || 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_SUSPECT';

    // override default scope to allow switching the type
    const defaultScope = app.models.contact.defaultScope;
    app.models.contact.defaultScope = function () {
    };

    app.models.contact
      .findOne({
        where: {
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
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
              'persons.id': contactId
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
              person.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';
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
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
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
                    'type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
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
        return caseInstance.updateAttributes({
          dateBecomeContact: app.utils.helpers.getDate().toDate(),
          wasCase: true,
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        }, options);
      })
      .then(function (contact) {
        convertedContact = contact;
        // after updating the case, find it's relations
        return app.models.relationship
          .find({
            where: {
              'persons.id': caseId
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
              person.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT';
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
   * Get hierarchical locations list for an outbreak
   * @param filter Besides the default filter properties this request also accepts 'includeChildren' boolean on the first level in 'where'; this flag is taken into consideration only if other filters are applied
   * @param callback
   */
  Outbreak.prototype.getLocationsHierarchicalList = function (filter, callback) {
    // define a list of location IDs used at outbreak level
    let outbreakLocationIds;
    // if the outbreak has a list of locations defined (if is empty array, then is not set)
    if (Array.isArray(this.locationIds) && this.locationIds.length) {
      // get them
      outbreakLocationIds = this.locationIds;
    }
    // if there are no location IDs defined
    if (!outbreakLocationIds) {
      // use global (unrestricted) locations hierarchical list
      return app.controllers.location.getHierarchicalList(filter, callback);
    }
    // otherwise get a list of all allowed location IDs (all locations and sub-locations for the configured locations)
    app.models.location.getSubLocations(outbreakLocationIds, [], function (error, allowedLocationIds) {
      // handle eventual errors
      if (error) {
        return callback(error);
      }
      // build an index for allowed locations (to find them faster)
      const allowedLocationsIndex = {};
      allowedLocationIds.forEach(function (locationId) {
        allowedLocationsIndex[locationId] = true;
      });

      // initialize includeChildren filter
      let includeChildren;
      // check if the includeChildren filter was sent; accepting it only on the first level
      includeChildren = _.get(filter, 'where.includeChildren');
      if (typeof includeChildren !== 'undefined') {
        // includeChildren was sent; remove it from the filter as it shouldn't reach DB
        delete filter.where.includeChildren;
      } else {
        // default value is true
        includeChildren = true;
      }

      // build the filter
      const _filter = app.utils.remote.mergeFilters({
        where: {
          id: {
            inq: allowedLocationIds
          }
        }
      }, filter || {});

      // if include children was provided
      if (includeChildren) {
        //set it back on the first level of where (where the getHierarchicalList expects it to be)
        _.set(_filter, 'where.includeChildren', includeChildren);
      }

      // build hierarchical list of locations, restricting locations to the list of allowed ones
      return app.controllers.location.getHierarchicalList(
        _filter,
        function (error, hierarchicalList) {
          // handle eventual errors
          if (error) {
            return callback(error);
          }
          // starting from the top, disable locations that are above the allowed locations
          // hierarchical list will show all parent locations, even the ones above the selected level, mark those as disabled
          (function disableDisallowedLocations(locationsList) {
            // if there are locations to process
            if (locationsList.length) {
              // go through all of them
              locationsList.forEach(function (location) {
                // the location is not one of the allowed ones
                if (!allowedLocationsIndex[location.location.id]) {
                  // mark it as disabled
                  location.location.disabled = true;
                  // continue checking children
                  if (Array.isArray(location.children)) {
                    disableDisallowedLocations(location.children);
                  }
                }
              });
            }
          })(hierarchicalList);
          // return processed hierarchical location list
          callback(null, hierarchicalList);
        });
    });
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
        instance.undoDelete(
          options,
          (err, result) => {
            // an error occurred?
            if (err) {
              return callback(err);
            }

            // retrieve contacts that were deleted and were associated with this case
            const contactsJobs = [];
            app.models.contact
              .find({
                deleted: true,
                where: {
                  deletedByParent: caseId,
                  deleted: true
                }
              })
              .then((contacts) => {
                // construct the list of contacts that we need to restore
                (contacts || []).forEach((contact) => {
                  contactsJobs.push((function (contactModel) {
                    return (callback) => {
                      contactModel.undoDelete(
                        {
                          extraProps: {
                            deletedByParent: null
                          }
                        },
                        callback
                      );
                    };
                  })(contact));
                });

                // restore contacts that were removed along with this case
                async.parallelLimit(contactsJobs, 10, function (error) {
                  callback(error, result);
                });
              })
              .catch(callback);
          }
        );
      })
      .catch(callback);
  };

  /**
   * Restore a deleted contact
   * @param contactId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContact = function (contactId, options, callback) {
    app.models.contact
      .findOne({
        deleted: true,
        where: {
          id: contactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contact.modelName, id: contactId});
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Restore a deleted event
   * @param eventId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreEvent = function (eventId, options, callback) {
    app.models.event
      .findOne({
        deleted: true,
        where: {
          id: eventId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.event.modelName, id: eventId});
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
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
   * @param data Props: { startDate, endDate (both follow up dates are required), targeted (boolean) }
   * @param options
   * @param callback
   */
  Outbreak.prototype.generateFollowups = function (data, options, callback) {
    let errorMessage = '';

    // outbreak follow up generate params sanity checks
    let invalidOutbreakParams = [];
    if (this.frequencyOfFollowUp <= 0) {
      invalidOutbreakParams.push('frequencyOfFollowUp');
    }
    if (this.frequencyOfFollowUpPerDay <= 0) {
      invalidOutbreakParams.push('frequencyOfFollowUpPerDay');
    }
    if (invalidOutbreakParams.length) {
      errorMessage += `Following outbreak params: [${Object.keys(invalidOutbreakParams).join(',')}] should be greater than 0`;
    }

    // parse start/end dates from request
    let followupStartDate = genericHelpers.getDate(data.startDate);
    let followupEndDate = genericHelpers.getDateEndOfDay(data.endDate);

    // sanity checks for dates
    let invalidFollowUpDates = [];
    if (!followupStartDate.isValid()) {
      invalidFollowUpDates.push('startDate');
    }
    if (!followupEndDate.isValid()) {
      invalidFollowUpDates.push('endDate');
    }
    if (invalidFollowUpDates.length) {
      errorMessage += `Follow up: [${Object.keys(invalidOutbreakParams).join(',')}] are not valid dates`;
    }

    // if the error message is not empty, stop the request
    if (errorMessage) {
      return callback(
        app.utils.apiError.getError(
          'INVALID_GENERATE_FOLLOWUP_PARAMS',
          {
            details: errorMessage
          }
        )
      );
    }

    // check if 'targeted' flag exists in the request, if not default to true
    // this flag will be set upon all generated follow ups
    let targeted = true;
    if (data.hasOwnProperty('targeted')) {
      targeted = data.targeted;
    }

    // cache outbreak's follow up options
    let outbreakFollowUpFreq = this.frequencyOfFollowUp;
    let outbreakFollowUpPerDay = this.frequencyOfFollowUpPerDay;

    // retrieve list of contacts that are eligible for follow up generation
    // and those that have last follow up inconclusive
    let outbreakId = this.id;

    // retrieve events with relationships to contacts
    // retrieve cases that were discarded so we can exclude contacts that are related only to discarded contacts
    Promise.all([
      new Promise((resolve, reject) => {
        app.models.case
          // retrieve discarded cases
          .rawFind({
            outbreakId: outbreakId,
            classification: {
              $in: app.models.case.discardedCaseClassifications
            }
          }, {projection: {_id: 1}})
          // retrieve contacts for which we can generate follow-ups
          .then(caseIds => {
            // retrieve list of discarded case ids
            caseIds = (caseIds || []).map((caseData) => caseData.id);

            // filter relationships
            return app.models.relationship
              .rawFind({
                outbreakId: outbreakId,
                $or: [{
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.0.id': {
                    $nin: caseIds
                  },
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
                }, {
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                  'persons.1.id': {
                    $nin: caseIds
                  }
                }]
              }, {projection: {persons: 1}});
          })
          .then(resolve)
          .catch(reject);
      }),
      new Promise((resolve, reject) => {
        app.models.event
          .rawFind({
            outbreakId: outbreakId,
          }, {projection: {_id: 1}})
          // retrieve contacts for which we can generate follow-ups
          .then(eventIds => {
            eventIds = (eventIds || []).map((eventData) => eventData.id);

            // filter relationships
            return app.models.relationship
              .rawFind({
                outbreakId: outbreakId,
                $or: [{
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT',
                  'persons.0.id': {
                    $in: eventIds
                  },
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
                }, {
                  'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                  'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT',
                  'persons.1.id': {
                    $in: eventIds
                  }
                }]
              }, {projection: {persons: 1}});
          })
          .then(resolve)
          .catch(reject);
      })
    ])
      .then(relations => {
        const allRelations = (relations[0] || []).concat((relations[1] || []));
        // retrieve contact ids
        const allowedContactIds = Array.from(new Set(allRelations.map((relationshipData) => {
          return relationshipData.persons[0].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT' ?
            relationshipData.persons[0].id :
            relationshipData.persons[1].id;
        })));

        // there is no point in generating any follow-ups if no allowed contact were found
        if (allowedContactIds.length < 1) {
          return [
            [],
            []
          ];
        }

        // retrieve contacts for which we can generate follow-ups
        return FollowupGeneration.getContactsEligibleForFollowup(
          followupStartDate.toDate(),
          followupEndDate.toDate(),
          outbreakId,
          allowedContactIds
        );
      })
      .then((contacts) => {
        if (!contacts.length) {
          return 0;
        }

        // get all teams and their locations to get eligible teams for each contact
        return FollowupGeneration
          .getAllTeamsWithLocationsIncluded()
          .then((teams) => {
            // get follow ups list for all contacts
            return FollowupGeneration
              .getContactFollowups(followupStartDate.toDate(), followupEndDate.toDate(), contacts.map(c => c.id))
              .then((followUpGroups) => {
                // create promise queues for handling database operations
                const dbOpsQueue = FollowupGeneration.dbOperationsQueue(options);

                let pool = new PromisePool(
                  contacts.map((contact) => {
                    contact.followUpsList = followUpGroups[contact.id] || [];
                    return FollowupGeneration
                      .getContactFollowupEligibleTeams(contact, teams)
                      .then((eligibleTeams) => {
                        contact.eligibleTeams = eligibleTeams;
                      })
                      .then(() => {
                        // it returns a list of follow ups objects to insert and a list of ids to remove
                        let generateResult = FollowupGeneration.generateFollowupsForContact(
                          contact,
                          contact.eligibleTeams,
                          {
                            startDate: followupStartDate,
                            endDate: followupEndDate
                          },
                          outbreakFollowUpFreq,
                          outbreakFollowUpPerDay,
                          targeted
                        );

                        dbOpsQueue.enqueueForInsert(generateResult.add);
                        dbOpsQueue.enqueueForRecreate(generateResult.update);
                      });
                  }),
                  100 // concurrency limit
                );

                let poolPromise = pool.start();

                return poolPromise
                  // make sure the queue has emptied
                  .then(() => dbOpsQueue.internalQueue.onIdle())
                  // settle any remaining items that didn't reach the batch size
                  .then(() => dbOpsQueue.settleRemaining())
                  .then(() => dbOpsQueue.insertedCount());
              });
          });
      })
      .then((count) => callback(null, {count: count}))
      .catch((err) => callback(err));
  };

  /**
   * Generate (next available) case visual id
   * @param visualIdMask
   * @param personId
   * @param callback
   */
  Outbreak.prototype.generateCaseVisualId = function (visualIdMask, personId, callback) {
    Outbreak.helpers.validateOrGetAvailableCaseVisualId(this, visualIdMask, personId)
      .then(function (visualId) {
        callback(null, visualId);
      })
      .catch(callback);
  };

  /**
   * Generate (next available) contact visual id
   * @param visualIdMask
   * @param personId
   * @param callback
   */
  Outbreak.prototype.generateContactVisualId = function (visualIdMask, personId, callback) {
    Outbreak.helpers.validateOrGetAvailableContactVisualId(this, visualIdMask, personId)
      .then(function (visualId) {
        callback(null, visualId);
      })
      .catch(callback);
  };

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
    if (typeof noDaysNewContacts !== 'undefined') {
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
   * (Pre)Process Transmission Chains Filter
   * @param filter
   * @return {Promise<{filter: *, personIds: any, endDate: *, activeFilter: *, includedPeopleFilter: *} | never>}
   */
  Outbreak.prototype.preProcessTransmissionChainsFilter = function (filter) {
    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // get outbreak id
    const outbreakId = this.id;

    // check if contacts should be counted as transmission chains
    const noContactChains = _.get(filter, 'where.noContactChains', true);
    // if present remove it from the main filter
    if (typeof noContactChains !== 'undefined' || noContactChains !== null) {
      delete filter.where.noContactChains;
    }

    // check if contacts should be included
    const includeContacts = _.get(filter, 'where.includeContacts', false);
    // if present remove it from the main filter
    if (includeContacts) {
      delete filter.where.includeContacts;
    }

    // check if contacts of contacts should be included
    const includeContactsOfContacts = _.get(filter, 'where.includeContactsOfContacts');
    // if present remove it from the main filter
    if (typeof includeContactsOfContacts !== 'undefined') {
      delete filter.where.includeContactsOfContacts;
    }

    // check if contacts should be counted
    const countContacts = _.get(filter, 'where.countContacts', false);
    if (countContacts) {
      delete filter.where.countContacts;
    }

    // get active filter
    let activeFilter = _.get(filter, 'where.active');
    // if active filter was sent remove it from the filter
    if (typeof activeFilter !== 'undefined') {
      delete filter.where.active;
    }

    // get size filter
    let sizeFilter = _.get(filter, 'where.size');
    // if size filter was sent remove it from the filter
    if (typeof sizeFilter !== 'undefined') {
      delete filter.where.size;
    }

    // initialize a person filter (will contain filters applicable on person entity)
    let personFilter = _.get(filter, 'where.person');
    // if person filter was sent
    if (personFilter) {
      // remove original filter
      delete filter.where.person;
    }

    // try and get the end date filter
    let endDate = _.get(filter, 'where.endDate');
    // no end date filter provided
    if (!endDate) {
      // end date is current date
      endDate = new Date();
    } else {
      // remove end date from filter
      delete filter.where.endDate;
    }

    // keep a flag for includedPeopleFilter
    let includedPeopleFilter = _.get(filter, 'where.chainIncludesPerson');

    // find relationship IDs for included people filter, if necessary
    let findIncludedPeopleIds;
    // if there is a included people filer
    if (includedPeopleFilter) {
      // remove the query from the filter
      delete filter.where.chainIncludesPerson;
      // find the relationships that belong to chains which include the filtered people
      findIncludedPeopleIds = app.models.person
        .rawFind(includedPeopleFilter, {projection: {_id: 1}})
        .then(function (people) {
          // update included people filter
          includedPeopleFilter = people.map(person => person.id);
        });
    } else {
      findIncludedPeopleIds = Promise.resolve(null);
    }

    // find IDs for included people filter, if necessary
    return findIncludedPeopleIds
      .then(function () {
        // if a person filter was used
        if (personFilter) {
          // find people that match the filter
          return app.models.person
            .rawFind(
              app.utils.remote.convertLoopbackFilterToMongo({
                and: [
                  {
                    outbreakId: outbreakId
                  },
                  personFilter
                ]
              }),
              {projection: {_id: 1}}
            )
            .then(function (people) {
              // return their IDs
              return people.map(person => person.id);
            });
        }
      })
      .then(function (personIds) {
        // if there was a people filter
        if (personIds) {
          // make sure both people in a relation match the filter passed
          filter = app.utils.remote
            .mergeFilters({
              where: {
                'persons.0.id': {
                  inq: personIds
                },
                'persons.1.id': {
                  inq: personIds
                }
              }
            }, filter);
        }
        return personIds;
      })
      .then(function (personIds) {
        // if contacts should not be included
        if (!includeContacts && !countContacts) {
          // restrict chain data to cases and events
          filter = app.utils.remote
            .mergeFilters({
              where: {
                'persons.0.type': {
                  inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                },
                'persons.1.type': {
                  inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                }
              }
            }, filter);
        }
        // return needed, processed information
        return {
          filter: filter,
          personIds: personIds,
          endDate: endDate,
          active: activeFilter,
          includedPeopleFilter: includedPeopleFilter,
          size: sizeFilter,
          countContacts: countContacts,
          includeContacts: includeContacts,
          noContactChains: noContactChains,
          includeContactsOfContacts: includeContactsOfContacts
        };
      });
  };

  /**
   * Post process/filter transmission chains
   * @param filter
   * @param dataSet
   * @param opts
   * @return {{transmissionChains: {chains: Array, length: number}, nodes: {}, edges: {}}}
   */
  Outbreak.prototype.postProcessTransmissionChains = function (filter, dataSet, opts = {}) {
    // define result structure
    const result = {
      transmissionChains: {
        chains: [],
        length: 0
      },
      nodes: {},
      edges: {}
    };

    // keep a flag to see if any transmission chain filters were applied (people should be filtered out)
    let appliedTransmissionChainsFilters = false;

    // keep an index of people that pass the filters
    const filteredChainPeopleIndex = {};
    // go through all the chains
    dataSet.transmissionChains.chains.forEach(function (transmissionChain) {
      // keep a flag for chain passing all filters
      let addTransmissionChain = true;

      // check if size filter is present
      if (filter.size != null) {
        // mark this filtering
        appliedTransmissionChainsFilters = true;
        // apply size filter
        addTransmissionChain = (addTransmissionChain && (transmissionChain.size === filter.size));
      }

      // check if active filter is present
      if (addTransmissionChain && filter.active != null) {
        // mark this filtering
        appliedTransmissionChainsFilters = true;
        // apply active filter
        addTransmissionChain = (addTransmissionChain && (transmissionChain.active === filter.active));
      }

      // build an index of transmission chain people
      const transmissionChainPeopleIndex = {};
      // build it only if the chain is valid
      if (addTransmissionChain) {
        // go through all the pairs in the chain
        transmissionChain.chain.forEach(function (peoplePair) {
          // map each person from the chain into the index
          peoplePair.forEach(function (personId) {
            transmissionChainPeopleIndex[personId] = true;
          });
        });
      }

      // check if the chain includes at least one person from the included people filter
      if (addTransmissionChain && filter.includedPeopleFilter != null) {
        // mark this filtering
        appliedTransmissionChainsFilters = true;
        // make a clone of the included people filter
        const includedPeople = filter.includedPeopleFilter.slice();
        // get first included person
        let includedPerson = includedPeople.shift();
        // assume the chain does not include the person
        let chainIncludesPerson = false;
        // keep looking for the person until either the person is found or there are no more people
        while (!chainIncludesPerson && includedPerson) {
          if (transmissionChainPeopleIndex[includedPerson]) {
            chainIncludesPerson = true;
          }
          includedPerson = includedPeople.shift();
        }
        // apply included person filter
        addTransmissionChain = (addTransmissionChain && chainIncludesPerson);
      }

      // if the chain passed all filters
      if (addTransmissionChain) {
        // add it to the result
        result.transmissionChains.chains.push(transmissionChain);
        // update people index
        Object.assign(filteredChainPeopleIndex, transmissionChainPeopleIndex);
      }
    });

    // update transmission chains no
    result.transmissionChains.length = result.transmissionChains.chains.length;

    // keep an index of nodes that should be kept
    const nodesToKeepIndex = {};
    // filter edges, should contain only the indexed people (people that passed the filters)
    Object.keys(dataSet.edges).forEach(function (edgeId) {
      // get the edge
      const edge = dataSet.edges[edgeId];
      // if no transmission chain filters applied or at least one person found in the index (case/event-contact relationships will have only one person in the index)
      if (!appliedTransmissionChainsFilters || filteredChainPeopleIndex[edge.persons[0].id] || filteredChainPeopleIndex[edge.persons[1].id]) {
        // keep the edge
        result.edges[edgeId] = edge;
        // keep both nodes
        nodesToKeepIndex[edge.persons[0].id] = true;
        nodesToKeepIndex[edge.persons[1].id] = true;
      }
    });

    // check if contact nodes should be removed from result
    // this should happen when include contacts flag is not set
    const shouldKeepContacts = opts.includeContacts;
    const shouldKeepContactsOfContacts = opts.includeContactsOfContacts;

    // go through all the nodes
    Object.keys(dataSet.nodes).forEach(function (nodeId) {
      // do not keep contact nodes
      if (!shouldKeepContacts && dataSet.nodes[nodeId].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
        return;
      }

      // do not keep contact of contact nodes
      if (!shouldKeepContactsOfContacts &&
        dataSet.nodes[nodeId].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT') {
        return;
      }

      // if the node should be kept
      if (nodesToKeepIndex[nodeId]) {
        // store it in the result
        result.nodes[nodeId] = dataSet.nodes[nodeId];
      }
    });
    // return processed result
    return result;
  };

  /**
   * Count independent transmission chains
   * @param filter Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param callback
   */
  Outbreak.prototype.countIndependentTransmissionChains = function (filter, callback) {
    const self = this;
    // processed filter
    this.preProcessTransmissionChainsFilter(filter)
      .then(function (processedFilter) {

        // use processed filters
        filter = processedFilter.filter;
        const personIds = processedFilter.personIds;
        const endDate = processedFilter.endDate;
        const includedPeopleFilter = processedFilter.includedPeopleFilter;

        // end date is supported only one first level of where in transmission chains
        _.set(filter, 'where.endDate', endDate);

        // count transmission chains
        app.models.relationship
          .countTransmissionChains(self.id, self.periodOfFollowup, filter, function (error, noOfChains) {
            if (error) {
              return callback(error);
            }

            // if we have includedPeopleFilter, we don't need isolated nodes
            if (includedPeopleFilter) {

              delete noOfChains.isolatedNodes;
              delete noOfChains.nodes;
              callback(null, noOfChains);

              // no includedPeopleFilter, add isolated nodes
            } else {
              // get node IDs
              const nodeIds = Object.keys(noOfChains.nodes);
              // count isolated nodes
              const isolatedNodesNo = Object.keys(noOfChains.isolatedNodes).reduce(function (accumulator, currentValue) {
                if (noOfChains.isolatedNodes[currentValue]) {
                  accumulator++;
                }
                return accumulator;
              }, 0);

              // build a filter of isolated nodes
              let isolatedNodesFilter = {
                outbreakId: self.id,
                or: [
                  {
                    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                    classification: {
                      nin: app.models.case.discardedCaseClassifications
                    }
                  },
                  {
                    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                  }
                ],
                id: {
                  nin: nodeIds
                },
                dateOfReporting: {
                  lte: endDate
                }
              };

              // if there was a people filter
              if (personIds) {
                // use it for isolated nodes as well
                // merge filter knows how to handle filters, but count accepts only 'where'
                const filter = app.utils.remote
                  .mergeFilters({
                    where: {
                      id: {
                        inq: personIds
                      }
                    }
                  }, {where: isolatedNodesFilter});
                // extract merged 'where' property
                isolatedNodesFilter = filter.where;
              }
              // find other isolated nodes (nodes that were never in a relationship)
              app.models.person
                .count(isolatedNodesFilter)
                .then(function (isolatedNodesCount) {
                  // total list of isolated nodes is composed by the nodes that were never in a relationship + the ones that
                  // come from relationships that were invalidated as part of the chain
                  noOfChains.isolatedNodesCount = isolatedNodesCount + isolatedNodesNo;
                  delete noOfChains.isolatedNodes;
                  delete noOfChains.nodes;
                  callback(null, noOfChains);
                })
                .catch(callback);
            }
          });
      });
  };

  /**
   * Get independent transmission chains
   * @param filter Note: also accepts 'active' boolean on the first level in 'where'. Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param callback
   */
  Outbreak.prototype.getIndependentTransmissionChains = function (filter, callback) {
    const self = this;

    // if contacts of contacts is disabled on the outbreak, do not include them in CoT
    const isContactsOfContactsActive = this.isContactsOfContactsActive;

    // process filters
    this.preProcessTransmissionChainsFilter(filter).then(function (processedFilter) {
      // use processed filters
      filter = processedFilter.filter;
      const personIds = processedFilter.personIds;
      const endDate = processedFilter.endDate;
      const activeFilter = processedFilter.active;
      const includedPeopleFilter = processedFilter.includedPeopleFilter;
      const sizeFilter = processedFilter.size;
      const includeContacts = processedFilter.includeContacts;
      const noContactChains = processedFilter.noContactChains;
      const includeContactsOfContacts = processedFilter.includeContactsOfContacts;

      // flag that indicates that contacts should be counted per chain
      const countContacts = processedFilter.countContacts;

      // end date is supported only one first level of where in transmission chains
      _.set(filter, 'where.endDate', endDate);

      // get transmission chains
      app.models.relationship
        .getTransmissionChains(self.id, self.periodOfFollowup, filter, countContacts, noContactChains, function (error, transmissionChains) {
          if (error) {
            return callback(error);
          }

          // apply post filtering/processing
          transmissionChains = self.postProcessTransmissionChains(
            {
              active: activeFilter,
              size: sizeFilter,
              includedPeopleFilter:
              includedPeopleFilter
            },
            transmissionChains,
            {
              includeContacts: includeContacts,
              includeContactsOfContacts: isContactsOfContactsActive && includeContactsOfContacts && includeContacts
            });

          // determine if isolated nodes should be included
          const shouldIncludeIsolatedNodes = (
            // there is no size filter
            (sizeFilter == null) &&
            // no included people filter
            !includedPeopleFilter);

          // initialize isolated nodes filter
          let isolatedNodesFilter;

          // build isolated nodes filter only if needed
          if (shouldIncludeIsolatedNodes) {
            // initialize isolated nodes filter
            isolatedNodesFilter = {
              where: {
                outbreakId: self.id,
                or: [
                  {
                    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                    classification: {
                      nin: app.models.case.discardedCaseClassifications
                    }
                  },
                  {
                    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'
                  }
                ],
                dateOfReporting: {
                  lte: endDate
                }
              }
            };

            // if there was a people filter
            if (personIds) {
              // use it for isolated nodes as well
              isolatedNodesFilter = app.utils.remote
                .mergeFilters({
                  where: {
                    id: {
                      inq: personIds
                    }
                  }
                }, isolatedNodesFilter);
            }
          }

          // depending on activeFilter we need to filter the transmissionChains
          if (typeof activeFilter !== 'undefined') {

            // update isolated nodes filter only if needed
            if (shouldIncludeIsolatedNodes) {

              // update isolated nodes filter depending on active filter value
              let followUpPeriod = self.periodOfFollowup;
              // get day of the start of the follow-up period starting from specified end date (by default, today)
              let followUpStartDate = genericHelpers.getDate(endDate).subtract(followUpPeriod, 'days');

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
            }
          } else {
            // if isolated nodes don't need to be included, stop here
            if (!shouldIncludeIsolatedNodes) {
              callback(null, transmissionChains);
            }
          }

          // look for isolated nodes, if needed
          if (shouldIncludeIsolatedNodes) {
            // update isolated nodes filter
            isolatedNodesFilter = app.utils.remote
              .mergeFilters({
                where: {
                  id: {
                    nin: Object.keys(transmissionChains.nodes)
                  }
                }
              }, isolatedNodesFilter);

            // get isolated nodes as well (nodes that were never part of a relationship)
            app.models.person
              .rawFind(app.utils.remote.convertLoopbackFilterToMongo(isolatedNodesFilter.where))
              .then(function (isolatedNodes) {
                // add all the isolated nodes to the complete list of nodes
                isolatedNodes.forEach(function (isolatedNode) {
                  transmissionChains.nodes[isolatedNode.id] = isolatedNode;
                });
                callback(null, transmissionChains);
              })
              .catch(callback);
          }
        });
    });
  };

  /**
   * Since this endpoint returns person data without checking if the user has the required read permissions,
   * check the user's permissions and return only the fields he has access to
   */
  Outbreak.afterRemote('prototype.getIndependentTransmissionChains', function (context, modelInstance, next) {
    let personTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    Object.keys(modelInstance.nodes).forEach((key) => {
      Outbreak.helpers.limitPersonInformation(modelInstance.nodes[key], personTypesWithReadAccess);

      // transform Mongo geolocation to Loopback geolocation
      genericHelpers.covertAddressesGeoPointToLoopbackFormat(modelInstance.nodes[key]);
    });
    next();
  });

  /**
   * Set outbreakId for created follow-ups
   */
  Outbreak.beforeRemote('prototype.__create__contacts__followUps', function (context, modelInstance, next) {
    // set outbreakId
    context.args.data.outbreakId = context.instance.id;
    next();
  });

  /**
   * Set outbreakId for created lab results
   */
  Outbreak.beforeRemote('prototype.__create__cases__labResults', function (context, modelInstance, next) {
    // set outbreakId
    context.args.data.outbreakId = context.instance.id;
    next();
  });

  /**
   * Set outbreakId for created lab results
   */
  Outbreak.beforeRemote('prototype.__create__contacts__labResults', function (context, modelInstance, next) {
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
    helpers.countContactsByFollowUpFilter({
      outbreakId: this.id,
      followUpFilter: app.models.followUp.seenFilter,
      resultProperty: 'contactsSeenCount'
    }, filter, callback);
  };

  /**
   * Count the contacts that are lost to follow-up
   * Note: The contacts are counted in total and per team. If a contact is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param filter
   */
  Outbreak.prototype.countContactsLostToFollowup = function (filter) {
    // get outbreakId
    let outbreakId = this.id;

    // filter by classification ?
    const classification = _.get(filter, 'where.classification');
    if (classification) {
      delete filter.where.classification;
    }

    // create filter as we need to use it also after the relationships are found
    let _filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          followUp: {
            neq: null
          },
          'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_LOST_TO_FOLLOW_UP'
        }
      }, filter || {});

    // do we need to filter contacts by case classification ?
    let promise = Promise.resolve();
    if (classification) {
      // retrieve cases
      promise = promise
        .then(() => {
          return app.models.case
            .rawFind({
              outbreakId: this.id,
              deleted: {
                $ne: true
              },
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
              deleted: {
                $ne: true
              },
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
          _filter.where = {
            $and: [
              _filter.where, {
                _id: {
                  $in: contactIds
                }
              }
            ]
          };
        });
    }

    // get contacts that are available for follow up generation
    return promise
      .then(() => {
        // get all relationships between events and contacts, where the contacts were created sooner than 'noDaysNewContacts' ago
        return app.models.contact
          .rawFind(_filter.where)
          .then(function (contacts) {
            return {
              contactsLostToFollowupCount: contacts.length,
              contactIDs: contacts.map((contact) => contact.id)
            };
          });
      });
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
              // count each case only once (do a specific check for person type as transmission chains may include events)
              if (!casesIndex[person.id] && person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE') {
                casesIndex[person.id] = true;
                result.total++;
                // check if the case is new (date of reporting is later than the threshold date)
                if ((new Date(person.dateOfReporting)) >= newCasesFromDate) {
                  result.newCases++;
                  result.caseIDs.push(person.id);
                }
              }
            });
          }
        });
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count new cases outside known transmission chains
   * @param filter Besides the default filter properties this request also accepts 'noDaysInChains': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countNewCasesOutsideKnownTransmissionChains = function (filter, callback) {
    const self = this;
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
              // count each case only once (do a specific check for person type as transmission chains may include events)
              if (!casesIndex[person.id] && person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE') {
                casesIndex[person.id] = true;
              }
            });
          }
        });
        // find cases that are not part of known transmission chains
        return app.models.case
          .rawFind({
            outbreakId: self.id,
            _id: {
              nin: Object.keys(casesIndex)
            },
            classification: {
              nin: app.models.case.discardedCaseClassifications
            }
          }, {
            projection: {
              dateOfReporting: 1
            }
          })
          .then(function (cases) {
            cases.forEach(function (caseRecord) {
              // check if the case is new (date of reporting is later than the threshold date)
              if ((new Date(caseRecord.dateOfReporting)) >= newCasesFromDate) {
                result.newCases++;
                result.caseIDs.push(caseRecord.id);
              }
              result.total++;
            });
          });
      })
      .then(function () {
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
    if (typeof noLessContacts !== 'undefined') {
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
    if (typeof noDaysNewContacts !== 'undefined') {
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
            {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'},
            {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'}
          ]
        },
        include: [{
          relation: 'people',
          scope: {
            where: {
              type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
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
          let eventIndex = relationship.persons.findIndex(elem => elem.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT');
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
          };
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
              inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
            },
            'persons.1.type': {
              inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
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
   * Since this endpoint returns person data without checking if the user has the required read permissions,
   * check the user's permissions and return only the fields he has access to
   */
  Outbreak.afterRemote('prototype.longPeriodsBetweenDatesOfOnsetInTransmissionChains', function (context, modelInstance, next) {
    let personTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    modelInstance.forEach((relationship) => {
      relationship.people.forEach((person) => {
        Outbreak.helpers.limitPersonInformation(person, personTypesWithReadAccess);
      });
    });
    next();
  });

  /**
   * Build new transmission chains from registered contacts who became cases
   * @param filter
   * @param callback
   */
  Outbreak.prototype.buildNewChainsFromRegisteredContactsWhoBecameCases = function (filter, callback) {
    Outbreak.helpers.buildOrCountNewChainsFromRegisteredContactsWhoBecameCases(this, filter, false, callback);
  };

  /**
   * Since this endpoint returns person data without checking if the user has the required read permissions,
   * check the user's permissions and return only the fields he has access to
   */
  Outbreak.afterRemote('prototype.buildNewChainsFromRegisteredContactsWhoBecameCases', function (context, modelInstance, next) {
    let personTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    Object.keys(modelInstance.nodes).forEach((key) => {
      Outbreak.helpers.limitPersonInformation(modelInstance.nodes[key], personTypesWithReadAccess);
    });
    next();
  });

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
   * Count contacts on follow-up lists on a specific day (default day: current day)
   * @param filter Accepts 'date' on the first level of 'where' property
   * @param callback
   */
  Outbreak.prototype.countFollowUpContacts = function (filter, callback) {
    app.models.followUp
      .countContacts(this.id, filter)
      .then(function (result) {
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
              inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
            },
            'persons.1.type': {
              inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
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
   * Since this endpoint returns person data without checking if the user has the required read permissions,
   * check the user's permissions and return only the fields he has access to
   */
  Outbreak.afterRemote('prototype.findSecondaryCasesWithDateOfOnsetBeforePrimaryCase', function (context, modelInstance, next) {
    let personTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    modelInstance.forEach((personPair) => {
      Outbreak.helpers.limitPersonInformation(personPair.primaryCase, personTypesWithReadAccess);
      Outbreak.helpers.limitPersonInformation(personPair.secondaryCase, personTypesWithReadAccess);
    });

    next();
  });

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
    if (typeof noDaysAmongContacts !== 'undefined') {
      // noDaysAmongContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysAmongContacts;
    } else {
      // get the outbreak noDaysAmongContacts as the default noDaysNewContacts value
      noDaysAmongContacts = this.noDaysAmongContacts;
    }

    // get now date
    let now = new Date();

    // get from noDaysAmongContacts ago
    let xDaysAgo = new Date((new Date()).setHours(0, 0, 0, 0));
    xDaysAgo.setDate(now.getDate() - noDaysAmongContacts);

    // get outbreakId
    let outbreakId = this.id;

    // get all cases that were reported sooner or have 'dateBecomeCase' sooner than 'noDaysAmongContacts' ago
    app.models.case.rawFind(app.utils.remote
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
      }, filter || {}).where
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
    filter = filter || {};
    // initialize noDaysNotSeen filter
    let noDaysNotSeen;
    // check if the noDaysNotSeen filter was sent; accepting it only on the first level
    noDaysNotSeen = _.get(filter, 'where.noDaysNotSeen');
    if (typeof noDaysNotSeen !== 'undefined') {
      // noDaysNotSeen was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysNotSeen;
    } else {
      // get the outbreak noDaysNotSeen as the default noDaysNotSeen value
      noDaysNotSeen = this.noDaysNotSeen;
    }

    // filter by classification ?
    const classification = _.get(filter, 'where.classification');
    if (classification) {
      delete filter.where.classification;
    }

    // get outbreakId
    let outbreakId = this.id;

    // get current date
    let now = genericHelpers.getDate();
    // get date from noDaysNotSeen days ago
    let xDaysAgo = now.clone().subtract(noDaysNotSeen, 'day');

    // get contact query
    let contactQuery = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter).contact;

    // by default, find contacts does not perform any task
    let findContacts = Promise.resolve();

    // do we need to filter contacts by case classification ?
    if (classification) {
      // retrieve cases
      findContacts = findContacts
        .then(() => {
          return app.models.case
            .rawFind({
              outbreakId: outbreakId,
              deleted: {
                $ne: true
              },
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
              deleted: {
                $ne: true
              },
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
          if (contactQuery) {
            contactQuery = {
              and: [
                contactQuery, {
                  id: {
                    inq: contactIds
                  }
                }
              ]
            };
          } else {
            contactQuery = {
              id: {
                inq: contactIds
              }
            };
          }
        });
    }

    // find the contacts
    findContacts = findContacts
      .then(() => {
        // no contact query
        if (!contactQuery) {
          return;
        }

        // if a contact query was specified
        return app.models.contact
          .rawFind({
            and: [
              {outbreakId: outbreakId},
              contactQuery
            ]
          })
          .then(function (contacts) {
            // return a list of contact ids
            return contacts.map(contact => contact.id);
          });
      });

    // find contacts
    findContacts
      .then(function (contactIds) {
        let followUpQuery = {
          where: {
            and: [
              {
                outbreakId: outbreakId
              },
              {
                // get follow-ups that were scheduled in the past noDaysNotSeen days
                date: {
                  between: [xDaysAgo, now]
                }
              },
              app.models.followUp.notSeenFilter
            ]
          }
        };
        // if a list of contact ids was specified
        if (contactIds) {
          // restrict list of follow-ups to the list fo contact ids
          followUpQuery.where.and.push({
            personId: {
              inq: contactIds
            }
          });
        }
        // get follow-ups
        return app.models.followUp.rawFind(
          app.utils.remote.mergeFilters(followUpQuery, filter || {}).where,
          {
            // order by date as we need to check the follow-ups from the oldest to the most new
            order: {date: 1}
          })
          .then(followUps => {
            const resultContactsList = [];
            // group follow ups per contact
            const groupedByContact = _.groupBy(followUps, (f) => f.personId);
            for (let contactId in groupedByContact) {
              // keep one follow up per day
              const contactFollowUps = [...new Set(groupedByContact[contactId].map((f) => f.index))];
              if (contactFollowUps.length === noDaysNotSeen) {
                resultContactsList.push(contactId);
              }
            }
            // send response
            return callback(null, {
              contactsCount: resultContactsList.length,
              contactIDs: resultContactsList
            });
          });
      })
      .catch(callback);
  };

  /**
   * Count the contacts that have followups scheduled and the contacts with successful followups
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsWithSuccessfulFollowups = function (filter, callback) {
    filter = filter || {};
    const FollowUp = app.models.followUp;

    // initialize result
    let result = {
      totalContactsWithFollowupsCount: 0,
      contactsWithSuccessfulFollowupsCount: 0,
      teams: [],
      contacts: []
    };

    // get outbreakId
    let outbreakId = this.id;

    // retrieve relations queries
    const relationsQueries = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);

    // get contact query, if any
    let contactQuery = relationsQueries.contact;

    // get case query, if any
    const caseQuery = relationsQueries.case;

    // by default, find contacts does not perform any task
    let findContacts = Promise.resolve();

    // do we need to filter contacts by case classification ?
    if (caseQuery) {
      // retrieve cases
      findContacts = findContacts
        .then(() => {
          return app.models.case
            .rawFind({
              and: [
                caseQuery, {
                  outbreakId: outbreakId,
                  deleted: {
                    $ne: true
                  }
                }
              ]
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
              outbreakId: outbreakId,
              deleted: {
                $ne: true
              },
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
          if (contactQuery) {
            contactQuery = {
              and: [
                contactQuery, {
                  id: {
                    inq: contactIds
                  }
                }
              ]
            };
          } else {
            contactQuery = {
              id: {
                inq: contactIds
              }
            };
          }
        });
    }

    // find the contacts
    findContacts = findContacts
      .then(() => {
        // no contact query
        if (!contactQuery) {
          return;
        }

        // if a contact query was specified
        return app.models.contact
          .rawFind({and: [contactQuery, {outbreakId: outbreakId}]}, {projection: {_id: 1}})
          .then(function (contacts) {
            // return a list of contact ids
            return contacts.map(contact => contact.id);
          });
      });

    // find contacts
    findContacts
      .then(function (contactIds) {
        // build follow-up filter
        let _filter = {
          where: {
            outbreakId: outbreakId
          }
        };
        // if contact ids were specified
        if (contactIds) {
          // restrict follow-up query to those ids
          _filter.where.personId = {
            inq: contactIds
          };
        }
        // get all the followups for the filtered period
        return FollowUp.rawFind(app.utils.remote
          .mergeFilters(_filter, filter || {}).where)
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
                  // new follow-up for the contact from the same team is performed; update flag and increase successful counter
                  if (!contactsTeamMap[contactId].teams[teamId].performed && FollowUp.isPerformed(followup) === true) {
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
                    performed: FollowUp.isPerformed(followup)
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
                  if (FollowUp.isPerformed(followup)) {
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
                      performed: FollowUp.isPerformed(followup)
                    }
                  },
                  performed: FollowUp.isPerformed(followup),
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
                if (FollowUp.isPerformed(followup)) {
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
              if (FollowUp.isPerformed(followup)) {
                // update counter for contact successful follow-ups
                contactsMap[contactId].successfulFollowupsCount++;

                // check if contact didn't have a successful followup and the current one was performed
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
          });
      })
      .catch(callback);
  };

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
      let today = genericHelpers.getDate().toString();
      let todayEndOfDay = genericHelpers.getDateEndOfDay().toString();

      defaultFilter.where.date = {
        between: [today, todayEndOfDay]
      };
    }

    // retrieve all teams to make sure that follow-ups teams still exist
    let existingTeamsMap = {};
    app.models.team
      .find()
      .then(function (teams) {
        // map teams
        teams.forEach((team) => {
          existingTeamsMap[team.id] = team;
        });

        // get all the followups for the filtered period
        return app.models.followUp
          .find(
            app.utils.remote.mergeFilters(
              defaultFilter,
              filter || {}
            )
          );
      })
      .then(function (followups) {
        // filter by relation properties
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);
        // initialize teams map
        let teamsMap = {};
        // initialize helper team to date to contacts map
        let teamDateContactsMap = {};

        followups.forEach(function (followup) {
          // get contactId
          const contactId = followup.personId;

          // get teamId; there might be no team id, set null
          let teamId;
          if (
            followup.teamId &&
            existingTeamsMap[followup.teamId]
          ) {
            teamId = followup.teamId;
          } else {
            teamId = null;
          }

          // get date; format it to UTC 00:00:00
          const date = genericHelpers.getDate(followup.date).toString();

          // initialize team entry if not already initialized
          if (!teamsMap[teamId]) {
            teamsMap[teamId] = {
              id: teamId,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0,
              dates: {}
            };

            teamDateContactsMap[teamId] = {};
          }

          // initialize date entry for the team if not already initialized
          if (!teamsMap[teamId].dates[date]) {
            teamsMap[teamId].dates[date] = {
              date: date,
              totalFollowupsCount: 0,
              successfulFollowupsCount: 0,
              contactIDs: []
            };

            teamDateContactsMap[teamId][date] = {};
          }

          // increase counters
          teamsMap[teamId].dates[date].totalFollowupsCount++;
          teamsMap[teamId].totalFollowupsCount++;

          if (app.models.followUp.isPerformed(followup)) {
            teamsMap[teamId].dates[date].successfulFollowupsCount++;
            teamsMap[teamId].successfulFollowupsCount++;
            result.successfulFollowupsCount++;
          }

          // add contactId to the team/date container if not already added
          if (!teamDateContactsMap[teamId][date][contactId]) {
            // keep flag to not add contact twice for team
            teamDateContactsMap[teamId][date][contactId] = true;
            teamsMap[teamId].dates[date].contactIDs.push(contactId);
          }
        });

        // update results; sending array with teams and contacts information
        result.totalFollowupsCount = followups.length;
        result.teams = _.map(teamsMap, (value) => {
          value.dates = Object.values(value.dates);
          return value;
        });

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
    if (typeof periodType !== 'undefined') {
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
    if (typeof periodInterval !== 'undefined') {
      // periodInterval was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodInterval;
      // normalize periodInterval dates
      periodInterval[0] = genericHelpers.getDate(periodInterval[0]);
      periodInterval[1] = genericHelpers.getDateEndOfDay(periodInterval[1]);
    } else {
      // set default periodInterval depending on periodType
      periodInterval = genericHelpers.getPeriodIntervalForDate(undefined, periodType);
    }

    // initialize includeTotals and includeDeaths flags; default: false
    let includeTotals, includeDeaths;
    // check if the includeTotals filter was sent; accepting it only on the first level
    includeTotals = _.get(filter, 'where.includeTotals');
    if (typeof includeTotals !== 'undefined') {
      // includeTotals was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.includeTotals;
    } else {
      // set default
      includeTotals = false;
    }

    // check if the includeDeaths filter was sent; accepting it only on the first level
    includeDeaths = _.get(filter, 'where.includeDeaths');
    if (typeof includeDeaths !== 'undefined') {
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
            outcomeId: {
              neq: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED'
            }
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
            const casePeriodInterval = genericHelpers.getPeriodIntervalForDate(periodInterval, periodType);

            // create a period identifier
            let casePeriodIdentifier = casePeriodInterval.join(' - ');

            // get index of the case location in the period counters per location array
            let periodLocationIndex = periodMap[casePeriodIdentifier].countersPerLocation.locations.findIndex(location => location.id === caseLocationId);
            // initialize location entry is not already initialized
            if (periodLocationIndex === -1) {
              periodLocationIndex = periodMap[casePeriodIdentifier].countersPerLocation.locations.push(
                Object.assign(
                  {
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
                Object.assign(
                  {
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
            if (item.outcomeId !== 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED') {
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
                Object.assign(
                  {
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
            if (item.outcomeId !== 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED') {
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
   * Merge multiple people of the same type (event/case/contact)
   * @param data List of records ids, to be merged
   * @param options
   * @param callback
   */
  Outbreak.prototype.mergePeople = function (data, options, callback) {
    if (!options) {
      options = {};
    }
    // execute same hooks as for sync (data should already exist)
    options._sync = true;
    // disable visual id validation for record merging
    options._disableVisualIdValidation = true;
    // defensive checks
    data = data || {};
    data.ids = data.ids || [];
    // default model type to case
    data.type = data.type || 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';
    data.model = data.model || {};

    // reference to application models
    const appModels = app.models;

    // friendly person type value
    const modelType = appModels.person.typeToModelMap[data.type];

    const outbreakId = this.id;

    /**
     * Helper function used to retrieve relations for a given case
     * @param personId
     */
    const _findRelations = function (personId) {
      return app.models.relationship.find({
        where: {
          'persons.id': personId
        }
      });
    };

    /**
     * Helper function used to delete model props like id, createdAt...
     * @param clone
     * @private
     */
    const _removeCloneProps = function (clone) {
      clone = clone || {};

      delete clone.id;

      delete clone.createdAt;
      delete clone.createdBy;

      delete clone.updatedAt;
      delete clone.updatedBy;

      delete clone.deletedAt;

      return clone;
    };

    // reference to the model type we should work upon (case/contact)
    const targetModel = appModels[modelType];

    // include follow-up/lab results, based on the person type
    let includes = [];
    if (modelType === appModels.case.modelName) {
      includes.push('labResults');
    }
    if (modelType === appModels.contact.modelName) {
      includes.push('followUps');
    }

    targetModel
      .find({
        where: {
          id: {
            inq: data.ids
          }
        },
        include: includes
      })
      // retrieve relations of each model
      .then((models) => Promise.all(
        models.map((model) => {
          return _findRelations(model.id)
            .then((relations) => {
              model.relationships = relations;
              return model;
            });
        }))
      )
      .then((models) => {
        // generate a unique id for the new instance to be created
        let winnerId = Uuid.v4();

        // make sure the number of follow ups in a single day do not exceed the limit configured on outbreak
        let outbreakLimitPerDay = this.frequencyOfFollowUpPerDay;

        // better name for merge candidates ids
        let modelsIds = data.ids;

        // skip relations between merge candidates
        let relationsToAdd = [];
        models.forEach((model) => {
          model.relationships.forEach((relation) => {
            let people = relation.persons;

            let firstMember = modelsIds.indexOf(people[0].id);
            let secondMember = modelsIds.indexOf(people[1].id);

            // if there is a relation between 2 merge candidates, skip it
            if (firstMember !== -1 && secondMember !== -1) {
              return;
            }

            // otherwise try check which of the candidates is from the merging list and replace it with winner's id
            firstMember = firstMember === -1 ? people[0].id : winnerId;
            secondMember = secondMember === -1 ? people[1].id : winnerId;

            // create a copy of the relationship data
            // alter participants and remove its id (auto generated)
            let clone = relation.toJSON();
            clone.persons = [
              {
                id: firstMember,
                type: firstMember === winnerId ? data.type : people[0].type,
                source: people[0].source,
                target: people[0].target
              },
              {
                id: secondMember,
                type: secondMember === winnerId ? data.type : people[1].type,
                source: people[1].source,
                target: people[1].target
              }
            ];

            // filter relations that might be duplicated
            // like 2 merge candidates that have a relation with an external entity
            let resultSourceEntity = clone.persons.find((person) => person.source);
            let resultTargetEntity = clone.persons.find((person) => person.target);
            let existingRelation = relationsToAdd.find((relation) => {
              // check if source/target entities are the same
              // if so, this is a duplicate
              let sourceEntity = relation.persons.find((person) => person.source);
              let targetEntity = relation.persons.find((person) => person.target);
              return (resultSourceEntity && resultTargetEntity && sourceEntity && targetEntity) &&
                (resultSourceEntity.id === sourceEntity.id) &&
                (resultTargetEntity.id === targetEntity.id);
            });

            if (!existingRelation) {
              clone = _removeCloneProps(clone);

              relationsToAdd.push(clone);
            }
          });
        });

        // collect follow ups from all the contacts
        // reset date to the start of the day
        // group them by day, and sorted by creation date
        // make sure limit per day is not exceeded for upcoming follow ups
        let followUpsToAdd = [];
        // store today date references, needed when checking for future follow ups
        let today = genericHelpers.getDate();
        if (modelType === appModels.contact.modelName) {
          let allFollowUps = [];
          models.forEach((model) => {
            let modelFollowUs = model.followUps();
            if (modelFollowUs.length) {
              // reset follow up day to the start of the day
              // change person id to point to winner model
              let followUps = modelFollowUs.map((followUp) => {
                followUp.date = genericHelpers.getDate(followUp.date).toDate().toISOString();
                return followUp;
              });

              allFollowUps = allFollowUps.concat(followUps);
            }
          });

          // group them by day
          let groupedFollowUps = _.groupBy(allFollowUps, (f) => f.date);

          // sort each group of follow ups by creation date
          // if group is in the future, remove from the end until the limit per day is ok
          for (let group in groupedFollowUps) {
            if (groupedFollowUps.hasOwnProperty(group)) {
              if (genericHelpers.getDate(group).isAfter(today)) {
                groupedFollowUps[group] = groupedFollowUps[group].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                let lengthDiff = groupedFollowUps[group].length - outbreakLimitPerDay;
                if (lengthDiff > 0) {
                  for (let i = 0; i < lengthDiff; i++) {
                    groupedFollowUps[group].pop();
                  }
                }
              }

              followUpsToAdd = followUpsToAdd.concat(groupedFollowUps[group].map((f) => {
                // create a copy of the follow up
                // remove not needed properties
                let clone = f.toJSON();

                // alter person id
                clone.personId = winnerId;

                clone = _removeCloneProps(clone);

                return clone;
              }));
            }
          }
        }

        // for cases update each lab result person id reference to the winning model
        let labResultsToAdd = [];
        if (modelType === appModels.case.modelName) {
          models.forEach((model) => {
            if (model.labResults().length) {
              labResultsToAdd = labResultsToAdd.concat(model.labResults().map((labResult) => {
                // create a copy of the lab results
                // remove not needed properties
                let clone = labResult.toJSON();

                // alter person id
                clone.personId = winnerId;

                clone = _removeCloneProps(clone);
                return clone;
              }));
            }
          });
        }

        // attach generated own and outbreak ids to the model
        data.model = Object.assign({}, data.model, {id: winnerId, outbreakId: outbreakId});

        // make changes into database
        Promise
        // delete all the merge candidates
          .all(modelsIds.map((id) => targetModel.destroyById(id, options)))
          // create a new model containing the result properties
          .then(() => targetModel.create(data.model, options))
          .then(() => Promise.all([
            // relations
            Promise.all(relationsToAdd.map((relation) => appModels.relationship.create(relation, options))),
            // lab results
            Promise.all(labResultsToAdd.map((labResult) => appModels.labResult.create(labResult, options))),
            // follow ups
            Promise.all(followUpsToAdd.map((followUp) => appModels.followUp.create(followUp, options)))
          ]))
          .then(() => targetModel.findById(winnerId).then((winnerModel) => callback(null, winnerModel)))
          .catch((err) => {
            // make sure the newly created instance is deleted
            targetModel
              .findById(winnerId)
              .then((instance) => {
                if (instance) {
                  return instance.destroy(options);
                }
              })
              // restore deleted instances
              .then(() => Promise
                .all(models.map((model) => model.undoDelete(options)))
                .then(() => callback(err)));
          });
      });
  };

  /**
   * List the latest follow-ups for contacts if were not performed
   * The request doesn't return a missed follow-up if there is a new one for the same contact that was performed
   * @param context
   * @param filter
   * @param callback
   */
  Outbreak.prototype.listLatestFollowUpsForContactsIfNotPerformed = function (filter, context, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // remove native pagination params, doing it manually
    searchByRelationProperty.deletePaginationFilterFromContext(context.remotingContext);

    // get all the followups for the filtered period
    app.models.followUp
      .find(app.utils.remote
        .mergeFilters({
          where: {
            outbreakId: outbreakId
          },
          fields: ['id', 'personId', 'statusId'],
          // order by date as we need to check the follow-ups from the oldest to the most recent
          order: 'date ASC'
        }, filter || {}))
      .then(function (followups) {
        // add support for filter parent
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);

        // initialize contacts map as the request needs to return the latest follow-up for the contact if not performed
        let contactsMap = {};

        followups.forEach(function (followup) {
          // get contactId
          let contactId = followup.personId;

          // add in the contacts map the follow-up ID if it was not performed
          if (followup.statusId === 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED' &&
            !contactsMap[followup.personId]) {
            contactsMap[contactId] = followup.id;
          }
        });

        // add any manual pagination filter, if required
        filter = filter || {};
        filter.skip = _.get(filter, '_deep.skip', 0);
        filter.limit = _.get(filter, '_deep.limit');

        // do a second search in order to preserve requested order in the filters
        return app.models.followUp
          .find(app.utils.remote
            .mergeFilters({
              where: {
                id: {
                  inq: Object.values(contactsMap)
                },
                outbreakId: outbreakId,
              },
            }, filter))
          .then(function (followUps) {
            // send response
            callback(null, followUps);
          });
      })
      .catch(callback);
  };

  /**
   * Count the latest follow-ups for contacts if were not performed
   * The request doesn't count a missed follow-up if there is a new one for the same contact that was performed
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountLatestFollowUpsForContactsIfNotPerformed = function (filter, callback) {
    this.listLatestFollowUpsForContactsIfNotPerformed(filter, {}, function (err, res) {
      if (err) {
        return callback(err);
      }
      callback(null, res.length);
    });
  };

  /**
   * Convert any date attribute that is string to 'Date' instance
   * Needed because mongodb doesn't always filter as expected when date is string
   */
  Outbreak.beforeRemote('**', function (context, modelInstance, next) {
    if (context.args.filter) {
      genericHelpers.convertPropsToDate(context.args.filter);
      genericHelpers.includeSubLocationsInLocationFilter(app, context.args.filter, next);
    } else {
      return next();
    }
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
    app.models.person.rawFind(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          // getting only the cases and contacts as there are no inconsistencies to check for events
          or: [{
            // for case: compare against dob
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
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
            // for case: compare dateOfInfection, dateOfOnset, dateBecomeCase, dateOfOutcome
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
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
            // for case: compare dateRanges startDate/endDate for each item in them and against the date of birth
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
            $where: `function () {
              // initialize check result
              var inconsistencyInKeyDates = false;
              // get date of birth
              var dob = this.dob;

              // loop through the dateRanges and make comparisons
              var datesContainers = ['dateRanges'];
              for (var i = 0; i < datesContainers.length; i++) {
                // check if the datesContainer exists on the model
                var datesContainer = datesContainers[i];
                if (this[datesContainer] && this[datesContainer].length) {
                  // loop through the dates; comparison stops at first successful check
                  for (var j = 0; j < this[datesContainer].length; j++) {
                    var dateEntry = this[datesContainer][j];

                    // make sure we have both dates when we compare them
                    if (dateEntry.startDate && dateEntry.endDate) {
                      // compare startDate with endDate
                      inconsistencyInKeyDates = dateEntry.startDate > dateEntry.endDate ? true : false;
                    }

                    // check for dob; both startDate and endDate must be after dob
                    if (!inconsistencyInKeyDates && dob) {
                      if (dateEntry.startDate) {
                        inconsistencyInKeyDates = dateEntry.startDate < dob ? true : false;
                      }
                      if (dateEntry.endDate) {
                        inconsistencyInKeyDates = inconsistencyInKeyDates || (dateEntry.endDate < dob ? true : false);
                      }
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
      }, filter || {}).where)
      .then(function (people) {
        // get case fields label map
        let caseFieldsLabelMap = app.models.case.fieldLabelsMap;

        // initialize map of possible inconsistencies operators
        let inconsistenciesOperators = {
          greaterThan: '>',
          lessThan: '<'
        };

        // loop through the people to add the inconsistencies array
        people.forEach(function (person, index) {
          // initialize inconsistencies
          let inconsistencies = [];

          // get dob since it is used in the majority of comparisons
          let dob = person.dob ? moment(person.dob) : null;
          // also get the other dates
          let dateOfInfection = person.dateOfInfection ? moment(person.dateOfInfection) : null;
          let dateOfOnset = person.dateOfOnset ? moment(person.dateOfOnset) : null;
          let dateBecomeCase = person.dateBecomeCase ? moment(person.dateBecomeCase) : null;
          let dateOfOutcome = person.dateOfOutcome ? moment(person.dateOfOutcome) : null;

          // for case:
          if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE') {
            // compare against dob
            if (dob) {
              // dateOfInfection < date of birth
              if (dateOfInfection && dob.isAfter(dateOfInfection)) {
                inconsistencies.push({
                  dates: [{
                    field: 'dob',
                    label: caseFieldsLabelMap.dob
                  }, {
                    field: 'dateOfInfection',
                    label: caseFieldsLabelMap.dateOfInfection
                  }],
                  issue: inconsistenciesOperators.greaterThan
                });
              }

              // dateOfOnset < date of birth
              if (dateOfOnset && dob.isAfter(dateOfOnset)) {
                inconsistencies.push({
                  dates: [{
                    field: 'dob',
                    label: caseFieldsLabelMap.dob
                  }, {
                    field: 'dateOfOnset',
                    label: caseFieldsLabelMap.dateOfOnset
                  }],
                  issue: inconsistenciesOperators.greaterThan
                });
              }

              // dateBecomeCase < date of birth
              if (dateBecomeCase && dob.isAfter(dateBecomeCase)) {
                inconsistencies.push({
                  dates: [{
                    field: 'dob',
                    label: caseFieldsLabelMap.dob
                  }, {
                    field: 'dateBecomeCase',
                    label: caseFieldsLabelMap.dateBecomeCase
                  }],
                  issue: inconsistenciesOperators.greaterThan
                });
              }

              // dateOfOutcome < date of birth
              if (dateOfOutcome && dob.isAfter(dateOfOutcome)) {
                inconsistencies.push({
                  dates: [{
                    field: 'dob',
                    label: caseFieldsLabelMap.dob
                  }, {
                    field: 'dateOfOutcome',
                    label: caseFieldsLabelMap.dateOfOutcome
                  }],
                  issue: inconsistenciesOperators.greaterThan
                });
              }
            }

            // compare dateOfInfection, dateOfOnset, dateBecomeCase, dateOfOutcome
            // dateOfInfection > dateOfOnset
            if (dateOfInfection && dateOfOnset && dateOfInfection.isAfter(dateOfOnset)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfInfection',
                  label: caseFieldsLabelMap.dateOfInfection
                }, {
                  field: 'dateOfOnset',
                  label: caseFieldsLabelMap.dateOfOnset
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateOfInfection > dateBecomeCase
            if (dateOfInfection && dateBecomeCase && dateOfInfection.isAfter(dateBecomeCase)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfInfection',
                  label: caseFieldsLabelMap.dateOfInfection
                }, {
                  field: 'dateBecomeCase',
                  label: caseFieldsLabelMap.dateBecomeCase
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateOfInfection > dateOfOutcome
            if (dateOfInfection && dateOfOutcome && dateOfInfection.isAfter(dateOfOutcome)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfInfection',
                  label: caseFieldsLabelMap.dateOfInfection
                }, {
                  field: 'dateOfOutcome',
                  label: caseFieldsLabelMap.dateOfOutcome
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateOfOnset > dateBecomeCase
            if (dateOfOnset && dateBecomeCase && dateOfOnset.isAfter(dateBecomeCase)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfOnset',
                  label: caseFieldsLabelMap.dateOfOnset
                }, {
                  field: 'dateBecomeCase',
                  label: caseFieldsLabelMap.dateBecomeCase
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateOfOnset > dateOfOutcome
            if (dateOfOnset && dateOfOutcome && dateOfOnset.isAfter(dateOfOutcome)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateOfOnset',
                  label: caseFieldsLabelMap.dateOfOnset
                }, {
                  field: 'dateOfOutcome',
                  label: caseFieldsLabelMap.dateOfOutcome
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // dateBecomeCase > dateOfOutcome
            if (dateBecomeCase && dateOfOutcome && dateBecomeCase.isAfter(dateOfOutcome)) {
              inconsistencies.push({
                dates: [{
                  field: 'dateBecomeCase',
                  label: caseFieldsLabelMap.dateBecomeCase
                }, {
                  field: 'dateOfOutcome',
                  label: caseFieldsLabelMap.dateOfOutcome
                }],
                issue: inconsistenciesOperators.greaterThan
              });
            }

            // compare dateRanges startDate/endDate for each item in them and against the date of birth
            // loop through the dateRanges and make comparisons
            var datesContainers = ['dateRanges'];
            datesContainers.forEach(function (datesContainer) {
              if (person[datesContainer] && person[datesContainer].length) {
                // loop through the dates to find inconsistencies
                person[datesContainer].forEach(function (dateEntry, dateEntryIndex) {
                  // get startDate and endDate
                  let startDate = dateEntry.startDate ? moment(dateEntry.startDate) : null;
                  let endDate = dateEntry.endDate ? moment(dateEntry.endDate) : null;

                  // compare startDate with endDate
                  if (
                    startDate &&
                    endDate &&
                    startDate.isAfter(endDate)
                  ) {
                    inconsistencies.push({
                      dates: [{
                        field: `${datesContainer}.${dateEntryIndex}.startDate`,
                        label: caseFieldsLabelMap[`${datesContainer}[].startDate`],
                        dateRangeType: dateEntry.typeId
                      }, {
                        field: `${datesContainer}.${dateEntryIndex}.endDate`,
                        label: caseFieldsLabelMap[`${datesContainer}[].endDate`],
                        dateRangeType: dateEntry.typeId
                      }],
                      issue: inconsistenciesOperators.greaterThan
                    });
                  }

                  // check for dob; both startDate and endDate must be after dob
                  if (dob) {
                    if (
                      startDate &&
                      dob.isAfter(startDate)
                    ) {
                      inconsistencies.push({
                        dates: [{
                          field: 'dob',
                          label: caseFieldsLabelMap.dob
                        }, {
                          field: `${datesContainer}.${dateEntryIndex}.startDate`,
                          label: caseFieldsLabelMap[`${datesContainer}[].startDate`],
                          dateRangeType: dateEntry.typeId
                        }],
                        issue: inconsistenciesOperators.greaterThan
                      });
                    }

                    if (
                      endDate &&
                      dob.isAfter(endDate)
                    ) {
                      inconsistencies.push({
                        dates: [{
                          field: 'dob',
                          label: caseFieldsLabelMap.dob
                        }, {
                          field: `${datesContainer}.${dateEntryIndex}.endDate`,
                          label: caseFieldsLabelMap[`${datesContainer}[].endDate`],
                          dateRangeType: dateEntry.typeId
                        }],
                        issue: inconsistenciesOperators.greaterThan
                      });
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
    // inject platform identifier
    options.platform = Platform.IMPORT;

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
          const labResultsList = app.utils.helpers.convertBooleanProperties(
            app.models.labResult,
            app.utils.helpers.remapProperties(rawlabResultsList, body.map, body.valuesMap));
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
              // sanitize questionnaire answers
              // convert to new format if necessary
              if (labResult.questionnaireAnswers) {
                labResult.questionnaireAnswers = genericHelpers.convertQuestionnaireAnswersToNewFormat(labResult.questionnaireAnswers);
              }

              // first check if the case id (person id) is valid
              app.models.case
                .findOne({
                  where: {
                    or: [
                      {id: labResult.personId},
                      {visualId: labResult.personId}
                    ],
                    outbreakId: self.id
                  }
                })
                .then(function (caseInstance) {
                  // if the person was not found, don't sync the lab result, stop with error
                  if (!caseInstance) {
                    throw app.utils.apiError.getError('PERSON_NOT_FOUND', {
                      model: app.models.case.modelName,
                      id: labResult.personId
                    });
                  }

                  // make sure we map it to the parent case in case we retrieved the case using visual id
                  labResult.personId = caseInstance.id;

                  // set outbreakId
                  labResult.outbreakId = self.id;

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
                    recordNo: index + 1,
                    data: {
                      file: rawlabResultsList[index],
                      save: labResult
                    }
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
    // inject platform identifier
    options.platform = Platform.IMPORT;
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
          const casesList = app.utils.helpers.convertBooleanProperties(
            app.models.case,
            app.utils.helpers.remapProperties(rawCasesList, body.map, body.valuesMap));
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

              // filter out empty addresses
              const addresses = app.models.person.sanitizeAddresses(caseData);
              if (addresses) {
                caseData.addresses = addresses;
              }

              // sanitize questionnaire answers
              if (caseData.questionnaireAnswers) {
                // convert properties that should be date to actual date objects
                caseData.questionnaireAnswers = genericHelpers.convertQuestionnairePropsToDate(caseData.questionnaireAnswers);
              }

              // sanitize visual ID
              if (caseData.visualId) {
                caseData.visualId = app.models.person.sanitizeVisualId(caseData.visualId);
              }

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
                    recordNo: index + 1,
                    data: {
                      file: rawCasesList[index],
                      save: caseData
                    }
                  });
                  callback(null, null);
                });
            });
          });
          // start importing cases
          async.series(createCases, function (error, results) {
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
    // inject platform identifier
    options.platform = Platform.IMPORT;
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
              const relationshipData = app.utils.helpers.convertBooleanProperties(
                app.models.relationship,
                app.utils.helpers.extractImportableFields(app.models.relationship, recordData.relationship));

              // extract contact data
              const contactData = app.utils.helpers.convertBooleanProperties(
                app.models.contact,
                app.utils.helpers.extractImportableFields(app.models.contact, recordData));

              // set outbreak ids
              contactData.outbreakId = self.id;
              relationshipData.outbreakId = self.id;

              // filter out empty addresses
              const addresses = app.models.person.sanitizeAddresses(contactData);
              if (addresses) {
                contactData.addresses = addresses;
              }

              // sanitize questionnaire answers
              if (contactData.questionnaireAnswers) {
                // convert properties that should be date to actual date objects
                contactData.questionnaireAnswers = genericHelpers.convertQuestionnairePropsToDate(contactData.questionnaireAnswers);
              }

              // sanitize visual ID
              if (contactData.visualId) {
                contactData.visualId = app.models.person.sanitizeVisualId(contactData.visualId);
              }

              // sync the contact
              return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.contact, contactData, options)
                .then(function (syncResult) {
                  const contactRecord = syncResult.record;
                  // promisify next step
                  return new Promise(function (resolve, reject) {
                    // normalize people
                    Outbreak.helpers.validateAndNormalizePeople(self.id, contactRecord.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', relationshipData, true, function (error) {
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
                      return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.relationship, relationshipData, options)
                        .then(function (syncedRelationship) {
                          // relationship successfully created, move to tne next one
                          callback(null, Object.assign({}, contactRecord.toJSON(), {relationships: [syncedRelationship.record.toJSON()]}));
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
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  createErrors.push({
                    message: `Failed to import contact ${index + 1}`,
                    error: error,
                    recordNo: index + 1,
                    data: {
                      file: rawContactList[index],
                      save: {
                        contact: contactData,
                        relationship: relationshipData
                      }
                    }
                  });
                  callback(null, null);
                });
            });
          });
          // start importing contacts
          async.series(createContacts, function (error, results) {
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
          // log error
          options.remotingContext.req.logger.error(error);
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
   * @param copies
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportCaseInvestigationTemplate = function (copies, options, callback) {
    helpers.printCaseInvestigation(this, pdfUtils, copies, null, options, callback);
  };

  /**
   * Build and return a pdf containing a case's information, relationships and lab results (dossier)
   * @param cases
   * @param anonymousFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.caseDossier = function (cases, anonymousFields, options, callback) {
    // reference shortcuts
    const models = app.models;

    // create a temporary directory to store generated pdfs that are included in the final archive
    const tmpDir = tmp.dirSync({unsafeCleanup: true});
    const tmpDirName = tmpDir.name;

    // current user language
    const languageId = options.remotingContext.req.authData.user.languageId;

    // questionnaires to be included in pdfs
    const labResultsTemplate = this.labResultsTemplate.toJSON();
    const caseInvestigationTemplate = this.caseInvestigationTemplate.toJSON();

    // get all requested cases, including their relationships and lab results
    this.__get__cases({
      where: {
        id: {
          inq: cases
        }
      },
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
          relation: 'labResults'
        }
      ]
    }, (err, results) => {
      if (err) {
        return callback(err);
      }

      const sanitizedCases = [];

      genericHelpers.attachParentLocations(
        app.models.case,
        app.models.location,
        results,
        (err, result) => {
          if (!err) {
            result = result || {};
            results = result.records || results;
          }

          // get the language dictionary
          app.models.language.getLanguageDictionary(languageId, (err, dictionary) => {
            if (err) {
              return callback(err);
            }

            // translate lab results/case investigation questionnaires
            const labResultsQuestionnaire = Outbreak.helpers.parseTemplateQuestions(labResultsTemplate, dictionary);
            const caseInvestigationQuestionnaire = Outbreak.helpers.parseTemplateQuestions(caseInvestigationTemplate, dictionary);

            // transform all DB models into JSONs for better handling
            // we call the variable "person" only because "case" is a javascript reserved word
            results.forEach((person, caseIndex) => {
              results[caseIndex] = person.toJSON();
              // this is needed because loopback doesn't return hidden fields from definition into the toJSON call
              // might be removed later
              results[caseIndex].type = person.type;

              // since relationships is a custom relation, the relationships collection is included differently in the case model,
              // and not converted by the initial toJSON method.
              person.relationships.forEach((relationship, relationshipIndex) => {
                person.relationships[relationshipIndex] = relationship.toJSON();
                person.relationships[relationshipIndex].people.forEach((member, memberIndex) => {
                  person.relationships[relationshipIndex].people[memberIndex] = member.toJSON();
                });
              });
            });

            // replace all foreign keys with readable data
            genericHelpers.resolveModelForeignKeys(app, models.case, results, dictionary)
              .then((results) => {
                // transform the model into a simple JSON
                results.forEach((person, caseIndex) => {
                  // keep the initial data of the case (we currently use it to generate the QR code only)
                  sanitizedCases[caseIndex] = {
                    rawData: person,
                    relationships: [],
                    labResults: []
                  };

                  // anonymize the required fields and prepare the fields for print (currently, that means eliminating undefined values,
                  // and formatting date type fields
                  if (anonymousFields) {
                    app.utils.anonymizeDatasetFields.anonymize(person, anonymousFields);
                  }

                  app.utils.helpers.formatDateFields(person, app.models.person.dossierDateFields);
                  app.utils.helpers.formatUndefinedValues(person);

                  // prepare the case's relationships for printing
                  person.relationships.forEach((relationship, relationshipIndex) => {
                    // extract the person with which the case has a relationship
                    let relationshipMember = _.find(relationship.people, (member) => {
                      return member.id !== person.id;
                    });

                    // if relationship member was not found
                    if (!relationshipMember) {
                      // stop here (invalid relationship)
                      return;
                    }

                    // needed for checks below
                    const relationshipMemberType = relationshipMember.type;
                    const isEvent = relationshipMemberType === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT';

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
                      app.models[models.person.typeToModelMap[relationshipMemberType]],
                      dictionary
                    );

                    relationshipMember = app.utils.helpers.translateFieldLabels(
                      app,
                      relationshipMember,
                      models[models.person.typeToModelMap[relationshipMemberType]].modelName,
                      dictionary
                    );

                    // translate the values of the fields marked as reference data fields on the relationship model
                    app.utils.helpers.translateDataSetReferenceDataValues(relationship, models.relationship, dictionary);

                    // translate all remaining keys of the relationship model
                    relationship = app.utils.helpers.translateFieldLabels(app, relationship, models.relationship.modelName, dictionary);

                    relationship[dictionary.getTranslation('LNG_RELATIONSHIP_PDF_FIELD_LABEL_PERSON')] = relationshipMember;

                    // add the sanitized relationship to the object to be printed
                    sanitizedCases[caseIndex].relationships[relationshipIndex] = relationship;
                  });

                  // prepare the case's lab results and lab results questionnaires for printing
                  person.labResults.forEach((labResult, labIndex) => {
                    // translate the values of the fields marked as reference data fields on the lab result model
                    app.utils.helpers.translateDataSetReferenceDataValues(labResult, models.labResult, dictionary);

                    // clone the questionnaires, as the function below is actually altering them
                    let labResultsQuestions = _.cloneDeep(labResultsQuestionnaire);

                    // convert questionnaire answers to old format, before doing anything
                    let labResultAnswers = labResult.questionnaireAnswers || {};

                    // since we are presenting all the answers, mark the one that was selected, for each question
                    labResultsQuestions = Outbreak.helpers.prepareQuestionsForPrint(labResultAnswers, labResultsQuestions);

                    // translate the remaining fields on the lab result model
                    labResult = app.utils.helpers.translateFieldLabels(app, labResult, models.labResult.modelName, dictionary);

                    // add the questionnaire separately (after field translations) because it will be displayed separately
                    labResult.questionnaire = labResultsQuestions;

                    // add the sanitized lab results to the object to be printed
                    sanitizedCases[caseIndex].labResults[labIndex] = labResult;
                  });

                  // clone the questionnaires, as the function below is actually altering them
                  let caseInvestigationQuestions = _.cloneDeep(caseInvestigationQuestionnaire);

                  // convert questionnaire answers to old format, before doing anything
                  let personAnswers = person.questionnaireAnswers || {};

                  // since we are presenting all the answers, mark the one that was selected, for each question
                  caseInvestigationQuestions = Outbreak.helpers.prepareQuestionsForPrint(personAnswers, caseInvestigationQuestions);

                  // translate all remaining keys
                  person = app.utils.helpers.translateFieldLabels(
                    app,
                    person,
                    models.case.modelName,
                    dictionary,
                    true
                  );

                  // add the questionnaire separately (after field translations) because it will be displayed separately
                  person.questionnaire = caseInvestigationQuestions;

                  // add the sanitized case to the object to be printed
                  sanitizedCases[caseIndex].data = person;
                });

                // translate the pdf section titles
                const caseDetailsTitle = dictionary.getTranslation('LNG_PAGE_TITLE_CASE_DETAILS');
                const caseQuestionnaireTitle = dictionary.getTranslation('LNG_PAGE_TITLE_CASE_QUESTIONNAIRE');
                const relationshipsTitle = dictionary.getTranslation('LNG_PAGE_ACTION_RELATIONSHIPS');
                const labResultsTitle = dictionary.getTranslation('LNG_PAGE_LIST_ENTITY_LAB_RESULTS_TITLE');
                const labResultsQuestionnaireTitle = dictionary.getTranslation('LNG_PAGE_TITLE_LAB_RESULTS_QUESTIONNAIRE');

                let pdfPromises = [];

                // Print all the data
                sanitizedCases.forEach((sanitizedCase) => {
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
                        app.utils.qrCode.addPersonQRCode(doc, sanitizedCase.rawData.outbreakId, 'case', sanitizedCase.rawData);
                      };

                      // add the QR code to the first page (this page has already been added and will not be covered by the next line)
                      addQrCode();

                      // set a listener on pageAdded to add the QR code to every new page
                      doc.on('pageAdded', addQrCode);

                      // remove the questionnaire from case printing model
                      const caseQuestionnaire = sanitizedCase.data.questionnaire;
                      delete sanitizedCase.data.questionnaire;

                      // display case details
                      pdfUtils.displayModelDetails(doc, sanitizedCase.data, true, caseDetailsTitle);

                      // display case investigation questionnaire
                      doc.addPage();
                      pdfUtils.createQuestionnaire(doc, caseQuestionnaire, true, caseQuestionnaireTitle);

                      // display case's relationships
                      pdfUtils.displayPersonRelationships(doc, sanitizedCase.relationships, relationshipsTitle);

                      // display lab results and questionnaires
                      pdfUtils.displayPersonSectionsWithQuestionnaire(doc, sanitizedCase.labResults, labResultsTitle, labResultsQuestionnaireTitle);

                      // add an additional empty page that contains only the QR code as per requirements
                      doc.addPage();

                      // stop adding this QR code. The next contact will need to have a different QR code
                      doc.removeListener('pageAdded', addQrCode);
                      doc.end();

                      // convert pdf stream to buffer and send it as response
                      genericHelpers.streamToBuffer(doc, (err, buffer) => {
                        if (err) {
                          reject(err);
                        } else {
                          const lastName = sanitizedCase.rawData.lastName ? sanitizedCase.rawData.lastName.replace(/\r|\n|\s/g, '').toUpperCase() + ' ' : '';
                          const firstName = sanitizedCase.rawData.firstName ? sanitizedCase.rawData.firstName.replace(/\r|\n|\s/g, '') : '';
                          fs.writeFile(`${tmpDirName}/${lastName}${firstName} - ${sanitizedCase.rawData.id}.pdf`, buffer, (err) => {
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
                let archiveName = `caseDossiers_${moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
                let archivePath = `${tmpDirName}/${archiveName}`;
                let zip = new AdmZip();

                zip.addLocalFolder(tmpDirName);
                zip.writeZip(archivePath);

                fs.readFile(archivePath, (err, data) => {
                  if (err) {
                    callback(err);
                  } else {
                    tmpDir.removeCallback();
                    app.utils.remote.helpers.offerFileToDownload(data, 'application/zip', archiveName, callback);
                  }
                });
              });
          });
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
    // Get all requested contacts, including their relationships and followUps
    this.__get__contacts({
      where: {
        id: {
          inq: contacts
        }
      },
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
        return callback(error);
      }

      const pdfUtils = app.utils.pdfDoc;
      const languageId = options.remotingContext.req.authData.user.languageId;
      let sanitizedContacts = [];

      genericHelpers.attachParentLocations(
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
                    // translate the values of the fields marked as reference data fields on the case/contact/event model
                    app.utils.helpers.translateDataSetReferenceDataValues(
                      relationshipMember,
                      models[models.person.typeToModelMap[relationshipMemberType]],
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
                      models.relationship,
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
                    app.utils.helpers.translateDataSetReferenceDataValues(followUp, app.models.followUp, dictionary);

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
                          const lastName = sanitizedContact.rawData.lastName ? sanitizedContact.rawData.lastName.replace(/\r|\n|\s/g, '').toUpperCase() + ' ' : '';
                          const firstName = sanitizedContact.rawData.firstName ? sanitizedContact.rawData.firstName.replace(/\r|\n|\s/g, '') : '';
                          fs.writeFile(`${tmpDirName}/${lastName}${firstName} - ${sanitizedContact.rawData.id}.pdf`, buffer, (err) => {
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
                let archiveName = `contactDossiers_${moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
                let archivePath = `${tmpDirName}/${archiveName}`;
                let zip = new AdmZip();

                zip.addLocalFolder(tmpDirName);
                zip.writeZip(archivePath);

                fs.readFile(archivePath, (err, data) => {
                  if (err) {
                    callback(err);
                  } else {
                    tmpDir.removeCallback();
                    app.utils.remote.helpers.offerFileToDownload(data, 'application/zip', archiveName, callback);
                  }
                });
              });
          });
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
      dateToFilter = moment(dateToFilter).isValid() ? genericHelpers.getDateEndOfDay(dateToFilter) : genericHelpers.getDateEndOfDay();

      // date was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.date;
    } else {
      // use today as default filter
      dateToFilter = genericHelpers.getDateEndOfDay();
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
          followUpEndDate = genericHelpers.getDateEndOfDay(followUpEndDate);
          if (!followUpEndDate.isValid() || followUpEndDate.isSameOrAfter(dateToFilter)) {
            // update contactsUnderFollowUpCount
            locationMap[contactLocationId].contactsUnderFollowUpCount++;
            result.contactsUnderFollowUpCount++;

            // get retrieved follow-up; is the latest that should have been performed
            let followUp = contact.toJSON().followUps[0];
            // check if the follow-up was performed
            if (followUp && app.models.followUp.isPerformed(followUp)) {
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
   * Export filtered contacts follow-ups to PDF
   * PDF Information: List of contacts with follow-ups table
   * @param filter This request also accepts 'includeContactAddress': boolean, 'includeContactPhoneNumber': boolean, 'groupResultsBy': enum ['case', 'location', 'riskLevel'] on the first level in 'where'
   * @param encryptPassword
   * @param anonymizeFields Array containing properties that need to be anonymized
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredContactFollowUps = function (filter, encryptPassword, anonymizeFields, options, callback) {
    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // initialize includeContactAddress and includeContactPhoneNumber filters
    let includeContactAddress, includeContactPhoneNumber;
    // check if the includeContactAddress filter was sent; accepting it only on the first level
    includeContactAddress = _.get(filter, 'where.includeContactAddress', null);
    if (includeContactAddress !== null) {
      // includeContactAddress was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.includeContactAddress;
    } else {
      // use false as default filter
      includeContactAddress = false;
    }

    // check if the includeContactPhoneNumber filter was sent; accepting it only on the first level
    includeContactPhoneNumber = _.get(filter, 'where.includeContactPhoneNumber', null);
    if (includeContactPhoneNumber !== null) {
      // includeContactPhoneNumber was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.includeContactPhoneNumber;
    } else {
      // use false as default filter
      includeContactPhoneNumber = false;
    }

    // initialize groupResultsBy filter
    let groupResultsBy;
    // initialize available options for group by
    let groupByOptions = {
      case: 'case',
      location: 'location',
      riskLevel: 'riskLevel'
    };
    let groupByOptionsLNGTokens = {
      case: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
      location: 'LNG_ADDRESS_FIELD_LABEL_LOCATION',
      riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL'
    };

    groupResultsBy = _.get(filter, 'where.groupResultsBy', null);
    if (groupResultsBy !== null) {
      // groupResultsBy was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.groupResultsBy;
      // check if the group value is accepted else do not group
      groupResultsBy = Object.values(groupByOptions).indexOf(groupResultsBy) !== -1 ? groupResultsBy : null;
    }

    // include follow-ups information for each contact
    filter = app.utils.remote
      .mergeFilters({
        include: [{
          relation: 'followUps',
          scope: {
            filterParent: true,
            order: 'date ASC'
          }
        }]
      }, filter || {});

    // if we need to group by case include also the relationships
    if (groupResultsBy === groupByOptions.case) {
      filter = app.utils.remote
        .mergeFilters({
          include: [{
            relation: 'relationships',
            scope: {
              where: {
                'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
              },
              order: 'contactDate DESC',
              limit: 1,
              // remove the contacts that don't have relationships to cases
              filterParent: true,
              // include the case model
              include: [{
                relation: 'people',
                scope: {
                  where: {
                    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
                  }
                }
              }]
            }
          }]
        }, filter || {});
    }

    let mimeType = 'application/pdf';

    // use get contacts functionality
    this.__get__contacts(filter, function (error, result) {
      if (error) {
        return callback(error);
      }

      // add support for filter parent
      const results = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(result, filter);

      // get logged user information
      const contextUser = app.utils.remote.getUserFromOptions(options);
      // load user language dictionary
      app.models.language.getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
        // handle errors
        if (error) {
          return callback(error);
        }

        // get contact properties to be printed
        let contactProperties = app.models.contact.printFieldsinOrder;
        // check for sent flags
        if (!includeContactAddress) {
          contactProperties.splice(contactProperties.indexOf('addresses'), 1);
        }

        // resolve models foreign keys (locationId in addresses)
        // resolve reference data fields
        genericHelpers.resolveModelForeignKeys(app, app.models.contact, results, dictionary, true)
          .then(function (contactsList) {
            // group results if needed; Doing this after getting the dictionary as some group identifiers require translations
            // initialize map of group identifiers values
            let groupIdentifiersValues = {};
            // initialize grouped results
            let groupedResults = {};

            // get usual place of residence translation as we will use it further
            let usualPlaceOfResidence = dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');

            // anonymize fields
            if (anonymizeFields.length) {
              // anonymize them
              app.utils.anonymizeDatasetFields.anonymize(contactsList, anonymizeFields);
            }

            // loop through the results and get the properties that will be exported;
            // also group the contacts if needed
            contactsList.forEach(function (contact) {
              genericHelpers.parseModelFieldValues(contact, app.models.contact);

              // create contact representation to be printed
              contact.toPrint = {};
              // set empty string for null/undefined values
              contactProperties.forEach(prop => contact.toPrint[prop] = typeof contact[prop] !== 'undefined' && contact[prop] !== null ? contact[prop] : '');

              // if we should include phone number, just take it from the current address
              if (includeContactPhoneNumber) {
                const currentAddress = contact.addresses.find(addr => addr.typeId === usualPlaceOfResidence);
                if (currentAddress) {
                  contact.phoneNumber = typeof currentAddress.phoneNumber !== 'undefined'
                  && currentAddress.phoneNumber !== null ? currentAddress.phoneNumber : '';
                }
              }

              // if addresses need to be added keep only the residence
              // Note: the typeId was already translated so need to check against the translated value
              if (includeContactAddress) {
                contact.toPrint.addresses = [contact.toPrint.addresses.find(address => address.typeId === usualPlaceOfResidence)];
              }

              // translate labels
              contact.toPrint = genericHelpers.translateFieldLabels(app, contact.toPrint, app.models.contact.modelName, dictionary);

              if (includeContactPhoneNumber) {
                // phone number should be translated from addresses
                contact.toPrint[dictionary.getTranslation(app.models.address.fieldLabelsMap.phoneNumber)] = contact.phoneNumber;
              }

              // check if the results need to be grouped
              if (groupResultsBy) {
                // get identifier for grouping
                let groupIdentifier, caseItem, residenceLocation;
                switch (groupResultsBy) {
                  case groupByOptions.case:
                    // get case entry in the contact relationship
                    caseItem = contact.relationships[0].persons.find(person => person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE');
                    groupIdentifier = caseItem.id;

                    // get identifier value only if the value was not previously calculated for another contact
                    if (!groupIdentifiersValues[groupIdentifier]) {
                      let caseModel = contact.relationships[0].people[0];
                      groupIdentifiersValues[groupIdentifier] = app.models.person.getDisplayName(caseModel);
                    }
                    break;
                  case groupByOptions.location:
                    // get contact residence location
                    contact.addresses = contact.addresses || [];
                    residenceLocation = contact.addresses.find(address => address.typeId === usualPlaceOfResidence);
                    groupIdentifier = residenceLocation ? residenceLocation.locationId : null;

                    // get identifier value only if the value was not previously calculated for another contact
                    if (!groupIdentifiersValues[groupIdentifier]) {
                      // for locationId the location name was already retrieved
                      groupIdentifiersValues[groupIdentifier] = groupIdentifier;
                    }
                    break;
                  case groupByOptions.riskLevel:
                    groupIdentifier = contact.riskLevel;

                    // get identifier value only if the value was not previously calculated for another contact
                    if (!groupIdentifiersValues[groupIdentifier]) {
                      // for risk level get reference data translation
                      groupIdentifiersValues[groupIdentifier] = dictionary.getTranslation(groupIdentifier);
                    }
                    break;
                }

                // intialize group entry in results if not already initialized
                if (!groupedResults[groupIdentifier]) {
                  groupedResults[groupIdentifier] = [];
                }

                // add contact in group
                groupedResults[groupIdentifier].push(contact);
              }
            });

            // initialize list of follow-up properties to be shown in table
            let followUpProperties = ['date', 'performed'];
            // define a list of follow-up table headers
            let followUpsHeaders = [];
            // headers come from follow-up models;
            followUpProperties.forEach(function (propertyName) {
              followUpsHeaders.push({
                id: propertyName,
                // use correct label translation for user language
                header: dictionary.getTranslation(app.models.followUp.fieldLabelsMap[propertyName])
              });
            });

            // generate pdf document
            let doc = pdfUtils.createPdfDoc();
            pdfUtils.addTitle(doc, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_WITH_FOLLOWUPS_DETAILS'));

            // add information to the doc
            if (groupResultsBy) {
              // add title for the group
              Object.keys(groupedResults).forEach(function (groupIdentifier) {
                pdfUtils.addTitle(doc, `${dictionary.getTranslation('LNG_PAGE_CONTACT_WITH_FOLLOWUPS_GROUP_TITLE')} ${dictionary.getTranslation(groupByOptionsLNGTokens[groupResultsBy])}: ${groupIdentifiersValues[groupIdentifier]}`, 18);

                // print contacts
                groupedResults[groupIdentifier].forEach(function (contact, index) {
                  // print profile
                  pdfUtils.displayModelDetails(doc, contact.toPrint, true, `${index + 1}. ${app.models.person.getDisplayName(contact)}`);

                  // print follow-ups table
                  pdfUtils.addTitle(doc, dictionary.getTranslation('LNG_PAGE_CONTACT_WITH_FOLLOWUPS_FOLLOWUPS_TITLE'), 16);
                  pdfUtils.createTableInPDFDocument(followUpsHeaders, contact.followUps, doc);
                });
              });
            } else {
              // print contacts
              contactsList.forEach(function (contact, index) {
                // print profile
                pdfUtils.displayModelDetails(doc, contact.toPrint, true, `${index + 1}. ${app.models.person.getDisplayName(contact)}`);

                // print follow-ups table
                pdfUtils.addTitle(doc, dictionary.getTranslation('LNG_PAGE_CONTACT_WITH_FOLLOWUPS_FOLLOWUPS_TITLE'), 16);
                pdfUtils.createTableInPDFDocument(followUpsHeaders, contact.followUps, doc);
              });
            }

            return new Promise(function (resolve, reject) {
              // convert document stream to buffer
              genericHelpers.streamToBuffer(doc, function (error, file) {
                if (error) {
                  reject(error);
                } else {
                  // encrypt the file if needed
                  if (encryptPassword) {
                    app.utils.aesCrypto.encrypt(encryptPassword, file)
                      .then(function (data) {
                        resolve(data);
                      });
                  } else {
                    resolve(file);
                  }
                }
              });

              // finalize document
              doc.end();
            });
          })
          .then(function (file) {
            // and offer it for download
            app.utils.remote.helpers.offerFileToDownload(file, mimeType, 'Contact Line List.pdf', callback);
          })
          .catch(callback);
      });
    });
  };

  /**
   * Find the list of people in a cluster
   * @param clusterId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findPeopleInCluster = function (clusterId, filter, callback) {
    // find people in a cluster
    Outbreak.prototype.findOrCountPeopleInCluster(clusterId, filter, false, callback);
  };

  /**
   * Count the people in a cluster
   * @param clusterId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countPeopleInCluster = function (clusterId, filter, callback) {
    // count people in cluster
    Outbreak.prototype.findOrCountPeopleInCluster(clusterId, filter, true, callback);
  };

  /**
   * Since this endpoint returns person data without checking if the user has the required read permissions,
   * check the user's permissions and return only the fields he has access to
   */
  Outbreak.afterRemote('prototype.findPeopleInCluster', function (context, people, next) {
    const personTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    people.forEach((person, index) => {
      person = person.toJSON();
      Outbreak.helpers.limitPersonInformation(person, personTypesWithReadAccess);
      people[index] = person;
    });
    next();
  });

  /**
   * Since this endpoint returns person data without checking if the user has the required read permissions,
   * check the user's permissions and return only the fields he has access to
   */
  Outbreak.afterRemote('prototype.__get__people', function (context, people, next) {
    const personTypesWithReadAccess = Outbreak.helpers.getUsersPersonReadPermissions(context);

    people.forEach((person, index) => {
      person = person.toJSON();
      Outbreak.helpers.limitPersonInformation(person, personTypesWithReadAccess);
      people[index] = person;
    });
    next();
  });


  /**
   * Export an empty case investigation for an existing case (has qrCode)
   * @param caseId
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportExistingEmptyCaseInvestigation = function (caseId, options, callback) {
    let self = this;

    this.__findById__cases(caseId, function (error, foundCase) {
      helpers.printCaseInvestigation(self, pdfUtils, 1, foundCase, options, callback);
    });
  };

  /**
   * Find possible person duplicates
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findPossiblePersonDuplicates = function (filter, callback) {
    // define default filter
    if (filter == null) {
      filter = {};
    }
    // get where filter (this needs to be mongoDB compliant where, not loopback, because we're using raw queries)
    let where = filter.where || {};
    // merge-in outbreakId
    where = {
      $and: [{
        outbreakId: this.id
      }, where]
    };
    // find possible person duplicates groups
    app.models.person
      .findOrCountPossibleDuplicates(Object.assign({where: where}, filter))
      .then(function (duplicates) {
        // send back result set
        callback(null, duplicates);
      })
      .catch(callback);
  };

  /**
   *
   * @param where
   * @param callback
   */
  Outbreak.prototype.countPossiblePersonDuplicates = function (where, callback) {
    // get where filter (this needs to be mongoDB compliant where, not loopback, because we're using raw queries)
    where = where || {};
    // merge-in outbreakId
    where = {
      $and: [{
        outbreakId: this.id
      }, where]
    };
    // find possible person duplicates groups
    app.models.person
      .findOrCountPossibleDuplicates({where: where}, true)
      .then(function (duplicatesNo) {
        callback(null, duplicatesNo);
      })
      .catch(callback);
  };

  /**
   * Create multiple contacts for cases
   * @param caseId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createCaseMultipleContacts = function (caseId, data, options, callback) {
    Outbreak.createPersonMultipleContacts(this, app.models.case.modelName, caseId, data, options)
      .then(function (results) {
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Create multiple contacts for events
   * @param eventId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createEventMultipleContacts = function (eventId, data, options, callback) {
    Outbreak.createPersonMultipleContacts(this, app.models.event.modelName, eventId, data, options)
      .then(function (results) {
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Bulk modify contacts
   * @param existingContacts
   * @param callback
   */
  Outbreak.prototype.bulkModifyContacts = function (existingContacts, callback) {
    Outbreak.modifyMultipleContacts(existingContacts)
      .then((results) => callback(null, results))
      .catch(callback);
  };

  /**
   * Restore a deleted outbreak
   * @param outbreakId
   * @param options
   * @param callback
   */
  Outbreak.restoreOutbreak = function (outbreakId, options, callback) {
    Outbreak
      .findOne({
        deleted: true,
        where: {
          id: outbreakId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: Outbreak.modelName, id: outbreakId});
        }

        // undo outbreak delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Find relationship exposures for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findCaseRelationshipExposures = function (caseId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipExposures(this.id, caseId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Count relationship exposures for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countCaseRelationshipExposures = function (caseId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipExposures(this.id, caseId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Find relationship contacts for a case. Relationship contacts are the relationships where the case is a source (it has nothing to do with person type contact)
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findCaseRelationshipContacts = function (caseId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipContacts(this.id, caseId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Count relationship contacts for a case. Relationship contacts are the relationships where the case is a source (it has nothing to do with person type contact)
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countCaseRelationshipContacts = function (caseId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipContacts(this.id, caseId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Find relationship exposures for a contact
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactRelationshipExposures = function (contactId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipExposures(this.id, contactId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Count relationship exposures for a contact
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactRelationshipExposures = function (caseId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipExposures(this.id, caseId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Find relationship contacts for a contact. Relationship contacts are the relationships where the contact is a source (it has nothing to do with person type contact)
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactRelationshipContacts = function (contactId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipContacts(this.id, contactId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Count relationship contacts for a contact. Relationship contacts are the relationships where the contact is a source (it has nothing to do with person type contact)
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactRelationshipContacts = function (contactId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipContacts(this.id, contactId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Find relationship exposures for a contact
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findEventRelationshipExposures = function (eventId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipExposures(this.id, eventId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Count relationship exposures for a contact
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countEventRelationshipExposures = function (eventId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipExposures(this.id, eventId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Find relationship contacts for a event. Relationship contacts are the relationships where the event is a source (it has nothing to do with person type contact)
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findEventRelationshipContacts = function (eventId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipContacts(this.id, eventId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };


  /**
   * Count relationship contacts for a event. Relationship contacts are the relationships where the event is a source (it has nothing to do with person type contact)
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countEventRelationshipContacts = function (eventId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipContacts(this.id, eventId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Count cases stratified by classification over time
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param callback
   */
  Outbreak.prototype.countCasesStratifiedByClassificationOverTime = function (filter, callback) {
    app.models.case.countStratifiedByClassificationOverTime(this, filter)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Create (upload) a new file
   * @param req
   * @param attachmentId
   * @param name
   * @param file
   * @param options
   * @param callback
   */
  Outbreak.prototype.attachmentUpload = function (req, attachmentId, name, file, options, callback) {
    app.models.fileAttachment
      .upload(this.id, req, attachmentId, name, file, options, callback);
  };

  /**
   * Download an attachment
   * @param attachmentId
   * @param callback
   */
  Outbreak.prototype.attachmentDownload = function (attachmentId, callback) {
    // try and find the attachment
    app.models.fileAttachment
      .findOne({
        where: {
          id: attachmentId,
          outbreakId: this.id,
        }
      })
      .then(function (attachment) {
        // if not found, stop with error
        if (!attachment) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.fileAttachment.modelName,
            id: attachmentId
          });
        }
        // download the attachment
        attachment.download(callback);
      })
      .catch(callback);
  };

  /**
   * Bulk create relationships
   * @param sources Source person Ids
   * @param targets Target person Ids
   * @param relationshipData Common relationship data
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkCreateRelationships = function (sources, targets, relationshipData, options, callback) {
    // inject platform identifier
    options.platform = Platform.BULK;

    // bulk create relationships
    app.models.relationship.bulkCreate(this.id, sources, targets, relationshipData, options)
      .then(function (result) {
        // if at least one relationship failed to be created
        if (result.failed.length) {
          // stop with error
          return callback(
            app.utils.apiError.getError('BULK_CREATE_RELATIONSHIP_ERRORS', {
              created: {
                records: result.created,
                count: result.created.length
              },
              failed: {
                errors: result.failed,
                count: result.failed.length
              }
            })
          );
        }
        // everything went fine
        return callback(null, result.created);
      })
      .catch(callback);
  };

  /**
   * Returns a pdf list, containing the outbreak's cases, distributed by location and classification
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.downloadCaseClassificationPerLocationLevelReport = function (filter, options, callback) {
    const self = this;
    const languageId = options.remotingContext.req.authData.user.languageId;
    // Get the dictionary so we can translate the case classifications and other necessary fields
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      app.models.person.getPeoplePerLocation('case', filter, self)
        .then((result) => {
          // Get all existing case classification so we know how many rows the list will have
          return app.models.referenceData
            .find({
              where: {
                categoryId: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION'
              }
            })
            .then(classification => [classification, result]);
        })
        .then((result) => {
          let caseClassifications = result[0];
          let caseDistribution = result[1].peopleDistribution || [];
          const locationCorelationMap = result[1].locationCorelationMap || {};
          let headers = [];
          // Initialize data as an object to easily distribute cases per classification. This will be changed to an array later.
          let data = {};

          // Create the list headers. These contain 2 custom headers (case type and total number of cases),
          // and all the reporting level locations
          headers.push({
            id: 'type',
            header: dictionary.getTranslation('LNG_LIST_HEADER_CASE_CLASSIFICATION')
          });

          caseDistribution.forEach((dataObj) => {
            headers.push({
              id: dataObj.location.id,
              header: dataObj.location.name
            });
          });

          headers.push({
            id: 'total',
            header: dictionary.getTranslation('LNG_LIST_HEADER_TOTAL')
          });

          // Add all existing classifications to the data object
          // Keep the values as strings so that 0 actually gets displayed in the table
          caseClassifications.forEach((caseClassification) => {
            if (!app.models.case.invalidCaseClassificationsForReports.includes(caseClassification.value)) {
              data[caseClassification.value] = {
                type: dictionary.getTranslation(caseClassification.value),
                total: '0'
              };
            }
          });

          // Since deceased is not a classification but is relevant to the report, add it separately
          // Keep the values as strings so that 0 actually gets displayed in the table
          data.deceased = {
            type: dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED'),
            total: '0'
          };

          // Initialize all counts per location with 0 for each case classification (including deceased)
          // Keep the values as strings so that 0 actually gets displayed in the table
          Object.keys(data).forEach((key) => {
            caseDistribution.forEach((dataObj) => {
              data[key][dataObj.location.id] = '0';
            });
          });

          // Go through all the cases and increment the relevant case counts.
          caseDistribution.forEach((dataObj) => {
            dataObj.people.forEach((caseModel) => {
              // get case current address
              const caseCurrentAddress = app.models.person.getCurrentAddress(caseModel);
              // define case latest location
              let caseLatestLocation;
              // if the case has a current address
              if (caseCurrentAddress) {
                // get case current location
                caseLatestLocation = caseCurrentAddress.locationId;
              }
              if (caseModel.outcomeId === 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED') {
                // if the case has a current location and the location is a reporting location
                if (caseLatestLocation) {
                  if (data.deceased[locationCorelationMap[caseLatestLocation]]) {
                    data.deceased[locationCorelationMap[caseLatestLocation]] = (parseInt(data.deceased[locationCorelationMap[caseLatestLocation]]) + 1) + '';
                  }
                } else {
                  // missing location
                  data.deceased[app.models.location.noLocation.id] = (parseInt(data.deceased[app.models.location.noLocation.id]) + 1) + '';
                }

                // total
                data.deceased.total = (parseInt(data.deceased.total) + 1) + '';
              } else if (data[caseModel.classification]) {
                // if the case has a current location and the location is a reporting location
                if (caseLatestLocation) {
                  if (data[caseModel.classification][locationCorelationMap[caseLatestLocation]]) {
                    data[caseModel.classification][locationCorelationMap[caseLatestLocation]] = (parseInt(data[caseModel.classification][locationCorelationMap[caseLatestLocation]]) + 1) + '';
                  }
                } else {
                  // missing location
                  data[caseModel.classification][app.models.location.noLocation.id] = (parseInt(data[caseModel.classification][app.models.location.noLocation.id]) + 1) + '';
                }

                // total
                data[caseModel.classification].total = (parseInt(data[caseModel.classification].total) + 1) + '';
              }
            });
          });

          // Create the pdf list file
          return app.utils.helpers.exportListFile(headers, Object.values(data), 'pdf', 'Case distribution per location');
        })
        .then(function (file) {
          // and offer it for download
          app.utils.remote.helpers.offerFileToDownload(file.data, file.mimeType, `Case distribution per location.${file.extension}`, callback);
        })
        .catch(callback);
    });
  };

  /**
   * Return a collection of items that contain a location and the cases that belong to that location.
   * Structure the data so that the response is consistent with other similar requests.
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countCasesPerLocationLevel = function (filter, callback) {
    // define additional filter to exclude cases of no interest
    const additionalFilter = {
      where: {
        classification: {
          nin: app.models.case.discardedCaseClassifications
        }
      }
    };

    // Merge the additional filter with the filter provided by the user
    const _filter = app.utils.remote.mergeFilters(additionalFilter, filter || {});

    // count people per location
    app.models.person.getPeoplePerLocation('case', _filter, this)
      .then((result) => {
        let response = {locations: []};
        let allCasesCount = 0;
        result.peopleDistribution.forEach((dataSet) => {
          // ignore no location records
          if (dataSet.location.id === app.models.location.noLocation.id) {
            return;
          }

          // set data
          dataSet.casesCount = dataSet.people.length;
          allCasesCount += dataSet.people.length;
          dataSet.caseIds = dataSet.people.map(caseModel => caseModel.id);
          delete dataSet.people;
          response.locations.push(dataSet);
        });
        response.count = allCasesCount;
        callback(null, response);
      })
      .catch(callback);
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
      filter.dateOfFollowUp = new Date();
    }

    // got dateOfFollowUp in where as it should be and not under filter ?
    if (filter.where.dateOfFollowUp) {
      filter.dateOfFollowUp = filter.where.dateOfFollowUp;
      delete filter.where.dateOfFollowUp;
    }

    // Get the date of the selected day for report to add to the pdf title (by default, current day)
    let selectedDayForReport = moment(filter.dateOfFollowUp).format('ll');

    // Get the dictionary so we can translate the case classifications and other neccessary fields
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      app.models.person.getPeoplePerLocation('contact', filter, self)
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
              expectedRelease: dataObj.people.length && dataObj.people[0].followUp ? moment(dataObj.people[0].followUp.endDate).format('ll') : '-'
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
   * Return a collection of items that contain a location and the contacts that belong to that location.
   * Structure the data so that the response is consistent with other similar requests.
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsPerLocationLevel = function (filter, callback) {
    app.models.person.getPeoplePerLocation('contact', filter, this)
      .then((result) => {
        let response = {locations: []};
        let allContactsCount = 0;
        result.peopleDistribution.forEach((dataSet) => {
          dataSet.contactsCount = dataSet.people.length;
          allContactsCount += dataSet.people.length;
          dataSet.contactIds = dataSet.people.map(contact => contact.id);
          delete dataSet.people;
          response.locations.push(dataSet);
        });
        response.count = allContactsCount;
        callback(null, response);
      })
      .catch(callback);
  };

  /**
   * Get movement for a case
   * Movement: list of addresses that contain geoLocation information, sorted from the oldest to newest based on date.
   * Empty date is treated as the most recent
   * @param caseId
   * @param callback
   */
  Outbreak.prototype.getCaseMovement = function (caseId, callback) {
    app.models.case
      .findOne({
        where: {
          id: caseId,
          outbreakId: this.id
        }
      })
      .then(function (caseRecord) {
        if (!caseRecord) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          });
        }
        return caseRecord.getMovement()
          .then(function (movement) {
            callback(null, movement);
          });
      })
      .catch(callback);
  };

  /**
   * Get movement for a contact
   * Movement: list of addresses that contain geoLocation information, sorted from the oldest to newest based on date.
   * Empty date is treated as the most recent
   * @param contactId
   * @param callback
   */
  Outbreak.prototype.getContactMovement = function (contactId, callback) {
    app.models.contact
      .findOne({
        where: {
          id: contactId,
          outbreakId: this.id
        }
      })
      .then(function (contactRecord) {
        if (!contactRecord) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: contactId
          });
        }
        return contactRecord.getMovement()
          .then(function (movement) {
            callback(null, movement);
          });
      })
      .catch(callback);
  };

  /**
   * Add support for 'identifier' search: Allow searching people based on id, visualId and documents.number
   */
  Outbreak.beforeRemote('prototype.__get__people', function (context, modelInstance, next) {
    // get filter (if any)
    const filter = context.args.filter || {};
    // get identifier query (if any)
    const identifier = _.get(filter, 'where.identifier');
    // if there is an identifier
    if (identifier !== undefined) {
      // remove it from the query
      delete filter.where.identifier;
      // update filter with custom query around identifier
      context.args.filter = app.utils.remote.mergeFilters(
        {
          where: {
            or: [
              {
                id: identifier
              },
              {
                visualId: identifier
              },
              {
                'documents.number': identifier
              }
            ]
          }
        }, filter || {});
    }
    next();
  });

  /**
   * Get a list of entries that show the delay between date of symptom onset and the lab testing for a case
   * @param filter
   * @param callback
   */
  Outbreak.prototype.caseDelayBetweenOnsetAndLabTesting = function (filter, callback) {
    app.models.case
      .delayBetweenOnsetAndLabTesting(this.id, filter)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Restore a deleted lab result
   * @param caseId
   * @param labResultId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreCaseLabResult = function (caseId, labResultId, options, callback) {
    app.models.labResult
      .findOne({
        deleted: true,
        where: {
          id: labResultId,
          personId: caseId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError(
            'MODEL_NOT_FOUND',
            {
              model: app.models.labResult.modelName,
              id: labResultId
            }
          );
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };


  /**
   * Export list of contacts that should be seen on a given date
   * Grouped by case/place
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportDailyListOfContacts = function (body, options, callback) {
    // shortcut for safe display a value in the document
    const display = pdfUtils.displayValue;

    // standard date format
    let standardFormat = 'YYYY-MM-DD';

    // get list of questions for contacts from outbreak
    let questions = templateParser.extractVariablesAndAnswerOptions(this.contactFollowUpTemplate);
    questions.forEach(function (question) {
      question.variable = question.name;
    });

    // case id value maps
    // mainly used to know which value should be set into document for each case id
    let caseIdValueMap = {};

    // get list of contacts
    app.models.contact
      .getGroupedByDate(this, body.date, body.groupBy)
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
                    .then((person) => {
                      caseIdValueMap[groupId] = `${display(person.firstName)} ${display(person.middleName)} ${display(person.lastName)}`;
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
              pdfUtils.addTitle(doc, dictionary.getTranslation('LNG_PAGE_TITLE_DAILY_CONTACTS_LIST'));
              doc.moveDown();

              let firstPage = true;

              // build tables for each group item
              for (let groupName in contactGroups) {
                if (contactGroups.hasOwnProperty(groupName)) {

                  // first page is added automatically
                  if (firstPage) {
                    firstPage = false;
                  } else {
                    doc.addPage();
                  }

                  // if contacts are grouped by case search the group name in the configured map
                  // otherwise use group id as title
                  let groupTitle = groupName;
                  if (body.groupBy === 'case') {
                    groupTitle = caseIdValueMap[groupName];
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
                    },
                    {
                      id: 'status',
                      header: dictionary.getTranslation('LNG_FOLLOW_UP_FIELD_LABEL_STATUSID')
                    }
                  ];

                  // additional tables for questionnaire
                  let additionalTables = [];
                  // allow only 9 questions to be displayed on the same table with contact information
                  let mainTableMaxQuestionsCount = 9;
                  // flag that indicates if main table questions limit is reached
                  let isMainTableFull = false;
                  // allow only 13 questions per additional table to be displayed
                  let additionalTableMaxCount = 13;
                  // global counter for questions
                  let counter = 1;

                  // helper function used to create new additional table, when limit is reached
                  let insertAdditionalTable = function () {
                    additionalTables.push({
                      headers: [],
                      values: []
                    });
                  };

                  // include contact questions into the table
                  questions.forEach((item) => {
                    if (item.variable) {
                      if (counter <= mainTableMaxQuestionsCount && !isMainTableFull) {
                        headers.push({
                          id: item.variable,
                          header: dictionary.getTranslation(item.text),
                          width: 50
                        });

                        if (counter === mainTableMaxQuestionsCount) {
                          isMainTableFull = true;
                          counter = 1;
                          // continue with next question
                          return false;
                        }
                      }

                      if (counter <= additionalTableMaxCount && isMainTableFull) {
                        if (!additionalTables.length) {
                          insertAdditionalTable();
                        }

                        let lastAdditionalTable = additionalTables[additionalTables.length - 1];
                        lastAdditionalTable.headers.push({
                          id: item.variable,
                          header: dictionary.getTranslation(item.text),
                          width: 60
                        });

                        if (counter === additionalTableMaxCount) {
                          insertAdditionalTable();
                          counter = 1;
                          // continue with next question
                          return false;
                        }
                      }

                      counter++;
                    }
                  });

                  // start building table data
                  let tableData = [];
                  let rowIndex = 0;
                  contactGroups[groupName].forEach((contact) => {
                    contact.followUps.forEach((followUp) => {
                      let row = {
                        contact: `${display(contact.firstName)} ${display(contact.middleName)} ${display(contact.lastName)}`,
                        status: dictionary.getTranslation(followUp.statusId) || '',
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
                        let followUpStartDate = genericHelpers.getDate(contact.followUp.startDate);
                        let followUpEndDate = genericHelpers.getDate(contact.followUp.endDate);

                        row.followUpStartDate = followUpStartDate.format(standardFormat);
                        row.followUpEndDate = followUpEndDate.format(standardFormat);
                      }

                      // if contacts are grouped per location
                      // then use the group name which is location name as place for each contact under the group
                      if (body.groupBy === 'place') {
                        row.place = groupName;
                      } else {
                        row.place = display(contact.locationName);
                      }

                      // get contact's current address
                      let contactAddress = app.models.person.getCurrentAddress(contact);
                      if (contactAddress) {
                        row.city = display(contactAddress.city);
                        row.address = display(contactAddress.addressLine1);
                      }

                      // defensive check
                      let answers = followUp.questionnaireAnswers || {};

                      // build list of questions/answers
                      let questionsAnswers = {};
                      questions.forEach(function (question) {
                        questionsAnswers[question.name] = answers[question.name];
                      });

                      // convert the questionnaire answers to old format
                      questionsAnswers = genericHelpers.convertQuestionnaireAnswersToOldFormat(questionsAnswers);

                      // add questionnaire answers into the table if any
                      for (let questionId in questionsAnswers) {
                        if (questionsAnswers.hasOwnProperty(questionId)) {
                          // filter the question answer through display function
                          // to be sure it will not display unwanted values like undefined/null in the document

                          // if its array all the things commented above for each item in the array
                          // then the result is joined with comma
                          let answer = '';
                          if (Array.isArray(questionsAnswers[questionId])) {
                            answer = questionsAnswers[questionId]
                              .map((q) => display(dictionary.getTranslation(q)))
                              .join();
                          } else {
                            answer = display(dictionary.getTranslation(questionsAnswers[questionId]));
                          }

                          // first check if its in the main table
                          let headerMainTableIndex = headers.findIndex((header) => header.id === questionId);
                          if (headerMainTableIndex >= 0) {
                            row[questionId] = answer;
                            continue;
                          }
                          // try to identify the question in any of the additional tables
                          // using filter to make sure that if the question is repeating itself
                          // the code doesn't break and just supplies the answer to all questions that have the same id
                          // doing this because table library also supports multiple headers with same id
                          let matchingTables = additionalTables.filter((table) => {
                            return table.headers.find((header) => header.id === questionId);
                          });

                          matchingTables.forEach((table) => {
                            table.values[rowIndex] = table.values[rowIndex] || {};
                            table.values[rowIndex][questionId] = answer;
                          });
                        }
                      }

                      tableData.push(row);
                      rowIndex++;
                    });
                  });

                  // insert table into the document
                  pdfUtils.createTableInPDFDocument(headers, tableData, doc, null, true);

                  doc.moveDown(2);

                  additionalTables.forEach((tableDef) => {
                    pdfUtils.createTableInPDFDocument(tableDef.headers, tableDef.values, doc, null, true);
                  });
                }
              }

              // end the document stream
              // to convert it into a buffer
              doc.end();

              // send pdf doc as response
              pdfUtils.downloadPdfDoc(doc, dictionary.getTranslation('LNG_FILE_NAME_DAILY_CONTACTS_LIST'), callback);
            }
          );
      });
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
    let startDate = genericHelpers.getDate(body.startDate);
    let endDate = genericHelpers.getDate(body.endDate);

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
        body.groupBy
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
                      let followUpStartDate = genericHelpers.getDate(contact.followUp.startDate);
                      let followUpEndDate = genericHelpers.getDate(contact.followUp.endDate);

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
                        let rowId = moment(followUp.date).format(standardFormat);
                        row[rowId] = {
                          value: dictionary.getTranslation(followUpStatusMap[followUp.statusId]) || '',
                          isDate: true
                        };
                      });
                    }

                    // move days that don't belong to main table to additional day tables
                    let mainTableDateHeaders = headers.filter((header) => header.hasOwnProperty('isDate'));
                    let lastDayInMainTable = genericHelpers.convertToDate(mainTableDateHeaders[mainTableDateHeaders.length - 1].id);

                    // get all date values from row, keep only until last day in the table
                    // rest split among additional tables
                    for (let prop in row) {
                      if (row.hasOwnProperty(prop) && row[prop].isDate) {
                        let parsedDate = genericHelpers.convertToDate(prop);
                        if (parsedDate.isAfter(lastDayInMainTable)) {
                          // find the suitable additional table
                          let suitableAdditionalTable = additionalTables.filter((tableDef) => {
                            if (tableDef.headers.length) {
                              let lastDay = tableDef.headers[tableDef.headers.length - 1].id;
                              return parsedDate.isSameOrBefore(genericHelpers.convertToDate(lastDay));
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
   * Backwards compatibility for find and filtered count follow-up filters
   * @param context
   * @param modelInstance
   * @param next
   */
  function findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next) {
    // get filter
    const filter = _.get(context, 'args.filter', {});
    // convert filters from old format into the new one
    let query = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);
    // get contact query, if any
    const queryContact = _.get(filter, 'where.contact');
    // if there is no contact query, but there is an older version of the filter
    if (!queryContact && query.contact) {
      // use that old version
      _.set(filter, 'where.contact', query.contact);
    }
    next();
  }

  Outbreak.beforeRemote('prototype.findFollowUps', function (context, modelInstance, next) {
    findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.filteredCountFollowUps', function (context, modelInstance, next) {
    findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.exportFilteredFollowups', function (context, modelInstance, next) {
    findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.exportContactFollowUpListPerDay', function (context, modelInstance, next) {
    findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.countFollowUpsByTeam', function (context, modelInstance, next) {
    findAndFilteredCountFollowUpsBackCompat(context, modelInstance, next);
  });

  /**
   * Find outbreak follow-ups
   * @param filter Supports 'where.contact', 'where.case' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.findFollowUps = function (filter, callback) {
    // pre-filter using related data (case, contact)
    app.models.followUp
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // replace nested geo points filters
        filter.where = app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.followUp,
          filter.where || {},
          true,
          undefined,
          true
        );

        // find follow-ups using filter
        return app.models.followUp.findAggregate(
          filter
        );
      })
      .then(function (followUps) {
        callback(null, followUps);
      })
      .catch(callback);
  };

  /**
   * Count outbreak follow-ups
   * @param filter Supports 'where.contact', 'where.case' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.filteredCountFollowUps = function (filter, callback) {
    // pre-filter using related data (case, contact)
    app.models.followUp
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // replace nested geo points filters
        filter.where = app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.followUp,
          filter.where || {},
          true,
          undefined,
          true
        );

        // count using query
        return app.models.followUp.findAggregate(
          filter,
          true
        );
      })
      .then(function (followUps) {
        callback(null, followUps);
      })
      .catch(callback);
  };

  /**
   * Export a list of follow-ups for a contact
   * @param filter
   * @param exportType
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   * @returns {*}
   */
  Outbreak.prototype.exportFilteredFollowups = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    let self = this;
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

    new Promise((resolve, reject) => {
      // load user language dictionary
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
        // handle errors
        if (error) {
          return reject(error);
        }

        // resolved
        resolve(dictionary);
      });
    })
      .then((dictionary) => {
        return app.models.followUp.preFilterForOutbreak(this, filter)
          .then((filter) => {
            return {
              dictionary: dictionary,
              filter: filter
            };
          });
      })
      .then(function (data) {
        const dictionary = data.dictionary;
        const filter = data.filter;

        // if encrypt password is not valid, remove it
        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        // make sure anonymizeFields is valid
        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        options.questionnaire = self.contactFollowUpTemplate;
        options.dictionary = dictionary;
        options.useQuestionVariable = useQuestionVariable;

        app.utils.remote.helpers.exportFilteredModelsList(
          app,
          app.models.followUp,
          {},
          filter,
          exportType,
          'Follow-Up List',
          encryptPassword,
          anonymizeFields,
          options,
          function (results) {
            return Promise.resolve(results);
          },
          callback
        );
      });
  };

  /**
   * Export a daily contact follow-up form for every contact from a specified date.
   * @param res
   * @param date
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFullContactFollowUpListPerDay = function (res, date, filter, options, callback) {
    filter = filter || {};

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

    const self = this;
    const languageId = options.remotingContext.req.authData.user.languageId;

    // define start date, end date for follow-ups
    let startDate;
    let endDate;
    // set them according to date
    if (date) {
      startDate = genericHelpers.getDate(date);
      endDate = genericHelpers.getDateEndOfDay(date);
    }

    // Filter to get all of the outbreak's contacts that are under follow-up, and all their follow-ups, from the specified date
    let _filter = {
      where: {
        and: [
          {outbreakId: this.id},
          {'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP'}
        ]
      },
      include: {
        relation: 'followUps',
        scope: {
          order: 'date ASC',
          filterParent: true
        }
      }
    };

    // include startDate and endDate
    if (startDate && endDate) {
      _filter.include.scope.where = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      };
    }

    // merge filters
    _filter = app.utils.remote.mergeFilters(_filter, filter);
    // get language dictionary
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      if (error) {
        return cb(error);
      }
      // start the builder
      const dailyFollowUpListBuilder = fork(`${__dirname}../../../components/workers/buildFullDailyFollowUpList`,
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

      /**
       * Process follow-ups in batches (avoid OOM situations)
       * @param skip
       * @param limit
       * @param maxCount
       * @returns {Promise<any | never>}
       */
      function processInBatches(skip, limit, maxCount) {
        // find contacts in batches
        return app.models.contact.rawFind(_filter.where, {
          projection: {
            firstName: 1,
            middleName: 1,
            lastName: 1,
            gender: 1,
            age: 1,
            dateOfLastContact: 1,
            addresses: 1
          },
          skip: skip,
          limit: limit
        })
          .then((contacts) => {
            // build a map of contacts
            const contactsMap = {};
            contacts.forEach(function (contact) {
              contactsMap[contact.id] = contact;
              contact.followUps = [];
            });

            // find followups filters
            let followUpsQuery = app.utils.remote.searchByRelationProperty
              .convertIncludeQueryToFilterQuery(_filter).followUps;

            // build followUps query
            followUpsQuery = {
              and: [
                followUpsQuery,
                {outbreakId: self.id},
                {
                  personId: {
                    inq: Object.keys(contactsMap)
                  }
                }
              ]
            };

            // find followUps that match the query
            return app.models.followUp
              .rawFind(followUpsQuery, {
                projection: {
                  personId: 1,
                  date: 1,
                  statusId: 1,
                  questionnaireAnswers: 1
                }
              })
              .then(function (followUps) {

                // add followUps to the list of contacts
                followUps.forEach(function (followUp) {
                  contactsMap[followUp.personId].followUps.push(followUp);
                });
                // Filter contacts with no follow-ups
                contacts = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(contacts, _filter);

                // build data for the worker thread;
                let _data = [];
                // go through all the contacts
                contacts.forEach((contact, index) => {
                  // build data entry
                  _data[index] = {};
                  // Initiate the data
                  let data = [{
                    description: 'Date'
                  }];

                  // Initiate the headers
                  let headers = [{
                    id: 'description',
                    header: ''
                  }];

                  // add follow-up status row
                  data.push({description: dictionary.getTranslation('LNG_FOLLOW_UP_FIELD_LABEL_STATUSID')});

                  // go through all follow-usp
                  contact.followUps.forEach((followUp, i) => {
                    headers.push({
                      id: 'index' + i,
                      header: followUp.index
                    });
                    // add follow-up date
                    data[0]['index' + i] = moment(followUp.date).format('YYYY-MM-DD');
                    // add follow-up status
                    data[data.length - 1]['index' + i] = dictionary.getTranslation(app.models.followUp.statusAcronymMap[followUp.statusId]);
                  });

                  // Add all questions as rows
                  templateParser.extractVariablesAndAnswerOptions(self.contactFollowUpTemplate).forEach((question) => {
                    data.push({description: dictionary.getTranslation(question.text)});
                    contact.followUps.forEach((followUp, i) => {
                      let questionAnswer = _.get(followUp, `questionnaireAnswers[${question.variable}]`);
                      questionAnswer = genericHelpers.convertQuestionAnswerToOldFormat(questionAnswer);

                      data[data.length - 1]['index' + i] = genericHelpers.translateQuestionAnswers(question, questionAnswer, dictionary);
                    });
                  });

                  // contact current address
                  const currentAddress = app.models.person.getCurrentAddress(contact);

                  // add contact information
                  _data[index].contactInformation = {
                    title: dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_DETAILS'),
                    rows: [
                      app.models.person.getDisplayName(contact),
                      `${dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_GENDER')}: ${pdfUtils.displayValue(dictionary.getTranslation(contact.gender))}`,
                      `${dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_AGE')}: ${_.get(contact, 'age.years')} ${dictionary.getTranslation('LNG_AGE_FIELD_LABEL_YEARS')} ${_.get(contact, 'age.months')} ${dictionary.getTranslation('LNG_AGE_FIELD_LABEL_MONTHS')}`,
                      `${dictionary.getTranslation('LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE')}: ${moment(contact.dateOfLastContact).format('YYYY-MM-DD')}`,
                      `${dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_ADDRESSES')}: ${app.models.address.getHumanReadableAddress(currentAddress)}`,
                      `${dictionary.getTranslation('LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER')}: ${pdfUtils.displayValue(currentAddress ? currentAddress.phoneNumber : null)}`
                    ]
                  };

                  // add legend
                  _data[index].legend = {
                    title: dictionary.getTranslation('LNG_FOLLOW_UP_STATUS_LEGEND'),
                    rows: []
                  };
                  for (let statusId in app.models.followUp.statusAcronymMap) {
                    if (app.models.followUp.statusAcronymMap.hasOwnProperty(statusId)) {
                      _data[index].legend.rows.push(`${dictionary.getTranslation(statusId)} = ${dictionary.getTranslation(app.models.followUp.statusAcronymMap[statusId])}`);
                    }
                  }
                  // add data & headers
                  _data[index].data = data;
                  _data[index].headers = headers;

                });
                // process data using workers
                return new Promise(function (resolve, reject) {
                  // send data to the worker
                  dailyFollowUpListBuilder.send({fn: 'sendData', args: [_data, skip + limit >= maxCount]});

                  // worker communicates via messages, listen to them
                  function listener(args) {
                    // first argument is an error
                    if (args[0]) {
                      // handle it
                      return reject(args[0]);
                    }
                    // if the worker is ready for the next batch
                    if (args[1] && args[1].readyForNextBatch) {
                      // remove current listener
                      dailyFollowUpListBuilder.removeListener('message', listener);
                      // send move to next step
                      return resolve();
                    }
                  }

                  // listen to worker messages
                  dailyFollowUpListBuilder.on('message', listener);
                });
              });
          })
          .then(function () {
            // update skip for the next
            skip += limit;
            // if there is a next batch
            if (skip < maxCount) {
              // process it
              return processInBatches(skip, limit, maxCount);
            }
          });
      }

      // count the contacts that match the query
      return app.models.contact
        .count(_filter.where)
        .then(function (contactsNo) {
          // process contacts in batches
          return processInBatches(0, 100, contactsNo);
        })
        .then(function () {
          // all records processed, inform the worker that is time to finish
          dailyFollowUpListBuilder.send({fn: 'finish', args: []});
        })
        .catch(cb);
    });
  };

  /**
   * Export contact follow-up list for one day
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
        startDate = genericHelpers.getDate(date.startDate);
        endDate = genericHelpers.getDateEndOfDay(date.endDate);

        // determine date condition that will be added when retrieving follow-ups
        dateCondition = {
          date: {
            gte: new Date(startDate),
            lte: new Date(endDate)
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
          return app.models.contact
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
                                name: `${person.firstName || ''} ${person.middleName || ''} ${person.lastName || ''}`.trim(),
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
                        age: pdfUtils.displayAge(record, dictionary),
                        gender: record.gender,
                        location: record.address && record.address.locationId && record.address.locationId !== 'LNG_REPORT_DAILY_FOLLOW_UP_LIST_UNKNOWN_LOCATION' && locationsMap[record.address.locationId] ?
                          locationsMap[record.address.locationId].name :
                          unknownLocationName,
                        address: app.models.address.getHumanReadableAddress(record.address),
                        day: record.index,
                        from: moment(_.get(record, 'contact.followUp.startDate')).format('YYYY-MM-DD'),
                        to: moment(_.get(record, 'contact.followUp.endDate')).format('YYYY-MM-DD'),
                        date: record.date ? moment(record.date).format('YYYY-MM-DD') : undefined,
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
                title: `${dictionary.getTranslation('LNG_REPORT_DAILY_FOLLOW_UP_LIST_TITLE')}: ${contactData ? app.models.person.getDisplayName(contactData) : moment(startDate).format('YYYY-MM-DD')}`,
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
   * Count follow-ups grouped by associated team. Supports 'where.contact', 'where.case' MongoDB compatible queries
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countFollowUpsByTeam = function (filter, callback) {
    const self = this;
    // pre-filter using related data (case, contact)
    app.models.followUp
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // find follow-ups using filter
        return app.models.followUp
          .countByTeam(self.id, filter);
      })
      .then(function (results) {
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Backwards compatibility for find and filtered count lab results filters
   * @param context
   * @param modelInstance
   * @param next
   */
  function findAndFilteredCountLabResultsBackCompat(context, modelInstance, next) {
    // get filter
    const filter = _.get(context, 'args.filter', {});
    // convert filters from old format into the new one
    let query = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);
    // get case query, if any
    const queryCase = _.get(filter, 'where.case');
    // if there is no case query, but there is an older version of the filter
    if (!queryCase && query.case) {
      // use that old version
      _.set(filter, 'where.case', query.case);
    }

    // be backwards compatible
    const personQuery = _.get(filter, 'where.person');
    if (!personQuery && query.person) {
      _.set(filter, 'where.person', query.person);
    }

    next();
  }

  Outbreak.beforeRemote('prototype.findLabResults', function (context, modelInstance, next) {
    findAndFilteredCountLabResultsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.filteredCountLabResults', function (context, modelInstance, next) {
    findAndFilteredCountLabResultsBackCompat(context, modelInstance, next);
  });

  Outbreak.beforeRemote('prototype.findLabResultsAggregate', function (context, modelInstance, next) {
    findAndFilteredCountLabResultsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.filteredCountLabResultsAggregate', function (context, modelInstance, next) {
    findAndFilteredCountLabResultsBackCompat(context, modelInstance, next);
  });

  /**
   * Find outbreak lab results
   * @param filter Supports 'where.case' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.findLabResults = function (filter, callback) {
    // pre-filter using related data (case)
    app.models.labResult
      .preFilterForOutbreak(this, filter)
      .then(filter => {
        if (!this.isContactLabResultsActive) {
          filter.where.personType = {
            neq: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          };
        }
        // find follow-ups using filter
        return app.models.labResult.find(filter);
      })
      .then(function (followUps) {
        callback(null, followUps);
      })
      .catch(callback);
  };

  /**
   * Count outbreak lab-results
   * @param filter Supports 'where.case' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.filteredCountLabResults = function (filter, callback) {
    // pre-filter using related data (case)
    app.models.labResult
      .preFilterForOutbreak(this, filter)
      .then(filter => {
        if (!this.isContactLabResultsActive) {
          filter.where.personType = {
            neq: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          };
        }
        // handle custom filter options
        filter = genericHelpers.attachCustomDeleteFilterOption(filter);

        // count using query
        return app.models.labResult.count(filter.where);
      })
      .then(function (followUps) {
        callback(null, followUps);
      })
      .catch(callback);
  };

  /**
   * Count a case's lab-results
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountCaseLabResults = function (caseId, filter, callback) {
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.personId = caseId;
    filter.where.personType = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';

    app.models.labResult
      .preFilterForOutbreak(this, filter)
      .then(filter => {
        // handle custom filter options
        filter = genericHelpers.attachCustomDeleteFilterOption(filter);
        return app.models.labResult.count(filter.where);
      })
      .then(result => callback(null, result))
      .catch(callback);
  };

  /**
   * Count a contact's lab-results
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountContactLabResults = function (contactId, filter, callback) {
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.personId = contactId;
    filter.where.personType = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT';

    app.models.labResult
      .preFilterForOutbreak(this, filter)
      .then(filter => {
        // handle custom filter options
        filter = genericHelpers.attachCustomDeleteFilterOption(filter);
        return app.models.labResult.count(filter.where);
      })
      .then(result => callback(null, result))
      .catch(callback);
  };

  /**
   * Find outbreak lab results along with case information
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findLabResultsAggregate = function (filter, callback) {
    app.models.labResult
      .preFilterForOutbreak(this, filter)
      .then(filter => {
        app.models.labResult.retrieveAggregateLabResults(
          this,
          filter,
          false,
          callback
        );
      });
  };

  /**
   * Count outbreak lab-results
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountLabResultsAggregate = function (filter, callback) {
    app.models.labResult
      .preFilterForOutbreak(this, filter)
      .then(filter => {
        app.models.labResult.retrieveAggregateLabResults(
          this,
          filter,
          true,
          callback
        );
      });
  };

  /**
   * Backwards compatibility for find, filtered-count and per-classification count cases filters
   * @param context
   * @param modelInstance
   * @param next
   */
  function findAndFilteredCountCasesBackCompat(context, modelInstance, next) {
    // get filter
    const filter = _.get(context, 'args.filter', {});
    // convert filters from old format into the new one
    let query = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter);
    // get relationship query, if any
    const queryRelationship = _.get(filter, 'where.relationship');
    // if there is no relationship query, but there is an older version of the filter
    if (!queryRelationship && query.relationships) {
      // use that old version
      _.set(filter, 'where.relationship', query.relationships);
    }
    // get relationship query, if any
    const queryLabResults = _.get(filter, 'where.labResult');
    // if there is no relationship query, but there is an older version of the filter
    if (!queryLabResults && query.labResults) {
      // use that old version
      _.set(filter, 'where.labResult', query.labResults);
    }
    next();
  }

  Outbreak.beforeRemote('prototype.countCasesPerClassification', function (context, modelInstance, next) {
    findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.exportFilteredCases', function (context, modelInstance, next) {
    findAndFilteredCountCasesBackCompat(context, modelInstance, next);
  });

  /**
   * Find outbreak cases
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.findCases = function (filter, callback) {
    const outbreakId = this.outbreakId;
    const countRelations = genericHelpers.getFilterCustomOption(filter, 'countRelations');

    // pre-filter using related data (case)
    app.models.case
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // fix for some filter options received from web ( e.g $elemMatch search in array properties )
        filter = filter || {};
        Object.assign(
          filter,
          app.utils.remote.convertLoopbackFilterToMongo({
            where: filter.where || {}
          })
        );

        // replace nested geo points filters
        app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.case,
          filter.where,
          true
        );

        // find follow-ups using filter
        return app.models.case.find(filter);
      })
      .then(function (cases) {
        if (countRelations) {
          // create a map of ids and their corresponding record
          // to easily manipulate the records below
          const casesMap = {};
          for (let record of cases) {
            casesMap[record.id] = record;
          }
          // determine number of contacts/exposures for each case
          app.models.person.getPeopleContactsAndExposures(outbreakId, Object.keys(casesMap))
            .then(relationsCountMap => {
              for (let recordId in relationsCountMap) {
                const caseRecord = casesMap[recordId];
                caseRecord.numberOfContacts = relationsCountMap[recordId].numberOfContacts;
                caseRecord.numberOfExposures = relationsCountMap[recordId].numberOfExposures;
              }
              return callback(null, cases);
            });
        } else {
          return callback(null, cases);
        }
      })
      .catch(callback);
  };

  /**
   * Find outbreak events
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findEvents = function (filter, callback) {
    filter = filter || {};
    filter.where = filter.where || {};

    const outbreakId = this.id;
    const countRelations = genericHelpers.getFilterCustomOption(filter, 'countRelations');

    filter.where = {
      and: [
        filter.where, {
          outbreakId: outbreakId
        }
      ]
    };

    app.models.event
      .find(filter)
      .then((records) => {
        if (countRelations) {
          // create a map of ids and their corresponding record
          // to easily manipulate the records below
          const eventsMap = {};
          for (let record of records) {
            eventsMap[record.id] = record;
          }

          // determine number of contacts/exposures
          app.models.person.getPeopleContactsAndExposures(outbreakId, Object.keys(eventsMap))
            .then((relationsCountMap) => {
              for (let recordId in relationsCountMap) {
                const record = eventsMap[recordId];
                record.numberOfContacts = relationsCountMap[recordId].numberOfContacts;
                record.numberOfExposures = relationsCountMap[recordId].numberOfExposures;
              }
              return callback(null, records);
            });
        } else {
          return callback(null, records);
        }
      })
      .catch(callback);
  };

  /**
   * Count outbreak cases
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.filteredCountCases = function (filter, callback) {
    // pre-filter using related data (case)
    app.models.case
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // fix for some filter options received from web ( e.g $elemMatch search in array properties )
        filter = filter || {};
        Object.assign(
          filter,
          app.utils.remote.convertLoopbackFilterToMongo({
            where: filter.where || {}
          })
        );

        // replace nested geo points filters
        app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.case,
          filter.where,
          true,
          undefined,
          true
        );

        // handle custom filter options
        filter = genericHelpers.attachCustomDeleteFilterOption(filter);

        // count using query
        return app.models.case.count(filter.where);
      })
      .then(function (cases) {
        callback(null, cases);
      })
      .catch(callback);
  };

  /**
   * Count cases by case classification
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.countCasesPerClassification = function (filter, callback) {
    app.models.case
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // count using query
        return app.models.case.rawFind(filter.where, {
          projection: {classification: 1},
          includeDeletedRecords: filter.deleted
        });
      })
      .then(function (cases) {
        // build a result
        const result = {
          classification: {},
          count: cases.length
        };
        // go through all case records
        cases.forEach(function (caseRecord) {
          // init case classification group if needed
          if (!result.classification[caseRecord.classification]) {
            result.classification[caseRecord.classification] = {
              count: 0
            };
          }

          // classify records by their classification
          result.classification[caseRecord.classification].count++;
        });
        // send back the result
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Export filtered cases to file
   * @param filter Supports 'where.relationship', 'where.labResult' MongoDB compatible queries
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredCases = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    const self = this;
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

    new Promise((resolve, reject) => {
      // load user language dictionary
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
        // handle errors
        if (error) {
          return reject(error);
        }

        // resolved
        resolve(dictionary);
      });
    })
      .then((dictionary) => {
        return app.models.case.preFilterForOutbreak(this, filter)
          .then((filter) => {
            return {
              dictionary: dictionary,
              filter: filter
            };
          });
      })
      .then(function (data) {
        const dictionary = data.dictionary;
        const filter = data.filter;

        // if encrypt password is not valid, remove it
        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        // make sure anonymizeFields is valid
        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        options.questionnaire = self.caseInvestigationTemplate;
        options.dictionary = dictionary;
        options.useQuestionVariable = useQuestionVariable;

        app.utils.remote.helpers.exportFilteredModelsList(
          app,
          app.models.case,
          {},
          filter,
          exportType,
          'Case List',
          encryptPassword,
          anonymizeFields,
          options,
          function (results) {
            return Promise.resolve(results);
          },
          callback
        );
      })
      .catch(callback);
  };

  /**
   * Export filtered relationships to file
   * @param filter Supports 'where.person' & 'where.followUp' MongoDB compatible queries. For person please include type in case you want to filter only cases, contacts etc.
   * If you include both person & followUp conditions, then and AND will be applied between them.
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredRelationships = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    // const self = this;
    app.models.relationship
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // if encrypt password is not valid, remove it
        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        // make sure anonymizeFields is valid
        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        // export list of relationships
        app.utils.remote.helpers.exportFilteredModelsList(
          app,
          app.models.relationship,
          {},
          filter,
          exportType,
          'Relationship List',
          encryptPassword,
          anonymizeFields,
          options,
          function (results) {
            // construct unique list of persons that we need to retrieve
            let personIds = {};
            results.forEach((relationship) => {
              if (
                relationship.persons &&
                relationship.persons.length > 1
              ) {
                personIds[relationship.persons[0].id] = true;
                personIds[relationship.persons[1].id] = true;
              }
            });

            // flip object to array
            personIds = Object.keys(personIds);

            // start with a resolved promise (so we can link others)
            let buildQuery = Promise.resolve();

            // retrieve list of persons
            const mappedPersons = {};
            if (!_.isEmpty(personIds)) {
              buildQuery = app.models.person
                .rawFind({
                  id: {
                    inq: personIds
                  }
                })
                .then((personRecords) => {
                  // map list of persons ( ID => persons model )
                  personRecords.forEach((personData) => {
                    mappedPersons[personData.id] = personData;
                  });
                });
            }

            // attach persons to the list of relationships
            return buildQuery
              .then(() => {
                // retrieve dictionary
                return new Promise(function (resolve, reject) {
                  // load context user
                  const contextUser = app.utils.remote.getUserFromOptions(options);

                  // load user language dictionary
                  app.models.language.getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
                    // handle errors
                    if (error) {
                      return reject(error);
                    }

                    // finished
                    resolve(dictionary);
                  });
                });
              })
              .then((dictionary) => {
                // add source & target objects
                results.forEach((relationship) => {
                  // map source & target
                  if (
                    relationship.persons &&
                    relationship.persons.length > 1
                  ) {
                    // retrieve person models
                    const firstPerson = mappedPersons[relationship.persons[0].id];
                    const secondPerson = mappedPersons[relationship.persons[1].id];
                    if (
                      firstPerson &&
                      secondPerson
                    ) {
                      // attach target
                      relationship.sourcePerson = relationship.persons[0].source ? firstPerson : secondPerson;
                      relationship.targetPerson = relationship.persons[0].target ? firstPerson : secondPerson;
                    } else {
                      // relationship doesn't have source & target ( it should've been deleted ( cascade ... ) )
                      relationship.sourcePerson = {};
                      relationship.targetPerson = {};
                    }
                  }

                  // translate data
                  if (relationship.sourcePerson.gender) {
                    relationship.sourcePerson.gender = dictionary.getTranslation(relationship.sourcePerson.gender);
                  }
                  if (relationship.targetPerson.gender) {
                    relationship.targetPerson.gender = dictionary.getTranslation(relationship.targetPerson.gender);
                  }
                });

                // return results once we map everything we need
                return results;
              });
          },
          callback
        );
      })
      .catch(callback);
  };

  /**
   * Backwards compatibility for find, filtered-count and per-classification count contacts filters
   * @param context
   * @param modelInstance
   * @param next
   */
  function findAndFilteredCountContactsBackCompat(context, modelInstance, next) {
    // get filter
    const filter = _.get(context, 'args.filter', {});
    // convert filters from old format into the new one
    let query = app.utils.remote.searchByRelationProperty
      .convertIncludeQueryToFilterQuery(filter, {people: 'case'});
    // get followUp query, if any
    const queryFollowUp = _.get(filter, 'where.followUp');
    // if there is no followUp query, but there is an older version of the filter
    if (!queryFollowUp && query.followUps) {
      // use that old version
      _.set(filter, 'where.followUp', query.followUps);
    }
    // get case query, if any
    const queryCase = _.get(filter, 'where.case');
    // if there is no case query, but there is an older version of the filter
    if (!queryCase && query.case) {
      // use that old version
      _.set(filter, 'where.case', query.case);
    }
    next();
  }

  Outbreak.beforeRemote('prototype.findContacts', function (context, modelInstance, next) {
    findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.filteredCountContacts', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = genericHelpers.removeFilterOptions(context.args.filter, ['countRelations']);

    findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.countContactsPerRiskLevel', function (context, modelInstance, next) {
    findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.exportFilteredContacts', function (context, modelInstance, next) {
    // remove custom filter options
    context.args = context.args || {};
    context.args.filter = genericHelpers.removeFilterOptions(context.args.filter, ['countRelations']);

    findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.exportDailyContactFollowUpList', function (context, modelInstance, next) {
    findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });
  Outbreak.beforeRemote('prototype.exportFilteredContactsOfContacts', function (context, modelInstance, next) {
    findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });

  Outbreak.beforeRemote('prototype.exportFilteredRelationships', function (context, modelInstance, next) {
    // remove custom filter options
    // technical debt from front end
    context.args = context.args || {};
    context.args.filter = context.args.filter || {};
    context.args.filter.where = context.args.filter.where || {};
    context.args.filter.where.person = context.args.filter.where.person || {};
    delete context.args.filter.where.person.countRelations;

    return next();
  });

  /**
   * Find outbreak contacts
   * @param filter Supports 'where.case', 'where.followUp' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.findContacts = function (filter, callback) {
    const outbreakId = this.outbreakId;
    const countRelations = genericHelpers.getFilterCustomOption(filter, 'countRelations');

    // pre-filter using related data (case, followUps)
    app.models.contact
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // find follow-ups using filter
        return app.models.contact.find(filter);
      })
      .then(function (contacts) {
        if (countRelations) {
          // create a map of ids and their corresponding record
          // to easily manipulate the records below
          const contactsMap = {};
          for (let contact of contacts) {
            contactsMap[contact.id] = contact;
          }
          // determine number of contacts/exposures for each case
          app.models.person.getPeopleContactsAndExposures(outbreakId, Object.keys(contactsMap))
            .then(relationsCountMap => {
              for (let recordId in relationsCountMap) {
                const contactRecord = contactsMap[recordId];
                contactRecord.numberOfContacts = relationsCountMap[recordId].numberOfContacts;
                contactRecord.numberOfExposures = relationsCountMap[recordId].numberOfExposures;
              }
              return callback(null, contacts);
            });
        } else {
          return callback(null, contacts);
        }
      })
      .catch(callback);
  };

  /**
   * Count outbreak contacts
   * @param filter Supports 'where.case', 'where.followUp' MongoDB compatible queries
   * @param callback
   */
  Outbreak.prototype.filteredCountContacts = function (filter, callback) {
    // pre-filter using related data (case, followUps)
    app.models.contact
      .preFilterForOutbreak(this, filter)
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

        // handle custom filter options
        filter = genericHelpers.attachCustomDeleteFilterOption(filter);

        // count using query
        return app.models.contact.count(filter.where);
      })
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Count contacts by case risk level
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsPerRiskLevel = function (filter, callback) {
    // pre-filter using related data (case, followUps)
    app.models.contact
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // find follow-ups using filter
        return app.models.contact.rawFind(filter.where, {
          projection: {riskLevel: 1},
          includeDeletedRecords: filter.deleted
        });
      })
      .then(function (contacts) {
        // build a result
        const result = {
          riskLevel: {},
          count: contacts.length
        };
        // go through all contact records
        contacts.forEach(function (contactRecord) {
          // risk level is optional
          if (contactRecord.riskLevel == null) {
            contactRecord.riskLevel = 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_UNCLASSIFIED';
          }
          // init contact riskLevel group if needed
          if (!result.riskLevel[contactRecord.riskLevel]) {
            result.riskLevel[contactRecord.riskLevel] = {
              count: 0
            };
          }
          // classify records by their risk level
          result.riskLevel[contactRecord.riskLevel].count++;
        });
        // send back the result
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
    const self = this;
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

    new Promise((resolve, reject) => {
      // load user language dictionary
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, function (error, dictionary) {
        // handle errors
        if (error) {
          return reject(error);
        }

        // resolved
        resolve(dictionary);
      });
    })
      .then(dictionary => {
        return app.models.contact.preFilterForOutbreak(this, filter)
          .then((filter) => {
            return {
              dictionary: dictionary,
              filter: filter
            };
          });
      })
      .then(data => {
        const dictionary = data.dictionary;
        const filter = data.filter;

        // if encrypt password is not valid, remove it
        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        // make sure anonymizeFields is valid
        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        options.questionnaire = self.contactInvestigationTemplate;
        options.dictionary = dictionary;
        options.useQuestionVariable = useQuestionVariable;

        app.utils.remote.helpers.exportFilteredModelsList(
          app,
          app.models.contact,
          {},
          filter,
          exportType,
          'Contacts List',
          encryptPassword,
          anonymizeFields,
          options,
          (results, dictionary) => {
            return new Promise(function (resolve, reject) {
              // determine contacts for which we need to retrieve the first relationship
              const contactsMap = _.transform(
                results,
                (r, v) => {
                  r[v.id] = v;
                },
                {}
              );

              // retrieve contacts relationships ( sorted by creation date )
              // only those for which source is a case / event ( at this point it shouldn't be possible to be a contact, but we should handle this case since date & source flags should be enough... )
              // in case we don't have any contact Ids there is no point in searching for relationships
              const contactIds = Object.keys(contactsMap);
              const promise = contactIds.length < 1 ?
                Promise.resolve([]) :
                app.models.relationship.find({
                  order: 'createdAt ASC',
                  where: {
                    'persons.id': {
                      inq: contactIds
                    }
                  }
                });

              // handle exceptions
              promise.catch(reject);

              // retrieve contacts relationships ( sorted by creation date )
              const relationshipsPromises = [];
              promise.then((relationshipResults) => {
                // keep only the first relationship
                // assign relationships to contacts
                _.each(relationshipResults, (relationship) => {
                  // incomplete relationship ?
                  if (relationship.persons.length < 2) {
                    return;
                  }

                  // determine contact & related ids
                  let contactId, relatedId;
                  if (relationship.persons[0].target) {
                    contactId = relationship.persons[0].id;
                    relatedId = relationship.persons[1].id;
                  } else {
                    contactId = relationship.persons[1].id;
                    relatedId = relationship.persons[0].id;
                  }

                  // check if this is the first relationship for this contact
                  // if it is, then we need to map information
                  if (
                    contactsMap[contactId] &&
                    !contactsMap[contactId].relationship
                  ) {
                    // get relationship data
                    contactsMap[contactId].relationship = relationship.toJSON();

                    // set related ID
                    contactsMap[contactId].relationship.relatedId = relatedId;

                    // resolve relationship foreign keys here
                    relationshipsPromises.push(genericHelpers.resolveModelForeignKeys(
                      app,
                      app.models.relationship,
                      [contactsMap[contactId].relationship],
                      dictionary
                    ).then(relationship => {
                      contactsMap[contactId].relationship = relationship[0];
                    }));
                  }
                });

                // finished
                return Promise.all(relationshipsPromises).then(() => resolve(results));
              });

            });
          },
          callback
        );
      })
      .catch(callback);
  };

  /**
   * Count contacts that are on the follow up list when generating
   * Also custom filtered
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountContactsOnFollowUpList = function (filter = {}, callback) {
    // defensive checks
    filter.where = filter.where || {};
    let startDate = genericHelpers.getDate().toDate();
    let endDate = genericHelpers.getDateEndOfDay().toDate();
    if (filter.where.startDate) {
      startDate = genericHelpers.getDate(filter.where.startDate).toDate();
      delete filter.where.startDate;
    }
    if (filter.where.endDate) {
      endDate = genericHelpers.getDateEndOfDay(filter.where.endDate).toDate();
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

    // do we need to filter contacts by case classification ?
    let promise = Promise.resolve();
    if (classification) {
      // retrieve cases
      promise = promise
        .then(() => {
          return app.models.case
            .rawFind({
              outbreakId: this.id,
              deleted: {
                $ne: true
              },
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
              deleted: {
                $ne: true
              },
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
      .preFilterForOutbreak(this, filter)
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
                            from: moment(_.get(record, 'followUp.startDate')).format('YYYY-MM-DD'),
                            to: moment(_.get(record, 'followUp.endDate')).format('YYYY-MM-DD'),
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
   * Get all duplicates based on hardcoded rules against a model props
   * @param filter pagination props (skip, limit)
   * @param model
   * @param callback
   */
  Outbreak.prototype.getContactPossibleDuplicates = function (filter = {}, model = {}, callback) {
    app.models.person
      .findDuplicatesByType(filter, this.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', model)
      .then(duplicates => callback(null, duplicates))
      .catch(callback);
  };

  /**
   * Get all duplicates based on hardcoded rules against a model props
   * @param filter pagination props (skip, limit)
   * @param model
   * @param callback
   */
  Outbreak.prototype.getCasePossibleDuplicates = function (filter = {}, model = {}, callback) {
    app.models.person
      .findDuplicatesByType(filter, this.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', model)
      .then(duplicates => callback(null, duplicates))
      .catch(callback);
  };

  /**
   * Get a list of entries that show the delay between date of symptom onset and the hospitalization/isolation dates for a case
   * @param filter
   * @param callback
   */
  Outbreak.prototype.caseDelayBetweenOnsetAndHospitalizationIsolation = function (filter, callback) {
    app.models.case
      .delayBetweenOnsetAndHospitalisationIsolation(this.id, filter)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count cases stratified by outcome over time
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param callback
   */
  Outbreak.prototype.countCasesStratifiedByOutcomeOverTime = function (filter, callback) {
    app.models.case.countStratifiedByOutcomeOverTime(this, filter)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count cases stratified by classification over reporting time
   * @param filter This applies on case record. Additionally you can specify a periodType and endDate in where property
   * @param callback
   */
  Outbreak.prototype.countCasesStratifiedByClassificationOverReportingTime = function (filter, callback) {
    app.models.case.countStratifiedByClassificationOverReportingTime(this, filter)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Get contacts follow up report per date range
   * @param dateRange
   * @param callback
   */
  Outbreak.prototype.getContactFollowUpReport = function (filter, dateRange, callback) {
    // endData can be received from filter or body
    // body has priority
    let endDate = dateRange.endDate || _.get(filter, 'where.endDate', null);
    if (_.get(filter, 'where.endDate')) {
      delete filter.where.endDate;
    }

    WorkerRunner
      .getContactFollowUpReport(
        this.id,
        dateRange.startDate,
        endDate,
        _.get(filter, 'where')
      )
      .then(result => callback(null, result))
      .catch(callback);
  };

  /**
   * Get follow ups grouped by contact
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getFollowUpsGroupedByContact = function (filter, callback) {
    app.models.followUp.getOrCountGroupedByPerson(this.id, filter, false, callback);
  };

  /**
   * Count follow ups grouped by contact
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countFollowUpsGroupedByContact = function (filter, callback) {
    app.models.followUp.getOrCountGroupedByPerson(this.id, filter, true, callback);
  };

  /**
   * Get bars cot data
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getBarsTransmissionChains = function (filter, callback) {
    app.models.person.getBarsTransmissionChainsData(this.id, filter, callback);
  };

  /**
   * Retrieve a case isolated contacts and count
   * @param caseId
   * @param callback
   */
  Outbreak.prototype.getCaseIsolatedContacts = function (caseId, callback) {
    app.models.case.getIsolatedContacts(caseId, (err, isolatedContacts) => {
      if (err) {
        return callback(err);
      }
      return callback(null, {
        count: isolatedContacts.length,
        ids: isolatedContacts.map((entry) => entry.contact.id)
      });
    });
  };

  /**
   * Count the cases per period per contact status
   * @param filter Besides the default filter properties this request also accepts
   * 'periodType': enum [day, week, month],
   * 'periodInterval':['date', 'date']
   * @param callback
   */
  Outbreak.prototype.countCasesPerPeriodPerContactStatus = function (filter, callback) {
    // initialize periodType filter; default is day; accepting day/week/month
    let periodType;
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

    // initialize periodInterval; keeping it as moment instances we need to use them further in the code
    let periodInterval;
    // check if the periodInterval filter was sent; accepting it only on the first level
    periodInterval = _.get(filter, 'where.periodInterval');
    if (typeof periodInterval !== 'undefined') {
      // periodInterval was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodInterval;
      // normalize periodInterval dates
      periodInterval[0] = genericHelpers.getDate(periodInterval[0]);
      periodInterval[1] = genericHelpers.getDateEndOfDay(periodInterval[1]);
    } else {
      // set default periodInterval depending on periodType
      periodInterval = genericHelpers.getPeriodIntervalForDate(undefined, periodType);
    }

    // get outbreakId
    let outbreakId = this.id;

    // initialize result
    let result = {
      totalCasesCount: 0,
      totalCasesNotFromContact: 0,
      totalCasesFromContactWithFollowupComplete: 0,
      totalCasesFromContactWithFollowupLostToFollowup: 0,
      caseIDs: [],
      caseNotFromContactIDs: [],
      caseFromContactWithFollowupCompleteIDs: [],
      caseFromContactWithFollowupLostToFollowupIDs: [],
      percentageOfCasesWithFollowupData: 0,
      period: []
    };

    // initialize default filter
    let defaultFilter = {
      where: {
        // cases only from our outbreak
        outbreakId: outbreakId,

        // exclude discarded cases
        classification: {
          nin: app.models.case.discardedCaseClassifications
        },

        // get only the cases reported in the periodInterval
        or: [{
          dateOfReporting: {
            // clone the periodInterval as it seems that Loopback changes the values in it when it sends the filter to MongoDB
            between: periodInterval.slice()
          },
          dateBecomeCase: {
            eq: null
          }
        }, {
          dateBecomeCase: {
            // clone the periodInterval as it seems that Loopback changes the values in it when it sends the filter to MongoDB
            between: periodInterval.slice()
          }
        }]
      },
      order: 'dateOfReporting ASC'
    };

    // initialize map for final followup status to properties that need to be updated in result
    const finalFollowupStatusMap = {
      'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_FOLLOW_UP_COMPLETED': {
        counter: 'totalCasesFromContactWithFollowupComplete',
        idContainer: 'caseFromContactWithFollowupCompleteIDs'
      },
      'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP': {
        counter: 'totalCasesFromContactWithFollowupComplete',
        idContainer: 'caseFromContactWithFollowupCompleteIDs'
      },
      'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_LOST_TO_FOLLOW_UP': {
        counter: 'totalCasesFromContactWithFollowupLostToFollowup',
        idContainer: 'caseFromContactWithFollowupLostToFollowupIDs'
      }
    };

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
            totalCasesNotFromContact: 0,
            totalCasesFromContactWithFollowupComplete: 0,
            totalCasesFromContactWithFollowupLostToFollowup: 0,
            caseIDs: [],
            caseNotFromContactIDs: [],
            caseFromContactWithFollowupCompleteIDs: [],
            caseFromContactWithFollowupLostToFollowupIDs: [],
            percentageOfCasesWithFollowupData: 0
          });
        });

        cases.forEach(function (item) {
          // get case date; it's either dateBecomeCase or dateOfReporting
          let caseDate = item.dateBecomeCase || item.dateOfReporting;

          // get interval based on date of onset
          const casePeriodInterval = genericHelpers.getPeriodIntervalForDate(periodInterval, periodType, caseDate);

          // create a period identifier
          let casePeriodIdentifier = casePeriodInterval.join(' - ');

          // increase total case count counter and add case ID in container
          periodMap[casePeriodIdentifier].totalCasesCount++;
          periodMap[casePeriodIdentifier].caseIDs.push(item.id);
          result.totalCasesCount++;
          result.caseIDs.push(item.id);

          // check if case was converted from contact and increase required counters
          if (!item.dateBecomeCase) {
            // case was not converted from contact
            // increase period counters
            periodMap[casePeriodIdentifier].totalCasesNotFromContact++;
            periodMap[casePeriodIdentifier].caseNotFromContactIDs.push(item.id);

            // increase total counters
            result.totalCasesNotFromContact++;
            result.caseNotFromContactIDs.push(item.id);
          } else {
            // case was converted from a contact
            // get follow-up status
            let finalFollowupStatus = _.get(item, 'followUp.status', null);
            // get entry in finalFollowupStatusMap; the entry might not be found for unknown statuses
            let finalFollowupStatusEntry = finalFollowupStatusMap[finalFollowupStatus];

            // check if the final follow-up status is known; was found in map
            if (finalFollowupStatusEntry) {
              // increase period counter
              periodMap[casePeriodIdentifier][finalFollowupStatusEntry.counter]++;
              periodMap[casePeriodIdentifier][finalFollowupStatusEntry.idContainer].push(item.id);

              // increase total counters
              result[finalFollowupStatusEntry.counter]++;
              result[finalFollowupStatusEntry.idContainer].push(item.id);

              // calculate new percentage as the status is known
              // period percentage
              periodMap[casePeriodIdentifier].percentageOfCasesWithFollowupData =
                (periodMap[casePeriodIdentifier].totalCasesFromContactWithFollowupComplete +
                  periodMap[casePeriodIdentifier].totalCasesFromContactWithFollowupLostToFollowup) /
                periodMap[casePeriodIdentifier].totalCasesCount;

              // total percentage
              result.percentageOfCasesWithFollowupData =
                (result.totalCasesFromContactWithFollowupComplete +
                  result.totalCasesFromContactWithFollowupLostToFollowup) /
                result.totalCasesCount;
            } else {
              // case was created from a contact that has an unknown (not default reference data) follow-up status
              // it was already added in the total cases count; no need to add in another counter
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

    // get list of contacts based on the filter passed on request
    app.models.contact
      .rawFind(
        app.utils.remote.mergeFilters({
          where: {
            outbreakId: outbreak.id,
          }
        }, filter || {}).where, {
          projection: {
            id: 1,
            firstName: 1,
            middleName: 1,
            lastName: 1,
            gender: 1,
            age: 1,
            addresses: 1
          }
        }
      )
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
            {
              outbreakId: outbreak.id,
              active: true
            },
            // and for the contacts desired
            {
              'persons.id': {
                $in: Object.keys(contactsMap)
              },
              'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
            },
            // retrieve only non-deleted records
            {
              $or: [
                {
                  deleted: false
                },
                {
                  deleted: {
                    $eq: null
                  }
                }
              ]
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
          ])
          .toArray()
          .then((relationshipData) => {
            // map relationship data
            (relationshipData || []).forEach((data) => {
              if (contactsMap[data._id]) {
                contactsMap[data._id].lastContactDate = genericHelpers.getDate(data.lastContactDate);
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
              {
                outbreakId: this.id,
                personId: {
                  $in: Object.keys(contactsMap)
                }
              },
              // retrieve only non-deleted records
              {
                $or: [
                  {
                    deleted: false
                  },
                  {
                    deleted: {
                      $eq: null
                    }
                  }
                ]
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
          ])
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
              const lastFollowUpDay = genericHelpers.getDateEndOfDay(firstFollowUpDay.clone().add(outbreak.periodOfFollowup, 'days'));

              // determine relevant follow-ups
              // those that are in our period of interest
              contactsMap[groupData._id].followUps = _.filter(groupData.followUps, (followUpData) => {
                return followUpData.date && moment(followUpData.date).isBetween(firstFollowUpDay, lastFollowUpDay, undefined, '[]');
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
                const lastFollowUpDay = genericHelpers.getDateEndOfDay(
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
                    moment(contactData.lastContactDate).format('YYYY-MM-DD') :
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
                  const dateFormated = moment(followUp.date).format('YYYY-MM-DD');
                  if (!tableData[tableData.length - 1][dateFormated]) {
                    // format questionnaire answers to old format so we can use the old functionality & also use the latest value
                    followUp.questionnaireAnswers = followUp.questionnaireAnswers || {};
                    followUp.questionnaireAnswers = genericHelpers.convertQuestionnaireAnswersToOldFormat(followUp.questionnaireAnswers);

                    // add cell data
                    tableData[tableData.length - 1][dateFormated] = genericHelpers.translateQuestionAnswers(
                      question,
                      question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_DATE_TIME' ?
                        (followUp.questionnaireAnswers[question.variable] ? moment(followUp.questionnaireAnswers[question.variable]).format('YYYY-MM-DD') : '') :
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
   * Retrieve available people for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getCaseRelationshipsAvailablePeople = function (caseId, filter, callback) {
    // retrieve available people
    app.models.person
      .getAvailablePeople(
        this.id,
        caseId,
        filter
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count available people for a case
   * @param caseId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countCaseRelationshipsAvailablePeople = function (caseId, where, callback) {
    // count available people
    app.models.person
      .getAvailablePeopleCount(
        this.id,
        caseId,
        where
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };

  /**
   * Retrieve available people for a contact
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getContactRelationshipsAvailablePeople = function (contactId, filter, callback) {
    // retrieve available people
    app.models.person
      .getAvailablePeople(
        this.id,
        contactId,
        filter
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count available people for a contact
   * @param contactId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countContactRelationshipsAvailablePeople = function (contactId, where, callback) {
    // count available people
    app.models.person
      .getAvailablePeopleCount(
        this.id,
        contactId,
        where
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };

  /**
   * Retrieve available people for a case
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getEventRelationshipsAvailablePeople = function (eventId, filter, callback) {
    // retrieve available people
    app.models.person
      .getAvailablePeople(
        this.id,
        eventId,
        filter
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count available people for an event
   * @param eventId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countEventRelationshipsAvailablePeople = function (eventId, where, callback) {
    // count available people
    app.models.person
      .getAvailablePeopleCount(
        this.id,
        eventId,
        where
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };

  /**
   * Change source and targets of a relationship
   * @param relationshipId
   * @param sourceTargetIds
   * @param callback
   */
  Outbreak.prototype.setTargetAndSourceForRelationship = function (relationshipId, sourceTargetIds, callback) {
    // outbreak id
    const outbreakId = this.id;

    // handle validation errors
    const throwValidationError = (msg) => {
      callback(app.utils.apiError.getError('VALIDATION_ERROR', {
        model: app.models.relationshipSourceTarget.modelName,
        details: msg
      }));
    };

    // validate input
    if (
      !sourceTargetIds ||
      !sourceTargetIds.sourceId ||
      !sourceTargetIds.targetId
    ) {
      return throwValidationError('Must contain sourceId & targetId');
    }

    // validate round relationships
    if (sourceTargetIds.sourceId === sourceTargetIds.targetId) {
      return throwValidationError('SourceId needs to be different from targetId');
    }

    // retrieve source & target models
    app.models.person
      .rawFind({
        outbreakId: outbreakId,
        _id: {
          inq: [sourceTargetIds.sourceId, sourceTargetIds.targetId]
        }
      })
      .then((records) => {
        // find source & target
        const sourceModel = _.find(records, (r) => r.id === sourceTargetIds.sourceId);
        const targetModel = _.find(records, (r) => r.id === sourceTargetIds.targetId);

        // did we found our records ?
        if (!sourceModel) {
          return throwValidationError('Source model is missing');
        }

        // did we found our records ?
        if (!targetModel) {
          return throwValidationError('Target model is missing');
        }

        // finished
        return {
          sourceModel: sourceModel,
          targetModel: targetModel
        };
      })
      .then((sourceAndTarget) => {
        return app.models.relationship
          .findById(relationshipId)
          .then((relationshipData) => {
            // found ?
            if (
              !relationshipData ||
              relationshipData.id !== relationshipId
            ) {
              return throwValidationError('Relationship model is missing');
            }

            // finished
            return Object.assign(
              sourceAndTarget, {
                relationshipData: relationshipData
              }
            );
          });
      })
      .then((replaceData) => {
        // update relationship
        return replaceData.relationshipData
          .updateAttributes({
            persons: [{
              id: replaceData.targetModel.id,
              type: replaceData.targetModel.type,
              target: true
            }, {
              id: replaceData.sourceModel.id,
              type: replaceData.sourceModel.type,
              source: true
            }]
          });
      })
      .then((updatedRelationship) => {
        // finished
        callback(null, updatedRelationship);
      })
      .catch(callback);
  };

  /**
   * Change target for all relationships matching specific conditions
   * @param targetId Case / Contact / Event
   * @param where Mongo Query
   * @param callback
   */
  Outbreak.prototype.bulkChangeTargetRelationships = function (targetId, where, callback) {
    app.models.relationship
      .bulkChangeSourceOrTarget(this.id, false, targetId, where)
      .then((changedCount) => {
        callback(null, changedCount);
      })
      .catch(callback);
  };

  /**
   * Change source for all relationships matching specific conditions
   * @param sourceId Case / Contact / Event
   * @param where Mongo Query
   * @param callback
   */
  Outbreak.prototype.bulkChangeSourceRelationships = function (sourceId, where, callback) {
    app.models.relationship
      .bulkChangeSourceOrTarget(this.id, true, sourceId, where)
      .then((changedCount) => {
        callback(null, changedCount);
      })
      .catch(callback);
  };

  /**
   * Bulk delete a list of follow ups
   * @param filter
   * @param callback
   */
  Outbreak.prototype.bulkDeleteFollowUps = function (filter, callback) {
    const outbreakId = this.id;
    filter = filter || {};
    filter.where = filter.where || {};
    app.models.followUp.destroyAll({
      and: [
        {
          outbreakId: outbreakId
        },
        filter.where
      ]
    }, callback);
  };

  /**
   * Bulk restore a list of deleted follow ups
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkRestoreFollowUps = function (filter, options, callback) {
    const outbreakId = this.id;
    filter = filter || {};
    filter.where = filter.where || {};
    app.models.followUp
      .find({
        deleted: true,
        where: {
          and: [
            {
              outbreakId: outbreakId,
              deleted: true
            },
            filter.where
          ]
        }
      })
      .then(records => {
        async.series(records.map(r => doneRecord => r.undoDelete(options, doneRecord)), callback);
      })
      .catch(callback);
  };

  /**
   * Import an importable lab results file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableContactLabResultsFileUsingMap = function (body, options, callback) {
    const self = this;
    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // inject platform identifier
    options.platform = Platform.IMPORT;
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
          const labResultsList = app.utils.helpers.convertBooleanProperties(
            app.models.labResult,
            app.utils.helpers.remapProperties(rawlabResultsList, body.map, body.valuesMap));
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
              // sanitize questionnaire answers
              // convert to new format if necessary
              if (labResult.questionnaireAnswers) {
                labResult.questionnaireAnswers = genericHelpers.convertQuestionnaireAnswersToNewFormat(labResult.questionnaireAnswers);
              }

              // first check if the case id (person id) is valid
              app.models.contact
                .findOne({
                  where: {
                    or: [
                      {id: labResult.personId},
                      {visualId: labResult.personId}
                    ],
                    outbreakId: self.id
                  }
                })
                .then(function (contactInstance) {
                  // if the person was not found, don't sync the lab result, stop with error
                  if (!contactInstance) {
                    throw app.utils.apiError.getError('PERSON_NOT_FOUND', {
                      model: app.models.case.modelName,
                      id: labResult.personId
                    });
                  }

                  // make sure we map it to the parent case in case we retrieved the contact using visual id
                  labResult.personId = contactInstance.id;

                  // set outbreakId
                  labResult.outbreakId = self.id;

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
                    recordNo: index + 1,
                    data: {
                      file: rawlabResultsList[index],
                      save: labResult
                    }
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
   * Restore a deleted lab result
   * @param contactId
   * @param labResultId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContactLabResult = function (contactId, labResultId, options, callback) {
    app.models.labResult
      .findOne({
        deleted: true,
        where: {
          id: labResultId,
          personId: contactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError(
            'MODEL_NOT_FOUND',
            {
              model: app.models.labResult.modelName,
              id: labResultId
            }
          );
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Find outbreak contacts of contacts
   * @param filter Supports 'where.contact'
   * @param callback
   */
  Outbreak.prototype.findContactsOfContacts = function (filter, callback) {
    const outbreakId = this.outbreakId;
    const countRelations = genericHelpers.getFilterCustomOption(filter, 'countRelations');

    app.models.contactOfContact
      .preFilterForOutbreak(this, filter)
      .then(app.models.contactOfContact.find)
      .then(records => {
        if (countRelations) {
          // create a map of ids and their corresponding record
          // to easily manipulate the records below
          const recordsMap = {};
          for (let record of records) {
            recordsMap[record.id] = record;
          }
          // determine number of contacts/exposures for each record
          app.models.person.getPeopleContactsAndExposures(outbreakId, Object.keys(recordsMap))
            .then(relationsCountMap => {
              for (let recordId in relationsCountMap) {
                const mapRecord = recordsMap[recordId];
                mapRecord.numberOfContacts = relationsCountMap[recordId].numberOfContacts;
                mapRecord.numberOfExposures = relationsCountMap[recordId].numberOfExposures;
              }
              return callback(null, records);
            });
        } else {
          return callback(null, records);
        }
      })
      .catch(callback);
  };

  /**
   * Find relations for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactOfContactRelationships = function (contactOfContactId, filter, callback) {
    helpers.findPersonRelationships(contactOfContactId, filter, callback);
  };

  /**
   * Create relation for a contact of contact
   * @param contactOfContactId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createContactOfContactRelationship = function (contactOfContactId, data, options, callback) {
    app.models.contactOfContact
      .findById(contactOfContactId)
      .then((record) => {
        if (!record) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contactOfContact.modelName,
            id: contactOfContactId
          }));
        }
        helpers.createPersonRelationship(
          this.id,
          contactOfContactId,
          'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
          data,
          options,
          callback
        );
      })
      .catch(callback);
  };

  /**
   * Retrieve a relation for a contact of contact
   * @param contactOfContactId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getContactOfContactRelationship = function (contactOfContactId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(
      contactOfContactId,
      relationshipId,
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
      filter,
      callback
    );
  };

  /**
   * Update a relation for a contact of contact
   * @param contactOfContactId
   * @param relationshipId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.updateContactOfContactRelationship = function (contactOfContactId, relationshipId, data, options, callback) {
    helpers.updatePersonRelationship(
      contactOfContactId,
      relationshipId,
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
      data,
      options,
      callback
    );
  };

  /**
   * Delete a relation for a contact of contact
   * @param contactOfContactId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteContactOfContactRelationship = function (contactOfContactId, relationshipId, options, callback) {
    helpers.deletePersonRelationship(
      contactOfContactId,
      relationshipId,
      options,
      callback
    );
  };

  /**
   * Count relations for a contact of contact
   * @param contactOfContactId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationships = function (contactOfContactId, where, callback) {
    app.models.contactOfContact
      .findById(contactOfContactId)
      .then((contact) => {
        if (!contact) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contactOfContact.modelName,
            id: contactOfContactId
          }));
        }
        helpers.countPersonRelationships(contactOfContactId, where, callback);
      })
      .catch(callback);
  };

  /**
   * Retrieve available people for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getContactOfContactRelationshipsAvailablePeople = function (contactOfContactId, filter, callback) {
    // we only make relations with contacts
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where = {
      and: [
        {
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        },
        filter.where
      ]
    };

    app.models.person
      .getAvailablePeople(
        this.id,
        contactOfContactId,
        filter
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count available people for a contact of contact
   * @param contactOfContactId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationshipsAvailablePeople = function (contactOfContactId, where, callback) {
    // we only make relations with contacts
    where = {
      and: [
        {
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        },
        where || {}
      ]
    };

    app.models.person
      .getAvailablePeopleCount(
        this.id,
        contactOfContactId,
        where
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };

  /**
   * Find relationship exposures for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactOfContactRelationshipExposures = function (contactOfContactId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipExposures(this.id, contactOfContactId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Count relationship exposures for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationshipExposures = function (contactOfContactId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipExposures(this.id, contactOfContactId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Export filtered contacts of contacts to file
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredContactsOfContacts = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    app.models.contactOfContact
      .preFilterForOutbreak(this, filter)
      .then(filter => {
        // if encrypt password is not valid, remove it
        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        // make sure anonymizeFields is valid
        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        app.utils.remote.helpers.exportFilteredModelsList(
          app,
          app.models.contactOfContact,
          {},
          filter,
          exportType,
          'Contacts Of Contacts List',
          encryptPassword,
          anonymizeFields,
          options,
          results => Promise.resolve(results),
          callback
        );
      })
      .catch(callback);
  };

  /**
   * Import an importable contacts of contacts file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableContactsOfContactsFileUsingMap = function (body, options, callback) {
    const self = this;
    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // inject platform identifier
    options.platform = Platform.IMPORT;
    // get importable file
    app.models.importableFile
      .getTemporaryFileById(body.fileId, function (error, file) {
        // handle errors
        if (error) {
          return callback(error);
        }
        try {
          // parse file content
          const rawRecordsList = JSON.parse(file);
          // remap properties & values
          const recordsList = app.utils.helpers.remapProperties(rawRecordsList, body.map, body.valuesMap);
          // build a list of create operations
          const createOps = [];
          // define a container for error results
          const createErrors = [];
          // define a toString function to be used by error handler
          createErrors.toString = function () {
            return JSON.stringify(this);
          };
          // go through all entries
          recordsList.forEach(function (recordItem, index) {
            createOps.push(function (callback) {
              // extract relationship data
              const relationshipData = app.utils.helpers.convertBooleanProperties(
                app.models.relationship,
                app.utils.helpers.extractImportableFields(app.models.relationship, recordItem.relationship));

              // extract record's data
              const recordData = app.utils.helpers.convertBooleanProperties(
                app.models.contactOfContact,
                app.utils.helpers.extractImportableFields(app.models.contactOfContact, recordItem));

              // set outbreak ids
              recordData.outbreakId = self.id;
              relationshipData.outbreakId = self.id;

              // filter out empty addresses
              const addresses = app.models.person.sanitizeAddresses(recordData);
              if (addresses) {
                recordData.addresses = addresses;
              }

              // sanitize visual ID
              if (recordData.visualId) {
                recordData.visualId = app.models.person.sanitizeVisualId(recordData.visualId);
              }

              // sync the record
              return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.contactOfContact, recordData, options)
                .then(function (syncResult) {
                  const syncedRecord = syncResult.record;
                  // promisify next step
                  return new Promise(function (resolve, reject) {
                    // normalize people
                    Outbreak.helpers.validateAndNormalizePeople(
                      self.id,
                      syncedRecord.id,
                      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
                      relationshipData,
                      true,
                      function (error) {
                        if (error) {
                          // delete record since it was created without an error while relationship failed
                          return app.models.contactOfContact.destroyById(
                            syncedRecord.id,
                            () => {
                              // return error
                              return reject(error);
                            }
                          );
                        }

                        // sync relationship
                        return app.utils.dbSync.syncRecord(options.remotingContext.req.logger, app.models.relationship, relationshipData, options)
                          .then(function (syncedRelationship) {
                            // relationship successfully created, move to tne next one
                            callback(null, Object.assign({}, syncedRecord.toJSON(), {relationships: [syncedRelationship.record.toJSON()]}));
                          })
                          .catch(function (error) {
                            // failed to create relationship, remove the record if it was created during sync
                            if (syncResult.flag === app.utils.dbSync.syncRecordFlags.CREATED) {
                              syncedRecord.destroy(options);
                            }
                            reject(error);
                          });
                      });
                  });
                })
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  createErrors.push({
                    message: `Failed to import contact of contact ${index + 1}`,
                    error: error,
                    recordNo: index + 1,
                    data: {
                      file: rawRecordsList[index],
                      save: {
                        record: recordData,
                        relationship: relationshipData
                      }
                    }
                  });
                  callback(null, null);
                });
            });
          });
          // start importing
          async.series(createOps, function (error, results) {
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
                model: app.models.contactOfContact.modelName,
                failed: createErrors,
                success: results
              }));
            }
            // send the result
            callback(null, results);
          });
        } catch (error) {
          // log error
          options.remotingContext.req.logger.error(error);
          // handle parse error
          callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
            contentType: 'JSON',
            details: error.message
          }));
        }
      });
  };

  /**
   * Generate (next available) contact of contact visual id
   * @param visualIdMask
   * @param personId
   * @param callback
   */
  Outbreak.prototype.generateContactOfContactVisualId = function (visualIdMask, personId, callback) {
    Outbreak.helpers.validateOrGetAvailableContactOfContactVisualId(this, visualIdMask, personId)
      .then(function (visualId) {
        callback(null, visualId);
      })
      .catch(callback);
  };

  /**
   * Get all duplicates based on hardcoded rules against a model props
   * @param filter pagination props (skip, limit)
   * @param model
   * @param callback
   */
  Outbreak.prototype.getContactOfContactPossibleDuplicates = function (filter = {}, model = {}, callback) {
    app.models.person
      .findDuplicatesByType(filter, this.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT', model)
      .then(duplicates => callback(null, duplicates))
      .catch(callback);
  };

  /**
   * Count outbreak contacts of contacts
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountContactsOfContacts = function (filter, callback) {
    // pre-filter using related data
    app.models.contactOfContact
      .preFilterForOutbreak(this, filter)
      .then(function (filter) {
        // replace nested geo points filters
        filter.where = app.utils.remote.convertNestedGeoPointsFilterToMongo(
          app.models.contactOfContact,
          filter.where || {},
          true,
          undefined,
          true,
          true
        );

        // count using query
        return app.models.contactOfContact.count(filter.where);
      })
      .then(function (records) {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Restore a deleted contact of contact
   * @param contactOfContactId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContactOfContact = function (contactOfContactId, options, callback) {
    app.models.contactOfContact
      .findOne({
        deleted: true,
        where: {
          id: contactOfContactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contactOfContact.modelName,
            id: contactOfContactId
          });
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Export filtered lab results to file
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredLabResults = function (filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    const self = this;

    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

    new Promise((resolve, reject) => {
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, (err, dictionary) => {
        if (err) {
          return reject(err);
        }
        return resolve(dictionary);
      });
    })
      .then(dictionary => {
        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        app.models.labResult.retrieveAggregateLabResults(
          this,
          filter,
          false,
          (err, results) => {
            if (err) {
              return callback(err);
            }

            options.questionnaire = self.labResultsTemplate;
            options.dictionary = dictionary;
            options.useQuestionVariable = useQuestionVariable;
            options.records = results;

            app.utils.remote.helpers.exportFilteredModelsList(
              app,
              app.models.labResult,
              {},
              filter,
              exportType,
              'LabResult-List',
              encryptPassword,
              anonymizeFields,
              options,
              data => Promise.resolve(data),
              callback
            );
          }
        );
      })
      .catch(callback);
  };

  /**
   * Import an importable relationships file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableRelationshipsFileUsingMap = function (body, options, callback) {
    const self = this;
    options._sync = false;
    // inject platform identifier
    options.platform = Platform.IMPORT;
    app.models.importableFile
      .getTemporaryFileById(body.fileId, (err, file) => {
        if (err) {
          return callback(err);
        }
        try {
          // parse file content
          const rawRelationsList = JSON.parse(file);
          // remap properties & values
          const relations = app.utils.helpers.convertBooleanProperties(
            app.models.relationship,
            app.utils.helpers.remapProperties(rawRelationsList, body.map, body.valuesMap));
          // build a list of create operations
          const createOps = [];
          // define a container for error results
          const createErrors = [];
          // define a toString function to be used by error handler
          createErrors.toString = function () {
            return JSON.stringify(this);
          };
          // go through all entries
          relations.forEach((relation, index) => {
            createOps.push(callback => {
              relation.outbreakId = self.id;

              return app.utils.dbSync.syncRecord(
                options.remotingContext.req.logger,
                app.models.relationship,
                relation,
                options
              )
                .then(result => callback(null, result.record))
                .catch(err => {
                  // on error, store the error, but don't stop, continue with other items
                  createErrors.push({
                    message: `Failed to import relationship ${index + 1}`,
                    error: err,
                    recordNo: index + 1,
                    data: {
                      file: rawRelationsList[index],
                      save: relation
                    }
                  });
                  return callback(null, null);
                });
            });
          });

          async.series(createOps, (err, results) => {
            if (err) {
              return callback(err);
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
                model: app.models.relationship.modelName,
                failed: createErrors,
                success: results
              }));
            }
            // send the result
            return callback(null, results);
          });
        } catch (parseErr) {
          callback(app.utils.apiError.getError('INVALID_CONTENT_OF_TYPE', {
            contentType: 'JSON',
            details: parseErr.message
          }));
        }
      });
  };

  /**
   * Export filtered case lab results to file
   * @param caseId
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredCaseLabResults = function (caseId, filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    const self = this;

    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // only case lab results
    filter.where = {
      and: [
        filter.where,
        {
          personId: caseId,
          personType: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
        }
      ]
    };

    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

    new Promise((resolve, reject) => {
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, (err, dictionary) => {
        if (err) {
          return reject(err);
        }
        return resolve(dictionary);
      });
    })
      .then(dictionary => {
        return app.models.labResult.preFilterForOutbreak(this, filter)
          .then((filter) => {
            return {
              dictionary: dictionary,
              filter: filter
            };
          });
      })
      .then(data => {
        const dictionary = data.dictionary;
        const filter = data.filter;

        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        options.questionnaire = self.labResultsTemplate;
        options.dictionary = dictionary;
        options.useQuestionVariable = useQuestionVariable;

        app.utils.remote.helpers.exportFilteredModelsList(
          app,
          app.models.labResult,
          {},
          filter,
          exportType,
          'LabResult-List',
          encryptPassword,
          anonymizeFields,
          options,
          data => Promise.resolve(data),
          callback
        );
      })
      .catch(callback);
  };

  /**
   * Export filtered case lab results to file
   * @param contactId
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredContactLabResults = function (contactId, filter, exportType, encryptPassword, anonymizeFields, options, callback) {
    const self = this;

    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // only contact lab results
    filter.where = {
      and: [
        filter.where,
        {
          personId: contactId,
          personType: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        }
      ]
    };

    // parse useQuestionVariable query param
    let useQuestionVariable = false;
    // if found, remove it form main query
    if (filter.where.hasOwnProperty('useQuestionVariable')) {
      useQuestionVariable = filter.where.useQuestionVariable;
      delete filter.where.useQuestionVariable;
    }

    new Promise((resolve, reject) => {
      const contextUser = app.utils.remote.getUserFromOptions(options);
      app.models.language.getLanguageDictionary(contextUser.languageId, (err, dictionary) => {
        if (err) {
          return reject(err);
        }
        return resolve(dictionary);
      });
    })
      .then(dictionary => {
        return app.models.labResult.preFilterForOutbreak(this, filter)
          .then((filter) => {
            return {
              dictionary: dictionary,
              filter: filter
            };
          });
      })
      .then(data => {
        const dictionary = data.dictionary;
        const filter = data.filter;

        if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
          encryptPassword = null;
        }

        if (!Array.isArray(anonymizeFields)) {
          anonymizeFields = [];
        }

        options.questionnaire = self.labResultsTemplate;
        options.dictionary = dictionary;
        options.useQuestionVariable = useQuestionVariable;

        app.utils.remote.helpers.exportFilteredModelsList(
          app,
          app.models.labResult,
          {},
          filter,
          exportType,
          'LabResult-List',
          encryptPassword,
          anonymizeFields,
          options,
          data => Promise.resolve(data),
          callback
        );
      })
      .catch(callback);
  };

  /**
   * Build and return a pdf containing a contact of contact's information and relationships (dossier)
   * @param contactsOfContacts
   * @param anonymousFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.contactOfContactDossier = function (contactsOfContacts, anonymousFields, options, callback) {
    const models = app.models;


    let tmpDir = tmp.dirSync({unsafeCleanup: true});
    let tmpDirName = tmpDir.name;

    // get all requested contact of contacts, including their relationships and followUps
    models.contactOfContact.find({
      where: {
        id: {
          inq: contactsOfContacts
        }
      },
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
        }
      ]
    }, (err, results) => {
      if (err) {
        return callback(err);
      }

      const pdfUtils = app.utils.pdfDoc;
      const languageId = options.remotingContext.req.authData.user.languageId;

      // list of records ready to be printed
      let sanitizedRecords = [];

      genericHelpers.attachParentLocations(
        app.models.contactOfContact,
        app.models.location,
        results,
        (err, result) => {
          if (!err) {
            result = result || {};
            results = result.records || results;
          }

          // get the language dictionary
          app.models.language.getLanguageDictionary(languageId, (err, dictionary) => {
            if (err) {
              return callback(err);
            }

            // transform all DB models into JSONs for better handling
            results.forEach((record, recordIndex) => {
              results[recordIndex] = record.toJSON();

              // this is needed because loopback doesn't return hidden fields from definition into the toJSON call
              // might be removed later
              results[recordIndex].type = record.type;

              // since relationships is a custom relation, the relationships collection is included differently in the model,
              // and not converted by the initial toJSON method.
              record.relationships.forEach((relationship, relationshipIndex) => {
                record.relationships[relationshipIndex] = relationship.toJSON();
                record.relationships[relationshipIndex].people.forEach((member, memberIndex) => {
                  record.relationships[relationshipIndex].people[memberIndex] = member.toJSON();
                });
              });
            });

            // replace all foreign keys with readable data
            genericHelpers.resolveModelForeignKeys(app, app.models.contactOfContact, results, dictionary)
              .then((results) => {
                results.forEach((contact, contactIndex) => {
                  // keep the initial data of the contact (we currently use it to generate the QR code only)
                  sanitizedRecords[contactIndex] = {
                    rawData: contact
                  };

                  // anonymize the required fields and prepare the fields for print (currently, that means eliminating undefined values,
                  // and format date type fields
                  if (anonymousFields) {
                    app.utils.anonymizeDatasetFields.anonymize(contact, anonymousFields);
                  }
                  app.utils.helpers.formatDateFields(contact, app.models.person.dossierDateFields);
                  app.utils.helpers.formatUndefinedValues(contact);

                  // prepare the contact's relationships for printing
                  contact.relationships.forEach((relationship, relationshipIndex) => {
                    sanitizedRecords[contactIndex].relationships = [];

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

                    // translate the values of the fields marked as reference data fields on the case/contact/event model
                    app.utils.helpers.translateDataSetReferenceDataValues(
                      relationshipMember,
                      models[models.person.typeToModelMap[relationshipMemberType]],
                      dictionary
                    );

                    relationshipMember = app.utils.helpers.translateFieldLabels(
                      app,
                      relationshipMember,
                      models[models.person.typeToModelMap[relationshipMemberType]].modelName,
                      dictionary
                    );

                    // translate the values of the fields marked as reference data fields on the relationship model
                    app.utils.helpers.translateDataSetReferenceDataValues(
                      relationship,
                      models.relationship,
                      dictionary
                    );

                    // translate all remaining keys of the relationship model
                    relationship = app.utils.helpers.translateFieldLabels(
                      app,
                      relationship,
                      models.relationship.modelName,
                      dictionary
                    );

                    relationship[dictionary.getTranslation('LNG_RELATIONSHIP_PDF_FIELD_LABEL_PERSON')] = relationshipMember;

                    // add the sanitized relationship to the object to be printed
                    sanitizedRecords[contactIndex].relationships[relationshipIndex] = relationship;
                  });

                  // translate all remaining keys
                  contact = app.utils.helpers.translateFieldLabels(
                    app,
                    contact,
                    app.models.contactOfContact.modelName,
                    dictionary,
                    true
                  );

                  // add the sanitized contact to the object to be printed
                  sanitizedRecords[contactIndex].data = contact;
                });

                const relationshipsTitle = dictionary.getTranslation('LNG_PAGE_ACTION_RELATIONSHIPS');

                let pdfPromises = [];

                // print all the data
                sanitizedRecords.forEach((sanitizedContact) => {
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
                        app.utils.qrCode.addPersonQRCode(doc, sanitizedContact.rawData.outbreakId, 'contactOfContact', sanitizedContact.rawData);
                      };

                      // add the QR code to the first page (this page has already been added and will not be covered by the next line)
                      addQrCode();

                      // set a listener on pageAdded to add the QR code to every new page
                      doc.on('pageAdded', addQrCode);

                      pdfUtils.displayModelDetails(doc, sanitizedContact.data, true, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_OF_CONTACT_DETAILS'));
                      pdfUtils.displayPersonRelationships(doc, sanitizedContact.relationships, relationshipsTitle);

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
                          const lastName = sanitizedContact.rawData.lastName ? sanitizedContact.rawData.lastName.replace(/\r|\n|\s/g, '').toUpperCase() + ' ' : '';
                          const firstName = sanitizedContact.rawData.firstName ? sanitizedContact.rawData.firstName.replace(/\r|\n|\s/g, '') : '';
                          fs.writeFile(`${tmpDirName}/${lastName}${firstName} - ${sanitizedContact.rawData.id}.pdf`, buffer, (err) => {
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
                let archiveName = `contactOfContactDossiers_${moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
                let archivePath = `${tmpDirName}/${archiveName}`;
                let zip = new AdmZip();

                zip.addLocalFolder(tmpDirName);
                zip.writeZip(archivePath);

                fs.readFile(archivePath, (err, data) => {
                  if (err) {
                    callback(err);
                  } else {
                    tmpDir.removeCallback();
                    app.utils.remote.helpers.offerFileToDownload(data, 'application/zip', archiveName, callback);
                  }
                });
              });
          });
        });
    });
  };

  /**
   * Get movement for a contact of contact
   * Movement: list of addresses that contain geoLocation information, sorted from the oldest to newest based on date.
   * Empty date is treated as the most recent
   * @param contactOfContactId
   * @param callback
   */
  Outbreak.prototype.getContactOfContactMovement = function (contactOfContactId, callback) {
    app.models.contactOfContact
      .findOne({
        where: {
          id: contactOfContactId,
          outbreakId: this.id
        }
      })
      .then(record => {
        if (!record) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contactOfContact.modelName,
            id: contactOfContactId
          });
        }
        return record.getMovement().then(movement => callback(null, movement));
      })
      .catch(callback);
  };

  /**
   * Count contacts of contacts by risk level
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsOfContactsPerRiskLevel = function (filter, callback) {
    app.models.contactOfContact
      .preFilterForOutbreak(this, filter)
      .then(filter => app.models.contactOfContact.rawFind(
        filter.where,
        {
          projection: {riskLevel: 1},
          includeDeletedRecords: filter.deleted
        })
      )
      .then(contacts => {
        const result = {
          riskLevel: {},
          count: contacts.length
        };
        contacts.forEach(contactRecord => {
          // risk level is optional
          if (contactRecord.riskLevel == null) {
            contactRecord.riskLevel = 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_UNCLASSIFIED';
          }
          // init contact riskLevel group if needed
          if (!result.riskLevel[contactRecord.riskLevel]) {
            result.riskLevel[contactRecord.riskLevel] = {
              count: 0
            };
          }
          // classify records by their risk level
          result.riskLevel[contactRecord.riskLevel].count++;
        });
        // send back the result
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Bulk modify contacts of contacts
   * @param records
   * @param callback
   */
  Outbreak.prototype.bulkModifyContactsOfContacts = function (records, callback) {
    Outbreak.modifyMultipleContacts(records, true)
      .then((results) => callback(null, results))
      .catch(callback);
  };

  /**
   * Create multiple contacts of contacts for a contact
   * @param contactId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createContactMultipleContactsOfContacts = function (contactId, data, options, callback) {
    Outbreak.createContactMultipleContactsOfContacts(this, contactId, data, options, callback);
  };

  /**
   * Get all records marked as not duplicates for a specific record
   * @param contactId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getContactMarkedAsNotDuplicates = function (contactId, filter = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        contactId,
        filter
      )
      .then((markedAsNotDuplicates) => callback(null, markedAsNotDuplicates))
      .catch(callback);
  };

  /**
   * Count records marked as not duplicates for a specific record
   * @param contactOfContactId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getContactMarkedAsNotDuplicatesCount = function (contactId, where = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        contactId, {
          where: where
        },
        true
      )
      .then((counted) => callback(null, counted))
      .catch(callback);
  };

  /**
   * Change contact duplicates
   */
  Outbreak.prototype.contactMarkPersonAsOrNotADuplicate = function (contactId, data, options, callback) {
    data = data || {};
    app.models.person
      .markAsOrNotADuplicate(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
        contactId,
        data.addRecords,
        data.removeRecords
      )
      .then((finalNotDuplicates) => {
        callback(null, finalNotDuplicates);
      })
      .catch(callback);
  };

  /**
   * Get all records marked as not duplicates for a specific record
   * @param caseId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getCaseMarkedAsNotDuplicates = function (caseId, filter = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        caseId,
        filter
      )
      .then((markedAsNotDuplicates) => callback(null, markedAsNotDuplicates))
      .catch(callback);
  };

  /**
   * Count records marked as not duplicates for a specific record
   * @param caseId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getCaseMarkedAsNotDuplicatesCount = function (caseId, where = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        caseId, {
          where: where
        },
        true
      )
      .then((counted) => callback(null, counted))
      .catch(callback);
  };

  /**
   * Change case duplicates
   */
  Outbreak.prototype.caseMarkPersonAsOrNotADuplicate = function (caseId, data, options, callback) {
    data = data || {};
    app.models.person
      .markAsOrNotADuplicate(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
        caseId,
        data.addRecords,
        data.removeRecords
      )
      .then((finalNotDuplicates) => {
        callback(null, finalNotDuplicates);
      })
      .catch(callback);
  };

  /**
   * Get all records marked as not duplicates for a specific record
   * @param contactOfContactId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getContactOfContactMarkedAsNotDuplicates = function (contactOfContactId, filter = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        contactOfContactId,
        filter
      )
      .then((markedAsNotDuplicates) => callback(null, markedAsNotDuplicates))
      .catch(callback);
  };

  /**
   * Count records marked as not duplicates for a specific record
   * @param contactOfContactId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getContactOfContactMarkedAsNotDuplicatesCount = function (contactOfContactId, where = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        contactOfContactId, {
          where: where
        },
        true
      )
      .then((counted) => callback(null, counted))
      .catch(callback);
  };

  /**
   * Change contact of contact duplicates
   */
  Outbreak.prototype.contactOfContactMarkPersonAsOrNotADuplicate = function (contactOfContactId, data, options, callback) {
    data = data || {};
    app.models.person
      .markAsOrNotADuplicate(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
        contactOfContactId,
        data.addRecords,
        data.removeRecords
      )
      .then((finalNotDuplicates) => {
        callback(null, finalNotDuplicates);
      })
      .catch(callback);
  };
};
