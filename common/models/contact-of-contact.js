'use strict';

const app = require('../../server/server');
const dateParser = app.utils.helpers.getDateDisplayValue;
const _ = require('lodash');

module.exports = function (ContactOfContact) {
  // set flag to not get controller
  ContactOfContact.hasController = false;

  // initialize model helpers
  ContactOfContact.helpers = {};

  /**
   * Return a list of field labels map that are allowed for export
   */
  ContactOfContact.helpers.sanitizeFieldLabelsMapForExport = () => {
    // make sure we don't alter the original array
    const fieldLabelsMap = {};

    // relationship person labels
    const relationshipFieldLabelsMap = {
      'relatedId': 'LNG_RELATIONSHIP_FIELD_LABEL_PERSONS_RELATED_PERSON',
      'contactDate': 'LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE',
      'contactDateEstimated': 'LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE_ESTIMATED',
      'certaintyLevelId': 'LNG_RELATIONSHIP_FIELD_LABEL_CERTAINTY_LEVEL',
      'exposureTypeId': 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_TYPE',
      'exposureFrequencyId': 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_FREQUENCY',
      'exposureDurationId': 'LNG_RELATIONSHIP_FIELD_LABEL_EXPOSURE_DURATION',
      'socialRelationshipTypeId': 'LNG_RELATIONSHIP_FIELD_LABEL_RELATION',
      'socialRelationshipDetail': 'LNG_RELATIONSHIP_FIELD_LABEL_RELATION_DETAIL',
      'clusterId': 'LNG_RELATIONSHIP_FIELD_LABEL_CLUSTER',
      'comment': 'LNG_RELATIONSHIP_FIELD_LABEL_COMMENT',
    };

    // append source export fields
    Object.assign(
      fieldLabelsMap,
      ContactOfContact.fieldLabelsMap,
      _.transform(
        relationshipFieldLabelsMap,
        (tokens, token, property) => {
          tokens[`relationship.${property}`] = token;
        },
        {}
      ), {
        'relationship': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_RELATIONSHIP'
      }
    );

    // finished
    return fieldLabelsMap;
  };

  ContactOfContact.fieldLabelsMap = Object.assign({}, ContactOfContact.fieldLabelsMap, {
    'firstName': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_AGE',
    'age.years': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_AGE_YEARS',
    'age.months': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_AGE_MONTHS',
    'dob': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_DOB',
    'documents': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_DOCUMENTS',
    'documents[].type': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_DOCUMENT_TYPE',
    'documents[].number': 'LNG_CONTACT_OF_CONTACT_OF_CONTACT_FIELD_LABEL_DOCUMENT_NUMBER',
    'wasCase': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_WAS_CASE',
    'dateBecomeContact': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_DATE_BECOME_CONTACT',
    'dateOfReporting': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_DATE_OF_REPORTING',
    'dateOfLastContact': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_DATE_OF_LAST_CONTACT',
    'riskLevel': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_RISK_REASON',
    'outcomeId': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_OUTCOME_ID',
    'dateOfOutcome': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_DATE_OF_OUTCOME',
    'visualId': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_VISUAL_ID',
    'type': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_TYPE',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'addresses[].typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'addresses[].country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'addresses[].city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addresses[].addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'addresses[].addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'addresses[].postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'addresses[].locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'addresses[].geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'addresses[].geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'addresses[].geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'addresses[].geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'addresses[].date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'addresses[].phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    'isDateOfReportingApproximate': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
    'safeBurial': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_SAFE_BURIAL',
    'dateOfBurial': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_DATE_OF_BURIAL',
    'vaccinesReceived': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_VACCINES_RECEIVED',
    'vaccinesReceived[].vaccine': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_VACCINE',
    'vaccinesReceived[].date': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_VACCINE_DATE',
    'vaccinesReceived[].status': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_VACCINE_STATUS',
    'pregnancyStatus': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_PREGNANCY_STATUS'
  });

  ContactOfContact.exportFieldsOrder = [
    'id',
    'visualId',
    'dateOfReporting',
    'isDateOfReportingApproximate'
  ];

  ContactOfContact.arrayProps = {
    addresses: {
      'typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
      'country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
      'city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
      'addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
      'addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
      'postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
      'locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
      'geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
      'geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
      'geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
      'geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
      'date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
      'phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    },
    documents: {
      'type': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_DOCUMENT_TYPE',
      'number': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_DOCUMENT_NUMBER'
    },
    vaccinesReceived: {
      'vaccine': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_VACCINE',
      'date': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_VACCINE_DATE',
      'status': 'LNG_CONTACT_OF_CONTACT_FIELD_LABEL_VACCINE_STATUS',
    }
  };

  ContactOfContact.referenceDataFieldsToCategoryMap = {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    outcomeId: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'addresses[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
    'vaccinesReceived[].vaccine': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE',
    'vaccinesReceived[].status': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS',
    pregnancyStatus: 'LNG_REFERENCE_DATA_CATEGORY_PREGNANCY_STATUS'
  };

  ContactOfContact.referenceDataFields = Object.keys(ContactOfContact.referenceDataFieldsToCategoryMap);

  // add parsers for field values that require parsing when displayed (eg. in pdf)
  ContactOfContact.fieldToValueParsersMap = {
    dob: dateParser,
    dateOfOutcome: dateParser,
    dateOfBurial: dateParser,
    'addresses[].date': dateParser
  };
  ContactOfContact.fieldsToParse = Object.keys(ContactOfContact.fieldToValueParsersMap);

  // contact fields to print
  ContactOfContact.printFieldsinOrder = [
    'visualId',
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'dob',
    'age',
    'occupation',
    'addresses',
    'documents',
    'riskLevel',
    'riskReason',
    'wasCase',
    'outcomeId',
    'dateOfOutcome',
    'dateBecomeContact',
    'safeBurial',
    'dateOfBurial',
    'vaccinesReceived',
    'pregnancyStatus',
    'dateOfReporting',
    'isDateOfReportingApproximate'
  ];

  ContactOfContact.locationFields = [
    'addresses[].locationId'
  ];

  ContactOfContact.foreignKeyResolverMap = {
    'addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].clusterId': {
      modelName: 'cluster',
      useProperty: 'name'
    },
    'relationships[].people[].addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].address.locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].burialLocationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].dateRanges[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    }
  };

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  ContactOfContact.nestedGeoPoints = [
    'addresses[].geoLocation'
  ];

  /**
   * Pre-filter contact of contacts for an outbreak using related contact
   * @param outbreak
   * @param filter Supports 'where.contact' MongoDB compatible queries
   * @return {Promise<void | never>}
   */
  ContactOfContact.preFilterForOutbreak = function (outbreak, filter) {
    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // related contact filter option
    let relatedContactFilter = filter.where.contact;
    if (relatedContactFilter) {
      delete filter.where.contact;
    }

    // main filter options
    let mainFilter = filter.where;

    // we build the final query object, by chaining few async jobs
    let resultQuery = Promise.resolve();

    // find related contacts in the current outbreak
    if (relatedContactFilter) {
      relatedContactFilter = {
        $and: [
          relatedContactFilter,
          {
            outbreakId: outbreak.id
          }
        ]
      };
      // find the related contacts in database
      resultQuery = resultQuery.then(() => {
        return app.models.contact.rawFind(relatedContactFilter, {projection: {_id: 1}})
          .then(records => {
            // find relationships with contact of contacts
            return app.models.relationship.rawFind(
              {
                outbreakId: outbreak.id,
                'persons.id': {
                  $in: records.map(record => record.id)
                },
                'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT'
              },
              {
                projection: {
                  persons: 1
                }
              })
              .then(relationships => {
                // gather contact of contact ids from relationships
                const ids = [];
                relationships.forEach(relationship => {
                  if (Array.isArray(relationship.persons)) {
                    relationship.persons.forEach(person => {
                      if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT') {
                        ids.push(person.id);
                      }
                    });
                  }
                });
                // attach related records to the main filter
                mainFilter = {
                  and: [
                    mainFilter,
                    {
                      id: {
                        inq: ids
                      }
                    }
                  ]
                };
                return ids;
              });
          });
      });
    }
    return resultQuery
      .then(() => {
        // restrict filter to the current outbreak
        mainFilter = {
          and: [
            mainFilter,
            {
              outbreakId: outbreak.id
            }
          ]
        };
        return Object.assign(
          filter,
          {
            where: mainFilter
          }
        );
      });
  };
};