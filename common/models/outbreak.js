'use strict';

const app = require('../../server/server');

module.exports = function (Outbreak) {

  // initialize available date formats
  Outbreak.availableDateFormats = {
    'dd-mm-yyyy': 'LNG_OUTBREAK_AVAILABLE_DATE_FORMATS_DD-MM-YYYY',
    'yyyy-mm-dd': 'LNG_OUTBREAK_AVAILABLE_DATE_FORMATS_YYYY-MM-DD',
    'mm/dd/yyyy': 'LNG_OUTBREAK_AVAILABLE_DATE_FORMATS_MM/DD/YYYY',
    'mm-dd-yyyy': 'LNG_OUTBREAK_AVAILABLE_DATE_FORMATS_MM-DD-YYYY'
  };

  // initialize model helpers
  Outbreak.helpers = {};

  /**
   * Find relations for a person
   * @param personId
   * @param filter
   * @param callback
   */
  Outbreak.helpers.findCaseContactRelationships = function (personId, filter, callback) {
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
  };

  /**
   * Validate persons property
   * @param personId
   * @param type
   * @param data
   * @param callback
   * @return {*}
   */
  Outbreak.helpers.validateAndNormalizePersons = function (personId, type, data, callback) {
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
  };

  /**
   * Create relation for a person
   * @param outbreakId
   * @param personId
   * @param type
   * @param data
   * @param callback
   */
  Outbreak.helpers.createCaseContactRelationship = function (outbreakId, personId, type, data, callback) {
    Outbreak.helpers.validateAndNormalizePersons(personId, type, data, function (error, persons) {
      if (error) {
        return callback(error);
      }
      data.persons = persons;
      app.models.relationship.removeReadOnlyProperties(data);
      app.models.relationship
        .create(Object.assign(data, { outbreakId: outbreakId }))
        .then(function (createdRelation) {
          callback(null, createdRelation);
        })
        .catch(callback);
    });
  };

  /**
   * Retrieve a relation for a person
   * @param personId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.helpers.getCaseContactRelationship = function (personId, relationshipId, filter, callback) {
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
  };

  /**
   * Update a relation for a person
   * @param personId
   * @param relationshipId
   * @param type
   * @param data
   * @param callback
   */
  Outbreak.helpers.updateCaseContactRelationship = function (personId, relationshipId, type, data, callback) {
    Outbreak.helpers.validateAndNormalizePersons(personId, type, data, function (error, persons) {
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
  };

  /**
   * Delete a relation for a person
   * @param personId
   * @param relationshipId
   * @param callback
   */
  Outbreak.helpers.deleteCaseContactRelationship = function (personId, relationshipId, callback) {
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
  };

  /**
   * Count relations for a person
   * @param personId
   * @param where
   * @param callback
   */
  Outbreak.helpers.countCaseContactRelationships = function (personId, where, callback) {
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
  };
};
