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
    'prototype.__delete__contacts__relationships',
    'prototype.__delete__events',
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
    const _filter = app.utils.remote.mergeFilters({
        where: {
          persons: personId
        },
        filter
      });
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
   * Create relation for a person
   * @param personId
   * @param data
   * @param callback
   */
  function createCaseContactRelationship(personId, data, callback) {
    callback(app.utils.apiError.getError('FUNCTIONALITY_NOT_IMPLEMENTED', {}, 501));
  }

  /**
   * Create relation for a case
   * @param caseId
   * @param data
   * @param callback
   */
  Outbreak.prototype.createCaseRelationship = function (caseId, data, callback) {
    createCaseContactRelationship(caseId, data, callback);
  };

  /**
   * Create relation for a contact
   * @param contactId
   * @param data
   * @param callback
   */
  Outbreak.prototype.createContactRelationship = function (contactId, data, callback) {
    createCaseContactRelationship(contactId, data, callback);
  };

  /**
   * Retrieve a relation for a person
   * @param personId
   * @param relationshipId
   * @param callback
   */
  function getCaseContactRelationship(personId, relationshipId, callback) {
    callback(app.utils.apiError.getError('FUNCTIONALITY_NOT_IMPLEMENTED', {}, 501));
  }

  /**
   * Retrieve a relation for a case
   * @param caseId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.getCaseRelationship = function (caseId, relationshipId, callback) {
    getCaseContactRelationship(caseId, relationshipId, callback);
  };

  /**
   * Retrieve a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.getContactRelationship = function (contactId, relationshipId, callback) {
    getCaseContactRelationship(contactId, relationshipId, callback);
  };

  /**
   * Update a relation for a person
   * @param personId
   * @param relationshipId
   * @param data
   * @param callback
   */
  function updateCaseContactRelationship(personId, relationshipId, data, callback) {
    callback(app.utils.apiError.getError('FUNCTIONALITY_NOT_IMPLEMENTED', {}, 501));
  }

  /**
   * Update a relation for a case
   * @param caseId
   * @param relationshipId
   * @param data
   * @param callback
   */
  Outbreak.prototype.updateCaseRelationship = function (caseId, relationshipId, data, callback) {
    updateCaseContactRelationship(caseId, relationshipId, data, callback);
  };

  /**
   * Update a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param data
   * @param callback
   */
  Outbreak.prototype.updateContactRelationship = function (contactId, relationshipId, data, callback) {
    updateCaseContactRelationship(contactId, relationshipId, data, callback);
  };

  /**
   * Delete a relation for a person
   * @param personId
   * @param relationshipId
   * @param callback
   */
  function deleteCaseContactRelationship(personId, relationshipId, callback) {
    callback(app.utils.apiError.getError('FUNCTIONALITY_NOT_IMPLEMENTED', {}, 501));
  }

  /**
   * Delete a relation for a case
   * @param caseId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.deleteCaseContactRelationship = function (caseId, relationshipId, callback) {
    deleteCaseContactRelationship(caseId, relationshipId, callback);
  };

  /**
   * Delete a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param callback
   */
  Outbreak.prototype.deleteCaseContactRelationship = function (contactId, relationshipId, callback) {
    deleteCaseContactRelationship(contactId, relationshipId, callback);
  };

  /**
   * Count relations for a person
   * @param personId
   * @param where
   * @param data
   * @param callback
   */
  function countCaseContactRelationships(personId, where, data, callback) {
    callback(app.utils.apiError.getError('FUNCTIONALITY_NOT_IMPLEMENTED', {}, 501));
  }

  /**
   * Count relations for a case
   * @param caseId
   * @param where
   * @param data
   * @param callback
   */
  Outbreak.prototype.countCaseContactRelationships = function (caseId, where, data, callback) {
    countCaseContactRelationships(caseId, where, data, callback);
  };

  /**
   * Count relations for a contact
   * @param contactId
   * @param where
   * @param data
   * @param callback
   */
  Outbreak.prototype.countCaseContactRelationships = function (contactId, where, data, callback) {
    countCaseContactRelationships(contactId, where, data, callback);
  };
};
