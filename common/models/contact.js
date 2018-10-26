'use strict';

const app = require('../../server/server');
const dateParser = app.utils.helpers.getDateDisplayValue;
const moment = require('moment');
const _ = require('lodash');

module.exports = function (Contact) {
  // set flag to not get controller
  Contact.hasController = false;

  Contact.fieldLabelsMap = Object.assign({}, Contact.fieldLabelsMap, {
    'firstName': 'LNG_CONTACT_FIELD_LABEL_FIRST_NAME',
    'middleName': 'LNG_CONTACT_FIELD_LABEL_MIDDLE_NAME',
    'lastName': 'LNG_CONTACT_FIELD_LABEL_LAST_NAME',
    'gender': 'LNG_CONTACT_FIELD_LABEL_GENDER',
    'occupation': 'LNG_CONTACT_FIELD_LABEL_OCCUPATION',
    'age': 'LNG_CONTACT_FIELD_LABEL_AGE',
    'age.years': 'LNG_CONTACT_FIELD_LABEL_AGE_YEARS',
    'age.months': 'LNG_CONTACT_FIELD_LABEL_AGE_MONTHS',
    'dob': 'LNG_CONTACT_FIELD_LABEL_DOB',
    'documents': 'LNG_CONTACT_FIELD_LABEL_DOCUMENTS',
    'documents[].type': 'LNG_CONTACT_FIELD_LABEL_DOCUMENT_TYPE',
    'documents[].number': 'LNG_CONTACT_FIELD_LABEL_DOCUMENT_NUMBER',
    'dateDeceased': 'LNG_CONTACT_FIELD_LABEL_DATE_DECEASED',
    'wasCase': 'LNG_CONTACT_FIELD_LABEL_WAS_CASE',
    'dateBecomeContact': 'LNG_CONTACT_FIELD_LABEL_DATE_BECOME_CONTACT',
    'dateOfReporting': 'LNG_CONTACT_FIELD_LABEL_DATE_OF_REPORTING',
    'phoneNumber': 'LNG_CONTACT_FIELD_LABEL_PHONE_NUMBER',
    'riskLevel': 'LNG_CONTACT_FIELD_LABEL_RISK_LEVEL',
    'riskReason': 'LNG_CONTACT_FIELD_LABEL_RISK_REASON',
    'dateOfOutcome': 'LNG_CONTACT_FIELD_LABEL_DATE_OF_OUTCOME',
    'deceased': 'LNG_CONTACT_FIELD_LABEL_DECEASED',
    'visualId': 'LNG_CONTACT_FIELD_LABEL_VISUAL_ID',
    'addresses': 'LNG_CASE_FIELD_LABEL_ADDRESSES',
    'addresses[].typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'addresses[].country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'addresses[].city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'addresses[].addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'addresses[].addressLine2': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_2',
    'addresses[].postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'addresses[].locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'addresses[].geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'addresses[].date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'fillGeoLocation': 'LNG_CONTACT_FIELD_LABEL_FILL_GEO_LOCATION',
    'isDateOfReportingApproximate': 'LNG_CONTACT_FIELD_LABEL_IS_DATE_OF_REPORTING_APPROXIMATE',
    'safeBurial': 'LNG_CONTACT_FIELD_LABEL_SAFE_BURIAL'
  });

  Contact.referenceDataFieldsToCategoryMap = {
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    'documents[].type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE',
    'addresses[].typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE'
  };

  Contact.referenceDataFields = Object.keys(Contact.referenceDataFieldsToCategoryMap);

  // add parsers for field values that require parsing when displayed (eg. in pdf)
  Contact.fieldToValueParsersMap = {
    dob: dateParser,
    dateDeceased: dateParser,
    'addresses[].date': dateParser,
    'followUps[].date': dateParser
  };
  Contact.fieldsToParse = Object.keys(Contact.fieldToValueParsersMap);

  // contact fields to print
  Contact.printFieldsinOrder = [
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'dob',
    'age',
    'occupation',
    'phoneNumber',
    'addresses',
    'documents',
    'riskLevel',
    'riskReason',
    'wasCase',
    'dateBecomeContact',
    'dateDeceased',
    'deceased',
    'safeBurial'
  ];

  Contact.foreignKeyResolverMap = {
    'addresses[].locationId': {
      modelName: 'location',
      useProperty: 'name'
    },
    'relationships[].people[].addresses[].locationId': {
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
        let propsToUpdate = {};
        propsToUpdate.status = 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP';
        // preserve original startDate, if any
        if (contactInstance.followUp && contactInstance.followUp.originalStartDate) {
          propsToUpdate.originalStartDate = contactInstance.followUp.originalStartDate;
        }
        // if active relationships found
        if (relationshipInstance) {
          // set follow-up start date to be the same as relationship contact date
          propsToUpdate.startDate = moment(relationshipInstance.contactDate).add(1, 'days');
          // if follow-up original start date was not previously set
          if (!propsToUpdate.originalStartDate) {
            // flag as an update
            shouldUpdate = true;
            // set it as follow-up start date
            propsToUpdate.originalStartDate = propsToUpdate.startDate;
          }
          // set follow-up end date
          propsToUpdate.endDate = moment(propsToUpdate.startDate).add(outbreak.periodOfFollowup, 'days');
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
   * Group them by place/case
   * If group by place is set, placeLevel property is required
   * @param outbreak
   * @param date
   * @param groupBy
   */
  Contact.getGroupedByDate = function (outbreak, date, groupBy) {
    if (groupBy === 'case') {
      let dateInterval = [];
      if (date) {
        dateInterval = [moment(date).startOf('day'), moment(date).endOf('day')];
      } else {
        dateInterval = [moment(new Date()).startOf('day'), moment(new Date()).endOf('day')];
      }

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
            contact.caseId = caseItem.id;
            return contact;
          });

          // group them by case id
          contacts = _.groupBy(contacts, (c) => c.caseId);

          return contacts;
        });
    }

    // return contacts grouped by location that have follow ups in the given day
    return app.models.person.getPeoplePerLocation('contact', {}, outbreak);
  };
};
