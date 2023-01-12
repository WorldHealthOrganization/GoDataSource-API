'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const path = require('path');
const fs = require('fs');
const common = require('./_common');
const uuid = require('uuid');

/**
 * Create / Update default reference data
 * @returns Promise
 */
const createUpdateDefaultReferenceData = (referenceDataDirPath) => {
  // create Mongo DB connection
  let language, languageToken, referenceData;
  const mappedLanguages = {};
  const referenceDataFilePaths = [];
  return MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      language = dbConn.collection('language');
      languageToken = dbConn.collection('languageToken');
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

      // determine reference data files that we need to import (create & update tokens)
      fs.readdirSync(referenceDataDirPath).forEach(function (refDataFilePath) {
        referenceDataFilePaths.push(path.resolve(`${referenceDataDirPath}/${refDataFilePath}`));
      });
    })
    .then(() => {
      // start
      const loadAndMigrateDefaultRefData = () => {
        // finished ?
        if (referenceDataFilePaths.length < 1) {
          return Promise.resolve();
        }

        // get next file
        const refDataFilePath = referenceDataFilePaths.splice(0, 1)[0];

        // start migrating tokens from this file
        return new Promise(
          (refDataFileResolve, refDataFileReject) => {
            // get template data
            const refData = require(refDataFilePath);

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
              console.log(`Creating / Updating reference data tokens for language '${mappedLanguages[languageId]}'`);

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
                        $in: Object.keys(refData.translations ? refData.translations : {})
                      }
                    }, {
                      projection: {
                        _id: 1,
                        token: 1,
                        translation: 1,
                        section: 1
                      }
                    })
                    .toArray()
                    .then((languageTokenModels) => {
                      // create update jobs if necessary
                      languageTokenModels.forEach((languageTokenModel) => {
                        // remove from create
                        tokensAlreadyHandled[languageTokenModel.token] = true;

                        // no change ?
                        if (
                          languageTokenModel.translation === refData.translations[languageTokenModel.token].translation &&
                          languageTokenModel.section === refData.translations[languageTokenModel.token].section
                        ) {
                          return;
                        }

                        // log
                        console.log(`Updating default reference data token '${languageTokenModel.token}' for language '${mappedLanguages[languageId]}'`);

                        // update token
                        jobs.push(
                          languageToken
                            .updateOne({
                              _id: languageTokenModel._id
                            }, {
                              $set: {
                                translation: refData.translations[languageTokenModel.token].translation,
                                modules: refData.translations[languageTokenModel.token].modules,
                                section: refData.translations[languageTokenModel.token].section,
                                deleted: false,
                                deletedAt: null
                              }
                            })
                        );
                      });
                    })
                    .then(() => {
                      // create tokens that weren't updated
                      Object.keys(refData.translations ? refData.translations : {}).forEach((token) => {
                        // handled ?
                        if (tokensAlreadyHandled[token]) {
                          return;
                        }

                        // log
                        console.log(`Creating default reference data token '${token}' for language '${mappedLanguages[languageId]}'`);

                        // create token
                        const tokenSortKey = token ? token.substr(0, 128) : '';
                        jobs.push(
                          languageToken
                            .insert({
                              _id: uuid.v4(),
                              languageId,
                              token,
                              tokenSortKey: tokenSortKey,
                              translation: refData.translations[token].translation,
                              modules: refData.translations[token].modules,
                              section: refData.translations[token].section,
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
                          console.log(`Finished creating / updating default reference data tokens for language '${mappedLanguages[languageId]}'`);

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
                !refData.referenceData ||
                refData.referenceData.length < 1
              ) {
                return Promise.resolve();
              }

              // create list of reference data items that we need to retrieve
              const referenceItemsMap = {};
              refData.referenceData.forEach((refData) => {
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
                    order: 1,
                    active: 1,
                    code: 1
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
                      (
                        refItem.categoryId === undefined ||
                        referenceDataModel.categoryId === refItem.categoryId
                      ) && (
                        refItem.value === undefined ||
                        referenceDataModel.value === refItem.value
                      ) && (
                        refItem.colorCode === undefined ||
                        referenceDataModel.colorCode === refItem.colorCode
                      ) && (
                        refItem.description === undefined ||
                        referenceDataModel.description === refItem.description
                      ) && (
                        refItem.order === undefined ||
                        referenceDataModel.order === refItem.order
                      ) && (
                        refItem.active === undefined ||
                        referenceDataModel.active === refItem.active
                      ) && (
                        refItem.code === undefined ||
                        referenceDataModel.code === refItem.code
                      )
                    ) {
                      return;
                    }

                    // log
                    console.log(`Updating default reference item '${referenceDataModel._id}'`);

                    // update
                    jobs.push(
                      referenceData
                        .updateOne({
                          _id: referenceDataModel._id
                        }, {
                          $set: {
                            categoryId: refItem.categoryId !== undefined ?
                              refItem.categoryId :
                              referenceDataModel.categoryId,
                            value: refItem.value !== undefined ?
                              refItem.value :
                              referenceDataModel.value,
                            colorCode: refItem.colorCode !== undefined ?
                              refItem.colorCode :
                              referenceDataModel.colorCode,
                            description: refItem.description !== undefined ?
                              refItem.description :
                              referenceDataModel.description,
                            order: refItem.order !== undefined ?
                              refItem.order :
                              referenceDataModel.order,
                            active: refItem.active !== undefined ?
                              refItem.active :
                              true,
                            code: refItem.code !== undefined ?
                              refItem.code :
                              referenceDataModel.code,
                            isDefaultReferenceData: true,
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
                    console.log(`Creating default reference item '${refItemId}'`);

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
                          active: refItem.active !== undefined ? refItem.active : true,
                          code: refItem.code,
                          isDefaultReferenceData: true,
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
                      console.log('Finished creating / updating default reference items');
                    });
                });
            };

            // start creating / updating
            return nextLanguage()
              .then(createUpdateReferenceData)
              .then(() => {
                refDataFileResolve();
              })
              .catch(refDataFileReject);
          })
          .then(loadAndMigrateDefaultRefData);
      };

      // start with first one
      return loadAndMigrateDefaultRefData();
    });
};

// export
module.exports = {
  createUpdateDefaultReferenceData
};
