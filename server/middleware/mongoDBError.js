'use strict';

const app = require('../server');
const _ = require('lodash');

/**
 * Check for Mongo DB error and parse it
 * @param error
 * @param request
 * @param response
 * @param next
 */
function mongoDBErrorHandler(error, request, response, next) {
  // duplicate ID error; occurs only when creating an entry with the same ID as an existing soft deleted entry
  if (
    error &&
    error.code === 11000 &&
    error.name === 'BulkWriteError'
  ) {
    // get sent ID; if not sent parse the Mongo error and get it
    let id = _.get(request, 'body.id', null);
    if (!id) {
      // get inserted IDs
      let insertedIDs = error.result.getInsertedIds ? error.result.getInsertedIds() : [];
      id = insertedIDs.map(function (idEntry) {
        return typeof idEntry === 'object' ? idEntry._id : null;
      }).join(', ');
    }

    // create error
    error = app.utils.apiError.getError('MODEL_CONFLICT', {id: id});
  }
  next(error);
}

module.exports = function () {
  return mongoDBErrorHandler;
};
