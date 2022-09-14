'use strict';

const MongoDBHelper = require('./../mongoDBHelper');

/**
 * TODO: Duplicated from Language model; doesn't use Loopback models. Should be used in Language model
 * Get language dictionary for the specified language (also include english as a fallback language)
 * @param languageId
 * @param tokenQuery Query for token field
 */
function getLanguageDictionary(languageId, tokenQuery) {
  let query = {
    $or: [
      {languageId: languageId},
      {languageId: 'english_us'}
    ],
    deleted: false
  };

  if (tokenQuery) {
    query = {
      $and: [
        query,
        tokenQuery
      ]
    };
  }

  return MongoDBHelper.executeAction(
    'languageToken',
    'find',
    [
      query,
      {
        projection: {token: 1, translation: 1, languageId: 1}
      }
    ])
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
