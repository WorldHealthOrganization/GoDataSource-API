'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with event related actions
 */

module.exports = function (Outbreak) {
  /**
   * Retrieve available people for a case
   * @param eventId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getEventRelationshipsAvailablePeople = function (eventId, filter, options, callback) {
    // retrieve available people
    app.models.person
      .getAvailablePeople(
        this.id,
        eventId,
        filter,
        options
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };
};
