'use strict';

const app = require('../../server/server');
const _ = require('lodash');

// used to manipulate dates
const moment = require('moment');

module.exports = function (Outbreak) {

  const arrayFields = {
    'addresses': 'address',
    'documents': 'document',
    'hospitalizationDates': 'dateRange',
    'incubationDates': 'dateRange',
    'isolationDates': 'dateRange',
    'person': 'person',
    'labResults': 'labResult',
    'relationships': 'relationship'
  };

  // initialize model helpers
  Outbreak.helpers = {};
  // set a higher limit for event listeners to avoid warnings (we have quite a few listeners)
  Outbreak.setMaxListeners(40);

  /**
   * Checks whether the given follow up model is generated
   * Checks that update/create dates are on the same
   * Checks that it is not performed or lost
   * @param model
   * @returns {boolean}
   */
  Outbreak.helpers.isNewGeneratedFollowup = function (model) {
    return moment(model.createdAt).isSame(moment(model.updatedAt))
      && model.isGenerated
      && !model.performed
      && !model.lostToFollowUp;
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
          type: type,
          source: true
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
                // this person is a target
                data.persons[index].target = true;
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
   * @param options
   * @param callback
   */
  Outbreak.helpers.createPersonRelationship = function (outbreakId, personId, type, data, options, callback) {
    Outbreak.helpers.validateAndNormalizePeople(personId, type, data, function (error, persons) {
      if (error) {
        return callback(error);
      }
      data.persons = persons;
      app.models.relationship.removeReadOnlyProperties(data);
      app.models.relationship
        .create(Object.assign(data, {outbreakId: outbreakId}), options)
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
   * @param options
   * @param callback
   */
  Outbreak.helpers.updatePersonRelationship = function (personId, relationshipId, type, data, options, callback) {
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
          return relationship.updateAttributes(data, options);
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
   * @param options
   * @param callback
   */
  Outbreak.helpers.deletePersonRelationship = function (personId, relationshipId, options, callback) {
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
        return relationship.destroy(options);
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
  };

  /**
   * Count the contacts by follow-up flag (eg: performed, lostToFollowUp)
   * Note: The contacts are counted in total and per team. If a contact is lost to follow-up by 2 teams it will be counted once in total and once per each team.
   * @param options Object containing outbreakId, follow-up flag name and result property
   * @param filter
   * @param callback
   */
  Outbreak.helpers.countContactsByFollowUpFlag = function (options, filter, callback) {
    // get options
    let followUpFlag = options.followUpFlag;
    let resultProperty = options.resultProperty;

    // initialize result
    let results = {
      [resultProperty]: 0,
      teams: []
    };

    // get all the followups for the filtered period
    app.models.followUp.find(app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: options.outbreakId
        }
      }, filter || {}))
      .then(function (followups) {
        // filter by relation properties
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);

        // initialize map of contacts to not count same contact twice
        let contacts = {};
        // initialize map of teams
        let teams = {};

        followups.forEach(function (followup) {
          // get contactId
          let contactId = followup.personId;
          // get teamId; there might be no team id, set null
          let teamId = followup.teamId || null;

          // check if a followup for the same contact was already parsed
          if (contacts[contactId]) {
            // check if there was another followup for the same team
            // if so check for the cached follow-up flag value; eg: check for the cached lostToFollowUp flag
            // if the previous followup flag was true there is no need to update any counter;
            // counter will not be incremented even though the new followup flag was also true; eg: will not increment even though the new follow-up is also lostToFollowUp
            // updates needed only for the case where the previous followup flag was false and the current one is true; eg: previous follow-up was not lostToFollowUp and the current one is
            if (contacts[contactId].teams[teamId]) {
              if (!contacts[contactId].teams[teamId][followUpFlag] && followup[followUpFlag] === true) {
                // update follow-up flag
                contacts[contactId].teams[teamId][followUpFlag] = true;
                // increase counter for team
                teams[teamId][resultProperty]++;
              }
            } else {
              // new teamId
              // cache followup flag information for contact in team
              contacts[contactId].teams[teamId] = {
                [followUpFlag]: followup[followUpFlag]
              };

              // initialize team entry if doesn't already exist
              teams[teamId] = teams[teamId] || {
                id: teamId,
                [resultProperty]: 0
              };

              // increase counter for the team
              followup[followUpFlag] && teams[teamId][resultProperty]++;
            }

            // check if the previous flag value was  false and the current one is true
            // eg: check if contact didn't have a lostToFollowUp followup and the current one was lostToFollowUp
            // as specified above for teams this is the only case where updates are needed
            if (!contacts[contactId][followUpFlag] && followup[followUpFlag] === true) {
              // update overall follow-up flag
              contacts[contactId][followUpFlag] = true;
              // increase successful total counter
              results[resultProperty]++;
            }
          } else {
            // first followup for the contact
            // cache followup flag information for contact in team and overall; eg: cache lostToFollowUp flag
            contacts[contactId] = {
              teams: {
                [teamId]: {
                  [followUpFlag]: followup[followUpFlag]
                }
              },
              [followUpFlag]: followup[followUpFlag]
            };

            // initialize team entry if doesn't already exist
            teams[teamId] = teams[teamId] || {
              id: teamId,
              [resultProperty]: 0
            };

            // increase counters if the follow-up flag is true
            // eg: if the contact was lost to follow-up
            if (followup[followUpFlag]) {
              results[resultProperty]++;
              teams[teamId][resultProperty]++;
            }
          }
        });

        // update results.teams; sending array with teams information only for the teams that have contacts
        results.teams = _.values(teams).filter(teamEntry => teamEntry[resultProperty]);

        // send response
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Build/Count new transmission chains from registered contacts who became cases
   * @param outbreak
   * @param filter
   * @param countOnly
   * @param callback
   */
  Outbreak.helpers.buildOrCountNewChainsFromRegisteredContactsWhoBecameCases = function (outbreak, filter, countOnly, callback) {
    // build a filter for finding cases who came from registered contacts and their relationships that appeared happened after they became cases
    const _filter = {
        where: {
          outbreakId: outbreak.id,
          dateBecomeCase: {
            neq: null
          }
        },
        fields: ['id', 'relationships', 'dateBecomeCase'],
        include: [
          {
            relation: 'relationships',
            fields: ['id', 'contactDate'],
            scope: {
              filterParent: true
            }
          }
        ]
      }
    ;
    // find the cases
    app.models.case
      .find(_filter)
      .then(function (cases) {
        // remove those without relations
        cases = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(cases, _filter);
        // keep a list of relationIds
        const relationshipIds = [];
        // go through all the cases
        cases.forEach(function (caseRecord) {
          if (Array.isArray(caseRecord.relationships)) {
            // go trough their relationships
            caseRecord.relationships.forEach(function (relationship) {
              // store only the relationships that are newer than their conversion date
              if ((new Date(relationship.contactDate)) > (new Date(caseRecord.dateBecomeCase))) {
                relationshipIds.push(relationship.id);
              }
            });
          }
        });
        // build/count transmission chains starting from the found relationIds
        app.models.relationship.buildOrCountTransmissionChains(outbreak.id, outbreak.periodOfFollowup, app.utils.remote.mergeFilters({
          where: {
            id: {
              inq: relationshipIds
            }
          }
        }, filter || {}), countOnly, callback);
      })
      .catch(callback);
  };

  /**
   * Validates whether a given visual identifier is unique per given outbreak
   * If not, then a DUPLICATE_VISUAL_ID error is built and returned
   * @param outbreakId Outbreaks identifier
   * @param visualId Visual identifier (string)
   * @returns Promise { false (if unique), error }
   */
  Outbreak.helpers.validateVisualIdUniqueness = function (outbreakId, visualId) {
    return app.models.person
      .findOne({
        where: {
          outbreakId: outbreakId,
          visualId: visualId
        },
        deleted: true
      })
      .then((instance) => {
        if (!instance) {
          // is unique, returning undefined, to be consistent with callback usage
          return;
        }
        // not unique, return crafted error
        return app.utils.apiError.getError('DUPLICATE_VISUAL_ID', {
          id: visualId
        });
      });
  };

  /**
   * Merge 2 or more 'person' models of the same type
   * @base base model to be merged upon
   * @people list of 'person' models to be merged into 'base'
   * @type person type: case/contact supported
   */
  Outbreak.helpers.mergePersonModels = function (base, people, type) {
    // declare list of properties specific for case/contacts
    const contactProps = [
      'riskLevel',
      'riskReason'
    ];
    const caseProps = [
      'dateOfInfection',
      'dateOfOnset',
      'isDateOfOnsetApproximate',
      'dateBecomeCase',
      'dateOfOutcome',
      'deceased',
      'dateDeceased',
      'classification',
      'riskLevel',
      'riskReason',
      'transferRefused'
    ];
    // the following case props are array and should be treated differently
    const caseArrayProps = [
      'isolationDates',
      'hospitalizationDates',
      'incubationDates',
    ];

    // decide which type of properties map to use, based on given type
    let propsMap = type === 'case' ? caseProps : contactProps;

    // get reference to properties of the base model
    let baseProps = base.__data;

    // list of properties that should be looked upon, levels below
    let missingProps = [];

    // iterate over case predefined props map
    for (let propName in propsMap) {
      // make sure the property is belonging to the model
      // note: undefined, null are taken into consideration as well
      // doing abstract equality, to check for both undefined/null values
      if (!baseProps.hasOwnProperty(propName) || baseProps[propName] == null) {
        missingProps.push(propName);
      }
    }

    // start working the properties that were missing in the base case
    missingProps.forEach((prop) => {
      for (let i = 1; i < people.length; i++) {
        let props = people[i].__data;
        if (props.hasOwnProperty(prop) && props[prop] !== null) {
          baseProps[prop] = props[prop];
          break;
        }
      }
    });

    // merge all case array props
    if (type === 'case') {
      caseArrayProps.forEach((arrayProp) => {
        baseProps[arrayProp] = baseProps[arrayProp] || [];
        baseProps[arrayProp] = baseProps[arrayProp].concat(...
          people
            .filter((item) => item[arrayProp])
            .map((item) => item[arrayProp])
        );
      });
    }

    // merge all address
    baseProps.addresses = baseProps.addresses || [];
    baseProps.addresses = baseProps.addresses.concat(
      ...people
        .filter((item) => item.addresses)
        .map((item) => item.addresses)
    );

    // merge all documents, accept only unique type,number combination
    baseProps.documents = baseProps.documents || [];
    baseProps.documents = baseProps.documents.concat(
      ...people
        .filter((item) => item.documents)
        .map((item) => {
          return item.documents.filter((doc) => baseProps.documents.findIndex((resultItem) => {
            return resultItem.type === doc.type && resultItem.number === doc.number;
          }) === -1);
        })
    );

    return base;
  };

  /**
   * Translate all marked referenceData fields of a model, or an array of models
   * @param modelName
   * @param model
   * @param contextUser
   * @param dictionary
   */
  Outbreak.helpers.translateDataSetReferenceDataValues = function (dataSet, modelName, contextUser, dictionary) {
    if(Array.isArray(dataSet)) {
      dataSet.forEach((model) => {
        Outbreak.helpers.translateModelReferenceDataValues(model, modelName, contextUser, dictionary)
      })
    } else {
      Outbreak.helpers.translateModelReferenceDataValues(dataSet, modelName, contextUser, dictionary)
    }
  };

  /**
   * Translate all marked referenceData fields of a model
   * @param model
   * @param modelName
   * @param contextUser
   * @param dictionary
   */
  Outbreak.helpers.translateModelReferenceDataValues = function (model, modelName, contextUser, dictionary) {
    app.models[modelName].referenceDataFields.forEach((field) => {
      if (field.indexOf('.') === -1) {
        if (_.get(model, field)) {
          _.set(model, field, app.models.language.getFieldTranslationFromDictionary(_.get(model, field), contextUser.languageId, dictionary));
        }
      } else {
        // separate the string into the name of the array type property and the name the field that needs to be translated
        let mainKey = field.split('.')[0];
        Outbreak.helpers.translateDataSetReferenceDataValues(model[mainKey], arrayFields[mainKey], contextUser, dictionary);
      }
    });
  };

  /**
   * Translate all marked field labels of a model
   * @param modelName
   * @param model
   * @param contextUser
   * @param dictionary
   */
  Outbreak.helpers.translateFieldLabels = function (model, modelName, contextUser, dictionary) {
    return _.mapKeys(model, (value, key) => {
      if(app.models[modelName] && app.models[modelName].fieldLabelsMap[key]) {
        if(Array.isArray(value) && value.length && typeof(value[0]) === 'object' && arrayFields[key]) {
          value.forEach((element, index) => {
            model[key][index] = Outbreak.helpers.translateFieldLabels(model[key][index], arrayFields[key], contextUser, dictionary);
          })
        } else if (typeof(value) === 'object' && Object.keys(value).length > 0) {
          model[key] = Outbreak.helpers.translateFieldLabels(value, arrayFields[key], contextUser, dictionary);
        }
        return app.models.language.getFieldTranslationFromDictionary(app.models[modelName].fieldLabelsMap[key], contextUser.languageId, dictionary);
      } else {
        return key;
      }
    })
  };
};
