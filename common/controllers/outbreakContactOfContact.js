'use strict';

/**
 * Note: It is not exposed as an actual controller
 * It extends the Outbreak controller with contact of contact related actions
 */

const app = require('../../server/server');

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

  /**
   * Count available people for a contact of contact
   * @param contactOfContactId
   * @param where
   * @param options
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationshipsAvailablePeople = function (contactOfContactId, where, options, callback) {
    // we only make relations with contacts
    where = {
      and: [
        {
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
        },
        where || {}
      ]
    };

    app.models.person
      .getAvailablePeopleCount(
        this.id,
        contactOfContactId,
        where,
        options
      )
      .then((counted) => {
        callback(null, counted);
      })
      .catch(callback);
  };

  /**
   * Get all duplicates based on hardcoded rules against a model props
   * @param filter pagination props (skip, limit)
   * @param model
   * @param options
   * @param callback
   */
  Outbreak.prototype.getContactOfContactPossibleDuplicates = function (filter = {}, model = {}, options, callback) {
    app.models.person
      .findDuplicatesByType(filter, this.id, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT', model, options)
      .then(duplicates => callback(null, duplicates))
      .catch(callback);
  };
};
