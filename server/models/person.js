'use strict';

// requires
const _ = require('lodash');
const async = require('async');
const mapsApi = require('../../components/mapsApi');
const app = require('../server');
const personDuplicate = require('../../components/workerRunner').personDuplicate;

module.exports = function (Person) {

  Person.hasController = false;

  // define a list of custom (non-loopback-supported) relations
  Person.customRelations = {
    relationships: {
      type: 'hasManyEmbedded',
      model: 'relationship',
      foreignKey: 'persons.id'
    },
    // case/contacts have locations
    locations: {
      type: 'belongsToManyComplex',
      model: 'location',
      foreignKeyContainer: 'addresses',
      foreignKey: 'locationId'
    },
    // event has location
    location: {
      type: 'belongsToEmbedded',
      model: 'location',
      foreignKey: 'address.locationId'
    }
  };

  Person.fieldLabelsMap = Object.assign({}, Person.fieldLabelsMap, {
    'firstName': 'LNG_CASE_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CASE_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CASE_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CASE_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CASE_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CASE_FIELD_LABEL_AGE',
    'dob': 'LNG_CASE_FIELD_LABEL_DOB',
    'classification': 'LNG_CASE_FIELD_LABEL_CLASSIFICATION',
    'dateBecomeCase': 'LNG_CASE_FIELD_LABEL_DATE_BECOME_CASE',
    'dateDeceased': 'LNG_CASE_FIELD_LABEL_DATE_DECEASED',
    'dateOfInfection': 'LNG_CASE_FIELD_LABEL_DATE_OF_INFECTION',
    'dateOfOnset': 'LNG_CASE_FIELD_LABEL_DATE_OF_ONSET',
    'phoneNumber': 'LNG_CASE_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CASE_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CASE_FIELD_LABEL_RISK_REASON',
    'dateOfOutcome': 'LNG_CASE_FIELD_LABEL_DATE_OF_OUTCOME',
    'deceased': 'LNG_CASE_FIELD_LABEL_DECEASED',
    'documents': 'LNG_CASE_FIELD_LABEL_DOCUMENTS',
    'type': 'LNG_CASE_FIELD_LABEL_TYPE',
    'isolationDates': 'LNG_CASE_FIELD_LABEL_ISOLATION_DATES',
    'hospitalizationDates': 'LNG_CASE_FIELD_LABEL_HOSPITALIZATION_DATES',
    'incubationDates': 'LNG_CASE_FIELD_LABEL_INCUBATION_DATES',
    'transferRefused': 'LNG_CASE_FIELD_LABEL_TRANSFER_REFUSED',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
  });

  Person.referenceDataFields = [
    'gender',
    'classification',
    'riskLevel',
    'occupation',
    'documents.type'
  ];

  Person.printFieldsinOrder = [
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'occupation',
    'age',
    'dob',
    'classification',
    'dateBecomeCase',
    'dateDeceased',
    'dateOfInfection',
    'dateOfOnset',
    'phoneNumber',
    'riskLevel',
    'riskReason',
    'dateOfOutcome',
    'deceased',
    'documents',
    'type',
    'isolationDates',
    'hospitalizationDates',
    'incubationDates',
    'transferRefused',
    'addresses'
  ];

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Person.nestedGeoPoints = [
    'addresses[].geoLocation',
    'address.geoLocation'
  ];

  Person.locationFields = [
    'addresses[].locationId',
    'address.locationId'
  ];

  /**
   * Construct and return the display name of the person
   */
  Person.prototype.getDisplayName = function () {
    return Person.getDisplayName(this);
  };

  /**
   * Construct and return the display name of a given person
   * @param person Model or JSON representation
   */
  Person.getDisplayName = function (person) {
    if (person.toJSON) {
      person = person.toJSON();
    }

    // construct display name
    if (person.name) {
      // for events if they have the name set return the name
      return this.name;
    } else {
      // for case/contact return 'firstName middleName lastName'
      return ['firstName', 'middleName', 'lastName'].reduce(function (result, property) {
        if (person[property]) {
          result += (result.length ? ' ' : '') + person[property];
        }
        return result;
      }, '');
    }
  };

  // helper function used to update a person's address geo location based on city/coutnry/adress lines
  // it queries the maps service to get the actual locations on the map
  // then updates the record
  const updateGeoLocations = function (ctx, addresses) {
    // index is important, for update operation
    let addressLines = addresses.map((addr) => {
      if (!addr) {
        return null;
      }
      return ['addressLine1', 'addressLine2', 'city', 'country', 'postalCode']
        .filter((prop) => addr[prop])
        .map((prop) => addr[prop])
        .join();
    });

    // retrieve geo location for each address string
    // then populate the address geo location
    async.series(
      addressLines.map(function (str) {
        return function (done) {
          if (!str || !mapsApi.isEnabled()) {
            return done();
          }
          mapsApi.getGeoLocation(str, function (err, location) {
            if (err) {
              // error is logged inside the fn
              return done();
            }
            return done(null, location);
          });
        };
      }),
      function (err, locations) {
        Person.findById(ctx.instance.id, (err, instance) => {
          if (!instance) {
            return;
          }

          // create an addresses map and set value to true for the ones
          // that should not be taken into consideration during update hook
          // this is done plainly for default geo location value (undefined)
          ctx.options = ctx.options || {};
          ctx.options.addressesMap = [];

          let addressCopy = instance.addresses.map((item, idx) => {
            item = item.toObject();

            // hack to know that this address index should be left unchanged on next update hook
            ctx.options.addressesMap[idx] = true;

            if (locations[idx]) {
              item.geoLocation = locations[idx];
            }

            return item;
          });

          // update addresses array
          instance.updateAttribute('addresses', addressCopy, ctx.options);
        });
      }
    );
  };


  /**
   * Before save hooks
   */
  Person.observe('before save', function (context, next) {
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);
    // if case classification was changed
    if (
      (
        !context.isNewInstance &&
        data.source.existingRaw.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
        && data.source.existing.classification !== data.source.updated.classification
      ) &&
      (
        // classification changed to/from discarded
        app.models.case.nonDiscardedCaseClassifications.includes(data.source.existing.classification) !==
        app.models.case.nonDiscardedCaseClassifications.includes(data.source.updated.classification)
      )
    ) {
      // set a flag on context to trigger relationship updated due to significant changes in case classification (from/to discarded case)
      context.options.triggerRelationshipUpdates = true;
    }
    next();
  });


  /**
   * After save hooks
   */
  Person.observe('after save', function (ctx, next) {
    // do not execute hook on sync
    if (ctx.options && ctx.options._sync) {
      return next();
    }

    // cache instance reference, used in many places below
    let instance = ctx.instance;

    /**
     * When case classification changes, relations need to be notified because they have business logic associated with case classification
     */
    // if a case was updated and relationship updates need to be triggered
    if (!ctx.isNewInstance && instance.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE' && ctx.options.triggerRelationshipUpdates) {
      // find all of its relationships with a contact
      app.models.relationship
        .find({
          where: {
            'persons.id': instance.id,
            and: [
              {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'},
              {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'}
            ]
          }
        })
        .then(function (relationships) {
          const updateRelationships = [];
          // trigger an update for them (to propagate eventual follow-up period changes)
          relationships.forEach(function (relationship) {
            // nothing to update, just trigger update method to activate the hooks
            updateRelationships.push(relationship.updateAttributes({}, ctx.options));
          });
          // the hook does not need to wait for the changes to propagate
          return Promise.all(updateRelationships);
        })
        .catch(function (err) {
          // log error
          app.logger.error(err);
        });
    }

    /**
     * If address is present in the request, make sure we're getting its geo location from external API
     * We only do this if googleApi.apiKey is present in the config
     */
    // defensive checks
    if (Array.isArray(instance.addresses)) {
      // set address items that have geo location as undefined
      let filteredAddresses = instance.addresses.map((addr, index) => {
        // if the geo location is filled manually or generated, leave it
        // plainly used for case when an update has been made and the hook executed one more time
        if ((_.get(ctx, 'options.addressesMap') && ctx.options.addressesMap[index]) || addr.geoLocation) {
          return null;
        }
        return addr;
      });

      // if all the addresses have geo location generated just stop
      if (filteredAddresses.every((addr) => addr === null)) {
        return next();
      }

      // update geo locations, do not check anything
      updateGeoLocations(ctx, filteredAddresses);
    }
    // do not wait for the above operations to complete
    return next();
  });


  /**
   * Find or count possible person duplicates
   * @param filter
   * @param [countOnly]
   * @return {Promise<any>}
   */
  Person.findOrCountPossibleDuplicates = function (filter, countOnly) {
    // define default filter
    if (filter == null) {
      filter = {};
    }
    // promisify the response
    return new Promise(function (resolve, reject) {
      let where = filter.where || {};
      // query non deleted records only
      where = {
        $and: [
          {
            deleted: {
              $ne: null
            },
          },
          where || {}
        ]
      };
      // use connector directly to bring big number of (raw) results
      app.dataSources.mongoDb.connector.collection('person')
        .find(where)
        .toArray(function (error, people) {
          // handle eventual errors
          if (error) {
            return reject(error);
          }
          let findOrCount;
          if (countOnly) {
            findOrCount = personDuplicate.count.bind(null, people);
          } else {
            findOrCount = personDuplicate.find.bind(null, people, Object.assign({where: where}, filter));
          }
          // find or count duplicate groups
          findOrCount(function (error, duplicates) {
            // handle eventual errors
            if (error) {
              return reject(error);
            }
            // send back the result
            return resolve(duplicates);
          });
        });
    });
  };
};
