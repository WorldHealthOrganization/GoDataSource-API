'use strict';

const app = require('../../server/server');
const _ = require('lodash');

// used to manipulate dates
const moment = require('moment');

module.exports = function (Outbreak) {

  // initialize model helpers
  Outbreak.helpers = {};

  /**
   * Convert a given date to UTC and reset time to start of the day
   * If no date is given, the current time is returned
   * @param date
   */
  Outbreak.helpers.getUTCDate = function (date) {
    return date ? moment(date).utc().startOf('day') : moment.utc().startOf('day');
  };

  /**
   * Checks whether the given follow up model is generated
   * Checks that update/create dates are on the same
   * Checks that it is not performed
   * @param model
   * @returns {boolean}
   */
  Outbreak.helpers.isGeneratedFollowup = function (model) {
    return moment(model.createdAt).isSame(moment(model.updatedAt)) && !model.performed;
  };

  /**
   * Find relations for a person
   * @param personId
   * @param filter
   * @param callback
   */
  Outbreak.helpers.findPersonRelationships = function (personId, filter, callback) {
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
  Outbreak.helpers.validateAndNormalizePeople = function (personId, type, data, callback) {
    if (Array.isArray(data.persons) && data.persons.length) {

      let errors;
      let persons = [];

      data.persons.forEach(function (person, index) {
        // validate each person item
        if (person.id === undefined) {
          if (!errors) {
            errors = [];
          }
          errors.push(`"persons[${index}]" must contain "id"`);
          // add only other people
        } else if (person.id !== personId) {
          // make sure type is not set (it will be set later on)
          delete person.type;
          persons.push(person);
        }
      });

      // check validation errors
      if (errors) {
        return callback(app.utils.apiError.getError('VALIDATION_ERROR', {
          model: app.models.relationship.modelName,
          details: errors.join(', ')
        }));
      }

      data.persons = persons;

      // another person must be specified for a relation to be valid
      if (!data.persons.length) {
        return callback(app.utils.apiError.getError('VALIDATION_ERROR', {
          model: app.models.relationship.modelName,
          details: 'you must specify the related person'
        }));
      }

      // add current person
      if (data.persons.length) {
        data.persons.push({
          id: personId,
          type: type
        });
      }

      // keep a list of promises for finding person types
      let personPromises = [];
      data.persons.forEach(function (person, index) {
        if (!person.type) {
          // find each person
          personPromises.push(
            app.models.person
              .findById(person.id)
              .then(function (foundPerson) {
                if (!foundPerson) {
                  throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
                    model: app.models.person.modelName,
                    id: person.id
                  })
                }

                // do not allow event-event relationships
                if (type === 'event' && foundPerson.type === 'event') {
                  throw callback(app.utils.apiError.getError('INVALID_EVENT_EVENT_RELATIONSHIP', {
                    id: person.id
                  }));
                }

                // do not allow contact-contact relationships
                if (type === 'contact' && foundPerson.type === 'contact') {
                  throw callback(app.utils.apiError.getError('INVALID_CONTACT_CONTACT_RELATIONSHIP', {
                    id: person.id
                  }));
                }

                // set its type
                data.persons[index].type = foundPerson.type;
              })
          );
        }
      });
      // wait for all the searches to finis
      Promise.all(personPromises)
        .then(function () {
          callback(null, data.persons);
        })
        .catch(callback);
    } else {
      callback(null, data.persons);
    }
  };

  /**
   * Create relation for a person
   * @param outbreakId
   * @param personId
   * @param type
   * @param data
   * @param callback
   */
  Outbreak.helpers.createPersonRelationship = function (outbreakId, personId, type, data, callback) {
    Outbreak.helpers.validateAndNormalizePeople(personId, type, data, function (error, persons) {
      if (error) {
        return callback(error);
      }
      data.persons = persons;
      app.models.relationship.removeReadOnlyProperties(data);
      app.models.relationship
        .create(Object.assign(data, {outbreakId: outbreakId}))
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
   * @param type
   * @param filter
   * @param callback
   */
  Outbreak.helpers.getPersonRelationship = function (personId, relationshipId, type, filter, callback) {
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
            contextModel: app.models[type].modelName,
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
  Outbreak.helpers.updatePersonRelationship = function (personId, relationshipId, type, data, callback) {
    Outbreak.helpers.validateAndNormalizePeople(personId, type, data, function (error, persons) {
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
              contextModel: app.models[type].modelName,
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
  Outbreak.helpers.deletePersonRelationship = function (personId, relationshipId, callback) {
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
  Outbreak.helpers.countPersonRelationships = function (personId, where, callback) {
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

  /**
   * Parsing the properties that are of type '["date"]' as Loopback doesn't save them correctly
   * Need to parse the date strings to actual date objects
   * Note: data object is altered by this function
   * @param data Data received in the req (req.body)
   */
  Outbreak.helpers.parseArrayOfDates = function (data) {
    // initialize list of properties that are of type array of dates
    let props = ['isolationDates', 'hospitalizationDates', 'incubationDates'];

    // loop through the array of dates properties and parse them
    props.forEach(function (prop) {
      if (Array.isArray(data[prop]) && data[prop].length) {
        data[prop].forEach(function (dateString, index) {
          data[prop][index] = new Date(dateString);
        });
      }
    });
  };

  /**
   * Attach filter people without relation behavior (before remote hook)
   * @param type
   * @param context
   * @param modelInstance
   * @param next
   * @return {*}
   */
  Outbreak.helpers.attachFilterPeopleWithoutRelation = function (type, context, modelInstance, next) {
    // Retrieve all relationships of requested type for the given outbreak
    // Then filter cases based on relations count
    if (context.args.filter && context.args.filter.noRelationships) {
      app.models.relationship
        .find({
          fields: ['persons'],
          where: {
            outbreakId: context.instance.id,
            'persons.type': type
          }
        })
        // build list of people that have relationships in the given outbreak
        .then((relations) => [].concat(...relations.map((relation) => relation.persons.map(((person) => person.id)))))
        .then((peopleWithRelation) => {
          // attach additional filtering for cases that have no relationships
          context.args.filter = app.utils.remote
            .mergeFilters({
              where: {
                id: {
                  nin: peopleWithRelation
                }
              }
            }, context.args.filter);

          return next();
        })
        .catch(next);
    } else {
      return next();
    }
  };

  /**
   * Get the next available visual id
   * @param outbreak
   * @param callback
   */
  Outbreak.helpers.getAvailableVisualId = function (outbreak, callback) {
    let maskRegExp = app.utils.maskField.convertMaskToSearchRegExp(outbreak.caseIdMask);
    app.models.person
      .findOne({
        where: {
          outbreakId: outbreak.id,
          visualId: {
            regexp: maskRegExp
          }
        },
        deleted: true,
        order: 'visualId DESC'
      })
      .then(function (person) {
        let index = 0;
        if (person) {
          index = app.utils.maskField.extractValueFromMaskedField(outbreak.caseIdMask, person.visualId);
        }
        index++;
        app.utils.maskField.resolveMask(outbreak.caseIdMask, index, callback);
      }).catch(callback);
  };

  /**
   * Get a resource link embedded in a QR Code Image (png) for a person
   * @param outbreak
   * @param type
   * @param personId
   * @param callback
   */
  Outbreak.helpers.getPersonQRResourceLink = function (outbreak, type, personId, callback) {
    callback(null, app.utils.qrCode.createResourceLink(type, {
      outbreakId: outbreak.id,
      [`${type}Id`]: personId
    }));
  };

  /**
   * Retrieve list of system reference data and outbreak's specific reference data; Returns the promise
   * @param outbreakId
   * @param filter Optional additional filter for the reference data
   */
  Outbreak.helpers.getSystemAndOwnReferenceData = function (outbreakId, filter) {
    const _filter = app.utils.remote
      .mergeFilters({
          where: {
            or: [
              {
                outbreakId: {
                  eq: null
                }
              },
              {
                outbreakId: outbreakId
              }
            ]
          }
        },
        filter
      );

    return app.models.referenceData
      .find(_filter);
  };


  /**
   * Restrict what users can see based on their assigned permissions
   * @param type
   * @param context
   */
  Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions = function (type, context) {
    /**
     * Create a restricted filter that will allow returning only the data from allowed fields
     * @param filter
     * @param allowedFields
     * @return {*}
     */
    function createRestrictedFilter(filter, allowedFields) {
      // restrict allowed fields
      filter.fields = allowedFields;
      // if there's a nested relation
      if (filter.include) {
        // always work with lists
        if (!Array.isArray(filter.include)) {
          filter.include = [filter.include];
        }
        let includes = [];
        // go through each relation
        filter.include.forEach(function (include) {
          // simple relation, restrict allowed fields
          if (typeof include === 'string') {
            includes.push({
              relation: include,
              scope: {
                fields: allowedFields
              }
            });
            // complex relation
          } else {
            // complex relation with scope
            if (include.scope) {
              // remove queries (as they may query unavailable data)
              delete include.scope.where;
              if (include.scope) {
                // process sub-scope
                include.scope = createRestrictedFilter(include.scope, allowedFields);
              }
              // no scope on relation, restrict allowed fields
            } else {
              include.scope = {
                fields: allowedFields
              };
            }
            // update includes
            includes.push(include);
          }
        });
        // update filter
        filter.include = includes;
      }
      // return processed filter
      return filter;
    }

    // get the list of permissions
    const permissions = _.get(context, 'req.authData.user.permissionsList', []);
    // get existing filter
    let filter = _.get(context, 'args.filter', {});
    // create a map of required permissions for each type
    let requiredPermissionMap = {
      'case': 'read_case',
      'event': 'read_case',
      'contact': 'read_contact'
    };
    // if the required permission is missing
    if (permissions.indexOf(requiredPermissionMap[type]) === -1) {
      // use restricted field
      filter = createRestrictedFilter(filter, ['id', 'relationships', 'persons', 'people']);
      // update filter
      _.set(context, 'args.filter', filter);
    }
  }
};
