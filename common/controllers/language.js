'use strict';

const app = require('../../server/server');
const xlsx = require('xlsx');
const fs = require('fs');

module.exports = function (Language) {

  // language tokens should not be managed via API
  app.utils.remote.disableRemoteMethods(Language, [
    'prototype.__create__languageTokens',
    'prototype.__delete__languageTokens',
    'prototype.__findById__languageTokens',
    'prototype.__updateById__languageTokens',
    'prototype.__destroyById__languageTokens',
  ]);

  Language.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    Language.checkIfEditable(context.instance, next);
  });

  Language.beforeRemote('prototype.importLanguageTokensFile', function (context, modelInstance, next) {
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
    app.utils.remote.helpers.parseMultipartRequest(req, [], ['languageFile'], function (error, fields, files) {
      if (error) {
        return callback(error);
      }
      // read language file
      fs.readFile(files.languageFile.path, function (error, buffer) {
        if (error) {
          return callback(error);
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
              let translation = ' ';
              // if the translation exists, use it
              if (parsedData.Sheets[sheetName][`B${index}`]) {
                translation = parsedData.Sheets[sheetName][`B${index}`].v
              }
              // save raw data
              languageTokens.push({
                token: token,
                translation: translation,
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
        self.updateLanguageTranslations(languageTokens, options)
          .then(function (languageTokens) {
            callback(null, languageTokens);
          })
          .catch(callback);
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
    // get language tokens for this language
    app.models.languageToken
      .find({
        where: {
          languageId: this.id
        },
        order: 'token ASC'
      })
      .then(function (languageTokens) {
        // keep a list of tokens
        const tokens = [];
        // define default translation file headers
        const translationFileHeaders = {
          token: 'Language Token',
          translation: 'Translation'
        };

        // try and find translation file headers in the correct language
        languageTokens.forEach(function (languageToken) {
          if (languageToken.token === 'LNG_TRANSLATION_FILE_LANGUAGE_TOKEN_HEADER') {
            translationFileHeaders.token = languageToken.translation;
          }
          if (languageToken.token === 'LNG_TRANSLATION_FILE_TRANSLATION_HEADER') {
            translationFileHeaders.translation = languageToken.translation;
          }
        });
        // build the list of "rows" for the workbook
        languageTokens.forEach(function (languageToken) {
          tokens.push({
            [translationFileHeaders.token]: languageToken.token,
            [translationFileHeaders.translation]: languageToken.translation
          });
        });
        // build the worksheet based on the build JSON
        const sheet = xlsx.utils.json_to_sheet(tokens);
        // create a new workbook
        const workbook = xlsx.utils.book_new();
        // add the worksheet to workbook
        xlsx.utils.book_append_sheet(workbook, sheet);
        // send the file for downloading
        app.utils.remote.helpers
          .offerFileToDownload(xlsx.write(workbook, {type: 'buffer'}), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${self.name}.xlsx`, callback);
      })
      .catch(callback)
  }
};
