'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with contact of contact related actions
 */

const app = require('../../server/server');
const genericHelpers = require('../../components/helpers');
const _ = require('lodash');
const tmp = require('tmp');
const fs = require('fs');
const AdmZip = require('adm-zip');
const moment = require('moment');
const apiError = require('../../components/apiError');
const Config = require('../../server/config.json');
const WorkerRunner = require('./../../components/workerRunner');
const exportHelper = require('./../../components/exportHelper');
const Platform = require('../../components/platform');
const importableFile = require('./../../components/importableFile');

// used in contact of contact import
const contactOfContactImportBatchSize = _.get(Config, 'jobSettings.importResources.batchSize', 100);

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
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationshipsAvailablePeople = function (contactOfContactId, filter, options, callback) {
    // we only make relations with contacts
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where = {
      and: [
        {
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        },
        filter.where || {}
      ]
    };

    app.models.person
      .getAvailablePeopleCount(
        this.id,
        contactOfContactId,
        filter,
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
   * @param options
   */
  Outbreak.prototype.findContactsOfContacts = function (filter, options, callback) {
    app.models.contactOfContact
      .preFilterForOutbreak(this, filter, options)
      .then(app.models.contactOfContact.find)
      .then(records => {
        callback(null, records);
      })
      .catch(callback);
  };

  /**
   * Count outbreak contacts of contacts
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.filteredCountContactsOfContacts = function (filter, options, callback) {
    // pre-filter using related data
    app.models.contactOfContact
      .preFilterForOutbreak(this, filter, options)
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

        // count using query
        return app.models.contactOfContact.rawCountDocuments(filter);
      })
      .then(function (records) {
        callback(null, records);
      })
      .catch(callback);
  };

  Outbreak.beforeRemote('prototype.exportFilteredContactsOfContacts', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });

  /**
   * Export filtered contacts of contacts to file
   * @param filter
   * @param exportType json, csv, xls, xlsx, ods, pdf or csv. Default: json
   * @param encryptPassword
   * @param anonymizeFields
   * @param fieldsGroupList
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFilteredContactsOfContacts = function (
    filter,
    exportType,
    encryptPassword,
    anonymizeFields,
    fieldsGroupList,
    options,
    callback
  ) {
    // set a default filter
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where.outbreakId = this.id;

    // parse includeCaseFields query param
    let includeCaseFields = false;
    if (filter.where.hasOwnProperty('includeCaseFields')) {
      includeCaseFields = filter.where.includeCaseFields;
      delete filter.where.includeCaseFields;
    }

    // parse includeContactFields query param
    let includeContactFields = false;
    if (filter.where.hasOwnProperty('includeContactFields')) {
      includeContactFields = filter.where.includeContactFields;
      delete filter.where.includeContactFields;
    }

    // parse useDbColumns query param
    let useDbColumns = false;
    if (filter.where.hasOwnProperty('useDbColumns')) {
      useDbColumns = filter.where.useDbColumns;
      delete filter.where.useDbColumns;
    }

    // parse dontTranslateValues query param
    let dontTranslateValues = false;
    if (filter.where.hasOwnProperty('dontTranslateValues')) {
      dontTranslateValues = filter.where.dontTranslateValues;
      delete filter.where.dontTranslateValues;
    }

    // parse jsonReplaceUndefinedWithNull query param
    let jsonReplaceUndefinedWithNull = false;
    if (filter.where.hasOwnProperty('jsonReplaceUndefinedWithNull')) {
      jsonReplaceUndefinedWithNull = filter.where.jsonReplaceUndefinedWithNull;
      delete filter.where.jsonReplaceUndefinedWithNull;
    }

    // parse includePersonExposureFields query param
    let includePersonExposureFields = false;
    if (filter.where.hasOwnProperty('includePersonExposureFields')) {
      includePersonExposureFields = filter.where.includePersonExposureFields;
      delete filter.where.includePersonExposureFields;
    }

    // parse retrieveOldestExposure query param
    let retrieveOldestExposure = false;
    if (filter.where.hasOwnProperty('retrieveOldestExposure')) {
      retrieveOldestExposure = filter.where.retrieveOldestExposure;
      delete filter.where.retrieveOldestExposure;
    }

    // if encrypt password is not valid, remove it
    if (typeof encryptPassword !== 'string' || !encryptPassword.length) {
      encryptPassword = null;
    }

    // make sure anonymizeFields is valid
    if (!Array.isArray(anonymizeFields)) {
      anonymizeFields = [];
    }

    // relationship prefilters
    const prefilters = exportHelper.generateAggregateFiltersFromNormalFilter(
      filter, {
        outbreakId: this.id
      }, {
        contact: {
          collection: 'person',
          queryPath: 'where.contact',
          queryAppend: {
            type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
          },
          localKey: '_id',
          // #TODO
          // - must implement later
          ignore: true
          // foreignKey: '....ce vine din relationship'
          // prefilters: {
          //   relationship: {
          //     collection: 'relationship',
          //     queryPath: 'where.relationship',
          //     localKey: '_id',
          //     foreignKey: 'persons[].id',
          //     foreignKeyArraySize: 2
          //   }
          // }
        }
      }
    );

    // do we need to include case/contact data in contact exported data if contact was a case/contact ?
    let additionalFieldsToExport;
    if (
      includeCaseFields ||
      includeContactFields
    ) {
      // initialize additional fields to export
      additionalFieldsToExport = {
        fields: {},
        arrayProps: {},
        locationFields: []
      };

      // determine contact of contact fields
      const contactOfContactFields = {};
      _.each(
        app.models.contactOfContact.fieldLabelsMap,
        (contactOfContactFieldToken, contactOfContactField) => {
          // should exclude or include ?
          let shouldExclude = false;
          if (app.models.contactOfContact.definition.settings.excludeBaseProperties) {
            for (let index = 0; index < app.models.contactOfContact.definition.settings.excludeBaseProperties.length; index++) {
              let excludedField = app.models.contactOfContact.definition.settings.excludeBaseProperties[index];
              if (
                contactOfContactField === excludedField ||
                contactOfContactField.startsWith(`${excludedField}.`) ||
                contactOfContactField.startsWith(`${excludedField}[]`)
              ) {
                // must exclude field
                shouldExclude = true;

                // no need to check further
                break;
              }
            }
          }

          // should exclude or include field ?
          if (!shouldExclude) {
            contactOfContactFields[contactOfContactField] = contactOfContactFieldToken;
          }
        }
      );

      // include case fields ?
      if (includeCaseFields) {
        // determine case fields
        const caseFields = {};
        _.each(
          app.models.case.fieldLabelsMap,
          (caseFieldToken, caseField) => {
            // should exclude or include ?
            let shouldExclude = false;
            if (app.models.case.definition.settings.excludeBaseProperties) {
              for (let index = 0; index < app.models.case.definition.settings.excludeBaseProperties.length; index++) {
                let excludedField = app.models.case.definition.settings.excludeBaseProperties[index];
                if (
                  caseField === excludedField ||
                  caseField.startsWith(`${excludedField}.`) ||
                  caseField.startsWith(`${excludedField}[]`)
                ) {
                  // must exclude field
                  shouldExclude = true;

                  // no need to check further
                  break;
                }
              }
            }

            // should exclude or include field ?
            if (!shouldExclude) {
              caseFields[caseField] = caseFieldToken;
            }
          }
        );

        // determine what fields from case are missing from contact of contact
        _.each(
          caseFields,
          (caseFieldToken, caseField) => {
            if (!contactOfContactFields[caseField]) {
              // add field
              additionalFieldsToExport.fields[caseField] = caseFieldToken;

              // is array property ?
              if (app.models.case.arrayProps[caseField]) {
                additionalFieldsToExport.arrayProps[caseField] = app.models.case.arrayProps[caseField];
              }

              // is location property ?
              if (app.models.case.locationFields.indexOf(caseField) > -1) {
                additionalFieldsToExport.locationFields.push(caseField);
              }
            }
          }
        );
      }

      // include contact fields ?
      if (includeContactFields) {
        // determine contact fields
        const contactFields = {};
        _.each(
          app.models.contact.fieldLabelsMap,
          (contactFieldToken, contactField) => {
            // should exclude or include ?
            let shouldExclude = false;
            if (app.models.contact.definition.settings.excludeBaseProperties) {
              for (let index = 0; index < app.models.contact.definition.settings.excludeBaseProperties.length; index++) {
                let excludedField = app.models.contact.definition.settings.excludeBaseProperties[index];
                if (
                  contactField === excludedField ||
                  contactField.startsWith(`${excludedField}.`) ||
                  contactField.startsWith(`${excludedField}[]`)
                ) {
                  // must exclude field
                  shouldExclude = true;

                  // no need to check further
                  break;
                }
              }
            }

            // should exclude or include field ?
            if (!shouldExclude) {
              contactFields[contactField] = contactFieldToken;
            }
          }
        );

        // determine what fields from contact are missing from contact of contact
        _.each(
          contactFields,
          (contactFieldToken, contactField) => {
            if (!contactOfContactFields[contactField]) {
              // add field
              additionalFieldsToExport.fields[contactField] = contactFieldToken;

              // is array property ?
              if (app.models.contact.arrayProps[contactField]) {
                additionalFieldsToExport.arrayProps[contactField] = app.models.contact.arrayProps[contactField];
              }

              // is location property ?
              if (app.models.contact.locationFields.indexOf(contactField) > -1) {
                additionalFieldsToExport.locationFields.push(contactField);
              }
            }
          }
        );
      }
    }

    // prefilter
    app.models.contactOfContact
      .addGeographicalRestrictions(
        options.remotingContext,
        filter.where
      )
      .then((updatedFilter) => {
        // update casesQuery if needed
        updatedFilter && (filter.where = updatedFilter);

        // determine fields that should be used at export
        let fieldLabelsMapOptions = app.models.contactOfContact.helpers.sanitizeFieldLabelsMapForExport();
        if (!includePersonExposureFields) {
          fieldLabelsMapOptions = _.transform(
            fieldLabelsMapOptions,
            (acc, token, field) => {
              // nothing to do ?
              if (
                field === 'relationship.relatedPersonData' ||
                field.startsWith('relationship.relatedPersonData.')
              ) {
                return;
              }

              // add to list
              acc[field] = token;
            },
            {}
          );
        }

        // export
        return WorkerRunner.helpers.exportFilteredModelsList(
          {
            collectionName: 'person',
            modelName: app.models.contactOfContact.modelName,
            scopeQuery: app.models.contactOfContact.definition.settings.scope,
            excludeBaseProperties: app.models.contactOfContact.definition.settings.excludeBaseProperties,
            arrayProps: app.models.contactOfContact.arrayProps,
            fieldLabelsMap: fieldLabelsMapOptions,
            exportFieldsGroup: app.models.contactOfContact.exportFieldsGroup,
            exportFieldsOrder: app.models.contactOfContact.exportFieldsOrder,
            locationFields: app.models.contactOfContact.locationFields,

            // fields that we need to bring from db, but we might not include in the export (you can still include it since we need it on import)
            // - responsibleUserId might be included since it is used on import, otherwise we won't have the ability to map this field
            projection: [
              'responsibleUserId'
            ]
          },
          filter,
          exportType,
          encryptPassword,
          anonymizeFields,
          fieldsGroupList,
          {
            userId: _.get(options, 'accessToken.userId'),
            outbreakId: this.id,
            questionnaire: undefined,
            useQuestionVariable: false,
            useDbColumns,
            dontTranslateValues,
            jsonReplaceUndefinedWithNull,
            contextUserLanguageId: app.utils.remote.getUserFromOptions(options).languageId
          },
          prefilters, {
            relationship: {
              type: exportHelper.RELATION_TYPE.GET_ONE,
              collection: 'relationship',
              project: [
                '_id',
                'contactDate',
                'contactDateEstimated',
                'certaintyLevelId',
                'exposureTypeId',
                'exposureFrequencyId',
                'exposureDurationId',
                'socialRelationshipTypeId',
                'socialRelationshipDetail',
                'clusterId',
                'comment',
                'createdAt',
                'createdBy',
                'updatedAt',
                'updatedBy',
                'deleted',
                'deletedAt',
                'createdOn',
                'persons'
              ],
              query: `(person) => {
                return person ?
                  {
                    outbreakId: '${this.id}',
                    deleted: false,
                    $or: [
                      {
                        'persons.0.id': person._id,
                        'persons.0.target': true,
                        'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
                      }, {
                          'persons.1.id': person._id,
                          'persons.1.target': true,
                          'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
                      }
                    ]
                  } :
                  undefined;
              }`,
              sort: {
                createdAt: retrieveOldestExposure ?
                  1 :
                  -1
              },
              after: `(person) => {
                // nothing to do ?
                if (
                  !person.relationship ||
                  !person.relationship.persons ||
                  person.relationship.persons.length !== 2
                ) {
                  return;
                }

                // determine related person
                person.relationship.relatedId = person.relationship.persons[0].id === person._id ?
                  person.relationship.persons[1].id :
                  person.relationship.persons[0].id;

                // cleanup
                delete person.relationship.persons;
                person.relationship.id = person.relationship._id;
                delete person.relationship._id;
              }`,
              relations: includePersonExposureFields ? {
                relatedPersonData: {
                  type: exportHelper.RELATION_TYPE.HAS_ONE,
                  collection: 'person',
                  project: [
                    '_id',
                    // contact
                    'firstName',
                    'lastName',
                    'visualId'
                  ],
                  key: '_id',
                  keyValue: `(person) => {
                    return person && person.relationship && person.relationship.relatedId ?
                      person.relationship.relatedId :
                      undefined;
                  }`,
                  after: `(person) => {
                    // nothing to do ?
                    if (!person.relatedPersonData) {
                      // then we shouldn't have relationship either because probably person was deleted
                      // - for now we shouldn't delete it because we will have no relationship to use on import
                      // - the correct way would be to retrieve the relationship if person not deleted, but now that isn't easily possible
                      // delete person.relationship;

                      // not found
                      return;
                    }

                    // move from root level to relationship
                    person.relationship.relatedPersonData = person.relatedPersonData;
                    delete person.relatedPersonData;
                  }`
                }
              } : undefined
            },
            responsibleUser: {
              type: exportHelper.RELATION_TYPE.HAS_ONE,
              collection: 'user',
              project: [
                '_id',
                'firstName',
                'lastName'
              ],
              key: '_id',
              keyValue: `(item) => {
                return item && item.responsibleUserId ?
                  item.responsibleUserId :
                  undefined;
              }`
            }
          }
        );
      })
      .then((exportData) => {
        // send export id further
        callback(
          null,
          exportData
        );
      })
      .catch(callback);
  };

  /**
   * Count contacts of contacts by risk level
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactsOfContactsPerRiskLevel = function (filter, options, callback) {
    app.models.person
      .groupCount(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
        filter,
        'riskLevel',
        'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL_UNCLASSIFIED'
      )
      .then((result) => {
        callback(
          null,
          result
        );
      })
      .catch(callback);
  };

  /**
   * Get all duplicates based on hardcoded rules against a model props
   * @param model
   * @param options
   * @param callback
   */
  Outbreak.prototype.getContactOfContactPossibleDuplicates = function (model = {}, options, callback) {
    if (
      Config.duplicate &&
      Config.duplicate.disableContactOfContactDuplicateCheck
    ) {
      callback(null, []);
    } else {
      app.models.person
        .findDuplicatesByType(this.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT', model, options)
        .then(duplicates => callback(null, duplicates))
        .catch(callback);
    }
  };

  /**
   * Build and return a pdf containing a contact of contact's information and relationships (dossier)
   * @param contactsOfContacts
   * @param anonymousFields
   * @param options
   * @param callback
   */
  Outbreak.prototype.contactOfContactDossier = function (contactsOfContacts, anonymousFields, options, callback) {
    const models = app.models;

    let tmpDir = tmp.dirSync({unsafeCleanup: true});
    let tmpDirName = tmpDir.name;

    const filter = {
      where: {
        id: {
          inq: contactsOfContacts
        }
      },
      include: [
        {
          relation: 'relationships',
          scope: {
            include: [
              {
                relation: 'people'
              },
              {
                relation: 'cluster'
              }
            ]
          }
        }
      ]
    };

    // add geographical restrictions if needed
    // Note: even though the given cases should already be in the geographical restriction
    // we are adding this additional condition to prevent security breaches
    app.models.contactOfContact
      .addGeographicalRestrictions(options.remotingContext, filter.where)
      .then(updatedFilter => {
        // update filter.where if needed
        updatedFilter && (filter.where = updatedFilter);

        // get all requested contact of contacts, including their relationships and followUps
        models.contactOfContact.find(filter, (err, results) => {
          if (err) {
            return callback(err);
          }

          const pdfUtils = app.utils.pdfDoc;
          const languageId = options.remotingContext.req.authData.user.languageId;

          // list of records ready to be printed
          let sanitizedRecords = [];

          genericHelpers.attachLocations(
            app.models.contactOfContact,
            app.models.location,
            results,
            (err, result) => {
              if (!err) {
                result = result || {};
                results = result.records || results;
              }

              // get the language dictionary
              app.models.language.getLanguageDictionary(languageId, (err, dictionary) => {
                if (err) {
                  return callback(err);
                }

                // transform all DB models into JSONs for better handling
                results.forEach((record, recordIndex) => {
                  results[recordIndex] = record.toJSON();

                  // this is needed because loopback doesn't return hidden fields from definition into the toJSON call
                  // might be removed later
                  results[recordIndex].type = record.type;

                  // since relationships is a custom relation, the relationships collection is included differently in the model,
                  // and not converted by the initial toJSON method.
                  record.relationships.forEach((relationship, relationshipIndex) => {
                    record.relationships[relationshipIndex] = relationship.toJSON();
                    record.relationships[relationshipIndex].people.forEach((member, memberIndex) => {
                      record.relationships[relationshipIndex].people[memberIndex] = member.toJSON();
                    });
                  });
                });

                // replace all foreign keys with readable data
                genericHelpers.resolveModelForeignKeys(app, app.models.contactOfContact, results, dictionary)
                  .then((results) => {
                    results.forEach((contact, contactIndex) => {
                      // keep the initial data of the contact (we currently use it to generate the QR code only)
                      sanitizedRecords[contactIndex] = {
                        rawData: contact
                      };

                      // anonymize the required fields and prepare the fields for print (currently, that means eliminating undefined values,
                      // and format date type fields
                      if (anonymousFields) {
                        app.utils.anonymizeDatasetFields.anonymize(contact, anonymousFields);
                      }
                      app.utils.helpers.formatDateFields(contact, app.models.person.dossierDateFields);
                      app.utils.helpers.formatUndefinedValues(contact);

                      // prepare the contact's relationships for printing
                      contact.relationships.forEach((relationship, relationshipIndex) => {
                        sanitizedRecords[contactIndex].relationships = [];

                        // extract the person with which the contact has a relationship
                        let relationshipMember = _.find(relationship.people, (member) => {
                          return member.id !== contact.id;
                        });

                        // if relationship member was not found
                        if (!relationshipMember) {
                          // stop here (invalid relationship)
                          return;
                        }

                        // needed for checks below
                        const relationshipMemberType = relationshipMember.type;

                        // translate the values of the fields marked as reference data fields on the case/contact/event model
                        app.utils.helpers.translateDataSetReferenceDataValues(
                          relationshipMember,
                          models[models.person.typeToModelMap[relationshipMemberType]].referenceDataFields,
                          dictionary
                        );

                        relationshipMember = app.utils.helpers.translateFieldLabels(
                          app,
                          relationshipMember,
                          models[models.person.typeToModelMap[relationshipMemberType]].modelName,
                          dictionary
                        );

                        // translate the values of the fields marked as reference data fields on the relationship model
                        app.utils.helpers.translateDataSetReferenceDataValues(
                          relationship,
                          models.relationship.referenceDataFields,
                          dictionary
                        );

                        // translate all remaining keys of the relationship model
                        relationship = app.utils.helpers.translateFieldLabels(
                          app,
                          relationship,
                          models.relationship.modelName,
                          dictionary
                        );

                        relationship[dictionary.getTranslation('LNG_RELATIONSHIP_PDF_FIELD_LABEL_PERSON')] = relationshipMember;

                        // add the sanitized relationship to the object to be printed
                        sanitizedRecords[contactIndex].relationships[relationshipIndex] = relationship;
                      });

                      // translate all remaining keys
                      contact = app.utils.helpers.translateFieldLabels(
                        app,
                        contact,
                        app.models.contactOfContact.modelName,
                        dictionary,
                        true
                      );

                      // add the sanitized contact to the object to be printed
                      sanitizedRecords[contactIndex].data = contact;
                    });

                    const relationshipsTitle = dictionary.getTranslation('LNG_PAGE_ACTION_RELATIONSHIPS');

                    let pdfPromises = [];

                    // print all the data
                    sanitizedRecords.forEach((sanitizedContact) => {
                      pdfPromises.push(
                        new Promise((resolve, reject) => {
                          // generate pdf document
                          let doc = pdfUtils.createPdfDoc({
                            fontSize: 7,
                            layout: 'portrait',
                            margin: 20,
                            lineGap: 0,
                            wordSpacing: 0,
                            characterSpacing: 0,
                            paragraphGap: 0
                          });

                          // add a top margin of 2 lines for each page
                          doc.on('pageAdded', () => {
                            doc.moveDown(2);
                          });

                          // set margin top for first page here, to not change the entire createPdfDoc functionality
                          doc.moveDown(2);
                          // write this as a separate function to easily remove it's listener
                          let addQrCode = function () {
                            app.utils.qrCode.addPersonQRCode(doc, sanitizedContact.rawData.outbreakId, 'contactOfContact', sanitizedContact.rawData);
                          };

                          // add the QR code to the first page (this page has already been added and will not be covered by the next line)
                          addQrCode();

                          // set a listener on pageAdded to add the QR code to every new page
                          doc.on('pageAdded', addQrCode);

                          pdfUtils.displayModelDetails(doc, sanitizedContact.data, true, dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_OF_CONTACT_DETAILS'));
                          pdfUtils.displayPersonRelationships(doc, sanitizedContact.relationships, relationshipsTitle);

                          // add an additional empty page that contains only the QR code as per requirements
                          doc.addPage();

                          // stop adding this QR code. The next contact will need to have a different QR code
                          doc.removeListener('pageAdded', addQrCode);
                          doc.end();

                          // convert pdf stream to buffer and send it as response
                          genericHelpers.streamToBuffer(doc, (err, buffer) => {
                            if (err) {
                              callback(err);
                            } else {
                              const fileName = exportHelper.getNameForExportedDossierFile(sanitizedContact, anonymousFields);

                              fs.writeFile(`${tmpDirName}/${fileName}`, buffer, (err) => {
                                if (err) {
                                  reject(err);
                                } else {
                                  resolve();
                                }
                              });
                            }
                          });
                        })
                      );
                    });
                    return Promise.all(pdfPromises);
                  })
                  .then(() => {
                    let archiveName = `contactOfContactDossiers_${moment().format('YYYY-MM-DD_HH-mm-ss')}.zip`;
                    let archivePath = `${tmpDirName}/${archiveName}`;
                    let zip = new AdmZip();

                    zip.addLocalFolder(tmpDirName);
                    zip.writeZip(archivePath);

                    fs.readFile(archivePath, (err, data) => {
                      if (err) {
                        callback(apiError.getError('FILE_NOT_FOUND'));
                      } else {
                        tmpDir.removeCallback();
                        app.utils.remote.helpers.offerFileToDownload(data, 'application/zip', archiveName, callback);
                      }
                    });
                  })
                  .catch(callback);
              });
            });
        });
      });
  };

  /**
   * Import an importable contacts of contacts file using file ID and a map to remap parameters & reference data values
   * @param body
   * @param options
   * @param callback
   */
  Outbreak.prototype.importImportableContactsOfContactsFileUsingMap = function (body, options, callback) {
    const self = this;

    // create a transaction logger as the one on the req will be destroyed once the response is sent
    const logger = app.logger.getTransactionLogger(options.remotingContext.req.transactionId);

    // treat the sync as a regular operation, not really a sync
    options._sync = false;
    // inject platform identifier
    options.platform = Platform.IMPORT;

    /**
     * Create array of actions that will be executed in series for each batch
     * Note: Failed items need to have success: false and any other data that needs to be saved on error needs to be added in a error container
     * @param {Array} batchData - Batch data
     * @returns {[]}
     */
    const createBatchActions = function (batchData) {
      return genericHelpers.fillGeoLocationInformation(batchData, 'save.contactOfContact.addresses', app)
        .then(() => {
          // build a list of create operations for this batch
          const createContactsOfContacts = [];
          // go through all entries
          batchData.forEach(function (recordData) {
            const dataToSave = recordData.save;

            createContactsOfContacts.push(function (asyncCallback) {
              // sync the record
              return app.utils.dbSync.syncRecord(app, app.models.contactOfContact, dataToSave.contactOfContact, options)
                .then(function (syncResult) {
                  const syncedRecord = syncResult.record;
                  // promisify next step
                  return new Promise(function (resolve, reject) {
                    // normalize people
                    Outbreak.helpers.validateAndNormalizePeople(
                      self.id,
                      syncedRecord.id,
                      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
                      dataToSave.relationship,
                      true,
                      function (error) {
                        if (error) {
                          // delete record since it was created without an error while relationship failed
                          return app.models.contactOfContact.destroyById(
                            syncedRecord.id,
                            () => {
                              // return error
                              return reject(error);
                            }
                          );
                        }

                        // sync relationship
                        return app.utils.dbSync.syncRecord(app, app.models.relationship, dataToSave.relationship, options)
                          .then(function () {
                            // relationship successfully created, move to tne next one
                            resolve();
                          })
                          .catch(function (error) {
                            // failed to create relationship, remove the record if it was created during sync
                            if (syncResult.flag === app.utils.dbSync.syncRecordFlags.CREATED) {
                              syncedRecord.destroy(options);
                            }
                            reject(error);
                          });
                      });
                  });
                })
                .then(function () {
                  asyncCallback();
                })
                .catch(function (error) {
                  // on error, store the error, but don't stop, continue with other items
                  asyncCallback(null, {
                    success: false,
                    error: {
                      error: error,
                      data: {
                        file: recordData.raw,
                        save: recordData.save
                      }
                    }
                  });
                });
            });
          });

          return createContactsOfContacts;
        });
    };

    // construct options needed by the formatter worker
    // model boolean properties
    const modelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.contactOfContact,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // relationship model boolean properties
    const relationshipModelBooleanProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.relationship,
      genericHelpers.DATA_TYPE.BOOLEAN
    );

    // model date properties
    const modelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.contactOfContact,
      genericHelpers.DATA_TYPE.DATE
    );

    // relationship model date properties
    const relationshipModelDateProperties = genericHelpers.getModelPropertiesByDataType(
      app.models.relationship,
      genericHelpers.DATA_TYPE.DATE
    );

    // options for the formatting method
    const formatterOptions = Object.assign({
      dataType: 'contactOfContact',
      batchSize: contactOfContactImportBatchSize,
      outbreakId: self.id,
      contactOfContactModelBooleanProperties: modelBooleanProperties,
      relationshipModelBooleanProperties: relationshipModelBooleanProperties,
      contactOfContactModelDateProperties: modelDateProperties,
      relationshipModelDateProperties: relationshipModelDateProperties,
      contactOfContactImportableTopLevelProperties: app.models.contactOfContact._importableTopLevelProperties,
      relationshipImportableTopLevelProperties: app.models.relationship._importableTopLevelProperties
    }, body);

    // start import
    importableFile.processImportableFileData(app, {
      modelName: app.models.contactOfContact.modelName,
      outbreakId: self.id,
      logger: logger
    }, formatterOptions, createBatchActions, callback);
  };

  /**
   * Convert a contact of contact to a contact
   * @param contactOfContactId
   * @param options
   * @param callback
   */
  Outbreak.prototype.convertContactOfContactToContact = function (contactOfContactId, options, callback) {
    let contactOfContactInstance, convertedContact;
    app.models.contactOfContact
      .findOne({
        where: {
          id: contactOfContactId
        },
        fields: [
          'id',
          'questionnaireAnswersContact'
        ]
      })
      .then(function (contactOfContactModel) {
        if (!contactOfContactModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contactOfContact.modelName, id: contactOfContactId});
        }

        // keep the contactOfContactModel as we will do actions on it
        contactOfContactInstance = contactOfContactModel;

        // in order for a contact of contact to be converted to a contact it must be related to at least another case/event and it must be a target in that relationship
        // check relations
        return app.models.relationship
          .rawFind({
            // required to use index to improve greatly performance
            'persons.id': contactOfContactId,

            $or: [
              {
                'persons.0.id': contactOfContactId,
                'persons.0.target': true,
                'persons.1.type': {
                  $in: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
                }
              },
              {
                'persons.1.id': contactOfContactId,
                'persons.1.target': true,
                'persons.0.type': {
                  $in: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE']
                }
              }
            ]
          }, {
            limit: 1,
            // required to use index to improve greatly performance
            hint: {
              'persons.id': 1
            }
          });
      })
      .then(function (relationsNumber) {
        if (!relationsNumber) {
          // the contact of contact doesn't have relations with other cases/events; stop conversion
          throw app.utils.apiError.getError('INVALID_CONTACT_OF_CONTACT_RELATIONSHIP', {id: contactOfContactId});
        }

        // define the attributes for update
        const attributes = {
          dateBecomeContact: app.utils.helpers.getDate().toDate(),
          wasContactOfContact: true,
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        };

        // restore data from custom forms before conversion
        if (!_.isEmpty(contactOfContactInstance.questionnaireAnswersContact)) {
          attributes.questionnaireAnswers = Object.assign({}, contactOfContactInstance.questionnaireAnswersContact);
          attributes.questionnaireAnswersContact = {};
        }

        // the contact has relations with other contacts; proceed with the conversion
        return app.models.person.rawUpdateOne(
          {
            _id: contactOfContactId
          },
          attributes,
          options
        );
      })
      .then(() => {
        return app.models.contact.findOne({
          where: {
            id: contactOfContactId
          }
        });
      })
      .then(function (contactOfContactModel) {
        if (!contactOfContactModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contact.modelName, id: contactOfContactId});
        }

        // keep the contactModel as we will do actions on it
        convertedContact = contactOfContactModel;

        // after updating the contact, find it's relations
        return app.models.relationship
          .find({
            where: {
              'persons.id': contactOfContactId
            }
          });
      })
      .then(function (relations) {
        if (!relations.length) {
          // the contact doesn't have relations with other contacts; stop conversion
          throw app.utils.apiError.getError('INVALID_CONTACT_OF_CONTACT_RELATIONSHIP', {id: contactOfContactId});
        }

        // update relations
        const updateRelations = [];
        relations.forEach(function (relation) {
          let persons = [];
          relation.persons.forEach(function (person) {
            // for every occurrence of current contact
            if (person.id === contactOfContactId) {
              // update type to match the new one
              person.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT';
            }
            persons.push(person);
          });
          updateRelations.push(relation.updateAttributes({persons: persons}, options));
        });
        return Promise.all(updateRelations);
      })
      .then(function () {
        // update personType from lab results
        return app.models.labResult
          .rawBulkUpdate(
            {
              personId: contactOfContactId
            },
            {
              personType: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
            },
            options
          );
      })
      .then(function () {
        callback(null, convertedContact);
      })
      .catch(callback);
  };
};
