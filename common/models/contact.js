'use strict';

const app = require('../../server/server');
const dateParser = app.utils.helpers.getDateDisplayValue;
const _ = require('lodash');
const helpers = require('../../components/helpers');

module.exports = function (Contact) {
  // set flag to not get controller
  Contact.hasController = false;

  // initialize model helpers
  Contact.helpers = {};

  /**
   * Return a list of field labels map that are allowed for export
   */
  Contact.helpers.sanitizeFieldLabelsMapForExport = () => {
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
      'id': 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
      'createdAt': 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_AT',
      'createdBy': 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_BY',
      'updatedAt': 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_AT',
      'updatedBy': 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_BY',
      'deleted': 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED',
      'deletedAt': 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED_AT',
      'createdOn': 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_ON'
    };

    // append source export fields
    Object.assign(
      fieldLabelsMap,
      Contact.fieldLabelsMap,
      _.transform(
        relationshipFieldLabelsMap,
        (tokens, token, property) => {
          tokens[`relationship.${property}`] = token;
        },
        {}
      ), {
        'relationship': 'LNG_CONTACT_FIELD_LABEL_RELATIONSHIP'
      }
    );

    // finished
    return fieldLabelsMap;
  };

  Contact.fieldLabelsMap = Object.assign({}, Contact.fieldLabelsMap, {
    'firstName': 'LNG_CONTACT_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CONTACT_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CONTACT_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CONTACT_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CONTACT_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CONTACT_FIELD_LABEL_AGE',
    'age.years': 'LNG_CONTACT_FIELD_LABEL_AGE_YEARS',
    'age.months': 'LNG_CONTACT_FIELD_LABEL_AGE_MONTHS',
    'followUp': 'LNG_CONTACT_FIELD_LABEL_FOLLOW_UP',
    'followUp.originalStartDate': 'LNG_CONTACT_FIELD_LABEL_FOLLOW_UP_ORIGINAL_START_DATE',
    'followUp.startDate': 'LNG_CONTACT_FIELD_LABEL_FOLLOW_UP_START_DATE',
    'followUp.endDate': 'LNG_CONTACT_FIELD_LABEL_FOLLOW_UP_END_DATE',
    'followUp.status': 'LNG_CONTACT_FIELD_LABEL_FOLLOW_UP_STATUS',
    'dob': 'LNG_CONTACT_FIELD_LABEL_DOB',
    'documents': 'LNG_CONTACT_FIELD_LABEL_DOCUMENTS',
    'documents[].type': 'LNG_CONTACT_FIELD_LABEL_DOCUMENT_TYPE',
    'documents[].number': 'LNG_CONTACT_FIELD_LABEL_DOCUMENT_NUMBER',
    'wasCase': 'LNG_CONTACT_FIELD_LABEL_WAS_CASE',
    'dateBecomeContact': 'LNG_CONTACT_FIELD_LABEL_DATE_BECOME_CONTACT',
    'dateOfReporting': 'LNG_CONTACT_FIELD_LABEL_DATE_OF_REPORTING',
    'dateOfLastContact': 'LNG_CONTACT_FIELD_LABEL_DATE_OF_LAST_CONTACT',
    'riskLevel': 'LNG_CONTACT_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CONTACT_FIELD_LABEL_RISK_REASON',
    'outcomeId': 'LNG_CONTACT_FIELD_LABEL_OUTCOME_ID',
    'dateOfOutcome': 'LNG_CONTACT_FIELD_LABEL_DATE_OF_OUTCOME',
    'visualId': 'LNG_CONTACT_FIELD_LABEL_VISUAL_ID',
    'type': 'LNG_CONTACT_FIELD_LABEL_TYPE',
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
    'addresses[].emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS',
    'isDateOfReportingApproximate': 'LNG_CONTACT_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
    'safeBurial': 'LNG_CONTACT_FIELD_LABEL_SAFE_BURIAL',
    'dateOfBurial': 'LNG_CONTACT_FIELD_LABEL_DATE_OF_BURIAL',
    'vaccinesReceived': 'LNG_CONTACT_FIELD_LABEL_VACCINES_RECEIVED',
    'vaccinesReceived[].vaccine': 'LNG_CONTACT_FIELD_LABEL_VACCINE',
    'vaccinesReceived[].date': 'LNG_CONTACT_FIELD_LABEL_VACCINE_DATE',
    'vaccinesReceived[].status': 'LNG_CONTACT_FIELD_LABEL_VACCINE_STATUS',
    'pregnancyStatus': 'LNG_CONTACT_FIELD_LABEL_PREGNANCY_STATUS',

    // must be last item from the list
    'questionnaireAnswers': 'LNG_CONTACT_FIELD_LABEL_QUESTIONNAIRE_ANSWERS'
  });

  Contact.exportFieldsOrder = [
    'id',
    'visualId',
    'dateOfReporting',
    'isDateOfReportingApproximate'
  ];

  Contact.arrayProps = {
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
      'emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS'
    },
    documents: {
      'type': 'LNG_CONTACT_FIELD_LABEL_DOCUMENT_TYPE',
      'number': 'LNG_CONTACT_FIELD_LABEL_DOCUMENT_NUMBER'
    },
    vaccinesReceived: {
      'vaccine': 'LNG_CONTACT_FIELD_LABEL_VACCINE',
      'date': 'LNG_CONTACT_FIELD_LABEL_VACCINE_DATE',
      'status': 'LNG_CONTACT_FIELD_LABEL_VACCINE_STATUS',
    }
  };

  Contact.sectionsFieldLabels = {
    personalInformation: {
      title: 'LNG_CONTACT_PERSONAL_SECTION',
      labels: [
        'LNG_CONTACT_FIELD_LABEL_VISUAL_ID',
        'LNG_CONTACT_FIELD_LABEL_FIRST_NAME',
        'LNG_CONTACT_FIELD_LABEL_MIDDLE_NAME',
        'LNG_CONTACT_FIELD_LABEL_LAST_NAME',
        'LNG_CONTACT_FIELD_LABEL_GENDER',
        'LNG_CONTACT_FIELD_LABEL_OCCUPATION',
        'LNG_CONTACT_FIELD_LABEL_AGE',
        'LNG_CONTACT_FIELD_LABEL_DOB',
        'LNG_CONTACT_FIELD_LABEL_DATE_OF_REPORTING',
        'LNG_CONTACT_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
        'LNG_CONTACT_FIELD_LABEL_RISK_LEVEL',
        'LNG_CONTACT_FIELD_LABEL_RISK_REASON'
      ]
    },
    addresses: {
      title: 'LNG_CONTACT_FIELD_LABEL_ADDRESSES',
      labels: [
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
        'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
        'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
        'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
        'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
        'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS'
      ]
    },
    documents: {
      title: 'LNG_CONTACT_FIELD_LABEL_DOCUMENTS',
      labels: [
        'LNG_CONTACT_FIELD_LABEL_DOCUMENT_TYPE',
        'LNG_CONTACT_FIELD_LABEL_DOCUMENT_NUMBER'
      ]
    }
  };

  Contact.referenceDataFieldsToCategoryMap = {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    outcomeId: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME',
    pregnancyStatus: 'LNG_REFERENCE_DATA_CATEGORY_PREGNANCY_STATUS',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'addresses[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
    'vaccinesReceived[].vaccine': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE',
    'vaccinesReceived[].status': 'LNG_REFERENCE_DATA_CATEGORY_VACCINE_STATUS',
    'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE'
  };

  Contact.referenceDataFields = Object.keys(Contact.referenceDataFieldsToCategoryMap);

  // add parsers for field values that require parsing when displayed (eg. in pdf)
  Contact.fieldToValueParsersMap = {
    dob: dateParser,
    dateOfOutcome: dateParser,
    dateOfBurial: dateParser,
    'addresses[].date': dateParser,
    'followUps[].date': dateParser
  };
  Contact.fieldsToParse = Object.keys(Contact.fieldToValueParsersMap);

  // contact fields to print
  Contact.printFieldsinOrder = [
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

  Contact.locationFields = [
    'addresses[].locationId'
  ];

  Contact.foreignKeyResolverMap = {
    'addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'followUps[].address.locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'followUps[].teamId': {
      modelName: 'team',
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
  Contact.nestedGeoPoints = [
    'addresses[].geoLocation'
  ];

  /**
   * Update Follow-Up dates if needed (if conditions are met)
   * @param context
   * @return {*|void|Promise<T | never>}
   */
  Contact.updateFollowUpDatesIfNeeded = function (context) {
    // prevent infinite loops
    if (app.utils.helpers.getValueFromContextOptions(context, 'updateFollowUpDatesIfNeeded')) {
      return Promise.resolve();
    }
    let relationshipInstance;
    // get contact instance
    let contactInstance = context.instance;
    // get newest relationship, if any
    return app.models.relationship
      .findOne({
        order: 'contactDate DESC',
        where: {
          'persons.id': contactInstance.id,
          active: true
        }
      })
      .then(function (relationshipRecord) {
        // get relationship instance, if any
        relationshipInstance = relationshipRecord;
        // get the outbreak as we need the followUpPeriod
        return app.models.outbreak.findById(contactInstance.outbreakId);
      })
      .then(function (outbreak) {
        // check for found outbreak
        if (!outbreak) {
          throw app.logger.error(`Error when updating contact (id: ${contactInstance.id}) follow-up dates. Outbreak (id: ${contactInstance.outbreakId}) was not found.`);
        }
        // keep a flag for updating contact
        let shouldUpdate = false;
        // build a list of properties that need to be updated
        // & preserve previous value
        const previousStatusValue = _.get(contactInstance, 'followUp.status');
        const propsToUpdate = {
          status: previousStatusValue ?
            previousStatusValue :
            'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP'
        };
        // preserve original startDate, if any
        if (contactInstance.followUp && contactInstance.followUp.originalStartDate) {
          propsToUpdate.originalStartDate = contactInstance.followUp.originalStartDate;
        }
        // if active relationships found
        if (relationshipInstance) {
          // set follow-up start date to be the same as relationship contact date
          propsToUpdate.startDate = helpers.getDate(relationshipInstance.contactDate).add(1, 'days');
          // if follow-up original start date was not previously set
          if (!propsToUpdate.originalStartDate) {
            // flag as an update
            shouldUpdate = true;
            // set it as follow-up start date
            propsToUpdate.originalStartDate = helpers.getDate(propsToUpdate.startDate);
          }
          // set follow-up end date
          propsToUpdate.endDate = helpers.getDate(propsToUpdate.startDate).add(outbreak.periodOfFollowup - 1, 'days');
        }
        // check if contact instance should be updated (check if any property changed value)
        !shouldUpdate && ['startDate', 'endDate']
          .forEach(function (updatePropName) {
            // if the property is missing (probably never, but lets be safe)
            if (!contactInstance.followUp) {
              // flag as an update
              return shouldUpdate = true;
            }
            // if either original or new value was not set (when the other was present)
            if (
              !contactInstance.followUp[updatePropName] && propsToUpdate[updatePropName] ||
              contactInstance.followUp[updatePropName] && !propsToUpdate[updatePropName]
            ) {
              // flag as an update
              return shouldUpdate = true;
            }
            // both original and new values are present, but the new values are different than the old ones
            if (
              contactInstance.followUp[updatePropName] &&
              propsToUpdate[updatePropName] &&
              ((new Date(contactInstance.followUp[updatePropName])).getTime() !== (new Date(propsToUpdate[updatePropName])).getTime())
            ) {
              // flag as an update
              return shouldUpdate = true;
            }
          });

        // if updates are required
        if (shouldUpdate) {
          // set a flag for this operation so we prevent infinite loops
          app.utils.helpers.setValueInContextOptions(context, 'updateFollowUpDatesIfNeeded', true);
          // update contact
          return contactInstance.updateAttributes({
            followUp: propsToUpdate,
            // contact is active if it has valid follow-up interval
            active: !!propsToUpdate.startDate
          }, context.options);
        }
      });
  };

  /**
   * After save hooks
   */
  Contact.observe('after save', function (context, next) {
    // if this is an exiting record
    if (!context.isNewInstance) {
      // update follow-up dates, if needed
      Contact.updateFollowUpDatesIfNeeded(context)
        .then(function () {
          next();
        })
        .catch(next);
    } else {
      next();
    }
  });

  /**
   * Retrieve all contact's that have follow ups on the given date
   * Group them by place/case/riskLevel
   * If group by place is set, placeLevel property is required
   * @param outbreak
   * @param date
   * @param groupBy
   */
  Contact.getGroupedByDate = function (outbreak, date, groupBy) {

    // process date interval
    let dateInterval = [];
    if (typeof date === 'object' && date.startDate && date.endDate) {
      dateInterval = [helpers.getDate(date.startDate), helpers.getDateEndOfDay(date.endDate)];
    } else if (typeof date === 'string') {
      dateInterval = [helpers.getDate(date), helpers.getDateEndOfDay(date)];
    } else {
      dateInterval = [helpers.getDate(), helpers.getDateEndOfDay()];
    }

    if (groupBy === 'case') {
      let filter = {
        where: {
          outbreakId: outbreak.id
        },
        include: [
          {
            relation: 'followUps',
            scope: {
              where: {
                date: {
                  between: dateInterval
                }
              },
              // remove the contacts that don't have follow ups in the given day
              filterParent: true,
            }
          },
          {
            relation: 'relationships',
            scope: {
              where: {
                'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
              },
              order: 'contactDate DESC',
              limit: 1,
              // remove the contacts that don't have relationships to cases
              filterParent: true,
              // include the case model
              include: [
                {
                  relation: 'people',
                  scope: {
                    where: {
                      type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
                    }
                  }
                }
              ]
            }
          }
        ]
      };

      return Contact
        .find(filter)
        .then((contacts) => {
          // add support for filter parent
          contacts = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(contacts, filter);

          // expose case id to first level, to easily group the contacts
          contacts = contacts.map((contact) => {
            let caseItem = contact.relationships[0].persons
              .find(person => person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE');
            // check for relation integrity (has a case id)
            // if it doesn't just set it to null and remove the entire 'null' group altogether
            contact.caseId = caseItem ? caseItem.id : null;
            return contact;
          });

          // retrieve contact's first address location
          return Promise
            .all(contacts.map((contact) => {
              // get contact address
              let contactAddress = app.models.person.getCurrentAddress(contact);
              if (contactAddress && contactAddress.locationId) {
                return app.models.location
                  .findById(contactAddress.locationId)
                  .then((location) => {
                    if (location) {
                      contactAddress.locationName = location.name;
                    }
                    return contact;
                  });
              }
              return contact;
            }))
            .then((contacts) => {
              // group them by case id
              return _.groupBy(contacts, (c) => c.caseId);
            });
        });
    }

    // group by risk level
    if (groupBy === 'riskLevel') {
      // find follow-ups for specified date interval
      return app.models.followUp
        .rawFind({
          date: {
            between: dateInterval
          },
          outbreakId: outbreak.id,
        }, {
          order: {date: 1}
        })
        .then(function (followUps) {
          // build a followUp map, to easily link them to contacts later
          const followUpMap = {};
          // go through the follow-ups
          followUps.forEach(function (followUp) {
            // add follow-ups to the map
            if (!followUpMap[followUp.personId]) {
              followUpMap[followUp.personId] = [];
            }
            followUpMap[followUp.personId].push(followUp);
          });
          // find the contacts associated with the follow-ups
          return app.models.contact
            .rawFind({
              _id: {
                inq: Array.from(new Set(Object.keys(followUpMap)))
              },
              outbreakId: outbreak.id,
            })
            .then(function (contacts) {
              // build contact groups
              const contactGroups = {};
              // go through the contacts
              contacts.forEach(function (contact) {
                // add their follow-ups
                contact.followUps = followUpMap[contact.id];
                // risk level is optional
                if (contact.riskLevel == null) {
                  contact.riskLevel = 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_UNCLASSIFIED';
                }
                // group contacts by risk level
                if (!contactGroups[contact.riskLevel]) {
                  contactGroups[contact.riskLevel] = [];
                }
                contactGroups[contact.riskLevel].push(contact);
              });
              // sort groups by risk level
              const _contactGroups = {};
              Object.keys(contactGroups).sort().forEach(function (key) {
                _contactGroups[key] = contactGroups[key];
              });
              return _contactGroups;
            });
        });
    }

    // check if we need to send an interval of dates or a single date
    let dateFilter = {dateOfFollowUp: date};
    if (typeof date === 'object') {
      dateFilter = {
        startDate: date.startDate,
        endDate: date.endDate
      };
    }

    // return contacts grouped by location that have follow ups in the given day
    return app.models.person
      .getPeoplePerLocation('contact', dateFilter, outbreak)
      .then((groups) => {
        // rebuild the result to match the structure resulted from 'case' grouping
        // doing this because we're reusing existing functionality that does not build the result the same way
        let contactGroups = {};

        groups.peopleDistribution.forEach((group) => {
          if (group.people.length) {
            contactGroups[group.location.name] = group.people;
          }
        });

        return contactGroups;
      });
  };

  /**
   * Pre-filter contact for an outbreak using related models (case, followUp)
   * @param outbreak
   * @param filter Supports 'where.case', 'where.followUp' MongoDB compatible queries
   * @return {Promise<void | never>}
   */
  Contact.preFilterForOutbreak = function (outbreak, filter) {
    // set a default filter
    filter = filter || {};
    // get cases query, if any
    let casesQuery = _.get(filter, 'where.case');
    // if found, remove it form main query
    if (casesQuery) {
      delete filter.where.case;
    }
    // get followUp query, if any
    let followUpQuery = _.get(filter, 'where.followUp');
    // if found, remove it form main query
    if (followUpQuery) {
      delete filter.where.followUp;
    }
    // get main contact query
    let contactQuery = _.get(filter, 'where', {});
    // start with a resolved promise (so we can link others)
    let buildQuery = Promise.resolve();
    // if a cases query is present
    if (casesQuery) {
      // restrict query to current outbreak
      casesQuery = {
        $and: [
          casesQuery,
          {
            outbreakId: outbreak.id
          }
        ]
      };
      // filter cases based on query
      buildQuery = buildQuery
        .then(function () {
          // find cases that match the query
          return app.models.case
            .rawFind(casesQuery, {projection: {_id: 1}})
            .then(function (cases) {
              // find relationships with contacts for the matched cases
              return app.models.relationship
                .rawFind({
                  outbreakId: outbreak.id,
                  'persons.id': {
                    $in: cases.map(caseRecord => caseRecord.id)
                  },
                  'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
                }, {
                  projection: {persons: 1}
                })
                .then(function (relationships) {
                  // gather contact ids from the found relationships
                  let contactIds = [];
                  // go through the relationships
                  relationships.forEach(function (relationship) {
                    // go through the people
                    Array.isArray(relationship.persons) && relationship.persons.forEach(function (person) {
                      // store contact ids
                      if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
                        contactIds.push(person.id);
                      }
                    });
                  });
                  // update contact query to include contact ids
                  contactQuery = {
                    and: [
                      contactQuery,
                      {
                        id: {
                          inq: contactIds
                        }
                      }
                    ]
                  };
                  return contactIds;
                });
            });
        });
    }
    // if there is a followUp query
    if (followUpQuery) {
      buildQuery = buildQuery
        .then(function (contactIds) {
          // restrict followUp query to current outbreak
          followUpQuery = {
            $and: [
              followUpQuery,
              {
                outbreakId: outbreak.id
              }
            ]
          };
          // if contact ids were provided, restrict the query to those contactIds
          if (contactIds) {
            followUpQuery.$and.push({
              personId: {
                $in: contactIds
              }
            });
          }
          // find followUps that match the query
          return app.models.followUp
            .rawFind(followUpQuery, {projection: {personId: 1}})
            .then(function (followUps) {
              // update contact query to include found contacts
              contactQuery = {
                and: [
                  contactQuery,
                  {
                    id: {
                      inq: followUps.map(followUp => followUp.personId)
                    }
                  }
                ]
              };
            });
        });
    }
    return buildQuery
      .then(function () {
        // restrict contacts query to current outbreak
        contactQuery = {
          and: [
            contactQuery,
            {
              outbreakId: outbreak.id
            }
          ]
        };
        // return updated filter
        return Object.assign(filter, {where: contactQuery});
      });
  };

  /**
   * Archive contact follow-up status changes, when detected
   * @param context
   */
  function archiveFollowUpStatusChanges(context) {
    // get data from context
    const data = app.utils.helpers.getSourceAndTargetFromModelHookContext(context);

    // get data source
    const dataSource = data.source.all;

    // if we don't have followUp data then there is no point in continuing
    if (!dataSource.followUp) {
      return;
    }

    // start with unknown last followUp status
    let lastKnownFollowStatus;

    // if there is a non-empty followUp status history
    if (Array.isArray(dataSource.followUpHistory) && dataSource.followUpHistory.length) {
      // find the last known contact followUp status
      lastKnownFollowStatus = dataSource.followUpHistory.find((followUpItem) => followUpItem.endDate == null);
    }

    // if the last known followUp status was found
    if (lastKnownFollowStatus) {
      // if it's different than current followUp status
      if (dataSource.followUp.status !== lastKnownFollowStatus.status) {
        // end last known followUp status entry
        lastKnownFollowStatus.endDate = new Date();

        // add the new followUp status in the history
        dataSource.followUpHistory.push({
          status: dataSource.followUp.status,
          startDate: lastKnownFollowStatus.endDate
        });
      }

      // update followUp status history
      data.target.followUpHistory = dataSource.followUpHistory;

    } else {
      // no last known followUp status, get existing followUp status history (if any)
      data.target.followUpHistory = dataSource.followUpHistory;

      // if there is no followUp status history
      if (!Array.isArray(data.target.followUpHistory)) {
        // start it now
        data.target.followUpHistory = [];
      }

      // add current followUp status to history
      data.target.followUpHistory.push({
        status: dataSource.followUp.status,
        startDate: new Date()
      });
    }
  }

  /**
   * Before save hooks
   */
  Contact.observe('before save', function (context, next) {
    // archive contact follow-up status
    archiveFollowUpStatusChanges(context);

    // sort multi answer questions
    const data = context.isNewInstance ? context.instance : context.data;
    helpers.sortMultiAnswerQuestions(data);

    // retrieve outbreak data
    let model = _.get(context, 'options.remotingContext.instance');
    if (model) {
      if (!(model instanceof app.models.outbreak)) {
        model = undefined;
      }
    }

    // convert date fields to date before saving them in database
    helpers
      .convertQuestionStringDatesToDates(
        data,
        model ?
          model.contactInvestigationTemplate :
          null
      )
      .then(() => {
        // finished
        next();
      })
      .catch(next);

    // finished
    next();
  });

  Contact.extendedForm = {
    template: 'contactInvestigationTemplate',
    containerProperty: 'questionnaireAnswers',
    isBasicArray: (variable) => {
      return variable.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS';
    }
  };
};
