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
   * Allow only one active outbreak
   * @param context
   * @param instanceId
   * @param next
   */
  Outbreak.helpers.validateActiveOutbreak = function (context, instanceId, next) {
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
   * Add geo-restriction conditions on filters
   * @param context
   * @param isCount Whether the request is a count request or not
   * @param next
   */
  function queryWithGeoRestrictions(context, isCount, next) {
    // get logged in user geo-restrictions
    let geoRestrictions = context.req.authData.user.geographicRestrictions;
    let query;
    // count has only 'where'
    if (isCount) {
      query = {
        where: context.args.where
      };
    } else {
      // find requests use "filter"
      query = context.args.filter;
    }

    // add restrictions filtering only if the user is geo-restricted
    if (geoRestrictions) {
      if (!query) {
        query = {};
      }
      // merge request filters with geo-location restrictions
      const _filter = app.utils.remote
        .mergeFilters({
          where: {
            or: [
              {
                'address.locationId': {
                  inq: geoRestrictions
                }
              },
              {
                'address.locationId': null
              },
              {
                'address.locationId': {
                  exists: false
                }
              }
            ]
          }
        }, query);

      // update arguments based on request type
      if (isCount) {
        context.args.where = _filter.where;
      } else {
        context.args.filter = _filter;
      }
    }
    next();
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
   * Apply geo-restrictions on case list
   */
  Outbreak.beforeRemote('prototype.__get__cases', function (context, modelInstance, next) {
    queryWithGeoRestrictions(context, false, next);
  });

  /**
   * Apply geo-restrictions on case count
   */
  Outbreak.beforeRemote('prototype.__count__cases', function (context, modelInstance, next) {
    queryWithGeoRestrictions(context, true, next);
  });

  /**
   * Apply geo-restrictions on contact list
   */
  Outbreak.beforeRemote('prototype.__get__contacts', function (context, modelInstance, next) {
    queryWithGeoRestrictions(context, false, next);
  });

  /**
   * Apply geo-restrictions on contact count
   */
  Outbreak.beforeRemote('prototype.__count__contacts', function (context, modelInstance, next) {
    queryWithGeoRestrictions(context, true, next);
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
