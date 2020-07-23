'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with COT related actions
 */

const app = require('../../server/server');
const _ = require('lodash');
const genericHelpers = require('../../components/helpers');
const config = require('../../server/config.json');

module.exports = function (Outbreak) {
  /**
   * Get independent transmission chains
   * @param filter Note: also accepts 'active' boolean on the first level in 'where'. Supports endDate property on first level of where. It is used to provide a snapshot of chains until the specified end date
   * @param options
   * @param callback
   */
  Outbreak.prototype.getIndependentTransmissionChains = function (filter, options, callback) {
    const self = this;

    // if contacts of contacts is disabled on the outbreak, do not include them in CoT
    const isContactsOfContactsActive = this.isContactsOfContactsActive;

    // determine if we need to send to client just some specific fields
    if (
      filter.fields &&
      filter.fields.length > 0
    ) {
      // determine visible and format visible fields
      const edgeFields = {};
      const nodeFields = {};
      const edgesName = 'edges.';
      const nodesName = 'nodes.';
      filter.fields.forEach((field) => {
        // check if we have fields for our objects
        if (field.toLowerCase().startsWith(edgesName)) {
          // push to fields array
          edgeFields[field.substring(edgesName.length)] = 1;
        } else if (field.toLowerCase().startsWith(nodesName)) {
          // push to fields array
          nodeFields[field.substring(nodesName.length)] = 1;
        }
      });

      // Edges - push required fields
      Object.assign(
        edgeFields, {
          id: 1,
          contactDate: 1,
          persons: 1
        }
      );

      // Nodes - push required fields
      Object.assign(
        nodeFields, {
          id: 1,
          type: 1
        }
      );

      // set fields
      filter.fields = undefined;
      filter.retrieveFields = {
        edges: edgeFields,
        nodes: nodeFields
      };
    }

    // don't limit by relationships ?
    if (
      filter.where &&
      filter.where.dontLimitRelationships !== undefined
    ) {
      filter.dontLimitRelationships = filter.where.dontLimitRelationships;
      delete filter.where.dontLimitRelationships;
    }

    // process filters
    this.preProcessTransmissionChainsFilter(filter, options).then(function (processedFilter) {
      // use processed filters
      const dontLimitRelationships = filter.dontLimitRelationships;
      filter = Object.assign(
        processedFilter.filter, {
          retrieveFields: filter.retrieveFields
        }
      );
      const personIds = processedFilter.personIds;
      const endDate = processedFilter.endDate;
      const activeFilter = processedFilter.active;
      const includedPeopleFilter = processedFilter.includedPeopleFilter;
      const sizeFilter = processedFilter.size;
      const includeContacts = processedFilter.includeContacts;
      const noContactChains = processedFilter.noContactChains;
      const includeContactsOfContacts = processedFilter.includeContactsOfContacts;

      // don't limit by relationships ?
      if (dontLimitRelationships !== undefined) {
        processedFilter.filter.dontLimitRelationships = dontLimitRelationships;
      }

      // if we need to display specific chains then we need to remove the maxRelationship constraint
      if (
        sizeFilter !== undefined || (
          includedPeopleFilter !== undefined &&
          includedPeopleFilter.length > 0
        )
      ) {
        processedFilter.filter.dontLimitRelationships = true;
      }

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
              includedPeopleFilter: includedPeopleFilter
            },
            transmissionChains,
            {
              includeContacts: includeContacts,
              includeContactsOfContacts: isContactsOfContactsActive && includeContactsOfContacts && includeContacts
            }
          );

          // determine if isolated nodes should be included
          const cotMaxRelationships = config.cot && config.cot.maxRelationships ?
            config.cot.maxRelationships :
            1000;
          const shouldIncludeIsolatedNodes = (
            // there is no size filter
            (sizeFilter == null) &&
            // no included people filter
            !includedPeopleFilter &&
            Object.keys(transmissionChains.edges).length < cotMaxRelationships
          );

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
            // from preprocess function the personIds are already geographically restricted so no need to apply geographic restriction here
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
              return callback(null, transmissionChains);
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
              .rawFind(
                app.utils.remote.convertLoopbackFilterToMongo(isolatedNodesFilter.where),
                filter.retrieveFields && filter.retrieveFields.nodes ? {
                  projection: filter.retrieveFields.nodes
                } : {}
              )
              .then(function (isolatedNodes) {
                // add all the isolated nodes to the complete list of nodes
                isolatedNodes.forEach(function (isolatedNode) {
                  transmissionChains.nodes[isolatedNode.id] = isolatedNode;
                });

                // send answer to client
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
        // & don't limit relationships
        Object.assign(
          processedFilter.filter, {
            retrieveFields: filter.retrieveFields,
            dontLimitRelationships: true
          }
        );

        // use processed filters
        filter = processedFilter.filter;
        const endDate = processedFilter.endDate;

        // end date is supported only one first level of where in transmission chains
        _.set(filter, 'where.endDate', endDate);

        // count transmission chains
        app.models.relationship
          .countTransmissionChains(self.id, self.periodOfFollowup, filter, function (error, noOfChains) {
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
};
