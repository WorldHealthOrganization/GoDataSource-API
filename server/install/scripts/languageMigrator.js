'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');
const path = require('path');
const fs = require('fs');
const common = require('./_common');
const uuid = require('uuid');
const localizationHelper = require('../../../components/localizationHelper');

/**
 * Create / Update language tokens
 * @param updateOnlyTheseLanguages [Optional - Array of strings - if not provided system updates all languages]
 * @returns Promise
 */
const createUpdateLanguageTokens = (
  languagesDirPath,
  updateOnlyTheseLanguages
) => {
  // create Mongo DB connection
  let language, languageToken;
  const languageFilePaths = [];
  let languageModels;
  return MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      language = dbConn.collection('language');
      languageToken = dbConn.collection('languageToken');
    })
    .then(() => {
      // create languages filter
      const languagesFilter = {
        deleted: false
      };

      // attach restrictions to languages
      if (
        updateOnlyTheseLanguages &&
        updateOnlyTheseLanguages.length > 0
      ) {
        languagesFilter._id = {
          $in: updateOnlyTheseLanguages
        };
      }

      // retrieve languages
      return language
        .find(languagesFilter, {
          projection: {
            _id: 1,
            name: 1
          }
        })
        .toArray();
    })
    .then((languages) => {
      // languages
      languageModels = languages;

      // determine language files that we need to import (create & update tokens)
      fs.readdirSync(languagesDirPath).forEach(function (languageFilePath) {
        languageFilePaths.push(path.resolve(`${languagesDirPath}/${languageFilePath}`));
      });
    })
    .then(() => {
      // start migrating language tokens
      const loadAndMigrateLanguageTokens = () => {
        // finished ?
        if (languageFilePaths.length < 1) {
          return Promise.resolve();
        }

        // get next file
        const languageFilePath = languageFilePaths.splice(0, 1)[0];

        // start migrating tokens from this file
        return new Promise(
          (languageFileResolve, languageFileReject) => {
            // get language data
            const languageFileData = require(languageFilePath);

            // start creating / updating language tokens for each language
            const languagesToCheck = [...languageModels];
            const nextLanguage = () => {
              // finished ?
              if (languagesToCheck.length < 1) {
                return Promise.resolve();
              }

              // get next language
              const languageModel = languagesToCheck.splice(0, 1)[0];

              // log
              console.log(`Creating / Updating tokens for language '${languageModel.name}'`);

              // start updating / creating tokens for this language
              return new Promise(
                (languageResolve, languageReject) => {
                  // determine which tokens already exist in db
                  const jobs = [];
                  const tokensAlreadyHandled = {};
                  languageToken
                    .find({
                      languageId: languageModel._id,
                      token: {
                        $in: Object.keys(languageFileData.tokens)
                      }
                    }, {
                      projection: {
                        _id: 1,
                        token: 1,
                        translation: 1,
                        section: 1,
                        deleted: 1
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
                          !languageTokenModel.deleted &&
                          languageTokenModel.translation === languageFileData.tokens[languageTokenModel.token].translation && (
                            !languageFileData.tokens[languageTokenModel.token].section ||
                            languageTokenModel.section === languageFileData.tokens[languageTokenModel.token].section
                          )
                        ) {
                          return;
                        }

                        // log
                        console.log(`Updating token '${languageTokenModel.token}' for language '${languageModel.name}'`);

                        // log
                        if (languageTokenModel.deleted) {
                          console.log(`Restoring token '${languageTokenModel.token}' for language '${languageModel.name}'`);
                        }

                        // update token
                        jobs.push(
                          languageToken
                            .updateOne({
                              _id: languageTokenModel._id
                            }, {
                              $set: {
                                translation: languageFileData.tokens[languageTokenModel.token].translation,
                                section: languageFileData.tokens[languageTokenModel.token].section ?
                                  languageFileData.tokens[languageTokenModel.token].section :
                                  languageTokenModel.section,
                                updatedAt: localizationHelper.now().toDate(),
                                dbUpdatedAt: localizationHelper.now().toDate(),
                                updatedBy: 'system',
                                deleted: false
                              },
                              $unset: {
                                deletedAt: ''
                              }
                            })
                        );
                      });
                    })
                    .then(() => {
                      // create tokens that weren't updated
                      Object.keys(languageFileData.tokens).forEach((token) => {
                        // handled ?
                        if (tokensAlreadyHandled[token]) {
                          return;
                        }

                        // log
                        console.log(`Creating token '${token}' for language '${languageModel.name}'`);

                        // create token
                        jobs.push(
                          languageToken
                            .insert({
                              _id: uuid.v4(),
                              languageId: languageModel._id,
                              token,
                              tokenSortKey: token,
                              translation: languageFileData.tokens[token].translation,
                              modules: languageFileData.tokens[token].modules,
                              section: languageFileData.tokens[token].section,
                              deleted: false,
                              createdAt: common.install.timestamps.createdAt,
                              createdBy: 'system',
                              updatedAt: common.install.timestamps.updatedAt,
                              dbUpdatedAt: localizationHelper.now().toDate(),
                              updatedBy: 'system',
                              isDefaultLanguageToken: true
                            })
                        );
                      });
                    })
                    .then(() => {
                      return Promise
                        .all(jobs)
                        .then(() => {
                          // log
                          console.log(`Finished creating / updating tokens for language '${languageModel.name}'`);

                          // finished
                          languageResolve();
                        });
                    })
                    .catch(languageReject);
                })
                .then(nextLanguage);
            };

            // start creating / updating tokens
            return nextLanguage()
              .then(() => {
                languageFileResolve();
              })
              .catch(languageFileReject);
          })
          .then(loadAndMigrateLanguageTokens);
      };

      // start with first one
      return loadAndMigrateLanguageTokens();
    });
};

// export
module.exports = {
  createUpdateLanguageTokens
};
