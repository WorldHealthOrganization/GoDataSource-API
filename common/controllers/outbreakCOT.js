'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with COT related actions
 */

const app = require('../../server/server');
const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const config = require('../../server/config.json');

// calculate cot storage path
const cotStoragePath = config.cot && config.cot.containerPath ?
  (
    // use configured path; if relative make it relative to config.json
    path.isAbsolute(config.cot.containerPath) ?
      path.resolve(config.cot.containerPath) :
      path.resolve(__dirname, '../../server', config.cot.containerPath)
  ) :
  // default
  path.resolve(__dirname, '../../server/storage/files');

module.exports = function (Outbreak) {
  /**
   * Get independent transmission chains
   * @param {Object} filter - also accepts 'active' boolean on the first level in 'where'. Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param {Object} options
   * @param {Function} callback
   */
  Outbreak.prototype.getIndependentTransmissionChains = function (filter, options, callback) {
    Outbreak
      .helpers
      .getIndependentTransmissionChains(this, filter, options)
      .then(result => {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Calculate independent transmission chains in async mode
   * @param {Object} filter - also accepts 'active' boolean on the first level in 'where'. Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param {Object} options
   * @param {Function} callback
   */
  Outbreak.prototype.calculateIndependentTransmissionChains = function (filter, options, callback) {
    const self = this;

    let cotDBEntry;
    // create cot DB entry
    app.models.transmissionChain
      .create({
        outbreakId: self.id,
        startDate: new Date(),
        status: 'LNG_COT_STATUS_IN_PROGRESS'
      }, options)
      .then(result => {
        // send response
        callback(null, result.id);

        // cache cot db entry
        cotDBEntry = result;

        return Outbreak
          .helpers
          .getIndependentTransmissionChains(self, filter, options);
      })
      .then(cot => {
        // save to file
        return fs
          .writeJSON(path.resolve(cotStoragePath, `${cotDBEntry.id}.json`), cot);
      })
      .then(() => {
        // file was saved; update db entry
        return cotDBEntry
          .updateAttributes({
            status: 'LNG_COT_STATUS_SUCCESS',
            endDate: new Date()
          });
      })
      .catch(err => {
        if (!cotDBEntry) {
          // error was encountered when creating db entry
          return callback(err);
        }

        // error was encountered when calculating cot or saving file
        cotDBEntry
          .updateAttributes({
            status: 'LNG_COT_STATUS_FAILED',
            error: err.toString() ? err.toString() : JSON.stringify(err),
            endDate: new Date()
          })
          .catch(err => {
            options.remotingContext.req.logger.debug(`Transmission chain (${cotDBEntry.id}) calculation failed with error ${err}`);
          });
      });
  };

  /**
   * Count independent transmission chains
   * @param filter Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param options
   * @param callback
   */
  Outbreak.prototype.countIndependentTransmissionChains = function (filter, options, callback) {
    // outbreak instance
    const self = this;

    // we don't need to retrieve all fields from database to determine the number of chains
    filter.retrieveFields = {
      edges: {
        id: 1,
        contactDate: 1,
        persons: 1
      },
      nodes: {
        id: 1,
        type: 1
      }
    };

    // processed filter
    this.preProcessTransmissionChainsFilter(filter, options)
      .then(function (processedFilter) {
        // we don't need to retrieve all fields from database to determine the number of chains
        Object.assign(
          processedFilter.filter, {
            retrieveFields: filter.retrieveFields
          }
        );

        // use processed filters
        filter = processedFilter.filter;
        const endDate = processedFilter.endDate;

        // end date is supported only one first level of where in transmission chains
        _.set(filter, 'where.endDate', endDate);

        // count transmission chains
        app.models.relationship
          .countTransmissionChains(self.id, self.periodOfFollowup, filter, processedFilter.geographicalRestrictionsQuery, function (error, noOfChains) {
            if (error) {
              return callback(error);
            }

            // we don't require to count isolated nodes
            delete noOfChains.isolatedNodes;
            delete noOfChains.nodes;
            callback(null, noOfChains);
          });
      });
  };

  /**
   * Count new cases in known transmission chains
   * @param filter Besides the default filter properties this request also accepts 'noDaysInChains': number on the first level in 'where'
   * @param options
   * @param callback
   */
  Outbreak.prototype.countNewCasesInKnownTransmissionChains = function (filter, options, callback) {
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
      .filterKnownTransmissionChains(this.id, filter, options)
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
   * Get a list of relationships that links cases with long periods between the dates of onset
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.longPeriodsBetweenDatesOfOnsetInTransmissionChains = function (filter, options, callback) {
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
        }, filter || {}), options)
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
   * Get a list of secondary cases that have date of onset before the date of onset of primary cases
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.findSecondaryCasesWithDateOfOnsetBeforePrimaryCase = function (filter, options, callback) {
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
        }, filter || {}), options)
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
   * Build new transmission chains from registered contacts who became cases
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.buildNewChainsFromRegisteredContactsWhoBecameCases = function (filter, options, callback) {
    // determine if we need to send to client just some specific fields
    filter.retrieveFields = {
      edges: {
        id: 1,
        contactDate: 1,
        persons: 1
      },
      nodes: {
        id: 1,
        type: 1
      }
    };
    if (
      filter.fields &&
      filter.fields.length > 0
    ) {
      // determine visible and format visible fields
      const edgesName = 'edges.';
      const nodesName = 'nodes.';
      filter.fields.forEach((field) => {
        // check if we have fields for our objects
        if (field.toLowerCase().startsWith(edgesName)) {
          // push to fields array
          filter.retrieveFields.edges[field.substring(edgesName.length)] = 1;
        } else if (field.toLowerCase().startsWith(nodesName)) {
          // push to fields array
          filter.retrieveFields.nodes[field.substring(nodesName.length)] = 1;
        }
      });
    }

    // build cot data
    Outbreak.helpers.buildOrCountNewChainsFromRegisteredContactsWhoBecameCases(this, filter, false, options, callback);
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
   * @param options
   * @param callback
   */
  Outbreak.prototype.countNewChainsFromRegisteredContactsWhoBecameCases = function (filter, options, callback) {
    // we don't need to retrieve all fields from database to determine the number of chains
    filter.retrieveFields = {
      edges: {
        id: 1,
        contactDate: 1,
        persons: 1
      },
      nodes: {
        id: 1,
        type: 1
      }
    };

    // build cot
    Outbreak.helpers.buildOrCountNewChainsFromRegisteredContactsWhoBecameCases(this, filter, true, options, function (error, result) {
      if (error) {
        return callback(error);
      }
      // there is no need for the nodes, it's just a count
      delete result.nodes;
      delete result.isolatedNodes;
      callback(null, result);
    });
  };
};
