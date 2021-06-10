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
   * @param options
   */
  Outbreak.prototype.findContactsOfContacts = function (filter, options, callback) {
    const outbreakId = this.outbreakId;
    const countRelations = genericHelpers.getFilterCustomOption(filter, 'countRelations');

    app.models.contactOfContact
      .preFilterForOutbreak(this, filter, options)
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

  Outbreak.beforeRemote('prototype.exportFilteredContactsOfContacts', function (context, modelInstance, next) {
    Outbreak.helpers.findAndFilteredCountContactsBackCompat(context, modelInstance, next);
  });

  /**
   * Export filtered contacts of contacts to file
   * @param filter
   * @param exportType json, xml, csv, xls, xlsx, ods, pdf or csv. Default: json
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
    app.models.contactOfContact
      .preFilterForOutbreak(this, filter, options)
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
          fieldsGroupList,
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
  Outbreak.prototype.countContactsOfContactsPerRiskLevel = function (filter, options, callback) {
    app.models.contactOfContact
      .preFilterForOutbreak(this, filter, options)
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
                              const lastName = sanitizedContact.rawData.lastName ? sanitizedContact.rawData.lastName.replace(/\r|\n|\s/g, '').toUpperCase() + ' ' : '';
                              const firstName = sanitizedContact.rawData.firstName ? sanitizedContact.rawData.firstName.replace(/\r|\n|\s/g, '') : '';
                              fs.writeFile(`${tmpDirName}/${lastName}${firstName} - ${sanitizedContact.rawData.id}.pdf`, buffer, (err) => {
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
                  });
              });
            });
        });
      });
  };
};
