'use strict';

// requires
const _ = require('lodash');
const async = require('async');
const mapsApi = require('../../components/mapsApi');

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
  const updateGeoLocations = function (personId, addresses) {
    // index is important, for update operation
    let addressLines = addresses.map((addr) => {
      if (!addr) {
        return null;
      }
      return `${addr.addressLine1}, ${addr.addressLine2}, ${addr.city}, ${addr.country}, ${addr.country}`;
    });

    // retrieve geo location for each address string
    // then populate the address geo location
    async.parallel(
      addressLines.map((str) => {
        return (done) => {
          if (!str) {
            return done(null, true);
          }
          if (!mapsApi.isEnabled) {
            return done();
          } else {
            mapsApi.getGeoLocation(str, (err, location) => {
              if (err) {
                // error is logged inside the fn
                return done();
              }
              return done(null, { lat: location.lat, lng: location.lng });
            });
          }
        };
      }),
      (err, locations) => {
        Person.findById(personId, (err, instance) => {
          let addressCopy = instance.addresses.map((item, idx) => {
            item = item.toObject();

            // this should be left unchanged
            // geo location was filled manually
            if (locations[idx] === true) {
              return item;
            }

            locations[idx] = locations[idx] || { lat: 0, lng: 0 };
            item.geoLocation = locations[idx];
            return item;
          });

          // update addresses array
          instance.updateAttribute('addresses', addressCopy);
        });
      }
    );
  };

  /**
   * Used to cache the old addresses of an instance
   * To know if the fields of interest required to generate geo location has been changed
   */
  Person.observe('before save', function (ctx, next) {
    if (ctx.isNewInstance) {
      return next();
    }

    // cache current instance addresses on ctx, needed on after save
    ctx.options.oldAddresses = ctx.currentInstance.addresses;

    return next();
  });

  /**
   * If address is present in the request, make sure we're getting its geo location from external API
   * We only do this if googleApi.apiKey is present in the config
   */
  Person.observe('after save', function (ctx, next) {
    // cache instance reference, used in many places below
    let instance = ctx.instance;

    if (ctx.isNewInstance) {
      // defensive checks
      if (Array.isArray(instance.addresses)) {
        // set address items that have geo location as undefined
        // to not be taken into consideration
        // i can't filter those out, because i'm losing the index of the address
        let filteredAddresses = instance.addresses.map((addr) => addr.geoLocation ? null : addr);

        // update geo locations, do not check anything
        updateGeoLocations(instance.id, filteredAddresses);
      }

      // do not wait for the above operation to stop
      return next();
    }

    // check if the properties for interest has been modified
    let propsOfInterest = ['addressLine1', 'addressLine2', 'city', 'country', 'postalCode', 'geoLocation'];
    let oldAddresses = ctx.options.oldAddresses;
    if (oldAddresses) {
      if (!oldAddresses.length) {
        updateGeoLocations(instance.id, instance.addresses.map((addr) => addr.geoLocation ? addr : null));
      } else {
        // find the elements that match all the desired properties
        // if it is a match, do not generate geo location
        let filteredAddresses = instance.addresses.map((addr) => {
          let matchedAddresses = oldAddresses
            .filter((oldAddr) => propsOfInterest.every((prop) => {
              if (prop === 'geoLocation') {
                return oldAddr.geoLocation[0] === addr.geoLocation.lat &&
                  oldAddr.geoLocation[1] === addr.geoLocation.lng;
              }
              return oldAddr[prop] === addr[prop];
            }));

          if (matchedAddresses.length) {
            return null;
          }

          return addr;
        });
        updateGeoLocations(instance.id, filteredAddresses);
      }
    }

    return next();
  });
};
