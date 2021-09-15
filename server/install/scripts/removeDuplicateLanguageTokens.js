'use strict';

const MongoDBHelper = require('../../../components/mongoDBHelper');

// Number of find requests at the same time
// Don't set this value to high so we don't exceed Mongo 16MB limit
const findBatchSize = 3000;

/**
 * Create / Update language tokens
 */
const checkAndRemoveLanguageTokens = (callback) => {
  // check for duplicates
  console.debug('Checking duplicate tokens...');

  // create Mongo DB connection
  let languageToken;
  MongoDBHelper
    .getMongoDBConnection()
    .then((dbConn) => {
      languageToken = dbConn.collection('languageToken');
    })
    .then(() => {
      // do until we have no duplicates
      const removeDuplicates = () => {
        return languageToken
          .aggregate([
            {
              $group: {
                _id: {
                  languageId: '$languageId',
                  token: '$token'
                },
                count: {
                  $sum: 1
                }
              }
            }, {
              $match: {
                _id: {
                  $ne : null
                },
                count: {
                  $gt: 1
                }
              }
            }, {
              $limit: findBatchSize
            }
          ], {
            allowDiskUse: true
          })
          .toArray()
          .then((records) => {
            // finished ?
            if (
              !records ||
              records.length < 1
            ) {
              return Promise.resolve();
            }

            // go through items and remove duplicates
            const nextDuplicate = () => {
              // finished ?
              if (records.length < 1) {
                return Promise.resolve();
              }

              // get duplicate record data
              const duplicateRecord = records.splice(0, 1)[0];
              return languageToken
                .find({
                  languageId: duplicateRecord._id.languageId,
                  token: duplicateRecord._id.token
                }, {
                  projection: {
                    _id: 1,
                    translation: 1
                  },
                  sort: {
                    updatedAt: 1
                  }
                })
                .toArray()
                .then((duplicateTokens) => {
                  // not a duplicate anymore ?
                  if (duplicateTokens.length < 2) {
                    return Promise.resolve();
                  }

                  // first one that has translation will keep, the rest will be removed
                  let indexThatShouldBeKept = -1;
                  for (let duplicateTokenIndex = 0; duplicateTokenIndex < duplicateTokens.length; duplicateTokenIndex++) {
                    if (duplicateTokens[duplicateTokenIndex].translation) {
                      indexThatShouldBeKept = duplicateTokenIndex;
                      break;
                    }
                  }

                  // no translation ? then keep the first one
                  if (indexThatShouldBeKept < 0) {
                    indexThatShouldBeKept = 0;
                  }

                  // get ids to remove
                  const idsToRemove = [];
                  for (let duplicateTokenIndex = 0; duplicateTokenIndex < duplicateTokens.length; duplicateTokenIndex++) {
                    if (duplicateTokenIndex !== indexThatShouldBeKept) {
                      idsToRemove.push(duplicateTokens[duplicateTokenIndex]._id);
                    }
                  }

                  // log
                  console.debug(`Removing duplicates for language '${duplicateRecord._id.languageId}', token '${duplicateRecord._id.token}'`);

                  // remove duplicate
                  return languageToken
                    .deleteMany({
                      _id: {
                        $in: idsToRemove
                      }
                    });
                })
                .then(nextDuplicate);
            };

            // check again for duplicates
            return nextDuplicate()
              .then(removeDuplicates);
          });
      };

      // do until we have no duplicates
      return removeDuplicates();
    })
    .then(() => {
      // finished
      callback();
    })
    .catch(callback);
};

// export list of migration jobs; functions that receive a callback
module.exports = {
  checkAndRemoveLanguageTokens
};
