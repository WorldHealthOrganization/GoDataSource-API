'use strict';

const app = require('../../server/server');
const _ = require('lodash');
const helpers = require('../../components/helpers');
const async = require('async');

module.exports = function (Event) {
  // set flag to not get controller
  Event.hasController = false;

  // important => DON'T use "Event.fieldLabelsMap = Object.assign({}, Event.fieldLabelsMap, {" since it gets all fields from person and we don't want that
  Event.fieldLabelsMap = {
    id: 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    createdAt: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_AT',
    createdBy: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_BY',
    updatedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_AT',
    updatedBy: 'LNG_COMMON_MODEL_FIELD_LABEL_UPDATED_BY',
    deleted: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED',
    deletedAt: 'LNG_COMMON_MODEL_FIELD_LABEL_DELETED_AT',
    createdOn: 'LNG_COMMON_MODEL_FIELD_LABEL_CREATED_ON',
    'visualId': 'LNG_EVENT_FIELD_LABEL_VISUAL_ID',
    'type': 'LNG_ENTITY_FIELD_LABEL_TYPE',
    'numberOfExposures': 'LNG_EVENT_FIELD_LABEL_NUMBER_OF_EXPOSURES',
    'numberOfContacts': 'LNG_EVENT_FIELD_LABEL_NUMBER_OF_CONTACTS',
    'name': 'LNG_EVENT_FIELD_LABEL_NAME',
    'date': 'LNG_EVENT_FIELD_LABEL_DATE',
    'dateOfReporting': 'LNG_EVENT_FIELD_LABEL_DATE_OF_REPORTING',
    'isDateOfReportingApproximate': 'LNG_EVENT_FIELD_LABEL_DATE_OF_REPORTING_APPROXIMATE',
    'description': 'LNG_EVENT_FIELD_LABEL_DESCRIPTION',
    'address': 'LNG_EVENT_FIELD_LABEL_ADDRESS',
    'address.typeId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_TYPEID',
    'address.country': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_COUNTRY',
    'address.city': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_CITY',
    'address.addressLine1': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_ADDRESS_LINE_1',
    'address.postalCode': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_POSTAL_CODE',
    'address.locationId': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_LOCATION_ID',
    'address.geoLocation': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION',
    'address.geoLocation.lat': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LAT',
    'address.geoLocation.lng': 'LNG_LOCATION_FIELD_LABEL_GEO_LOCATION_LNG',
    'address.geoLocationAccurate': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_GEO_LOCATION_ACCURATE',
    'address.date': 'LNG_ADDRESS_FIELD_LABEL_ADDRESS_DATE',
    'address.phoneNumber': 'LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER',
    'address.emailAddress': 'LNG_ADDRESS_FIELD_LABEL_EMAIL_ADDRESS',
    'responsibleUserId': 'LNG_EVENT_FIELD_LABEL_RESPONSIBLE_USER_UUID', // required for import map
    'responsibleUser': 'LNG_EVENT_FIELD_LABEL_RESPONSIBLE_USER_ID',
    'responsibleUser.id': 'LNG_COMMON_MODEL_FIELD_LABEL_ID',
    'responsibleUser.firstName': 'LNG_USER_FIELD_LABEL_FIRST_NAME',
    'responsibleUser.lastName': 'LNG_USER_FIELD_LABEL_LAST_NAME',
    'eventCategory': 'LNG_EVENT_FIELD_LABEL_EVENT_CATEGORY',
    'endDate': 'LNG_EVENT_FIELD_LABEL_END_DATE',

    // must be last item from the list
    'questionnaireAnswers': 'LNG_EVENT_FIELD_LABEL_QUESTIONNAIRE_ANSWERS'
  };

  // used on importable file logic
  Event.foreignKeyFields = {
    'responsibleUserId': {
      modelName: 'user',
      collectionName: 'user',
      labelProperty: [
        'firstName',
        'lastName',
        'email'
      ]
    }
  };

  Event.extendedForm = {
    template: 'eventInvestigationTemplate',
    containerProperty: 'questionnaireAnswers',
    isBasicArray: (variable) => {
      return variable.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS';
    }
  };

  // merge merge properties so we don't remove anything from a array / properties defined as being "mergeble" in case we don't send the entire data
  // this is relevant only when we update a record since on create we don't have old data that we need to merge
  Event.mergeFieldsOnUpdate = [
    'questionnaireAnswers'
  ];

  // map language token labels for export fields group
  Event.exportFieldsGroup = {
    'LNG_COMMON_LABEL_EXPORT_GROUP_RECORD_CREATION_AND_UPDATE_DATA': {
      properties: [
        'id',
        'createdAt',
        'createdBy',
        'updatedAt',
        'updatedBy',
        'deleted',
        'deletedAt',
        'createdOn'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_CORE_DEMOGRAPHIC_DATA': {
      properties: [
        'visualId',
        'name',
        'type',
        'date',
        'dateOfReporting',
        'isDateOfReportingApproximate',
        'eventCategory',
        'endDate',
        'description',
        'responsibleUser',
        'responsibleUser.id',
        'responsibleUser.firstName',
        'responsibleUser.lastName',
        'numberOfExposures',
        'numberOfContacts'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_ADDRESS_AND_LOCATION_DATA': {
      properties: [
        'address',
        'address.typeId',
        'address.country',
        'address.city',
        'address.addressLine1',
        'address.postalCode',
        'address.locationId',
        'address.geoLocation',
        'address.geoLocation.lat',
        'address.geoLocation.lng',
        'address.geoLocationAccurate',
        'address.date',
        'address.phoneNumber',
        'address.emailAddress'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA': {
      properties: [
        // the ids and identifiers fields for a location are added custom
      ],
      required: [
        'LNG_COMMON_LABEL_EXPORT_GROUP_ADDRESS_AND_LOCATION_DATA'
      ]
    },
    'LNG_COMMON_LABEL_EXPORT_GROUP_QUESTIONNAIRE_DATA': {
      properties: [
        'questionnaireAnswers'
      ]
    }
  };

  // default export order
  Event.exportFieldsOrder = [
    'id',
    'visualId',
    'dateOfReporting',
    'isDateOfReportingApproximate'
  ];

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Event.nestedGeoPoints = [
    'address.geoLocation'
  ];

  Event.locationFields = [
    'address.locationId'
  ];

  Event.printFieldsinOrder = [
    'visualId',
    'type',
    'name',
    'date',
    'dateOfReporting',
    'isDateOfReportingApproximate',
    'eventCategory',
    'endDate',
    'description',
    'address'
  ];

  Event.referenceDataFieldsToCategoryMap = {
    type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE',
    'address.typeId': 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE',
    eventCategory: 'LNG_REFERENCE_DATA_CATEGORY_EVENT_CATEGORY'
  };

  Event.referenceDataFields = Object.keys(Event.referenceDataFieldsToCategoryMap);

  /**
   * Get alternate unique identifier query for sync/import actions
   * Note: Event records don't have an alternate unique identifier. Overwriting Person model function
   * @returns {null}
   */
  Event.getAlternateUniqueIdentifierQueryForSync = () => {
    return null;
  };

  Event.getIsolatedContacts = function (eventId, callback) {
    // get all relations with a contact
    return app.models.relationship
      .rawFind({
        // required to use index to improve greatly performance
        'persons.id': eventId,

        // filter
        $or: [
          {
            'persons.0.id': eventId,
            'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          },
          {
            'persons.1.id': eventId,
            'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          }
        ]
      }, {
        projection: {
          persons: 1
        },
        // required to use index to improve greatly performance
        hint: {
          'persons.id': 1
        }
      })
      .then((relationships) => {
        async.parallelLimit(relationships.map((rel) => {
          const contact = rel.persons.find((p) => p.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT');
          return (cb) => {
            app.models.contact
              .findOne({
                where: {
                  id: contact.id
                }
              })
              .then((contact) => {
                // contact missing ?
                if (!contact) {
                  cb(null, {isValid: false});
                  return;
                }

                // get all relations of the contact that are not with this event
                app.models.relationship
                  .rawFind({
                    // required to use index to improve greatly performance
                    'persons.id': contact.id,

                    // filter
                    $or: [
                      {
                        'persons.0.id': contact.id,
                        'persons.1.id': {
                          $ne: eventId
                        },
                        'persons.1.type': {
                          inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                        }
                      },
                      {
                        'persons.0.id': {
                          $ne: eventId
                        },
                        'persons.0.type': {
                          inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                        },
                        'persons.1.id': contact.id
                      }
                    ]
                  }, {
                    projection: {
                      _id: 1
                    },
                    // required to use index to improve greatly performance
                    hint: {
                      'persons.id': 1
                    }
                  })
                  .then((relationships) => cb(null, {contact: contact, isValid: !relationships.length}));
              })
              .catch((error) => cb(error));
          };
        }), 10, (err, possibleIsolatedContacts) => {
          if (err) {
            return callback(err);
          }
          return callback(null, possibleIsolatedContacts.filter((entry) => entry.isValid));
        });
      });
  };

  /**
   * Before save hooks
   */
  Event.observe('before save', function (context, next) {
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
          model.eventInvestigationTemplate :
          null
      )
      .then(() => {
        // finished
        next();
      })
      .catch(next);
  });

  /**
   * Event after delete
   * Actions:
   * Remove any contacts that remain isolated after the event deletion
   */
  Event.observe('after delete', (context, next) => {
    if (context.options.mergeDuplicatesAction) {
      // don't remove isolated contacts when merging two events
      return next();
    }

    const eventId = context.instance.id;
    Event.getIsolatedContacts(eventId, (err, isolatedContacts) => {
      if (err) {
        return next(err);
      }

      // construct the list of contacts that we need to remove
      const contactsJobs = [];
      isolatedContacts.forEach((isolatedContact) => {
        if (isolatedContact.isValid) {
          // remove contact job
          contactsJobs.push((function (contactModel) {
            return (callback) => {
              contactModel.destroy(
                {
                  extraProps: {
                    deletedByParent: eventId
                  }
                },
                callback
              );
            };
          })(isolatedContact.contact));
        }
      });

      // delete each isolated contact & and its relationship
      async.parallelLimit(contactsJobs, 10, function (error) {
        next(error);
      });
    });
  });
};
