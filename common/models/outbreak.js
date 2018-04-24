'use strict';

const app = require('../../server/server');

module.exports = function (Outbreak) {

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

  Outbreak.availableDateFormats = {
    'dd-mm-yyyy': 'dd-mm-yyyy',
    'yyyy-mm-dd': 'yyyy-mm-dd',
    'mm/dd/yyyy': 'mm/dd/yyyy',
    'mm-dd-yyyy': 'mm-dd-yyyy'
  };

  /**
   * Do not allow deletion of a active Outbreak
   */
  Outbreak.beforeRemote('deleteById', function (context, modelInstance, next) {
    Outbreak.findById(context.args.id)
      .then(function (outbreak) {
        if (outbreak && outbreak.active) {
          next(app.utils.apiError.getError('DELETE_ACTIVE_OUTBREAK', {id: context.args.id}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * Allow only one active outbreak
   * @param context
   * @param instanceId
   * @param next
   */
  function validateActiveOutbreak(context, instanceId, next) {
    if (context.args.data.active) {
      const query = {
        active: true
      };
      // if existing instance, make sure its excluded from search
      if (instanceId) {
        query.id = {
          neq: instanceId
        };
      }
      Outbreak
        .findOne({where: query})
        .then(function (activeOutbreak) {
          if (activeOutbreak) {
            return next(app.utils.apiError.getError('ONE_ACTIVE_OUTBREAK', {id: activeOutbreak.id}, 422));
          }
          next();
        })
        .catch(next);
    } else {
      next();
    }
  }

  /**
   * Allow only one active outbreak on create
   */
  Outbreak.beforeRemote('create', function (context, modelInstance, next) {
    validateActiveOutbreak(context, true, next);
  });

  /**
   * Allow only one active outbreak on update
   */
  Outbreak.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    validateActiveOutbreak(context, context.instance.id, next);
  });

  /**
   * Get available date formats
   * @param callback
   */
  Outbreak.getAvailableDateFormats = function (callback) {
    callback(null, Outbreak.availableDateFormats);
  };

  /**
   * Find relations for a person
   * @param personId
   * @param filter
   * @param callback
   */
  function findCaseContactRelationships(personId, filter, callback) {
    const _filter = app.utils.remote
      .mergeFilters({
        where: {
          'persons.id': personId
        }
      }, filter);

    app.models.relationship
      .find(_filter)
      .then(function (relationships) {
        callback(null, relationships);
      })
      .catch(callback);
  }

  /**
   * Find relations for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findCaseRelationships = function (caseId, filter, callback) {
    findCaseContactRelationships(caseId, filter, callback);
  };

  /**
   * Find relations for a contact
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactRelationships = function (contactId, filter, callback) {
    findCaseContactRelationships(contactId, filter, callback);
  };

  /**
   * Validate persons property
   * @param personId
   * @param type
   * @param data
   * @param callback
   * @return {*}
   */
  function validateAndNormalizePersons(personId, type, data, callback) {
    let currentPersonFound = false;

    if (Array.isArray(data.persons) && data.persons.length) {

      let errors;
      let persons = [];

      data.persons.forEach(function (person, index) {
        // validate each person item
        if (person.type === undefined || person.id === undefined) {
          if (!errors) {
            errors = [];
          }
          errors.push(`"persons[${index}]" must contain both "type" and "id"`);
          // check if the person is current person
        } else if (person.id === personId) {
          // keep only one entry of the current person
          if (!currentPersonFound) {
            currentPersonFound = true;
            persons.push(person);
          }
        } else {
          persons.push(person);
        }
      });

      if (errors) {
        return callback(app.utils.apiError.getError('VALIDATION_ERROR', {
          model: app.models.relationship.modelName,
          details: errors.join(', ')
        }));
      }

      data.persons = persons;

      // another person must be specified for a relation to be valid
      if (currentPersonFound && data.persons.length === 1) {
        return callback(app.utils.apiError.getError('VALIDATION_ERROR', {
          model: app.models.relationship.modelName,
          details: 'you must specify the related person'
        }));
      }

      // if current person was not added by front end, add it here
      if (!currentPersonFound && data.persons.length) {
        data.persons.push({
          id: personId,
          type: type
        });
      }
    }
    callback(null, data.persons);
  }

  /**
   * Create relation for a person
   * @param personId
   * @param type
   * @param data
   * @param callback
   */
  function createCaseContactRelationship(personId, type, data, callback) {
    validateAndNormalizePersons(personId, type, data, function (error, persons) {
      if (error) {
        return callback(error);
      }
      data.persons = persons;
      app.models.relationship.removeReadOnlyProperties(data);
      app.models.relationship
        .create(data)
        .then(function (createdRelation) {
          callback(null, createdRelation);
        })
        .catch(callback);
    });
  }

  /**
   * Create relation for a case
   * @param caseId
   * @param data
   * @param callback
   */
  Outbreak.prototype.createCaseRelationship = function (caseId, data, callback) {
    createCaseContactRelationship(caseId, 'case', data, callback);
  };

  /**
   * Create relation for a contact
   * @param contactId
   * @param data
   * @param callback
   */
  Outbreak.prototype.createContactRelationship = function (contactId, data, callback) {
    createCaseContactRelationship(contactId, 'contact', data, callback);
  };

  /**
   * Retrieve a relation for a person
   * @param personId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  function getCaseContactRelationship(personId, relationshipId, filter, callback) {
    const _filter = app.utils.remote
      .mergeFilters({
        where: {
          id: relationshipId,
          'persons.id': personId
        }
      }, filter);

    app.models.relationship
      .findOne(_filter)
      .then(function (relationship) {
        if (!relationship) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND_IN_CONTEXT', {
            model: app.models.relationship.modelName,
            id: relationshipId,
            contextModel: app.models.case.modelName,
            contextId: personId
          });
        }
        callback(null, relationship);
      })
      .catch(callback);
  }

  /**
   * Retrieve a relation for a case
   * @param caseId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getCaseRelationship = function (caseId, relationshipId, filter, callback) {
    getCaseContactRelationship(caseId, relationshipId, filter, callback);
  };

  /**
   * Retrieve a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getContactRelationship = function (contactId, relationshipId, filter, callback) {
    getCaseContactRelationship(contactId, relationshipId, filter, callback);
  };

  /**
   * Update a relation for a person
   * @param personId
   * @param relationshipId
   * @param type
   * @param data
   * @param callback
   */
  function updateCaseContactRelationship(personId, relationshipId, type, data, callback) {
    validateAndNormalizePersons(personId, type, data, function (error, persons) {
      if (error) {
        return callback(error);
      }
      data.person = persons;
      app.models.relationship
        .findOne({
          where: {
            id: relationshipId,
            'persons.id': personId
          }
        })
        .then(function (relationship) {
          if (!relationship) {
            throw app.utils.apiError.getError('MODEL_NOT_FOUND_IN_CONTEXT', {
              model: app.models.relationship.modelName,
              id: relationshipId,
              contextModel: app.models.case.modelName,
              contextId: personId
            });
          }
          app.models.relationship.removeReadOnlyProperties(data);
          return relationship.updateAttributes(data);
        })
        .then(function (relationship) {
          callback(null, relationship);
        })
        .catch(callback);
    });
  }

  /**
   * Update a relation for a case
   * @param caseId
   * @param relationshipId
   * @param data
   * @param callback
   */
  Outbreak.prototype.updateCaseRelationship = function (caseId, relationshipId, data, callback) {
    updateCaseContactRelationship(caseId, relationshipId, 'case', data, callback);
  };

  /**
   * Update a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param data
   * @param callback
   */
  Outbreak.prototype.updateContactRelationship = function (contactId, relationshipId, data, callback) {
    updateCaseContactRelationship(contactId, relationshipId, 'contact', data, callback);
  };

  /**
   * Delete a relation for a person
   * @param personId
   * @param relationshipId
   * @param callback
   */
  function deleteCaseContactRelationship(personId, relationshipId, callback) {
    app.models.relationship
      .findOne({
        where: {
          id: relationshipId,
          'persons.id': personId
        }
      })
      .then(function (relationship) {
        if (!relationship) {
          return {count: 0};
        }
        return relationship.destroy();
      })
      .then(function (relationship) {
        callback(null, relationship);
      })
      .catch(callback);
  }

  /**
   * Delete a relation for a case
   * @param caseId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.deleteCaseRelationship = function (caseId, relationshipId, callback) {
    deleteCaseContactRelationship(caseId, relationshipId, callback);
  };

  /**
   * Delete a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.deleteContactRelationship = function (contactId, relationshipId, callback) {
    deleteCaseContactRelationship(contactId, relationshipId, callback);
  };

  /**
   * Count relations for a person
   * @param personId
   * @param where
   * @param callback
   */
  function countCaseContactRelationships(personId, where, callback) {
    const _filter = app.utils.remote
      .mergeFilters({
          where: {
            'persons.id': personId
          }
        },
        {where: where});

    app.models.relationship
      .count(_filter.where)
      .then(function (relationships) {
        callback(null, relationships);
      })
      .catch(callback);
  }

  /**
   * Count relations for a case
   * @param caseId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countCaseRelationships = function (caseId, where, callback) {
    countCaseContactRelationships(caseId, where, callback);
  };

  /**
   * Count relations for a contact
   * @param contactId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countContactRelationships = function (contactId, where, callback) {
    countCaseContactRelationships(contactId, where, callback);
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
    app.models.contact.defaultScope = function (){};

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
  }
};
