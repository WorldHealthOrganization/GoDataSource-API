'use strict';

// imports
const async = require('async');
const _ = require('lodash');
const app = require('../../../../server');
const language = app.models.language;
const languageToken = app.models.languageToken;
const outbreakTemplate = app.models.template;
const referenceData = app.models.referenceData;
const common = require('./../../_common');
const defaultOutbreakTemplateData = require(`${__dirname}/data/outbreak-template/defaultOutbreakTemplateData.json`);

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  // initialize action options; set _init, _sync flags to prevent execution of some after save scripts
  const options = {
    _init: true,
    _sync: true
  };

  // make sure we have what we need :)
  const defaultOutbreakTemplateDataJson = defaultOutbreakTemplateData || [];

  // retrieve all languages
  const mappedLanguages = {};
  language
    .find()
    .then((languages) => {
      languages.forEach((language) => {
        mappedLanguages[language.id] = true;
      });
    })

    // ignore existing help items
    .then(() => {
      return languageToken
        .find({
          where: {
            token: {
              inq: Object.keys(defaultOutbreakTemplateDataJson.translations)
            }
          }
        });
    })

    // determine which language tokens exist already and include them for update
    .then((langTokens) => {
      // map tokens for which we need to update data
      const createUpdateLanguageTokensJob = [];
      (langTokens || []).forEach((langTokenModel) => {
        // add update job
        const fileTranslation = defaultOutbreakTemplateDataJson.translations[langTokenModel.token] ?
          defaultOutbreakTemplateDataJson.translations[langTokenModel.token][langTokenModel.languageId] :
          undefined;

        // delete token that we need to update so we don't create a new one
        if (defaultOutbreakTemplateDataJson.translations[langTokenModel.token]) {
          delete defaultOutbreakTemplateDataJson.translations[langTokenModel.token][langTokenModel.languageId];
        }

        // update only if necessary
        if (typeof fileTranslation !== 'string') {
          // finished
          app.logger.debug(`Translation missing for ${langTokenModel.token} => ${langTokenModel.languageId}`);

          // check if translation is the same
        } else if (
          fileTranslation === langTokenModel.translation &&
          _.isEqual(defaultOutbreakTemplateDataJson.translations[langTokenModel.token].modules, langTokenModel.modules)
        ) {
          // finished
          app.logger.debug(`Translation is the same for ${langTokenModel.token} => ${langTokenModel.languageId}`);
        } else {
          (function (langToken, newTranslation, modules) {
            createUpdateLanguageTokensJob.push((cb) => {
              // display log
              app.logger.debug(`Updating token ${langToken.token} => ${langToken.languageId} ...`);

              // update
              langToken
                .updateAttributes({
                  translation: newTranslation,
                  modules: modules
                }, options)
                .then(() => {
                  // finished
                  app.logger.debug(`Updated token ${langToken.token} => ${langToken.languageId}`);
                  cb();
                })
                .catch(cb);
            });
          })(langTokenModel, fileTranslation, defaultOutbreakTemplateDataJson.translations[langTokenModel.token].modules);
        }
      });

      // create new language tokens
      Object.keys(defaultOutbreakTemplateDataJson.translations || {})
        .forEach((token) => {
          // go through each language token
          Object.keys(defaultOutbreakTemplateDataJson.translations[token] || {})
            .forEach((languageId) => {
              // jump over if this isn't a language
              if (!mappedLanguages[languageId]) {
                return;
              }

              // create
              (function (newToken, newLanguageId, newTranslation, modules) {
                // add to create list
                createUpdateLanguageTokensJob.push((cb) => {
                  // display log
                  app.logger.debug(`Creating token ${newToken} => ${newLanguageId} ...`);

                  // create token
                  languageToken
                    .create(Object.assign({
                      token: newToken,
                      languageId: newLanguageId,
                      translation: newTranslation,
                      modules: modules
                    }, common.install.timestamps), options)
                    .then(() => {
                      // finished
                      app.logger.debug(`Created token ${newToken} => ${newLanguageId}`);
                      cb();
                    })
                    .catch(cb);
                });
              })(token, languageId, defaultOutbreakTemplateDataJson.translations[token][languageId], defaultOutbreakTemplateDataJson.translations[token].modules);
            });
        });

      // execute jobs
      return new Promise((resolve, reject) => {
        // wait for all operations to be done
        async.parallelLimit(createUpdateLanguageTokensJob, 10, function (error) {
          // error
          if (error) {
            return reject(error);
          }

          // finished
          resolve();
        });
      });
    })

    // create reference data items
    .then(() => {
      // execute jobs
      return new Promise((resolve, reject) => {
        // nothing to do ?
        if (_.isEmpty(defaultOutbreakTemplateDataJson.referenceData)) {
          return resolve();
        }

        // map reference items
        const referenceItemMap = {};
        (defaultOutbreakTemplateDataJson.referenceData || [])
          .forEach((item) => {
            referenceItemMap[item.id] = item;
          });

        // determine which reference items exist already
        const createUpdateRefItemJobs = [];
        const existingRefItems = {};
        referenceData
          .find({
            deleted: true,
            where: {
              id: {
                inq: Object.keys(referenceItemMap)
              }
            }
          })
          .then((refDataItems) => {
            (refDataItems || []).forEach((refDataItem) => {
              // add to list of existing items so we can exclude it from creation
              existingRefItems[refDataItem.id] = true;

              // determine if we need to update ref items
              const fileData = referenceItemMap[refDataItem.id];
              if (
                refDataItem.value === fileData.value &&
                refDataItem.description === fileData.description &&
                refDataItem.colorCode === fileData.colorCode &&
                refDataItem.order === fileData.order &&
                refDataItem.isOutbreakTemplateReferenceData === true
              ) {
                // finished
                app.logger.debug(`No need to update reference data item ${refDataItem.id}`);
              } else {
                // update item
                (function (updateRefItem, data) {
                  createUpdateRefItemJobs.push((cb) => {
                    // display log
                    app.logger.debug(`Updating reference data item ${updateRefItem.id} ...`);

                    // update
                    updateRefItem
                      .updateAttributes({
                        value: data.value,
                        description: data.description,
                        colorCode: data.colorCode,
                        order: data.order,
                        deleted: false,
                        deletedAt: null,
                        isOutbreakTemplateReferenceData: true
                      }, options)
                      .then(() => {
                        // finished
                        app.logger.debug(`Updated reference data item ${updateRefItem.id}`);
                        cb();
                      })
                      .catch(cb);
                  });
                })(refDataItem, fileData);
              }
            });

            // create reference data item that weren't updated
            (defaultOutbreakTemplateDataJson.referenceData || []).forEach((fileData) => {
              // don't create ref data item if we've updated this one
              if (existingRefItems[fileData.id]) {
                return;
              }

              // create ref data item
              (function (newRefItem) {
                createUpdateRefItemJobs.push((cb) => {
                  // display log
                  app.logger.debug(`Creating reference data item ${newRefItem.id} ...`);

                  // create
                  referenceData
                    .create(Object.assign({
                      id: newRefItem.id,
                      categoryId: newRefItem.categoryId,
                      value: newRefItem.value,
                      description: newRefItem.description,
                      colorCode: newRefItem.colorCode,
                      order: newRefItem.order,
                      isOutbreakTemplateReferenceData: true
                    }, common.install.timestamps), options)
                    .then(() => {
                      // finished
                      app.logger.debug(`Created reference data item ${newRefItem.id}`);
                      cb();
                    })
                    .catch(cb);
                });
              })(fileData);
            });

            // wait for all operations to be done
            async.parallelLimit(createUpdateRefItemJobs, 10, function (error) {
              // error
              if (error) {
                return reject(error);
              }

              // finished
              resolve();
            });
          })
          .catch(reject);
      });
    })

    // create outbreak templates
    .then(() => {
      // execute jobs
      return new Promise((resolve, reject) => {
        // nothing to do ?
        if (_.isEmpty(defaultOutbreakTemplateDataJson.outbreakTemplates)) {
          return resolve();
        }

        // map outbreak templates
        const outbreakTemplatesMap = {};
        (defaultOutbreakTemplateDataJson.outbreakTemplates || [])
          .forEach((item) => {
            outbreakTemplatesMap[item.id] = item;
          });

        // determine which template items exist already
        const createUpdateItemsJobs = [];
        const existingTemplates = {};
        outbreakTemplate
          .find({
            deleted: true,
            where: {
              id: {
                inq: Object.keys(outbreakTemplatesMap)
              }
            }
          })
          .then((outbreakTemplateModels) => {
            (outbreakTemplateModels || []).forEach((outbreakTemplateModel) => {
              // add to list of existing items so we can exclude it from creation
              existingTemplates[outbreakTemplateModel.id] = true;

              // update item
              const fileData = outbreakTemplatesMap[outbreakTemplateModel.id];
              (function (updateTemplateModel, data) {
                createUpdateItemsJobs.push((cb) => {
                  // display log
                  app.logger.debug(`Updating outbreak template ${outbreakTemplateModel.id} ...`);

                  // update
                  updateTemplateModel
                    .updateAttributes({
                      name: data.name,
                      description: data.description,
                      disease: data.disease,
                      periodOfFollowup: data.periodOfFollowup,
                      frequencyOfFollowUp: data.frequencyOfFollowUp,
                      frequencyOfFollowUpPerDay: data.frequencyOfFollowUpPerDay,
                      generateFollowUpsOverwriteExisting: data.generateFollowUpsOverwriteExisting,
                      generateFollowUpsKeepTeamAssignment: data.generateFollowUpsKeepTeamAssignment,
                      generateFollowUpsTeamAssignmentAlgorithm: data.generateFollowUpsTeamAssignmentAlgorithm,
                      intervalOfFollowUp: data.intervalOfFollowUp,
                      noDaysAmongContacts: data.noDaysAmongContacts,
                      noDaysInChains: data.noDaysInChains,
                      noDaysNotSeen: data.noDaysNotSeen,
                      noLessContacts: data.noLessContacts,
                      longPeriodsBetweenCaseOnset: data.longPeriodsBetweenCaseOnset,
                      noDaysNewContacts: data.noDaysNewContacts,
                      caseInvestigationTemplate: data.caseInvestigationTemplate,
                      contactInvestigationTemplate: data.contactInvestigationTemplate,
                      contactFollowUpTemplate: data.contactFollowUpTemplate,
                      labResultsTemplate: data.labResultsTemplate,
                      isContactLabResultsActive: !!data.isContactLabResultsActive,
                      applyGeographicRestrictions: !!data.applyGeographicRestrictions,
                      deleted: false,
                      deletedAt: null
                    }, options)
                    .then(() => {
                      // finished
                      app.logger.debug(`Updated outbreak template ${outbreakTemplateModel.id}`);
                      cb();
                    })
                    .catch(cb);
                });
              })(outbreakTemplateModel, fileData);
            });

            // create items that weren't updated
            (defaultOutbreakTemplateDataJson.outbreakTemplates || []).forEach((oTemplateData) => {
              // don't create item if we've updated this one
              if (existingTemplates[oTemplateData.id]) {
                return;
              }

              // create item
              (function (newTemplateItem) {
                createUpdateItemsJobs.push((cb) => {
                  // display log
                  app.logger.debug(`Creating outbreak template ${newTemplateItem.id} ...`);

                  // create
                  outbreakTemplate
                    .create(Object.assign({
                      id: newTemplateItem.id,
                      name: newTemplateItem.name,
                      description: newTemplateItem.description,
                      disease: newTemplateItem.disease,
                      periodOfFollowup: newTemplateItem.periodOfFollowup,
                      frequencyOfFollowUp: newTemplateItem.frequencyOfFollowUp,
                      frequencyOfFollowUpPerDay: newTemplateItem.frequencyOfFollowUpPerDay,
                      generateFollowUpsOverwriteExisting: newTemplateItem.generateFollowUpsOverwriteExisting,
                      generateFollowUpsKeepTeamAssignment: newTemplateItem.generateFollowUpsKeepTeamAssignment,
                      generateFollowUpsTeamAssignmentAlgorithm: newTemplateItem.generateFollowUpsTeamAssignmentAlgorithm,
                      intervalOfFollowUp: newTemplateItem.intervalOfFollowUp,
                      noDaysAmongContacts: newTemplateItem.noDaysAmongContacts,
                      noDaysInChains: newTemplateItem.noDaysInChains,
                      noDaysNotSeen: newTemplateItem.noDaysNotSeen,
                      noLessContacts: newTemplateItem.noLessContacts,
                      longPeriodsBetweenCaseOnset: newTemplateItem.longPeriodsBetweenCaseOnset,
                      noDaysNewContacts: newTemplateItem.noDaysNewContacts,
                      caseInvestigationTemplate: newTemplateItem.caseInvestigationTemplate,
                      contactInvestigationTemplate: newTemplateItem.contactInvestigationTemplate,
                      contactFollowUpTemplate: newTemplateItem.contactFollowUpTemplate,
                      labResultsTemplate: newTemplateItem.labResultsTemplate,
                      isContactLabResultsActive: !!newTemplateItem.isContactLabResultsActive,
                      applyGeographicRestrictions: !!newTemplateItem.applyGeographicRestrictions
                    }, common.install.timestamps), options)
                    .then(() => {
                      // finished
                      app.logger.debug(`Created outbreak template ${newTemplateItem.id}`);
                      cb();
                    })
                    .catch(cb);
                });
              })(oTemplateData);
            });

            // wait for all operations to be done
            async.parallelLimit(createUpdateItemsJobs, 10, function (error) {
              // error
              if (error) {
                return reject(error);
              }

              // finished
              resolve();
            });
          })
          .catch(reject);
      });
    })

    // finished
    .then(() => {
      console.log('Default Outbreak Template Data Installed');
      callback();
    })

    // handle errors
    .catch(callback);
}

module.exports = {
  run
};
