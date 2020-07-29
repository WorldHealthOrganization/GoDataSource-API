'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with contact of contact related actions
 */

module.exports = function (Outbreak) {
  /**
   * Retrieve available people for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.getContactOfContactRelationshipsAvailablePeople = function (contactOfContactId, filter, options, callback) {
    // we only make relations with contacts
    filter = filter || {};
    filter.where = filter.where || {};
    filter.where = {
      and: [
        {
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        },
        filter.where
      ]
    };

    app.models.person
      .getAvailablePeople(
        this.id,
        contactOfContactId,
        filter,
        options
      )
      .then((records) => {
        callback(null, records);
      })
      .catch(callback);
  };
};
