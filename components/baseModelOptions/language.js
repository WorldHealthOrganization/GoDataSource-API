'use strict';

const MongoDBHelper = require('./../mongoDBHelper');

/**
 * TODO: Duplicated from Language model; doesn't use Loopback models. Should be used in Language model
 * Get language dictionary for the specified language (also include english as a fallback language)
 * @param languageId
 */
function getLanguageDictionary(languageId) {
  return MongoDBHelper
    .executeAction(
      'languageToken',
      'find',
      [{
        $or: [
          {languageId: languageId},
          {languageId: 'english_us'}
        ],
        deleted: {
          $ne: true
        }
      }, {
        projection: {token: 1, translation: 1, languageId: 1}
      }]
    )
    .then(function (languageTokens) {
      // build a language map for easy referencing language tokens
      const tokensMap = {};
      languageTokens.forEach(function (languageToken) {
        tokensMap[`${languageToken.token}-${languageToken.languageId}`] = languageToken.translation;
      });
      /**
       * Get translation for a language token
       * @param field
       * @return {*}
       */
      tokensMap.getTranslation = function (field) {
        // first look for the translation in the specified language
        if (this[`${field}-${languageId}`]) {
          field = this[`${field}-${languageId}`];
          // then look for the translation in the english language
        } else if (this[`${field}-english_us`]) {
          field = this[`${field}-english_us`];
        }
        return field;
      };
      return tokensMap;
    });
}

module.exports = {
  helpers: {
    getLanguageDictionary: getLanguageDictionary
  }
};
