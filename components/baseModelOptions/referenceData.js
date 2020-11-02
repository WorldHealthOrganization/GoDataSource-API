'use strict';

const MongoDBHelper = require('./../mongoDBHelper');
const mergeFilters = require('./../mergeFilters');
const convertLoopbackFilterToMongo = require('./../convertLoopbackFilterToMongo');

/**
 * TODO: Duplicated from Outbreak model; doesn't use Loopback models. Should be used in Outbreak model
 * Retrieve list of system reference data and outbreak's specific reference data; Returns the promise
 * @param outbreakId
 * @param filter Optional additional filter for the reference data
 */
const getSystemAndOutbreakReferenceData = function (outbreakId, filter) {
  // no scope query for reference data
  const loopbackFilter = mergeFilters(
    {
      where: {
        or: [
          {
            outbreakId: {
              eq: null
            }
          },
          {
            outbreakId: outbreakId
          }
        ],
        // add not deleted filter
        deleted: {
          $ne: true
        }
      }
    },
    filter
  );

  const query = convertLoopbackFilterToMongo(loopbackFilter.where);

  let projection;
  if (loopbackFilter.fields) {
    projection = {};
    loopbackFilter.fields.forEach(field => {
      projection[field] = 1;
    });
  }

  return MongoDBHelper.executeAction(
    'referenceData',
    'find',
    [
      query,
      projection
    ]);
};

module.exports = {
  helpers: {
    getSystemAndOutbreakReferenceData: getSystemAndOutbreakReferenceData
  }
};
