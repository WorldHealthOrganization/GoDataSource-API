'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with contact of contact related actions
 */

const app = require('../../server/server');
const genericHelpers = require('../../components/helpers');

module.exports = function (Outbreak) {
  /**
   * Retrieve available people for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getContactOfContactRelationshipsAvailablePeople = function (contactOfContactId, filter, options, callback) {
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
        filter,
        options
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
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationshipsAvailablePeople = function (contactOfContactId, where, options, callback) {
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
        where,
        options
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };

  /**
   * Attach before remote (GET outbreaks/{id}/contacts-of-contacts) hooks
   */
  Outbreak.beforeRemote('prototype.findContactsOfContacts', function (context, modelInstance, next) {
    // filter information based on available permissions
    Outbreak.helpers.filterPersonInformationBasedOnAccessPermissions('LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT', context);
    next();
  });

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

        // handle custom filter options
        filter = genericHelpers.attachCustomDeleteFilterOption(filter);

        // count using query
        return app.models.contactOfContact.count(filter.where);
      })
      .then(function (records) {
        callback(null, records);
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
          (results, dictionary) => {
            return new Promise(function (resolve, reject) {
              // determine contacts of contacts for which we need to retrieve the first relationship
              const contactOfContactsMap = _.transform(
                results,
                (r, v) => {
                  r[v.id] = v;
                },
                {}
              );

              // retrieve contact of contacts relationships ( sorted by creation date )
              // only those for which source is a contact ( at this point it shouldn't be anything else than a contact, but we should handle this case since date & source flags should be enough... )
              // in case we don't have any contact of contact Ids there is no point in searching for relationships
              const contactOfContactIds = Object.keys(contactOfContactsMap);
              const promise = contactOfContactIds.length < 1 ?
                Promise.resolve([]) :
                app.models.relationship.find({
                  order: 'createdAt ASC',
                  where: {
                    'persons.id': {
                      inq: contactOfContactIds
                    }
                  }
                });

              // handle exceptions
              promise.catch(reject);

              // retrieve contact of contacts relationships ( sorted by creation date )
              const relationshipsPromises = [];
              promise.then((relationshipResults) => {
                // keep only the first relationship
                // assign relationships to contacts
                _.each(relationshipResults, (relationship) => {
                  // incomplete relationship ?
                  if (relationship.persons.length < 2) {
                    return;
                  }

                  // determine contact of contacts & related ids
                  let contactOfContactId, relatedId;
                  if (relationship.persons[0].target) {
                    contactOfContactId = relationship.persons[0].id;
                    relatedId = relationship.persons[1].id;
                  } else {
                    contactOfContactId = relationship.persons[1].id;
                    relatedId = relationship.persons[0].id;
                  }

                  // check if this is the first relationship for this contact of contacts
                  // if it is, then we need to map information
                  if (
                    contactOfContactsMap[contactOfContactId] &&
                    !contactOfContactsMap[contactOfContactId].relationship
                  ) {
                    // get relationship data
                    contactOfContactsMap[contactOfContactId].relationship = relationship.toJSON();

                    // set related ID
                    contactOfContactsMap[contactOfContactId].relationship.relatedId = relatedId;

                    // resolve relationship foreign keys here
                    relationshipsPromises.push(genericHelpers.resolveModelForeignKeys(
                      app,
                      app.models.relationship,
                      [contactOfContactsMap[contactOfContactId].relationship],
                      dictionary
                    ).then(relationship => {
                      contactOfContactsMap[contactOfContactId].relationship = relationship[0];
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
   * Get all duplicates based on hardcoded rules against a model props
   * @param filter pagination props (skip, limit)
   * @param model
   * @param options
   * @param callback
   */
  Outbreak.prototype.getContactOfContactPossibleDuplicates = function (filter = {}, model = {}, options, callback) {
    app.models.person
      .findDuplicatesByType(filter, this.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT', model, options)
      .then(duplicates => callback(null, duplicates))
      .catch(callback);
  };
};
