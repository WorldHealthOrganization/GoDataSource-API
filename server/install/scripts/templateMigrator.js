'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const path = require('path');
const fs = require('fs');
const common = require('./_common');
const uuid = require('uuid');
const Platform = require('../../../components/platform');

/**
 * Create / Update default outbreak templates
 * @returns Promise
 */
const createUpdateDefaultOutbreakTemplates = (outbreakTemplatesDirPath) => {
  // create Mongo DB connection
  let language, languageToken, outbreakTemplate, referenceData;
  const mappedLanguages = {};
  const templateFilePaths = [];
  return MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      language = dbConn.collection('language');
      languageToken = dbConn.collection('languageToken');
      outbreakTemplate = dbConn.collection('template');
      referenceData = dbConn.collection('referenceData');
    })
    .then(() => {
      return language
        .find({}, {
          projection: {
            _id: 1,
            name: 1
          }
        })
        .toArray();
    })
    .then((languages) => {
      // languages
      languages.forEach((language) => {
        mappedLanguages[language._id] = language.name;
      });

      // determine outbreak template files that we need to import (create & update tokens)
      fs.readdirSync(outbreakTemplatesDirPath).forEach(function (outbreakTemplateFilePath) {
        templateFilePaths.push(path.resolve(`${outbreakTemplatesDirPath}/${outbreakTemplateFilePath}`));
      });
    })
    .then(() => {
      // start
      const loadAndMigrateDefaultOutbreakTemplates = () => {
        // finished ?
        if (templateFilePaths.length < 1) {
          return Promise.resolve();
        }

        // get next file
        const templateDataFilePath = templateFilePaths.splice(0, 1)[0];

        // start migrating tokens from this file
        return new Promise(
          (templateDataFileResolve, templateDataFileReject) => {
            // get template data
            const templateData = require(templateDataFilePath);

            // start creating / updating language tokens for each language
            const languagesToCheckIds = Object.keys(mappedLanguages);
            const nextLanguage = () => {
              // finished ?
              if (languagesToCheckIds.length < 1) {
                return Promise.resolve();
              }

              // get next language
              const languageId = languagesToCheckIds.splice(0, 1)[0];

              // log
              console.log(`Creating / Updating default template tokens for language '${mappedLanguages[languageId]}'`);

              // start updating / creating tokens for this language
              return new Promise(
                (languageResolve, languageReject) => {
                  // determine which tokens already exist in db
                  const jobs = [];
                  const tokensAlreadyHandled = {};
                  languageToken
                    .find({
                      languageId: languageId,
                      token: {
                        $in: Object.keys(templateData.translations)
                      }
                    }, {
                      projection: {
                        _id: 1,
                        token: 1,
                        translation: 1
                      }
                    })
                    .toArray()
                    .then((languageTokenModels) => {
                      // create update jobs if necessary
                      languageTokenModels.forEach((languageTokenModel) => {
                        // remove from create
                        tokensAlreadyHandled[languageTokenModel.token] = true;

                        // no change ?
                        const templateTokenTranslation = templateData.translations[languageTokenModel.token][languageId] ?
                          templateData.translations[languageTokenModel.token][languageId] :
                          templateData.translations[languageTokenModel.token]['english_us'];
                        if (languageTokenModel.translation === templateTokenTranslation) {
                          return;
                        }

                        // log
                        console.log(`Updating default template token '${languageTokenModel.token}' for language '${mappedLanguages[languageId]}'`);

                        // update token
                        jobs.push(
                          languageToken
                            .updateOne({
                              _id: languageTokenModel._id
                            }, {
                              $set: {
                                translation: templateTokenTranslation,
                                modules: templateData.translations[languageTokenModel.token].modules,
                                deleted: false,
                                deletedAt: null
                              }
                            })
                        );
                      });
                    })
                    .then(() => {
                      // create tokens that weren't updated
                      Object.keys(templateData.translations).forEach((token) => {
                        // handled ?
                        if (tokensAlreadyHandled[token]) {
                          return;
                        }

                        // log
                        console.log(`Creating default template token '${token}' for language '${mappedLanguages[languageId]}'`);

                        // create token
                        const tokenSortKey = token ? token.substr(0, 128) : '';
                        const templateTokenTranslation = templateData.translations[token][languageId] ?
                          templateData.translations[token][languageId] :
                          templateData.translations[token]['english_us'];
                        jobs.push(
                          languageToken
                            .insert({
                              _id: uuid.v4(),
                              languageId,
                              token,
                              tokenSortKey: tokenSortKey,
                              translation: templateTokenTranslation,
                              modules: templateData.translations[token].modules,
                              deleted: false,
                              createdAt: common.install.timestamps.createdAt,
                              createdBy: 'system',
                              updatedAt: common.install.timestamps.updatedAt,
                              updatedBy: 'system'
                            })
                        );
                      });
                    })
                    .then(() => {
                      return Promise
                        .all(jobs)
                        .then(() => {
                          // log
                          console.log(`Finished creating / updating default template tokens for language '${mappedLanguages[languageId]}'`);

                          // finished
                          languageResolve();
                        });
                    })
                    .catch(languageReject);
                })
                .then(nextLanguage);
            };

            // create & update reference data
            const createUpdateReferenceData = () => {
              // nothing to retrieve ?
              if (
                !templateData.referenceData ||
                templateData.referenceData.length < 1
              ) {
                return Promise.resolve();
              }

              // create list of reference data items that we need to retrieve
              const referenceItemsMap = {};
              templateData.referenceData.forEach((refData) => {
                referenceItemsMap[refData.id] = refData;
              });

              // create / update reference data
              const jobs = [];
              const refItemsAlreadyHandled = {};
              return referenceData
                .find({
                  _id: {
                    $in: Object.keys(referenceItemsMap)
                  }
                }, {
                  projection: {
                    _id: 1,
                    categoryId: 1,
                    value: 1,
                    colorCode: 1,
                    description: 1,
                    order: 1
                  }
                })
                .toArray()
                .then((referenceDataModels) => {
                  // create update jobs if necessary
                  referenceDataModels.forEach((referenceDataModel) => {
                    // remove from create
                    refItemsAlreadyHandled[referenceDataModel._id] = true;

                    // no change ?
                    const refItem = referenceItemsMap[referenceDataModel._id];
                    if (
                      referenceDataModel.categoryId === refItem.categoryId &&
                      referenceDataModel.value === refItem.value &&
                      referenceDataModel.colorCode === refItem.colorCode &&
                      referenceDataModel.description === refItem.description &&
                      referenceDataModel.order === refItem.order
                    ) {
                      return;
                    }

                    // log
                    console.log(`Updating default template reference item '${referenceDataModel._id}'`);

                    // update
                    jobs.push(
                      referenceData
                        .updateOne({
                          _id: referenceDataModel._id
                        }, {
                          $set: {
                            categoryId: refItem.categoryId,
                            value: refItem.value,
                            colorCode: refItem.colorCode,
                            description: refItem.description,
                            order: refItem.order,
                            deleted: false,
                            deletedAt: null
                          }
                        })
                    );
                  });
                })
                .then(() => {
                  // create item that weren't updated
                  Object.keys(referenceItemsMap).forEach((refItemId) => {
                    // handled ?
                    if (refItemsAlreadyHandled[refItemId]) {
                      return;
                    }

                    // log
                    console.log(`Creating default template reference item '${refItemId}'`);

                    // create
                    const refItem = referenceItemsMap[refItemId];
                    jobs.push(
                      referenceData
                        .insert({
                          _id: refItemId,
                          categoryId: refItem.categoryId,
                          value: refItem.value,
                          description: refItem.description,
                          colorCode: refItem.colorCode,
                          order: refItem.order,
                          isOutbreakTemplateReferenceData: true,
                          deleted: false,
                          createdAt: common.install.timestamps.createdAt,
                          createdBy: 'system',
                          updatedAt: common.install.timestamps.updatedAt,
                          updatedBy: 'system',
                          createdOn: Platform.API
                        })
                    );
                  });
                })
                .then(() => {
                  return Promise
                    .all(jobs)
                    .then(() => {
                      // log
                      console.log('Finished creating / updating default template reference items');
                    });
                });
            };

            // create update outbreak template
            const createUpdateOutbreakTemplate = () => {

              //delete old monkeypox template(s) to avoid confusion with new updated one in v2.50.2
              const deleteOldMonkeypox = outbreakTemplate
                .deleteMany({
                  name: { $regex: /^\s*monkeypox\s*$/i },
                })
                .then((result) => {
                  if (result.deletedCount > 0) {
                    console.log(
                      `Deleted ${result.deletedCount} existing 'Monkeypox' template(s).`
                    );
                  } else {
                    console.log('No existing Monkeypox templates found.');
                  }
                });

              return deleteOldMonkeypox.then(() => {
              // create list of templates that we need to retrieve
                const templateItemsMap = {};
                templateData.outbreakTemplates.forEach((tempData) => {
                  templateItemsMap[tempData.id] = tempData;
                });

                // check if template exists or we need to create it
                const jobs = [];
                const templatesAlreadyHandled = {};
                return outbreakTemplate
                  .find({
                    _id: {
                      $in: Object.keys(templateItemsMap)
                    }
                  })
                  .toArray()
                  .then((templateDataModels) => {
                    // create update jobs if necessary
                    templateDataModels.forEach((templateDataModel) => {
                      // remove from create
                      templatesAlreadyHandled[templateDataModel._id] = true;

                      // log
                      const refItem = templateItemsMap[templateDataModel._id];
                      console.log(`Updating default template '${refItem.name}'`);

                      // update
                      jobs.push(
                        outbreakTemplate
                          .updateOne({
                            _id: templateDataModel._id
                          }, {
                            $set: {
                              name: refItem.name,
                              description: refItem.description,
                              disease: refItem.disease,
                              periodOfFollowup: refItem.periodOfFollowup,
                              frequencyOfFollowUp: refItem.frequencyOfFollowUp,
                              frequencyOfFollowUpPerDay: refItem.frequencyOfFollowUpPerDay,
                              generateFollowUpsOverwriteExisting: refItem.generateFollowUpsOverwriteExisting,
                              generateFollowUpsKeepTeamAssignment: refItem.generateFollowUpsKeepTeamAssignment,
                              generateFollowUpsTeamAssignmentAlgorithm: refItem.generateFollowUpsTeamAssignmentAlgorithm,
                              generateFollowUpsDateOfLastContact: refItem.generateFollowUpsDateOfLastContact,
                              generateFollowUpsWhenCreatingContacts: refItem.generateFollowUpsWhenCreatingContacts,
                              intervalOfFollowUp: refItem.intervalOfFollowUp,
                              noDaysAmongContacts: refItem.noDaysAmongContacts,
                              noDaysInChains: refItem.noDaysInChains,
                              noDaysNotSeen: refItem.noDaysNotSeen,
                              noLessContacts: refItem.noLessContacts,
                              longPeriodsBetweenCaseOnset: refItem.longPeriodsBetweenCaseOnset,
                              noDaysNewContacts: refItem.noDaysNewContacts,
                              caseInvestigationTemplate: refItem.caseInvestigationTemplate,
                              contactInvestigationTemplate: refItem.contactInvestigationTemplate,
                              eventInvestigationTemplate: refItem.eventInvestigationTemplate,
                              caseFollowUpTemplate: refItem.caseFollowUpTemplate,
                              contactFollowUpTemplate: refItem.contactFollowUpTemplate,
                              labResultsTemplate: refItem.labResultsTemplate,
                              isContactLabResultsActive: refItem.isContactLabResultsActive,
                              isContactsOfContactsActive: refItem.isContactsOfContactsActive,
                              applyGeographicRestrictions: refItem.applyGeographicRestrictions,
                              checkLastContactDateAgainstDateOnSet: refItem.checkLastContactDateAgainstDateOnSet,
                              disableModifyingLegacyQuestionnaire: refItem.disableModifyingLegacyQuestionnaire,
                              allowCasesFollowUp: refItem.allowCasesFollowUp,
                              periodOfFollowupCases: refItem.periodOfFollowupCases,
                              frequencyOfFollowUpCases: refItem.frequencyOfFollowUpCases,
                              frequencyOfFollowUpPerDayCases: refItem.frequencyOfFollowUpPerDayCases,
                              intervalOfFollowUpCases: refItem.intervalOfFollowUpCases,
                              generateFollowUpsOverwriteExistingCases: refItem.generateFollowUpsOverwriteExistingCases,
                              generateFollowUpsKeepTeamAssignmentCases: refItem.generateFollowUpsKeepTeamAssignmentCases,
                              generateFollowUpsTeamAssignmentAlgorithmCases: refItem.generateFollowUpsTeamAssignmentAlgorithmCases,
                              generateFollowUpsDateOfOnset: refItem.generateFollowUpsDateOfOnset,
                              generateFollowUpsWhenCreatingCases: refItem.generateFollowUpsWhenCreatingCases,
                              visibleAndMandatoryFields: refItem.visibleAndMandatoryFields,
                              deleted: false,
                              deletedAt: null
                            }
                          })
                      );
                    });
                  })
                  .then(() => {
                    // create item that weren't updated
                    Object.keys(templateItemsMap).forEach((tempItemId) => {
                      // handled ?
                      if (templatesAlreadyHandled[tempItemId]) {
                        return;
                      }

                      // log
                      const refItem = templateItemsMap[tempItemId];
                      console.log(`Creating default template '${refItem.name}'`);

                      // create
                      jobs.push(
                        outbreakTemplate
                          .insert({
                            _id: tempItemId,
                            name: refItem.name,
                            description: refItem.description,
                            disease: refItem.disease,
                            periodOfFollowup: refItem.periodOfFollowup,
                            frequencyOfFollowUp: refItem.frequencyOfFollowUp,
                            frequencyOfFollowUpPerDay: refItem.frequencyOfFollowUpPerDay,
                            generateFollowUpsOverwriteExisting: refItem.generateFollowUpsOverwriteExisting,
                            generateFollowUpsKeepTeamAssignment: refItem.generateFollowUpsKeepTeamAssignment,
                            generateFollowUpsTeamAssignmentAlgorithm: refItem.generateFollowUpsTeamAssignmentAlgorithm,
                            generateFollowUpsDateOfLastContact: refItem.generateFollowUpsDateOfLastContact,
                            generateFollowUpsWhenCreatingContacts: refItem.generateFollowUpsWhenCreatingContacts,
                            intervalOfFollowUp: refItem.intervalOfFollowUp,
                            noDaysAmongContacts: refItem.noDaysAmongContacts,
                            noDaysInChains: refItem.noDaysInChains,
                            noDaysNotSeen: refItem.noDaysNotSeen,
                            noLessContacts: refItem.noLessContacts,
                            longPeriodsBetweenCaseOnset: refItem.longPeriodsBetweenCaseOnset,
                            noDaysNewContacts: refItem.noDaysNewContacts,
                            caseInvestigationTemplate: refItem.caseInvestigationTemplate,
                            contactInvestigationTemplate: refItem.contactInvestigationTemplate,
                            eventInvestigationTemplate: refItem.eventInvestigationTemplate,
                            caseFollowUpTemplate: refItem.caseFollowUpTemplate,
                            contactFollowUpTemplate: refItem.contactFollowUpTemplate,
                            labResultsTemplate: refItem.labResultsTemplate,
                            isContactLabResultsActive: refItem.isContactLabResultsActive,
                            isContactsOfContactsActive: refItem.isContactsOfContactsActive,
                            applyGeographicRestrictions: refItem.applyGeographicRestrictions,
                            checkLastContactDateAgainstDateOnSet: refItem.checkLastContactDateAgainstDateOnSet,
                            disableEditingLegacyQuestionnaire: refItem.disableEditingLegacyQuestionnaire,
                            allowCasesFollowUp: refItem.allowCasesFollowUp,
                            periodOfFollowupCases: refItem.periodOfFollowupCases,
                            frequencyOfFollowUpCases: refItem.frequencyOfFollowUpCases,
                            frequencyOfFollowUpPerDayCases: refItem.frequencyOfFollowUpPerDayCases,
                            intervalOfFollowUpCases: refItem.intervalOfFollowUpCases,
                            generateFollowUpsOverwriteExistingCases: refItem.generateFollowUpsOverwriteExistingCases,
                            generateFollowUpsKeepTeamAssignmentCases: refItem.generateFollowUpsKeepTeamAssignmentCases,
                            generateFollowUpsTeamAssignmentAlgorithmCases: refItem.generateFollowUpsTeamAssignmentAlgorithmCases,
                            generateFollowUpsDateOfOnset: refItem.generateFollowUpsDateOfOnset,
                            generateFollowUpsWhenCreatingCases: refItem.generateFollowUpsWhenCreatingCases,
                            visibleAndMandatoryFields: refItem.visibleAndMandatoryFields,
                            deleted: false,
                            createdAt: common.install.timestamps.createdAt,
                            createdBy: 'system',
                            updatedAt: common.install.timestamps.updatedAt,
                            updatedBy: 'system'
                          })
                      );
                    });
                  })
                  .then(() => {
                    return Promise
                      .all(jobs)
                      .then(() => {
                        // log
                        console.log('Finished creating / updating default template');
                      });
                  });
              });
            };

            // start creating / updating
            return nextLanguage()
              .then(createUpdateReferenceData)
              .then(createUpdateOutbreakTemplate)
              .then(() => {
                templateDataFileResolve();
              })
              .catch(templateDataFileReject);
          })
          .then(loadAndMigrateDefaultOutbreakTemplates);
      };

      // start with first one
      return loadAndMigrateDefaultOutbreakTemplates();
    });
};

// export
module.exports = {
  createUpdateDefaultOutbreakTemplates
};
