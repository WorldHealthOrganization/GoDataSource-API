'use strict';

const app = require('../../server/server');
const xlsx = require('xlsx');
const fs = require('fs');
const _ = require('lodash');
const localizationHelper = require('./../../components/localizationHelper');
const apiError = require('../../components/apiError');
const addMissingLanguageTokens = require('../../server/install/scripts/addMissingLanguageTokens');

module.exports = function (Language) {

  // language tokens should not be managed via API
  app.utils.remote.disableRemoteMethods(Language, [
    'prototype.__create__languageTokens',
    'prototype.__delete__languageTokens',
    'prototype.__findById__languageTokens',
    'prototype.__updateById__languageTokens',
    'prototype.__destroyById__languageTokens',
    'prototype.__get__languageTokens'
  ]);

  Language.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    Language.checkIfEditable(context.instance, next);
  });

  Language.beforeRemote('deleteById', function (context, modelInstance, next) {
    Language.checkIfEditable(context.args.id, next);
  });

  /**
   * Import file containing language tokens
   * @param req
   * @param languageFile
   * @param options
   * @param callback
   */
  Language.prototype.importLanguageTokensFile = function (req, languageFile, options, callback) {
    // make context available
    const self = this;
    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, [], ['languageFile'], Language, [], function (error, fields, files) {
      if (error) {
        return callback(error);
      }
      // read language file
      fs.readFile(files.languageFile.path, function (error, buffer) {
        if (error) {
          return callback(apiError.getError('FILE_NOT_FOUND'));
        }
        // read XLS file
        // we don't need to worry about other file formats, XLSX tries to read anything (does not do validations)
        // we'll validate the tokens below
        const parsedData = xlsx.read(buffer);
        // extract first sheet name (we only care about first sheet)
        let sheetName = parsedData.SheetNames.shift();
        // keep a list of language tokens
        const languageTokens = [];
        // keep a marker for end of file
        let eof = false;
        // start from row 2, first row contains headings
        let index = 2;
        // keep parsing until we reach end of file
        while (!eof) {
          // keep reading from the file until there are no translations left
          if (!parsedData.Sheets[sheetName][`A${index}`]) {
            eof = true;
          } else {
            // get token
            let token = parsedData.Sheets[sheetName][`A${index}`].v;
            // check if token is valid (starts with LNG_)
            if (/^LNG_/.test(token)) {
              // translation may be missing, use a default
              let translation = '';
              // if the translation exists, use it
              if (parsedData.Sheets[sheetName][`B${index}`]) {
                translation = parsedData.Sheets[sheetName][`B${index}`].v;
              }
              // save raw data
              languageTokens.push({
                token: token,
                translation: translation
              });
            }
          }
          // move to next row
          index++;
        }
        // do a simple file validation (check if we found valid tokens)
        if (!languageTokens.length) {
          // error if no valid tokens found
          return callback(app.utils.apiError.getError('INVALID_TRANSLATIONS_FILE', {
            fileName: files.languageFile.name,
            details: 'No valid language tokens were found in the file.'
          }));
        }
        // start updating translations
        self.updateLanguageTranslations(languageTokens, options, true)
          .then(function (languageTokens) {
            // add missing language tokens from other languages
            // - this shouldn't be necessary but it is a way to fix translation issue until a fix is delivered in next build after issue was reported
            addMissingLanguageTokens.checkAndAddMissingLanguageTokens(
              (err) => {
                callback(err, languageTokens);
              },
              self.id
            );
          })
          .catch(function (error) {
            // make error response readable
            error.errors.toString = function () {
              return this.length;
            };
            error.success.toString = function () {
              return this.length;
            };
            // on error, return error details
            return callback(app.utils.apiError.getError('IMPORT_PARTIAL_SUCCESS', {
              model: app.models.languageToken.modelName,
              failed: error.errors,
              success: error.success
            }));
          });
      });
    });
  };

  /**
   * Export a file containing language tokens
   * @param callback
   */
  Language.prototype.exportLanguageTokensFile = function (callback) {
    // make context available
    const self = this;

    // initialize filter
    const languageTokenFilter = {
      languageId: this.id
    };

    // define default translation file headers
    const translationFileHeaders = {
      token: 'Language Token',
      translation: 'Translation'
    };

    // translate file headers
    app.models.languageToken
      .rawFind(Object.assign({
        token: {
          $in: [
            'LNG_TRANSLATION_FILE_LANGUAGE_TOKEN_HEADER',
            'LNG_TRANSLATION_FILE_TRANSLATION_HEADER'
          ]
        }
      }, languageTokenFilter), {
        projection: {token: 1, translation: 1}
      })
      .then((headerTokens) => {
        // determine header columns translations
        (headerTokens || []).forEach((languageToken) => {
          // token header
          if (languageToken.token === 'LNG_TRANSLATION_FILE_LANGUAGE_TOKEN_HEADER') {
            translationFileHeaders.token = languageToken.translation;
          }

          // translation header
          if (languageToken.token === 'LNG_TRANSLATION_FILE_TRANSLATION_HEADER') {
            translationFileHeaders.translation = languageToken.translation;
          }
        });

        // initialize parameters for handleActionsInBatches call
        const getActionsCount = () => {
          return Promise.resolve()
            .then(() => {
              // count language tokens that we need to update
              return app.models.languageToken
                .count(languageTokenFilter);
            });
        };

        // get language tokens for batch
        const getBatchData = (batchNo, batchSize) => {
          return app.models.languageToken
            .rawFind(
              languageTokenFilter, {
                order: {tokenSortKey: 1},
                projection: {token: 1, translation: 1},
                skip: (batchNo - 1) * batchSize,
                limit: batchSize,
              }
            );
        };

        // batch item actions
        // #TODO - must change this logic  to work with worker and write to stream and NOT to memory how it is right now
        // keep a list of tokens that we will export
        const tokens = [];
        const batchItemsAction = (languageTokens) => {
          // try and find translation file headers in the correct language
          languageTokens.forEach(function (languageToken) {
            // add to list of tokens to export
            tokens.push({
              [translationFileHeaders.token]: languageToken.token,
              [translationFileHeaders.translation]: languageToken.translation
            });
          });

          // finished
          return Promise.resolve();
        };

        // execute jobs in batches
        return app.utils.helpers
          .handleActionsInBatches(
            getActionsCount,
            getBatchData,
            batchItemsAction,
            null,
            10000,
            10,
            console
          )
          .then(() => {
            // create XLSX file
            app.utils.spreadSheetFile.createXlsxFile(null, tokens, function (error, file) {
              // handle errors
              if (error) {
                return callback(error);
              }

              // offer file for download
              app.utils.remote.helpers
                .offerFileToDownload(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${self.name}.xlsx`, callback);
            });
          });
      })
      .catch(callback);
  };

  /**
   * If not authenticated then we can't retrieve all language tokens
   */
  Language.beforeRemote('prototype.getLanguageTokens', function (context, modelInstance, next) {
    // attach authenticated query ?
    if (!_.get(context, 'req.authData.user.id')) {

      // construct the unauthenticated query
      const condition = {
        modules: {
          $in: ['unauthenticated']
        }
      };

      // retrieve query
      const whereFilter = _.get(context, 'args.filter.where');

      // merge with existing filter query
      _.set(
        context,
        'args.filter.where',
        whereFilter ? {
          $and: [
            whereFilter,
            condition
          ]
        } : condition
      );
    }

    // finished
    next();
  });

  /**
   * Retrieve language tokens
   * @param callback
   */
  Language.prototype.getLanguageTokens = function (filter, callback) {
    // default data
    filter = filter || {};
    const fields = filter.fields || [
      'token',
      'translation'
    ];
    let whereFilter = filter.where || {};

    // do we need to retrieve only updated tokens ?
    if (whereFilter.updatedSince) {
      // retrieve date
      const updatedSince = localizationHelper.toMoment(whereFilter.updatedSince).toISOString();
      delete whereFilter.updatedSince;

      // filter tokens
      const condition = {
        $or: [
          {
            updatedAt: {
              $gt: updatedSince
            }
          }, {
            createdAt: {
              $gt: updatedSince
            }
          }
        ]
      };
      if (_.isEmpty(whereFilter)) {
        whereFilter = condition;
      } else {
        whereFilter = {
          $and: [
            condition,
            whereFilter
          ]
        };
      }
    }

    // construct where condition
    // retrieve only records from a specific language
    // & retrieve only non-deleted records
    let where = {
      languageId: this.id,
      deleted: false
    };
    if (!_.isEmpty(whereFilter)) {
      where.$and = [
        whereFilter
      ];
    }

    // construct what data should be retrieved
    const projection = _.transform(fields, (r, v) => r[v] = 1, {});

    // there is no need to retrieve the id
    projection._id = 0;

    // convert where condition to mongo
    where = app.utils.remote.convertLoopbackFilterToMongo(
      where
    );

    // retrieve language tokens
    // since we can't replace root we will need to go through tokens ourselves
    app.dataSources.mongoDb.connector
      .collection('languageToken')
      .find(where, {
        projection: projection
      })
      .toArray()
      .then((tokens) => {
        // use indexes to retrieve the last item instead of retrieving dates and determining the last item from nodejs
        return app.dataSources.mongoDb.connector
          .collection('languageToken')
          .find(where, {
            projection: {
              updatedAt: 1
            },
            sort: {
              updatedAt: -1
            },
            limit: 1
          })
          .toArray()
          .then((lastToken) => {
            return {
              tokens: tokens,
              lastToken: lastToken && lastToken.length > 0 && lastToken[0].updatedAt ?
                lastToken[0] :
                null
            };
          });
      })
      .then((data) => {
        // retrieve language tokens
        callback(
          null, {
            languageId: this.id,
            lastUpdateDate: data.lastToken ? moment(data.lastToken.updatedAt).toISOString() : null,
            tokens: data.tokens
          }
        );
      })
      .catch(callback);
  };
};
