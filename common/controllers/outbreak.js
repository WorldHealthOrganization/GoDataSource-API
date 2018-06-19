'use strict';

const app = require('../../server/server');
const _ = require('lodash');

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
    'prototype.__delete__contacts__relationships'
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
          next(app.utils.apiError.getError('DELETE_ACTIVE_OUTBREAK', {id: context.args.id}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * Enhance cases list request to support optional filtering of cases that don't have any relations
   */
  Outbreak.beforeRemote('prototype.__get__cases', function (context, modelInstance, next) {
    Outbreak.helpers.attachFilterPeopleWithoutRelation('case', context, modelInstance, next);
  });

  /**
   * Enhance events list request to support optional filtering of events that don't have any relations
   */
  Outbreak.beforeRemote('prototype.__get__events', function (context, modelInstance, next) {
    Outbreak.helpers.attachFilterPeopleWithoutRelation('event', context, modelInstance, next);
  });

  /**
   * Parsing the properties that are of type '["date"]' as Loopback doesn't save them correctly
   */
  Outbreak.beforeRemote('prototype.__create__cases', function (context, modelInstance, next) {
    // parse array of dates properties
    helpers.parseArrayOfDates(context.args.data);

    next();
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
        return contact.updateAttribute('type', 'case');
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
};
