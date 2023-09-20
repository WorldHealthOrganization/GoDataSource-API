'use strict';

const localizationHelper = require('../../components/localizationHelper');
const app = require('../../server/server');
const _ = require('lodash');
const genericHelpers = require('../../components/helpers');
const async = require('async');
const pdfUtils = app.utils.pdfDoc;
const searchByRelationProperty = require('../../components/searchByRelationProperty');
const Uuid = require('uuid');
const templateParser = require('./../../components/templateParser');
const fork = require('child_process').fork;
const Platform = require('../../components/platform');

module.exports = function (Outbreak) {

  // get model helpers
  const helpers = Outbreak.helpers;

  // disable bulk delete for related models
  app.utils.remote.disableRemoteMethods(Outbreak, [
    'prototype.__delete__cases',
    'prototype.__delete__cases__labResults',
    'prototype.__delete__cases__relationships',
    'prototype.__delete__cases__followUps',
    'prototype.__delete__contacts',
    'prototype.__delete__contacts__labResults',
    'prototype.__delete__contacts__relationships',
    'prototype.__delete__contacts__followUps',
    'prototype.__delete__contactsOfContacts',
    'prototype.__delete__contactsOfContacts__labResults',
    'prototype.__delete__contactsOfContacts__relationships',
    'prototype.__delete__contactsOfContacts__followUps',
    'prototype.__delete__events',
    'prototype.__delete__clusters',
    'prototype.__create__clusters__relationships',
    'prototype.__delete__clusters__relationships',
    'prototype.__findById__clusters__relationships',
    'prototype.__updateById__clusters__relationships',
    'prototype.__destroyById__clusters__relationships',
    'prototype.__get__clusters__relationships',
    'prototype.__count__clusters__relationships',
    'prototype.__get__referenceData',
    'prototype.__delete__referenceData',
    'prototype.__count__referenceData',
    'prototype.__create__referenceData',
    'prototype.__findById__referenceData',
    'prototype.__updateById__referenceData',
    'prototype.__destroyById__referenceData',
    'prototype.__create__followUps',
    'prototype.__delete__followUps',
    'prototype.__updateById__followUps',
    'prototype.__destroyById__followUps',
    'prototype.__create__people',
    'prototype.__delete__people',
    'prototype.__count__people',
    'prototype.__findById__people',
    'prototype.__updateById__people',
    'prototype.__destroyById__people',
    'prototype.__create__labResults',
    'prototype.__delete__labResults',
    'prototype.__count__labResults',
    'prototype.__create__attachments',
    'prototype.__get__attachments',
    'prototype.__delete__attachments',
    'prototype.__updateById__attachments',
    'prototype.__count__attachments',
    'prototype.__get__followUps',
    'prototype.__count__followUps',
    'prototype.__get__labResults',
    'prototype.__get__cases',
    'prototype.__get__events',
    'prototype.__count__events',
    'prototype.__get__contacts',
    'prototype.__count__contacts',
    'prototype.__get__contacts__followUps',
    'prototype.__count__contacts__followUps',
    'prototype.__get__contactsOfContacts',
    'prototype.__count__contactsOfContacts',
    'prototype.__updateById__contacts__followUps',
    'prototype.__destroyById__contacts__followUps',
    'prototype.__delete__transmissionChains',
    'prototype.__create__transmissionChains',
    'prototype.__updateById__transmissionChains'
  ]);

  // attach search by relation property behavior on get contacts
  app.utils.remote.searchByRelationProperty.attachOnRemotes(Outbreak, [
    'prototype.findCaseRelationships',
    'prototype.findContactRelationships',
    'prototype.findContactOfContactRelationships',
    'prototype.findEventRelationships'
  ]);

  // load controller extensions (other files that contain outbreak related actions)
  require('./outbreakCase')(Outbreak);
  require('./outbreakContact')(Outbreak);
  require('./outbreakEvent')(Outbreak);
  require('./outbreakContactOfContact')(Outbreak);
  require('./outbreakRelationship')(Outbreak);
  require('./outbreakFollowUp')(Outbreak);
  require('./outbreakLocation')(Outbreak);
  require('./outbreakLabResult')(Outbreak);
  require('./outbreakCOT')(Outbreak);
  require('./outbreakPeople')(Outbreak);
  require('./outbreakCluster')(Outbreak);

  /**
   * Allow changing follow-up status (only status property)
   */
  Outbreak.beforeRemote('prototype.__updateById__contacts', function (context, modelInstance, next) {
    // get follow-up status property
    const followUpStatus = _.get(context, 'args.data.followUp.status');
    // if status was provided
    if (followUpStatus) {
      // load contact instance
      app.models.contact
        .findById(context.args.fk)
        .then(function (contact) {
          // get instance data
          const instance = contact.toJSON();
          // update follow-up status
          Object.assign(context.args.data.followUp, instance.followUp, {status: followUpStatus});
          // move along
          next();
        });
    } else {
      next();
    }
  });

  /**
   * Restrict the list of outbreaks only to what's accessible to current logged in user
   */
  Outbreak.beforeRemote('find', function (context, modelInstance, next) {
    // get logged in user outbreak restrictions
    const restrictedOutbreakIds = _.get(context, 'req.authData.user.outbreakIds', []);
    // if there are any restrictions set
    if (restrictedOutbreakIds.length) {
      // update filters to search only in the outbreaks accessible to the user
      context.args.filter = app.utils.remote
        .mergeFilters({
          where: {
            id: {
              in: restrictedOutbreakIds
            }
          }
        }, context.args.filter || {});
    }
    next();
  });

  Outbreak.beforeRemote('count', function (context, modelInstance, next) {
    const restrictedOutbreakIds = _.get(context, 'req.authData.user.outbreakIds', []);
    if (restrictedOutbreakIds.length) {
      // do we have delete filter ?
      let filter = {where: _.get(context, 'args.where', {})};

      let includeDeletedRecords;
      if (
        filter.where &&
        filter.where.includeDeletedRecords !== undefined
      ) {
        includeDeletedRecords = filter.where.includeDeletedRecords;
        delete filter.where.includeDeletedRecords;
      }

      // merge filter
      filter = app.utils.remote
        .mergeFilters({
          where: {
            id: {
              in: restrictedOutbreakIds
            }
          }
        }, filter || {});

      // replace with new one
      context.args.where = filter.where;

      // attach the include deleted records
      if (includeDeletedRecords !== undefined) {
        filter.where.includeDeletedRecords = includeDeletedRecords;
      }
    }

    // finished
    next();
  });

  /**
   * Find relations for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findCaseRelationships = function (caseId, filter, callback) {
    helpers.findPersonRelationships(caseId, filter, callback);
  };

  /**
   * Find relations for a contact
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactRelationships = function (contactId, filter, callback) {
    helpers.findPersonRelationships(contactId, filter, callback);
  };

  /**
   * Find relations for a event
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findEventRelationships = function (eventId, filter, callback) {
    helpers.findPersonRelationships(eventId, filter, callback);
  };

  /**
   * Create relation for a case
   * @param caseId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createCaseRelationship = function (caseId, data, options, callback) {
    // make sure case is valid, before trying to create any relations
    app.models.case
      .findById(caseId)
      .then((caseModel) => {
        if (!caseModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          });
        }
        if (app.models.case.discardedCaseClassifications.includes(caseModel.classification)) {
          throw app.utils.apiError.getError('INVALID_RELATIONSHIP_WITH_DISCARDED_CASE', {
            id: caseId
          });
        }
        helpers.createPersonRelationship(this.id, caseId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', data, options, callback);
      })
      .catch(callback);
  };

  /**
   * Create relation for a contact
   * @param contactId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createContactRelationship = function (contactId, data, options, callback) {
    // make sure contact is valid, before trying to create any relations
    app.models.contact
      .findById(contactId)
      .then((contact) => {
        if (!contact) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: contactId
          }));
        }
        helpers.createPersonRelationship(this.id, contactId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', data, options, callback);
      })
      .catch(callback);
  };

  /**
   * Create relation for a event
   * @param eventId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createEventRelationship = function (eventId, data, options, callback) {
    // make sure event is valid, before trying to create any relations
    app.models.event
      .findById(eventId)
      .then((event) => {
        if (!event) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.event.modelName,
            id: eventId
          }));
        }
        helpers.createPersonRelationship(this.id, eventId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', data, options, callback);
      })
      .catch(callback);
  };

  /**
   * Retrieve a relation for a case
   * @param caseId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getCaseRelationship = function (caseId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(caseId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', filter, callback);
  };

  /**
   * Retrieve a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getContactRelationship = function (contactId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(contactId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', filter, callback);
  };

  /**
   * Retrieve a relation for a event
   * @param eventId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getEventRelationship = function (eventId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(eventId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', filter, callback);
  };

  /**
   * Update a relation for a case
   * @param caseId
   * @param relationshipId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.updateCaseRelationship = function (caseId, relationshipId, data, options, callback) {
    // make sure case is valid, before trying to update any relations
    app.models.case
      .findById(caseId)
      .then((caseModel) => {
        if (!caseModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          });
        }
        // do not allow relationships with discarded cases
        if (app.models.case.discardedCaseClassifications.includes(caseModel.classification)) {
          throw app.utils.apiError.getError('INVALID_RELATIONSHIP_WITH_DISCARDED_CASE', {
            id: caseId
          });
        }
        helpers.updatePersonRelationship(caseId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', data, options, callback);
      })
      .catch(callback);
  };

  /**
   * Update a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.updateContactRelationship = function (contactId, relationshipId, data, options, callback) {
    helpers.updatePersonRelationship(contactId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT', data, options, callback);
  };

  /**
   * Update a relation for a event
   * @param eventId
   * @param relationshipId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.updateEventRelationship = function (eventId, relationshipId, data, options, callback) {
    helpers.updatePersonRelationship(eventId, relationshipId, 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT', data, options, callback);
  };

  /**
   * Delete a relation for a case
   * @param caseId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteCaseRelationship = function (caseId, relationshipId, options, callback) {
    helpers.deletePersonRelationship(caseId, relationshipId, options, callback);
  };

  /**
   * Delete a relation for a contact
   * @param contactId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteContactRelationship = function (contactId, relationshipId, options, callback) {
    helpers.deletePersonRelationship(contactId, relationshipId, options, callback);
  };

  /**
   * Delete a relation for a event
   * @param eventId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteEventRelationship = function (eventId, relationshipId, options, callback) {
    helpers.deletePersonRelationship(eventId, relationshipId, options, callback);
  };

  /**
   * Count relations for a case
   * @param caseId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countCaseRelationships = function (caseId, where, callback) {
    // make sure case is valid
    app.models.case
      .findById(caseId)
      .then((caseModel) => {
        if (!caseModel) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          }));
        }
        helpers.countPersonRelationships(caseId, where, callback);
      })
      .catch(callback);
  };

  /**
   * Count filtered relations for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountCaseRelationships = function (caseId, filter, callback) {
    // make sure case is valid
    app.models.case
      .findById(caseId)
      .then((caseModel) => {
        if (!caseModel) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          }));
        }
        helpers.filteredCountPersonRelationships(caseId, filter, callback);
      })
      .catch(callback);
  };

  /**
   * Count relations for a contact
   * @param contactId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countContactRelationships = function (contactId, where, callback) {
    // make sure contact is valid
    app.models.contact
      .findById(contactId)
      .then((contact) => {
        if (!contact) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: contactId
          }));
        }
        helpers.countPersonRelationships(contactId, where, callback);
      })
      .catch(callback);
  };

  /**
   * Count filtered relations for a contact
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountContactRelationships = function (contactId, filter, callback) {
    // make sure case is valid
    app.models.contact
      .findById(contactId)
      .then((contact) => {
        if (!contact) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: contactId
          }));
        }
        helpers.filteredCountPersonRelationships(contactId, filter, callback);
      })
      .catch(callback);
  };

  /**
   * Count relations for an event
   * @param eventId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countEventRelationships = function (eventId, where, callback) {
    // make sure event is valid
    app.models.event
      .findById(eventId)
      .then((event) => {
        if (!event) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.event.modelName,
            id: eventId
          }));
        }
        helpers.countPersonRelationships(eventId, where, callback);
      })
      .catch(callback);
  };

  /**
   * Count filtered relations for an event
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountEventRelationships = function (eventId, filter, callback) {
    // make sure case is valid
    app.models.event
      .findById(eventId)
      .then((event) => {
        if (!event) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.event.modelName,
            id: eventId
          }));
        }
        helpers.filteredCountPersonRelationships(eventId, filter, callback);
      })
      .catch(callback);
  };

  /**
   * Convert a contact to a case
   * @param contactId
   * @param options
   * @param callback
   */
  Outbreak.prototype.convertContactToCase = function (contactId, options, callback) {
    let convertedCase, contactsOfContactsMap = {};
    app.models.contact
      .findOne({
        where: {
          id: contactId
        },
        fields: [
          'id',
          'questionnaireAnswers',
          'questionnaireAnswersCase'
        ]
      })
      .then(function (contactModel) {
        if (!contactModel) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contact.modelName, id: contactId});
        }

        // define the attributes for update
        const attributes = {
          dateBecomeCase: app.utils.helpers.getDate().toDate(),
          wasContact: true,
          type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
          classification: 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_SUSPECT'
        };

        // retain data from custom forms upon conversion
        if (!_.isEmpty(contactModel.questionnaireAnswers)) {
          attributes.questionnaireAnswersContact = Object.assign({}, contactModel.questionnaireAnswers);
          attributes.questionnaireAnswers = {};
        }

        // restore data from custom forms before conversion
        if (!_.isEmpty(contactModel.questionnaireAnswersCase)) {
          attributes.questionnaireAnswers = Object.assign({}, contactModel.questionnaireAnswersCase);
          attributes.questionnaireAnswersCase = {};
        }

        // the case has relations with other cases; proceed with the conversion
        return app.models.person.rawUpdateOne(
          {
            _id: contactId
          },
          attributes,
          options
        );
      })
      .then(() => {
        return app.models.case.findOne({
          where: {
            id: contactId
          }
        });
      })
      .then(function (caseModel) {
        if (!caseModel) {
          // the case doesn't have relations with other cases; stop conversion
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.case.modelName, id: contactId});
        }

        // keep the caseModel as we will do actions on it
        convertedCase = caseModel;

        // after updating the case, find it's relations
        return app.models.relationship
          .find({
            where: {
              'persons.id': contactId
            }
          });
      })
      .then(function (relations) {
        // check if there are relations
        if (!relations.length) {
          return;
        }

        // collect update relations
        const updateRelations = [];
        relations.forEach(function (relation) {
          let persons = [];
          relation.persons.forEach(function (person) {
            // for every occurrence of current contact
            if (person.id === contactId) {
              // update type to match the new one
              person.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';
            } else {
              // find his contacts relationships (contacts of contacts) to convert them to "contact" type
              if (person.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT') {
                contactsOfContactsMap[person.id] = true;
              }
            }
            persons.push(person);
          });
          updateRelations.push(relation.updateAttributes({persons: persons}, options));
        });
        return Promise.all(updateRelations);
      })
      .then(function () {
        // update personType from lab results
        return app.models.labResult
          .rawBulkUpdate(
            {
              personId: contactId
            },
            {
              personType: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE'
            },
            options
          );
      })
      .then(function () {
        // check if there are contacts of contacts
        const contactsOfContactsIds = Object.keys(contactsOfContactsMap);
        if (!contactsOfContactsIds.length) {
          return [];
        }

        // convert contacts of contacts to contacts
        return app.models.person
          .rawBulkUpdate(
            {
              id: {
                $in: contactsOfContactsIds
              }
            },
            {
              type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
            },
            options
          );
      })
      .then(function () {
        // check if there are contacts of contacts
        const contactsOfContactsIds = Object.keys(contactsOfContactsMap);
        if (!contactsOfContactsIds.length) {
          return [];
        }

        // get the converted contacts to update the rest of the fields and update them again to trigger the hooks
        return app.models.contact
          .find({
            where: {
              'id': {
                $in: contactsOfContactsIds
              }
            }
          });
      })
      .then(function (records) {
        // check if there are records
        if (!records.length) {
          return;
        }

        // update the rest of the fields
        const updateContacts = [];
        records.forEach(function (contact) {
          updateContacts.push(contact.updateAttributes({
            dateBecomeContact: app.utils.helpers.getDate().toDate(),
            wasContactOfContact: true
          }, options));
        });
        return Promise.all(updateContacts);
      })
      .then(function () {
        // check if there are contacts of contacts
        const contactsOfContactsIds = Object.keys(contactsOfContactsMap);
        if (!contactsOfContactsIds.length) {
          return [];
        }

        // get the relationship persons for contacts of contacts
        return app.models.relationship
          .find({
            where: {
              'persons.id': {
                $in: contactsOfContactsIds
              }
            }
          });
      })
      .then(function (relations) {
        // check if there are relations
        if (!relations.length) {
          return;
        }

        // collect update relations
        const updateRelations = [];
        relations.forEach(function (relation) {
          let persons = [];
          relation.persons.forEach(function (person) {
            // for every occurrence of current contact
            if (contactsOfContactsMap[person.id]) {
              // update type to match the new one
              person.type = 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT';
            }
            persons.push(person);
          });
          updateRelations.push(relation.updateAttributes({persons: persons}, options));
        });
        return Promise.all(updateRelations);
      })
      .then(function () {
        // check if there are contacts of contacts
        const contactsOfContactsIds = Object.keys(contactsOfContactsMap);
        if (!contactsOfContactsIds.length) {
          return;
        }

        // update personType from lab results for contacts of contacts
        return app.models.labResult
          .rawBulkUpdate(
            {
              personId: {
                $in: contactsOfContactsIds
              }
            },
            {
              personType: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
            },
            options
          );
      })
      .then(function () {
        callback(null, convertedCase);
      })
      .catch(callback);
  };

  /**
   * Restore a deleted case
   * @param caseId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreCase = function (caseId, options, callback) {
    app.models.case
      .findOne({
        deleted: true,
        where: {
          id: caseId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.case.modelName, id: caseId});
        }

        // undo case delete
        instance.undoDelete(
          options,
          (err, result) => {
            // an error occurred?
            if (err) {
              return callback(err);
            }

            // retrieve contacts that were deleted and were associated with this case
            const contactsJobs = [];
            app.models.contact
              .find({
                deleted: true,
                where: {
                  deletedByParent: caseId,
                  deleted: true
                }
              })
              .then((contacts) => {
                // construct the list of contacts that we need to restore
                (contacts || []).forEach((contact) => {
                  contactsJobs.push((function (contactModel) {
                    return (callback) => {
                      contactModel.undoDelete(
                        {
                          extraProps: {
                            deletedByParent: null
                          }
                        },
                        (err, result) => {
                          // an error occurred?
                          if (err) {
                            return callback(err);
                          }

                          // retrieve contacts of contacts that were deleted and were associated with this contact
                          const contactsOfContactsJobs = [];
                          app.models.contactOfContact
                            .find({
                              deleted: true,
                              where: {
                                deletedByParent: contact.id,
                                deleted: true
                              }
                            })
                            .then((contactsOfContacts) => {
                              // construct the list of contacts of contacts that we need to restore
                              (contactsOfContacts || []).forEach((contactOfContact) => {
                                contactsOfContactsJobs.push((function (contactOfContactModel) {
                                  return (callback) => {
                                    contactOfContactModel.undoDelete(
                                      {
                                        extraProps: {
                                          deletedByParent: null
                                        }
                                      },
                                      callback
                                    );
                                  };
                                })(contactOfContact));
                              });

                              // restore contacts of contacts that were removed along with this contact
                              async.parallelLimit(contactsOfContactsJobs, 10, function (error) {
                                callback(error, result);
                              });
                            })
                            .catch(callback);
                        }
                      );
                    };
                  })(contact));
                });

                // restore contacts that were removed along with this case
                async.parallelLimit(contactsJobs, 10, function (error) {
                  callback(error, result);
                });
              })
              .catch(callback);
          }
        );
      })
      .catch(callback);
  };

  /**
   * Restore a deleted contact
   * @param contactId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContact = function (contactId, options, callback) {
    app.models.contact
      .findOne({
        deleted: true,
        where: {
          id: contactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.contact.modelName, id: contactId});
        }

        // undo delete
        instance.undoDelete(
          options,
          (err, result) => {
            // an error occurred?
            if (err) {
              return callback(err);
            }

            // retrieve contacts of contacts that were deleted and were associated with this contact
            const contactsOfContactsJobs = [];
            app.models.contactOfContact
              .find({
                deleted: true,
                where: {
                  deletedByParent: contactId,
                  deleted: true
                }
              })
              .then((contactsOfContacts) => {
                // construct the list of contacts of contacts that we need to restore
                (contactsOfContacts || []).forEach((contactOfContact) => {
                  contactsOfContactsJobs.push((function (contactOfContactModel) {
                    return (callback) => {
                      contactOfContactModel.undoDelete(
                        {
                          extraProps: {
                            deletedByParent: null
                          }
                        },
                        callback
                      );
                    };
                  })(contactOfContact));
                });

                // restore contacts of contacts that were removed along with this contact
                async.parallelLimit(contactsOfContactsJobs, 10, function (error) {
                  callback(error, result);
                });
              })
              .catch(callback);
          }
        );
      })
      .catch(callback);
  };

  /**
   * Restore a deleted event
   * @param eventId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreEvent = function (eventId, options, callback) {
    app.models.event
      .findOne({
        deleted: true,
        where: {
          id: eventId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: app.models.event.modelName, id: eventId});
        }

        // undo delete
        instance.undoDelete(
          options,
          (err, result) => {
            // an error occurred?
            if (err) {
              return callback(err);
            }

            // retrieve contacts that were deleted and were associated with this event
            const contactsJobs = [];
            app.models.contact
              .find({
                deleted: true,
                where: {
                  deletedByParent: eventId,
                  deleted: true
                }
              })
              .then((contacts) => {
                // construct the list of contacts that we need to restore
                (contacts || []).forEach((contact) => {
                  contactsJobs.push((function (contactModel) {
                    return (callback) => {
                      contactModel.undoDelete(
                        {
                          extraProps: {
                            deletedByParent: null
                          }
                        },
                        (err, result) => {
                          // an error occurred?
                          if (err) {
                            return callback(err);
                          }

                          // retrieve contacts of contacts that were deleted and were associated with this contact
                          const contactsOfContactsJobs = [];
                          app.models.contactOfContact
                            .find({
                              deleted: true,
                              where: {
                                deletedByParent: contact.id,
                                deleted: true
                              }
                            })
                            .then((contactsOfContacts) => {
                              // construct the list of contacts of contacts that we need to restore
                              (contactsOfContacts || []).forEach((contactOfContact) => {
                                contactsOfContactsJobs.push((function (contactOfContactModel) {
                                  return (callback) => {
                                    contactOfContactModel.undoDelete(
                                      {
                                        extraProps: {
                                          deletedByParent: null
                                        }
                                      },
                                      callback
                                    );
                                  };
                                })(contactOfContact));
                              });

                              // restore contacts of contacts that were removed along with this contact
                              async.parallelLimit(contactsOfContactsJobs, 10, function (error) {
                                callback(error, result);
                              });
                            })
                            .catch(callback);
                        }
                      );
                    };
                  })(contact));
                });

                // restore contacts that were removed along with this event
                async.parallelLimit(contactsJobs, 10, function (error) {
                  callback(error, result);
                });
              })
              .catch(callback);
          }
        );
      })
      .catch(callback);
  };

  /**
   * Restore a deleted follow up
   * @param contactId
   * @param followUpId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContactFollowUp = function (contactId, followUpId, options, callback) {
    app.models.followUp
      .findOne({
        deleted: true,
        where: {
          id: followUpId,
          personId: contactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.followUp.modelName,
            id: followUpId
          });
        }
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Generate (next available) event visual id
   * @param visualIdMask
   * @param personId
   * @param callback
   */
  Outbreak.prototype.generateEventVisualId = function (visualIdMask, personId, callback) {
    Outbreak.helpers.validateOrGetAvailableEventVisualId(this, visualIdMask, personId)
      .then(function (visualId) {
        callback(null, visualId);
      })
      .catch(callback);
  };

  /**
   * Generate (next available) case visual id
   * @param visualIdMask
   * @param personId
   * @param callback
   */
  Outbreak.prototype.generateCaseVisualId = function (visualIdMask, personId, callback) {
    Outbreak.helpers.validateOrGetAvailableCaseVisualId(this, visualIdMask, personId)
      .then(function (visualId) {
        callback(null, visualId);
      })
      .catch(callback);
  };

  /**
   * Generate (next available) contact visual id
   * @param visualIdMask
   * @param personId
   * @param callback
   */
  Outbreak.prototype.generateContactVisualId = function (visualIdMask, personId, callback) {
    Outbreak.helpers.validateOrGetAvailableContactVisualId(this, visualIdMask, personId)
      .then(function (visualId) {
        callback(null, visualId);
      })
      .catch(callback);
  };

  /**
   * Count the new contacts and groups them by exposure type
   * @param filter Besides the default filter properties this request also accepts 'noDaysNewContacts': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countNewContactsByExposure = function (filter, callback) {
    // initialize noDaysNewContacts filter
    let noDaysNewContacts;
    // check if the noDaysNewContacts filter was sent; accepting it only on the first level
    noDaysNewContacts = _.get(filter, 'where.noDaysNewContacts');
    if (typeof noDaysNewContacts !== 'undefined') {
      // noDaysNewContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysNewContacts;
    } else {
      // get the outbreak noDaysNewContacts as the default noDaysNewContacts value
      noDaysNewContacts = this.noDaysNewContacts;
    }

    // get outbreak ID
    let outbreakId = this.id;

    // initialize exposureType map
    let exposureTypeMap = {};

    // get exposureTypes from reference data
    helpers.getSystemAndOwnReferenceData(outbreakId, {
      where: {
        categoryId: 'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE'
      }
    })
      .then(function (exposureTypes) {
        // loop through exposure types and initialize the exposureTypeMap entry
        exposureTypes.forEach(function (exposureType) {
          exposureTypeMap[exposureType.value] = {
            id: exposureType.value,
            count: 0,
            contactIDs: []
          };
        });

        // get now date
        let now = new Date();

        // get the new contacts in the outbreak
        return app.models.contact.find(app.utils.remote
          .mergeFilters({
            include: ['relationships'],
            where: {
              outbreakId: outbreakId,
              dateOfReporting: {
                gte: now.setDate(now.getDate() - noDaysNewContacts)
              }
            }
          }, filter || {})
        );
      })
      .then(function (contacts) {
        // filter by relation properties
        contacts = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(contacts, filter);
        // loop through the contacts and check relationships exposure types to increase the counters in the result
        contacts.forEach(function (contact) {
          contact.relationships.forEach(function (relationship) {
            // Note: The result counters total will not equal number of contacts as contacts may have multiple relationships
            // counting only if contact wasn't already added for the exposure type
            // also checking if set exposureTypeId is known; if not known, relations is skipped
            if (exposureTypeMap[relationship.exposureTypeId] && exposureTypeMap[relationship.exposureTypeId].contactIDs.indexOf(contact.id) === -1) {
              // increasing counter for exposure type
              exposureTypeMap[relationship.exposureTypeId].count++;
              // kepp contact ID
              exposureTypeMap[relationship.exposureTypeId].contactIDs.push(contact.id);
            }
          });
        });

        // initialize result
        let result = {
          newContactsCount: contacts.length,
          exposureType: Object.values(exposureTypeMap)
        };

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * (Pre)Process Transmission Chains Filter
   * @param filter
   * @param options Options from request
   * @return {Promise<{filter: *, personIds: any, endDate: *, activeFilter: *, includedPeopleFilter: *} | never>}
   */
  Outbreak.prototype.preProcessTransmissionChainsFilter = function (filter, options) {
    // defensive checks
    filter = filter || {};
    filter.where = filter.where || {};

    // get outbreak id
    const outbreakId = this.id;

    // check if contacts should be counted as transmission chains
    const noContactChains = _.get(filter, 'where.noContactChains', true);
    // if present remove it from the main filter
    if (typeof noContactChains !== 'undefined' || noContactChains !== null) {
      delete filter.where.noContactChains;
    }

    // check if contacts should be included
    const includeContacts = _.get(filter, 'where.includeContacts', false);
    // if present remove it from the main filter
    if (includeContacts) {
      delete filter.where.includeContacts;
    }

    // check if contacts of contacts should be included
    const includeContactsOfContacts = _.get(filter, 'where.includeContactsOfContacts');
    // if present remove it from the main filter
    if (typeof includeContactsOfContacts !== 'undefined') {
      delete filter.where.includeContactsOfContacts;
    }

    // check if contacts should be counted
    const countContacts = _.get(filter, 'where.countContacts', false);
    if (countContacts) {
      delete filter.where.countContacts;
    }

    // get active filter
    let activeFilter = _.get(filter, 'where.active');
    // if active filter was sent remove it from the filter
    if (typeof activeFilter !== 'undefined') {
      delete filter.where.active;
    }

    // get size filter
    let sizeFilter = _.get(filter, 'where.size');
    // if size filter was sent remove it from the filter
    if (typeof sizeFilter !== 'undefined') {
      delete filter.where.size;
    }

    // initialize a person filter (will contain filters applicable on person entity)
    let personFilter = _.get(filter, 'where.person');
    // if person filter was sent
    if (personFilter) {
      // remove original filter
      delete filter.where.person;
    }

    // try and get the end date filter
    let endDate = _.get(filter, 'where.endDate');
    // no end date filter provided
    if (!endDate) {
      // end date is current date
      endDate = new Date();
    } else {
      // remove end date from filter
      delete filter.where.endDate;
    }

    // keep a flag for includedPeopleFilter
    let includedPeopleFilter = _.get(filter, 'where.chainIncludesPerson');

    // initialize geographical restriction query to be cached in promise.then
    let geographicalRestrictionsQueryCache;

    // start with geographical restriction
    return app.models.person
      .addGeographicalRestrictions(options.remotingContext)
      .then(geographicalRestrictionsQuery => {
        geographicalRestrictionsQueryCache = geographicalRestrictionsQuery;

        // find relationship IDs for included people filter, if necessary
        let findIncludedPeopleIds;

        // if there is a included people filer
        if (includedPeopleFilter) {
          // remove the query from the filter
          delete filter.where.chainIncludesPerson;
          // find the relationships that belong to chains which include the filtered people
          findIncludedPeopleIds = app.models.person
            .rawFind(geographicalRestrictionsQuery ? {
              and: [
                includedPeopleFilter,
                geographicalRestrictionsQuery
              ]
            } : includedPeopleFilter, {projection: {_id: 1}})
            .then(function (people) {
              // update included people filter
              includedPeopleFilter = people.map(person => person.id);
            });
        } else {
          findIncludedPeopleIds = Promise.resolve(null);
        }

        // find IDs for included people filter, if necessary
        return findIncludedPeopleIds;
      })
      .then(function () {
        // create person query from person filter and geographical restrictions
        let personQuery;

        if (personFilter) {
          personQuery = {
            and: [
              {
                outbreakId: outbreakId
              },
              personFilter
            ]
          };

          if (geographicalRestrictionsQueryCache) {
            personQuery.and.push(geographicalRestrictionsQueryCache);
          }
        } else if (geographicalRestrictionsQueryCache) {
          personQuery = {
            and: [
              {
                outbreakId: outbreakId
              },
              geographicalRestrictionsQueryCache
            ]
          };
        }

        // if a person query was contructed get the IDs for the persons
        if (personQuery) {
          // find people that match the filter
          return app.models.person
            .rawFind(
              app.utils.remote.convertLoopbackFilterToMongo(personQuery),
              {projection: {_id: 1}}
            )
            .then(function (people) {
              // return their IDs
              return people.map(person => person.id);
            });
        }
      })
      .then(function (personIds) {
        // if there was a people filter
        if (personIds) {
          // make sure both people in a relation match the filter passed
          filter = app.utils.remote
            .mergeFilters({
              where: {
                'persons.0.id': {
                  inq: personIds
                },
                'persons.1.id': {
                  inq: personIds
                }
              }
            }, filter);
        }

        // if contacts should not be included
        if (!includeContacts && !countContacts) {
          // restrict chain data to cases and events
          filter = app.utils.remote
            .mergeFilters({
              where: {
                'persons.0.type': {
                  inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                },
                'persons.1.type': {
                  inq: ['LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE', 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT']
                }
              }
            }, filter);
        }
        // return needed, processed information
        return {
          filter: filter,
          personIds: personIds,
          endDate: endDate,
          active: activeFilter,
          includedPeopleFilter: includedPeopleFilter,
          size: sizeFilter,
          countContacts: countContacts,
          includeContacts: includeContacts,
          noContactChains: noContactChains,
          includeContactsOfContacts: includeContactsOfContacts,
          geographicalRestrictionsQuery: geographicalRestrictionsQueryCache
        };
      });
  };

  /**
   * Post process/filter transmission chains
   * @param filter
   * @param dataSet
   * @param opts
   * @return {{transmissionChains: {chains: Array, length: number}, nodes: {}, edges: {}}}
   */
  Outbreak.prototype.postProcessTransmissionChains = function (filter, dataSet, opts = {}) {
    // define result structure
    const result = {
      transmissionChains: {
        chains: [],
        length: 0
      },
      nodes: {},
      edges: {}
    };

    // keep a flag to see if any transmission chain filters were applied (people should be filtered out)
    let appliedTransmissionChainsFilters = false;

    // keep an index of people that pass the filters
    const filteredChainPeopleIndex = {};
    // go through all the chains
    dataSet.transmissionChains.chains.forEach(function (transmissionChain) {
      // keep a flag for chain passing all filters
      let addTransmissionChain = true;

      // check if size filter is present
      if (filter.size != null) {
        // mark this filtering
        appliedTransmissionChainsFilters = true;
        // apply size filter
        addTransmissionChain = (addTransmissionChain && (transmissionChain.size === filter.size));
      }

      // check if active filter is present
      if (addTransmissionChain && filter.active != null) {
        // mark this filtering
        appliedTransmissionChainsFilters = true;
        // apply active filter
        addTransmissionChain = (addTransmissionChain && (transmissionChain.active === filter.active));
      }

      // build an index of transmission chain people
      const transmissionChainPeopleIndex = {};
      // build it only if the chain is valid
      if (addTransmissionChain) {
        // go through all the pairs in the chain
        transmissionChain.chain.forEach(function (peoplePair) {
          // map each person from the chain into the index
          peoplePair.forEach(function (personId) {
            transmissionChainPeopleIndex[personId] = true;
          });
        });
      }

      // check if the chain includes at least one person from the included people filter
      if (addTransmissionChain && filter.includedPeopleFilter != null) {
        // mark this filtering
        appliedTransmissionChainsFilters = true;
        // make a clone of the included people filter
        const includedPeople = filter.includedPeopleFilter.slice();
        // get first included person
        let includedPerson = includedPeople.shift();
        // assume the chain does not include the person
        let chainIncludesPerson = false;
        // keep looking for the person until either the person is found or there are no more people
        while (!chainIncludesPerson && includedPerson) {
          if (transmissionChainPeopleIndex[includedPerson]) {
            chainIncludesPerson = true;
          }
          includedPerson = includedPeople.shift();
        }
        // apply included person filter
        addTransmissionChain = (addTransmissionChain && chainIncludesPerson);
      }

      // if the chain passed all filters
      if (addTransmissionChain) {
        // add it to the result
        result.transmissionChains.chains.push(transmissionChain);
        // update people index
        Object.assign(filteredChainPeopleIndex, transmissionChainPeopleIndex);
      }
    });

    // update transmission chains no
    result.transmissionChains.length = result.transmissionChains.chains.length;

    // keep an index of nodes that should be kept
    const nodesToKeepIndex = {};
    // filter edges, should contain only the indexed people (people that passed the filters)
    Object.keys(dataSet.edges).forEach(function (edgeId) {
      // get the edge
      const edge = dataSet.edges[edgeId];
      // if no transmission chain filters applied or at least one person found in the index (case/event-contact relationships will have only one person in the index)
      if (!appliedTransmissionChainsFilters || filteredChainPeopleIndex[edge.persons[0].id] || filteredChainPeopleIndex[edge.persons[1].id]) {
        // keep the edge
        result.edges[edgeId] = edge;
        // keep both nodes
        nodesToKeepIndex[edge.persons[0].id] = true;
        nodesToKeepIndex[edge.persons[1].id] = true;
      }
    });

    // check if contact nodes should be removed from result
    // this should happen when include contacts flag is not set
    const shouldKeepContacts = opts.includeContacts;
    const shouldKeepContactsOfContacts = opts.includeContactsOfContacts;

    // go through all the nodes
    Object.keys(dataSet.nodes).forEach(function (nodeId) {
      // do not keep contact nodes
      if (!shouldKeepContacts && dataSet.nodes[nodeId].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT') {
        return;
      }

      // do not keep contact of contact nodes
      if (!shouldKeepContactsOfContacts &&
        dataSet.nodes[nodeId].type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT') {
        return;
      }

      // if the node should be kept
      if (nodesToKeepIndex[nodeId]) {
        // store it in the result
        result.nodes[nodeId] = dataSet.nodes[nodeId];
      }
    });
    // return processed result
    return result;
  };

  /**
   * Set outbreakId for created follow-ups
   */
  Outbreak.beforeRemote('prototype.__create__contacts__followUps', function (context, modelInstance, next) {
    // set outbreakId
    context.args.data.outbreakId = context.instance.id;
    next();
  });

  /**
   * Set outbreakId for created lab results
   */
  Outbreak.beforeRemote('prototype.__create__cases__labResults', function (context, modelInstance, next) {
    // set outbreakId
    context.args.data.outbreakId = context.instance.id;
    next();
  });

  /**
   * Set outbreakId for created lab results
   */
  Outbreak.beforeRemote('prototype.__create__contacts__labResults', function (context, modelInstance, next) {
    // set outbreakId
    context.args.data.outbreakId = context.instance.id;
    next();
  });

  /**
   * Count the cases with less than X contacts
   * Note: Besides the count the response also contains a list with the counted cases IDs
   * @param filter Besides the default filter properties this request also accepts 'noLessContacts': number on the first level in 'where'
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesWithLessThanXContacts = function (filter, options, callback) {
    // initialize noLessContacts filter
    let noLessContacts;
    // check if the noLessContacts filter was sent; accepting it only on the first level
    noLessContacts = _.get(filter, 'where.noLessContacts');
    if (typeof noLessContacts !== 'undefined') {
      // noLessContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noLessContacts;
    } else {
      // get the outbreak noLessContacts as the default noLessContacts value
      noLessContacts = this.noLessContacts;
    }

    // get outbreakId
    let outbreakId = this.id;

    // get cases with contacts
    app.models.relationship
      .getCasesWithContacts(outbreakId, filter, options)
      .then(function (casesWithContacts) {
        // initialize result
        let result = {
          cases: Object.values(casesWithContacts.cases)
        };

        // get all the found cases IDs
        let allCasesIDs = Object.keys(casesWithContacts.cases);
        let allCasesInfo = Object.values(casesWithContacts.cases);

        // get the caseIDs with less than noLessContacts contacts
        result.caseIDs = allCasesIDs.filter(caseId => casesWithContacts.cases[caseId].contactsCount < noLessContacts);
        result.cases = allCasesInfo.filter(item => result.caseIDs.indexOf(item.id) !== -1);
        result.casesCount = result.caseIDs.length;

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count the new contacts for each event
   * @param filter Besides the default filter properties this request also accepts 'noDaysNewContacts': number on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countEventNewContacts = function (filter, callback) {
    // initialize noDaysNewContacts filter
    let noDaysNewContacts;
    // check if the noDaysNewContacts filter was sent; accepting it only on the first level
    noDaysNewContacts = _.get(filter, 'where.noDaysNewContacts');
    if (typeof noDaysNewContacts !== 'undefined') {
      // noDaysNewContacts was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.noDaysNewContacts;
    } else {
      // get the outbreak noDaysNewContacts as the default noDaysNewContacts value
      noDaysNewContacts = this.noDaysNewContacts;
    }

    // get now date
    let now = new Date();

    // initialize results
    let results = {
      newContactsCount: 0,
      events: {}
    };

    // get outbreakId
    let outbreakId = this.id;

    // create filter as we need to use it also after the relationships are found
    let _filter = app.utils.remote
      .mergeFilters({
        where: {
          outbreakId: outbreakId,
          and: [
            {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'},
            {'persons.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT'}
          ]
        },
        include: [{
          relation: 'people',
          scope: {
            where: {
              type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
              dateOfReporting: {
                gte: now.setDate(now.getDate() - noDaysNewContacts)
              }
            },
            filterParent: true
          }
        }]
      }, filter || {});

    // get all relationships between events and contacts, where the contacts were created sooner than 'noDaysNewContacts' ago
    app.models.relationship.find(_filter)
      .then(function (relationships) {
        // filter by relation properties
        relationships = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(relationships, _filter);
        // initialize events map and contacts map
        let eventsMap = {};
        let contactsMap = {};
        // helper property to keep the contacts already counted
        let eventContactsMap = {};

        // loop through the relationships and populate the eventsMap;
        // Note: This loop will only add the events that have relationships. Will need to do another query to get the events without relationships
        relationships.forEach(function (relationship) {
          // get event index from persons
          let eventIndex = relationship.persons.findIndex(elem => elem.type === 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_EVENT');
          // get eventId, contactId
          // there are only 2 persons so the indexes are 0 or 1
          let eventId = relationship.persons[eventIndex].id;
          let contactId = relationship.persons[eventIndex ? 0 : 1].id;

          // create entry for the event in the eventsMap if not already created
          if (!eventsMap[eventId]) {
            eventsMap[eventId] = {
              id: eventId,
              newContactsCount: 0,
              contactIDs: []
            };

            // also create entry for the eventContactsMap
            eventContactsMap[eventId] = {};
          }

          // count the contact only if not already counted
          if (!eventContactsMap[eventId][contactId]) {
            // get contactId flag in order to not count it twice for the event
            eventContactsMap[eventId][contactId] = true;
            // increase counter
            eventsMap[eventId].newContactsCount++;
            // add contactId
            eventsMap[eventId].contactIDs.push(contactId);
          }

          if (!contactsMap[contactId]) {
            // get contactId flag in order to not count it twice in total
            contactsMap[contactId] = true;
            // increase total counter
            results.newContactsCount++;
          }
        });

        // update results.events; sending array with events information
        results.events = _.values(eventsMap);

        // get events without relationships
        return app.models.event.find({
          where: {
            outbreakId: outbreakId,
            id: {
              nin: Object.keys(eventContactsMap)
            }
          },
          fields: {
            id: true
          }
        });
      })
      .then(function (events) {
        // parse the events to create entries for the result
        let parsedEvents = events.map(event => {
          return {
            id: event.id,
            newContactsCount: 0,
            contactIDs: []
          };
        });

        // add the parsed events in the result
        results.events = results.events.concat(parsedEvents);

        // send response
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Count the contacts for each case; Also calculate mean/median
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.countCasesContacts = function (filter, options, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // get cases with contacts
    app.models.relationship
      .getCasesWithContacts(outbreakId, filter, options)
      .then(function (casesWithContacts) {
        // initialize result
        let result = {
          casesCount: casesWithContacts.casesCount,
          contactsCount: casesWithContacts.contactsCount,
          cases: Object.values(casesWithContacts.cases)
        };

        // calculate average/mean/median
        // get an array with sorted contact numbers; sort is needed for median
        let contactCountList = result.cases.map(item => item.contactsCount).sort((a, b) => a - b);
        let contactCountListLength = contactCountList.length;

        // calculate mean number of contacts per case; sum the number of contacts per case and split to number of cases
        // Note: the value is rounded to 1 decimal
        result.meanNoContactsPerCase = parseFloat((contactCountList.reduce((totalNo, noContactsPerCase) => totalNo + noContactsPerCase, 0) / contactCountListLength).toFixed(1));

        // calculate median; it's either the middle element of the array in case the length is uneven or the average of the two middle elements for even length
        result.medianNoContactsPerCase = contactCountListLength % 2 === 0 ?
          (contactCountList[contactCountListLength / 2 - 1] + contactCountList[contactCountListLength / 2]) / 2 :
          contactCountList[Math.floor(contactCountListLength / 2)];

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count contacts on follow-up lists on a specific day (default day: current day)
   * @param filter Accepts 'date' on the first level of 'where' property
   * @param callback
   */
  Outbreak.prototype.countFollowUpContacts = function (filter, callback) {
    app.models.followUp
      .countContacts(this.id, filter)
      .then(function (result) {
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Count the cases per period per classification
   * @param filter Besides the default filter properties this request also accepts
   * 'periodType': enum [day, week, month],
   * 'periodInterval':['date', 'date'],
   * 'includeTotals': boolean (if false 'total' response properties are not calculated),
   * 'includeDeaths': boolean (if false 'death' response properties are not calculated) on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countCasesPerPeriod = function (filter, callback) {
    // initialize periodType filter; default is day; accepting day/week/month
    let periodType;
    let periodTypes = {
      day: 'day',
      week: 'week',
      month: 'month'
    };

    // check if the periodType filter was sent; accepting it only on the first level
    periodType = _.get(filter, 'where.periodType');
    if (typeof periodType !== 'undefined') {
      // periodType was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodType;
    }

    // check if the received periodType is accepted
    if (Object.values(periodTypes).indexOf(periodType) === -1) {
      // set default periodType
      periodType = periodTypes.day;
    }

    // initialize periodInterval; keeping it as moment instances we need to use them further in the code
    let periodInterval;
    // check if the periodInterval filter was sent; accepting it only on the first level
    periodInterval = _.get(filter, 'where.periodInterval');
    if (typeof periodInterval !== 'undefined') {
      // periodInterval was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.periodInterval;
      // normalize periodInterval dates
      periodInterval[0] = genericHelpers.getDate(periodInterval[0]);
      periodInterval[1] = genericHelpers.getDateEndOfDay(periodInterval[1]);
    } else {
      // set default periodInterval depending on periodType
      periodInterval = genericHelpers.getPeriodIntervalForDate(undefined, periodType);
    }

    // initialize includeTotals and includeDeaths flags; default: false
    let includeTotals, includeDeaths;
    // check if the includeTotals filter was sent; accepting it only on the first level
    includeTotals = _.get(filter, 'where.includeTotals');
    if (typeof includeTotals !== 'undefined') {
      // includeTotals was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.includeTotals;
    } else {
      // set default
      includeTotals = false;
    }

    // check if the includeDeaths filter was sent; accepting it only on the first level
    includeDeaths = _.get(filter, 'where.includeDeaths');
    if (typeof includeDeaths !== 'undefined') {
      // includeDeaths was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.includeDeaths;
    } else {
      // set default
      includeDeaths = false;
    }

    // get outbreakId
    let outbreakId = this.id;

    // initialize result
    let result = {
      totalCasesForIntervalCount: 0,
      totalCasesClassificationCountersForInterval: {},
      totalCasesCountersForIntervalPerLocation: {
        locations: []
      },
      caseIDsForInterval: [],
      period: []
    };

    // initialize default filter
    // depending on includeTotals/includeDeaths filters we will make different queries
    let defaultFilter = {
      where: {
        outbreakId: outbreakId
      },
      order: 'dateOfReporting ASC'
    };

    if (!includeTotals) {
      // don't include totals; get only the cases reported in the periodInterval
      defaultFilter = app.utils.remote
        .mergeFilters({
          where: {
            or: [{
              and: [{
                dateOfReporting: {
                  // clone the periodInterval as it seems that Loopback changes the values in it when it sends the filter to MongoDB
                  between: periodInterval.slice()
                },
                dateBecomeCase: {
                  eq: null
                }
              }]
            }, {
              dateBecomeCase: {
                // clone the periodInterval as it seems that Loopback changes the values in it when it sends the filter to MongoDB
                between: periodInterval.slice()
              }
            }]
          }
        }, defaultFilter);
    } else {
      // totals are included; initialize additional result properties
      Object.assign(result, {
        totalCasesCount: 0,
        totalCasesClassificationCounters: {},
        totalCasesCountersPerLocation: {
          locations: []
        },
        caseIDs: []
      });
    }

    if (!includeDeaths) {
      // don't include deaths; get only the cases that are not dead
      defaultFilter = app.utils.remote
        .mergeFilters({
          where: {
            outcomeId: {
              neq: 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED'
            }
          }
        }, defaultFilter);
    } else {
      // deaths are included; initialize additional result properties (deaths for interval)
      Object.assign(result, {
        totalDeadCasesForIntervalCount: 0,
        totalDeadConfirmedCasesForIntervalCount: 0,
        deadCaseIDsForInterval: [],
        deadConfirmedCaseIDsForInterval: []
      });

      // check for includeTotals; we might need to add additional properties in the result
      if (includeTotals) {
        Object.assign(result, {
          totalDeadCasesCount: 0,
          totalDeadConfirmedCasesCount: 0,
          deadCaseIDs: [],
          deadConfirmedCaseIDs: []
        });
      }
    }

    // get all the cases for the filtered period
    app.models.case.find(app.utils.remote
      .mergeFilters(defaultFilter, filter || {}))
      .then(function (cases) {
        // get periodMap for interval
        let periodMap = genericHelpers.getChunksForInterval(periodInterval, periodType);
        // fill additional details for each entry in the periodMap
        Object.keys(periodMap).forEach(function (entry) {
          Object.assign(periodMap[entry], {
            totalCasesCount: 0,
            classificationCounters: {},
            countersPerLocation: {
              locations: []
            },
            caseIDs: []
          });

          // check for deaths flag in order to add additional properties to the result
          if (includeDeaths) {
            Object.assign(periodMap[entry], {
              totalDeadCasesCount: 0,
              totalDeadConfirmedCasesCount: 0,
              deadCaseIDs: [],
              deadConfirmedCaseIDs: []
            });
          }
        });

        cases.forEach(function (item) {
          // get case date; it's either dateBecomeCase or dateOfReporting
          let caseDate = item.dateBecomeCase || item.dateOfReporting;
          // get case location
          // normalize addresses
          item.addresses = item.addresses || [];
          let caseLocation = item.addresses.find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
          // use usual place of residence if found else leave the case unassigned to a location
          let caseLocationId = caseLocation && caseLocation.locationId ? caseLocation.locationId : null;
          // get confirmed flag
          let caseConfirmed = item.classification === 'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED';

          // in case includeTotals is true, there might be cases that have the date outside of the periodInterval;
          // these cases are not added in any period entry
          // initialize flag to know if the case needs to be added in a period entry
          let addInPeriod = !includeTotals || (periodInterval[0].isSameOrBefore(caseDate) && periodInterval[1].isSameOrAfter(caseDate));

          if (addInPeriod) {
            // get period in which the case needs to be included
            const casePeriodInterval = genericHelpers.getPeriodIntervalForDate(periodInterval, periodType);

            // create a period identifier
            let casePeriodIdentifier = casePeriodInterval.join(' - ');

            // get index of the case location in the period counters per location array
            let periodLocationIndex = periodMap[casePeriodIdentifier].countersPerLocation.locations.findIndex(location => location.id === caseLocationId);
            // initialize location entry is not already initialized
            if (periodLocationIndex === -1) {
              periodLocationIndex = periodMap[casePeriodIdentifier].countersPerLocation.locations.push(
                Object.assign(
                  {
                    id: caseLocationId,
                    totalCasesCount: 0,
                    caseIDs: []
                  },
                  // check for includeDeaths flag to add additional properties
                  includeDeaths ? {
                    totalDeadCasesCount: 0,
                    totalDeadConfirmedCasesCount: 0,
                    deadCaseIDs: [],
                    deadConfirmedCaseIDs: []
                  } : {}
                )
              ) - 1;
            }

            // get index of the case location in the entire interval counters per location array
            let entireIntervalLocationIndex = result.totalCasesCountersForIntervalPerLocation.locations.findIndex(location => location.id === caseLocationId);
            // initialize location entry is not already initialized
            if (entireIntervalLocationIndex === -1) {
              entireIntervalLocationIndex = result.totalCasesCountersForIntervalPerLocation.locations.push(
                Object.assign(
                  {
                    id: caseLocationId,
                    totalCasesCount: 0,
                    caseIDs: []
                  },
                  // check for includeDeaths flag to add additional properties
                  includeDeaths ? {
                    totalDeadCasesCount: 0,
                    totalDeadConfirmedCasesCount: 0,
                    deadCaseIDs: [],
                    deadConfirmedCaseIDs: []
                  } : {}
                )
              ) - 1;
            }

            // check if case is dead; will not add it to classificationCounters if so
            if (item.outcomeId !== 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED') {
              // period classification
              // initialize counter for period classification if it's not already initialized
              if (!periodMap[casePeriodIdentifier].classificationCounters[item.classification]) {
                periodMap[casePeriodIdentifier].classificationCounters[item.classification] = {
                  count: 0,
                  caseIDs: [],
                  locations: []
                };
              }
              periodMap[casePeriodIdentifier].classificationCounters[item.classification].count++;
              periodMap[casePeriodIdentifier].classificationCounters[item.classification].caseIDs.push(item.id);

              // get index of the case location in the locations array
              let locationIndex = periodMap[casePeriodIdentifier].classificationCounters[item.classification].locations.findIndex(location => location.id === caseLocationId);
              // initialize location entry is not already initialized
              if (locationIndex === -1) {
                locationIndex = periodMap[casePeriodIdentifier].classificationCounters[item.classification].locations.push({
                  id: caseLocationId,
                  totalCasesCount: 0,
                  caseIDs: []
                }) - 1;
              }

              // increase period classification location counters
              periodMap[casePeriodIdentifier].classificationCounters[item.classification].locations[locationIndex].totalCasesCount++;
              periodMap[casePeriodIdentifier].classificationCounters[item.classification].locations[locationIndex].caseIDs.push(item.id);

              // increase period counters outside of case classification
              periodMap[casePeriodIdentifier].totalCasesCount++;
              periodMap[casePeriodIdentifier].caseIDs.push(item.id);

              // increase period location counters
              periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].totalCasesCount++;
              periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].caseIDs.push(item.id);

              // entire interval classification
              // initialize counter for entire interval classification if it's not already initialized
              if (!result.totalCasesClassificationCountersForInterval[item.classification]) {
                result.totalCasesClassificationCountersForInterval[item.classification] = {
                  count: 0,
                  caseIDs: [],
                  locations: []
                };
              }
              result.totalCasesClassificationCountersForInterval[item.classification].count++;
              result.totalCasesClassificationCountersForInterval[item.classification].caseIDs.push(item.id);

              // get index of the case location in the entire interval classification locations array
              let entireIntervalClassificationLocationIndex = result.totalCasesClassificationCountersForInterval[item.classification].locations.findIndex(location => location.id === caseLocationId);
              // initialize location entry is not already initialized
              if (entireIntervalClassificationLocationIndex === -1) {
                entireIntervalClassificationLocationIndex = result.totalCasesClassificationCountersForInterval[item.classification].locations.push({
                  id: caseLocationId,
                  totalCasesCount: 0,
                  caseIDs: []
                }) - 1;
              }

              // increase entire interval classification classification location counters
              result.totalCasesClassificationCountersForInterval[item.classification].locations[entireIntervalClassificationLocationIndex].totalCasesCount++;
              result.totalCasesClassificationCountersForInterval[item.classification].locations[entireIntervalClassificationLocationIndex].caseIDs.push(item.id);

              // increase entire interval counters outside of case classification
              result.totalCasesForIntervalCount++;
              result.caseIDsForInterval.push(item.id);

              // increase entire interval location counters
              result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].totalCasesCount++;
              result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].caseIDs.push(item.id);
            } else {
              // update period counters
              if (caseConfirmed) {
                // update confirmed dead case counters
                periodMap[casePeriodIdentifier].totalDeadConfirmedCasesCount++;
                periodMap[casePeriodIdentifier].deadConfirmedCaseIDs.push(item.id);
                periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].totalDeadConfirmedCasesCount++;
                periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].deadConfirmedCaseIDs.push(item.id);

                result.totalDeadConfirmedCasesForIntervalCount++;
                result.deadConfirmedCaseIDsForInterval.push(item.id);
                result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].totalDeadConfirmedCasesCount++;
                result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].deadConfirmedCaseIDs.push(item.id);
              }

              // update death counters
              periodMap[casePeriodIdentifier].totalDeadCasesCount++;
              periodMap[casePeriodIdentifier].deadCaseIDs.push(item.id);
              periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].totalDeadCasesCount++;
              periodMap[casePeriodIdentifier].countersPerLocation.locations[periodLocationIndex].deadCaseIDs.push(item.id);

              result.totalDeadCasesForIntervalCount++;
              result.deadCaseIDsForInterval.push(item.id);
              result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].totalDeadCasesCount++;
              result.totalCasesCountersForIntervalPerLocation.locations[entireIntervalLocationIndex].deadCaseIDs.push(item.id);
            }
          }

          // check for include totals to increase totals counters
          if (includeTotals) {
            // get index of the case location in the total counters per location array
            let totalLocationIndex = result.totalCasesCountersPerLocation.locations.findIndex(location => location.id === caseLocationId);
            // initialize location entry is not already initialized
            if (totalLocationIndex === -1) {
              totalLocationIndex = result.totalCasesCountersPerLocation.locations.push(
                Object.assign(
                  {
                    id: caseLocationId,
                    totalCasesCount: 0,
                    caseIDs: []
                  },
                  // check for includeDeaths flag to add additional properties
                  includeDeaths ? {
                    totalDeadCasesCount: 0,
                    totalDeadConfirmedCasesCount: 0,
                    deadCaseIDs: [],
                    deadConfirmedCaseIDs: []
                  } : {}
                )
              ) - 1;
            }

            // check if case is dead; will not add it to classificationCounters if so
            if (item.outcomeId !== 'LNG_REFERENCE_DATA_CATEGORY_OUTCOME_DECEASED') {
              // initialize counter for total classification if it's not already initialized
              if (!result.totalCasesClassificationCounters[item.classification]) {
                result.totalCasesClassificationCounters[item.classification] = {
                  count: 0,
                  caseIDs: [],
                  locations: []
                };
              }
              result.totalCasesClassificationCounters[item.classification].count++;
              result.totalCasesClassificationCounters[item.classification].caseIDs.push(item.id);

              // get index of the case location in the total classification locations array
              let totalClassificationLocationIndex = result.totalCasesClassificationCounters[item.classification].locations.findIndex(location => location.id === caseLocationId);
              // initialize location entry is not already initialized
              if (totalClassificationLocationIndex === -1) {
                totalClassificationLocationIndex = result.totalCasesClassificationCounters[item.classification].locations.push({
                  id: caseLocationId,
                  totalCasesCount: 0,
                  caseIDs: []
                }) - 1;
              }

              // increase period classification location counters
              result.totalCasesClassificationCounters[item.classification].locations[totalClassificationLocationIndex].totalCasesCount++;
              result.totalCasesClassificationCounters[item.classification].locations[totalClassificationLocationIndex].caseIDs.push(item.id);

              // increase counters outside of case classification
              result.totalCasesCount++;
              result.caseIDs.push(item.id);

              // increase location counters
              result.totalCasesCountersPerLocation.locations[totalLocationIndex].totalCasesCount++;
              result.totalCasesCountersPerLocation.locations[totalLocationIndex].caseIDs.push(item.id);
            } else {
              // update period counters
              if (caseConfirmed) {
                // update confirmed dead case counters
                result.totalDeadConfirmedCasesCount++;
                result.deadConfirmedCaseIDs.push(item.id);
                result.totalCasesCountersPerLocation.locations[totalLocationIndex].totalDeadConfirmedCasesCount++;
                result.totalCasesCountersPerLocation.locations[totalLocationIndex].deadConfirmedCaseIDs.push(item.id);
              }

              // update death counters
              result.totalDeadCasesCount++;
              result.deadCaseIDs.push(item.id);
              result.totalCasesCountersPerLocation.locations[totalLocationIndex].totalDeadCasesCount++;
              result.totalCasesCountersPerLocation.locations[totalLocationIndex].deadCaseIDs.push(item.id);
            }
          }
        });

        // update results; sending array with period entries
        result.period = Object.values(periodMap);

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Merge multiple people of the same type (event/case/contact)
   * @param data List of records ids, to be merged
   * @param options
   * @param callback
   */
  Outbreak.prototype.mergePeople = function (data, options, callback) {
    if (!options) {
      options = {};
    }
    // execute same hooks as for sync (data should already exist)
    options._sync = true;
    // disable visual id validation for record merging
    options._disableVisualIdValidation = true;
    // defensive checks
    data = data || {};
    data.ids = data.ids || [];
    // default model type to case
    data.type = data.type || 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE';
    data.model = data.model || {};

    // reference to application models
    const appModels = app.models;

    // friendly person type value
    const modelType = appModels.person.typeToModelMap[data.type];

    const outbreakId = this.id;

    /**
     * Helper function used to retrieve relations for a given case
     * @param personId
     */
    const _findRelations = function (personId) {
      return app.models.relationship.find({
        where: {
          'persons.id': personId
        }
      });
    };

    /**
     * Helper function used to delete model props like id, createdAt...
     * @param clone
     * @private
     */
    const _removeCloneProps = function (clone) {
      clone = clone || {};

      delete clone.id;

      delete clone.createdAt;
      delete clone.createdBy;

      delete clone.updatedAt;
      delete clone.updatedBy;

      delete clone.deletedAt;

      return clone;
    };

    // reference to the model type we should work upon (case/contact)
    const targetModel = appModels[modelType];

    // include follow-up/lab results, based on the person type
    let includes = [];
    if (
      modelType === appModels.case.modelName ||
      modelType === appModels.contact.modelName
    ) {
      includes.push('labResults');
      includes.push('followUps');
    }

    targetModel
      .find({
        where: {
          id: {
            inq: data.ids
          }
        },
        include: includes
      })
      // retrieve relations of each model
      .then((models) => Promise.all(
        models.map((model) => {
          return _findRelations(model.id)
            .then((relations) => {
              model.relationships = relations;
              return model;
            });
        }))
      )
      .then((models) => {
        // generate a unique id for the new instance to be created
        let winnerId = Uuid.v4();

        // make sure the number of follow ups in a single day do not exceed the limit configured on outbreak
        let outbreakLimitPerDay = this.frequencyOfFollowUpPerDay;

        // better name for merge candidates ids
        let modelsIds = data.ids;

        // skip relations between merge candidates
        let relationsToAdd = [];
        models.forEach((model) => {
          model.relationships.forEach((relation) => {
            let people = relation.persons;

            let firstMember = modelsIds.indexOf(people[0].id);
            let secondMember = modelsIds.indexOf(people[1].id);

            // if there is a relation between 2 merge candidates, skip it
            if (firstMember !== -1 && secondMember !== -1) {
              return;
            }

            // otherwise try check which of the candidates is from the merging list and replace it with winner's id
            firstMember = firstMember === -1 ? people[0].id : winnerId;
            secondMember = secondMember === -1 ? people[1].id : winnerId;

            // create a copy of the relationship data
            // alter participants and remove its id (auto generated)
            let clone = relation.toJSON();
            clone.persons = [
              {
                id: firstMember,
                type: firstMember === winnerId ? data.type : people[0].type,
                source: people[0].source,
                target: people[0].target
              },
              {
                id: secondMember,
                type: secondMember === winnerId ? data.type : people[1].type,
                source: people[1].source,
                target: people[1].target
              }
            ];

            // filter relations that might be duplicated
            // like 2 merge candidates that have a relation with an external entity
            let resultSourceEntity = clone.persons.find((person) => person.source);
            let resultTargetEntity = clone.persons.find((person) => person.target);
            let existingRelation = relationsToAdd.find((relation) => {
              // check if source/target entities are the same
              // if so, this is a duplicate
              let sourceEntity = relation.persons.find((person) => person.source);
              let targetEntity = relation.persons.find((person) => person.target);
              return (resultSourceEntity && resultTargetEntity && sourceEntity && targetEntity) &&
                (resultSourceEntity.id === sourceEntity.id) &&
                (resultTargetEntity.id === targetEntity.id);
            });

            if (!existingRelation) {
              clone = _removeCloneProps(clone);

              relationsToAdd.push(clone);
            }
          });
        });

        // collect follow ups from all the contacts
        // reset date to the start of the day
        // group them by day, and sorted by creation date
        // make sure limit per day is not exceeded for upcoming follow ups
        let followUpsToAdd = [];
        // store today date references, needed when checking for future follow ups
        let today = genericHelpers.getDate();
        if (
          modelType === appModels.contact.modelName ||
          modelType === appModels.case.modelName
        ) {
          let allFollowUps = [];
          models.forEach((model) => {
            let modelFollowUs = model.followUps();
            if (modelFollowUs.length) {
              // reset follow up day to the start of the day
              // change person id to point to winner model
              let followUps = modelFollowUs.map((followUp) => {
                followUp.date = genericHelpers.getDate(followUp.date).toDate().toISOString();
                return followUp;
              });

              allFollowUps = allFollowUps.concat(followUps);
            }
          });

          // group them by day
          let groupedFollowUps = _.groupBy(allFollowUps, (f) => f.date);

          // sort each group of follow ups by creation date
          // if group is in the future, remove from the end until the limit per day is ok
          for (let group in groupedFollowUps) {
            if (groupedFollowUps.hasOwnProperty(group)) {
              if (genericHelpers.getDate(group).isAfter(today)) {
                groupedFollowUps[group] = groupedFollowUps[group].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                let lengthDiff = groupedFollowUps[group].length - outbreakLimitPerDay;
                if (lengthDiff > 0) {
                  for (let i = 0; i < lengthDiff; i++) {
                    groupedFollowUps[group].pop();
                  }
                }
              }

              followUpsToAdd = followUpsToAdd.concat(groupedFollowUps[group].map((f) => {
                // create a copy of the follow up
                // remove not needed properties
                let clone = f.toJSON();

                // alter person id
                clone.personId = winnerId;

                clone = _removeCloneProps(clone);

                return clone;
              }));
            }
          }
        }

        // for cases update each lab result person id reference to the winning model
        let labResultsToAdd = [];
        if (
          modelType === appModels.case.modelName ||
          modelType === appModels.contact.modelName
        ) {
          models.forEach((model) => {
            if (model.labResults().length) {
              labResultsToAdd = labResultsToAdd.concat(model.labResults().map((labResult) => {
                // create a copy of the lab results
                // remove not needed properties
                let clone = labResult.toJSON();

                // alter person id
                clone.personId = winnerId;

                clone = _removeCloneProps(clone);
                return clone;
              }));
            }
          });
        }

        // attach generated own and outbreak ids to the model
        data.model = Object.assign({}, data.model, {id: winnerId, outbreakId: outbreakId});

        // make changes into database
        // set flag to not remove isolated contacts when removing the cases that are being merged
        // those isolated contacts will be immediately included in the new relationships
        options.mergeDuplicatesAction = true;
        Promise
          // delete all the merge candidates
          .all(modelsIds.map((id) => targetModel.destroyById(id, options)))
          // create a new model containing the result properties
          .then(() => targetModel.create(data.model, options))
          .then(() => Promise.all([
            // relations
            Promise.all(relationsToAdd.map((relation) => appModels.relationship.create(relation, options))),
            // lab results
            Promise.all(labResultsToAdd.map((labResult) => appModels.labResult.create(labResult, options))),
            // follow ups
            Promise.all(followUpsToAdd.map((followUp) => appModels.followUp.create(followUp, options)))
          ]))
          .then(() => targetModel.findById(winnerId).then((winnerModel) => callback(null, winnerModel)))
          .catch((err) => {
            // make sure the newly created instance is deleted
            targetModel
              .findById(winnerId)
              .then((instance) => {
                if (instance) {
                  return instance.destroy(options);
                }
              })
              // restore deleted instances
              .then(() => Promise
                .all(models.map((model) => model.undoDelete(options)))
                .then(() => callback(err)));
          });
      });
  };

  /**
   * List the latest follow-ups for contacts if were not performed
   * The request doesn't return a missed follow-up if there is a new one for the same contact that was performed
   * @param context
   * @param filter
   * @param callback
   */
  Outbreak.prototype.listLatestFollowUpsForContactsIfNotPerformed = function (filter, context, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // remove native pagination params, doing it manually
    searchByRelationProperty.deletePaginationFilterFromContext(context.remotingContext);

    // get all the followups for the filtered period
    app.models.followUp
      .find(app.utils.remote
        .mergeFilters({
          where: {
            outbreakId: outbreakId
          },
          fields: ['id', 'personId', 'statusId'],
          // order by date as we need to check the follow-ups from the oldest to the most recent
          order: 'date ASC'
        }, filter || {}))
      .then(function (followups) {
        // add support for filter parent
        followups = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(followups, filter);

        // initialize contacts map as the request needs to return the latest follow-up for the contact if not performed
        let contactsMap = {};

        followups.forEach(function (followup) {
          // get contactId
          let contactId = followup.personId;

          // add in the contacts map the follow-up ID if it was not performed
          if (followup.statusId === 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED' &&
            !contactsMap[followup.personId]) {
            contactsMap[contactId] = followup.id;
          }
        });

        // add any manual pagination filter, if required
        filter = filter || {};
        filter.skip = _.get(filter, '_deep.skip', 0);
        filter.limit = _.get(filter, '_deep.limit');

        // do a second search in order to preserve requested order in the filters
        return app.models.followUp
          .find(app.utils.remote
            .mergeFilters({
              where: {
                id: {
                  inq: Object.values(contactsMap)
                },
                outbreakId: outbreakId,
              },
            }, filter))
          .then(function (followUps) {
            // send response
            callback(null, followUps);
          });
      })
      .catch(callback);
  };

  /**
   * Count the latest follow-ups for contacts if were not performed
   * The request doesn't count a missed follow-up if there is a new one for the same contact that was performed
   * @param filter
   * @param callback
   */
  Outbreak.prototype.filteredCountLatestFollowUpsForContactsIfNotPerformed = function (filter, callback) {
    this.listLatestFollowUpsForContactsIfNotPerformed(filter, {}, function (err, res) {
      if (err) {
        return callback(err);
      }
      callback(null, res.length);
    });
  };

  /**
   * Convert any date attribute that is string to 'Date' instance
   * Needed because mongodb doesn't always filter as expected when date is string
   */
  Outbreak.beforeRemote('**', function (context, modelInstance, next) {
    if (context.args.filter) {
      genericHelpers.convertPropsToDate(context.args.filter);
      genericHelpers.includeSubLocationsInLocationFilter(
        app,
        context.args.filter,
        'locationId',
        next
      );
    } else if (context.args.where) {
      genericHelpers.convertPropsToDate(context.args.where);
      genericHelpers.includeSubLocationsInLocationFilter(
        app, {
          where: context.args.where
        },
        'locationId',
        next
      );
    } else {
      return next();
    }
  });

  /**
   * Upload an importable file
   * @param req
   * @param file
   * @param modelName
   * @param decryptPassword
   * @param options
   * @param callback
   */
  Outbreak.prototype.importableFileUpload = function (req, file, modelName, decryptPassword, options, callback) {
    app.controllers.importableFile.upload(req, file, modelName, decryptPassword, options, this.id, callback);
  };

  /**
   * Get an importable file (contents) using file id
   * @param id
   * @param callback
   */
  Outbreak.prototype.getImportableFileJsonById = function (id, callback) {
    app.controllers.importableFile.getJsonById(id, callback);
  };

  /**
   * Build and return a pdf containing case investigation template
   * @param copies
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportCaseInvestigationTemplate = function (copies, options, callback) {
    helpers.printCaseInvestigation(this, pdfUtils, copies, null, options, callback);
  };

  /**
   * Count the total number of contacts per location; Include counters for contacts under follow-up, contacts seen on date, contacts released as well as date for expected release of last contact
   * @param filter This request also accepts 'date': 'date', 'locationId': 'locationId' on the first level in 'where'
   * @param callback
   */
  Outbreak.prototype.countContactsPerLocation = function (filter, callback) {
    // get outbreakId
    let outbreakId = this.id;

    // initialize filter to be sent to mongo
    let _filter = {
      where: {
        outbreakId: outbreakId
      }
    };

    // initialize dateToFilter and locationToFilter filters
    let dateToFilter, locationToFilter;
    // check if the dateToFilter filter was sent; accepting it only on the first level
    dateToFilter = _.get(filter, 'where.date', null);
    if (dateToFilter !== null) {
      // add date to filter if it is valid; else use today
      dateToFilter = localizationHelper.toMoment(dateToFilter).isValid() ? genericHelpers.getDateEndOfDay(dateToFilter) : genericHelpers.getDateEndOfDay();

      // date was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.date;
    } else {
      // use today as default filter
      dateToFilter = genericHelpers.getDateEndOfDay();
    }

    // add date to filter
    // also in order to see if a contact was seen on the day get the latest follow-up that should have occurred
    _filter = app.utils.remote
      .mergeFilters({
        where: {
          dateOfReporting: {
            lte: new Date(dateToFilter)
          }
        },
        include: {
          relation: 'followUps',
          scope: {
            where: {
              date: {
                // filter until date as follow-ups can be scheduled in the future
                lte: new Date(dateToFilter)
              }
            },
            order: 'date DESC',
            limit: 1
          }
        }
      }, _filter);

    // check if the locationToFilter filter was sent; accepting it only on the first level
    locationToFilter = _.get(filter, 'where.locationId', null);
    if (locationToFilter !== null) {
      // add location to filter
      _filter = app.utils.remote
        .mergeFilters({
          where: {
            'addresses': {
              'elemMatch': {
                typeId: 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE',
                locationId: locationToFilter
              }
            }
          }
        }, _filter);

      // locationId was sent; remove it from the filter as it shouldn't reach DB
      delete filter.where.locationId;
    }

    // initialize result
    let result = {
      totalRegisteredContactsCount: 0,
      releasedContactsCount: 0,
      contactsUnderFollowUpCount: 0,
      contactsSeenOnDateCount: 0,
      lastContactDateOfRelease: null
    };

    // get all the contacts using sent and created filters
    app.models.contact.find(app.utils.remote
      .mergeFilters(_filter, filter || {}))
      .then(function (contacts) {
        // initialize locations map
        let locationMap = {};

        // loop through all contacts and update counters
        contacts.forEach(function (contact) {
          // get contactId
          let contactId = contact.id;

          // get location
          let contactLocationId;
          if (locationToFilter) {
            // a filter for location was sent and the contact was found means that the contact location is the filtered location
            contactLocationId = locationToFilter;
          } else {
            // get the contact's usual place of residence
            // normalize addresses
            contact.addresses = contact.addresses || [];
            let contactResidence = contact.addresses.find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
            // use usual place of residence if found else leave the contact unassigned to a location
            contactLocationId = contactResidence && contactResidence.locationId ? contactResidence.locationId : null;
          }

          // initialize location entry if not already initialized
          if (!locationMap[contactLocationId]) {
            locationMap[contactLocationId] = {
              id: contactLocationId,
              totalRegisteredContactsCount: 0,
              releasedContactsCount: 0,
              contactsUnderFollowUpCount: 0,
              contactsSeenOnDateCount: 0,
              lastContactDateOfRelease: null,
              contactIDs: []
            };
          }

          // increase counters
          locationMap[contactLocationId].totalRegisteredContactsCount++;

          // check if the contact is still under follow-up
          // get end date of contact follow-ups
          // not having an end date should not be encountered; considering this case as still under follow-up
          let followUpEndDate = localizationHelper.toMoment(_.get(contact, 'followUp.endDate', null));
          followUpEndDate = genericHelpers.getDateEndOfDay(followUpEndDate);
          if (!followUpEndDate.isValid() || followUpEndDate.isSameOrAfter(dateToFilter)) {
            // update contactsUnderFollowUpCount
            locationMap[contactLocationId].contactsUnderFollowUpCount++;
            result.contactsUnderFollowUpCount++;

            // get retrieved follow-up; is the latest that should have been performed
            let followUp = contact.toJSON().followUps[0];
            // check if the follow-up was performed
            if (followUp && app.models.followUp.isPerformed(followUp)) {
              // update contactsSeenOnDateCount
              locationMap[contactLocationId].contactsSeenOnDateCount++;
              result.contactsSeenOnDateCount++;
            }
          } else {
            // update releasedContactsCount
            locationMap[contactLocationId].releasedContactsCount++;
            result.releasedContactsCount++;
          }

          // add the contact ID in the array
          locationMap[contactLocationId].contactIDs.push(contactId);

          // update lastContactDateOfRelease if not set or contact follow-up end date is after
          if (!locationMap[contactLocationId].lastContactDateOfRelease || followUpEndDate.isAfter(locationMap[contactLocationId].lastContactDateOfRelease)) {
            locationMap[contactLocationId].lastContactDateOfRelease = followUpEndDate;
          }
          // same for general result
          if (!result.lastContactDateOfRelease || followUpEndDate.isAfter(result.lastContactDateOfRelease)) {
            result.lastContactDateOfRelease = followUpEndDate;
          }
        });

        // add totalRegisteredContactsCount
        result.totalRegisteredContactsCount = contacts.length;

        // get the locations
        result.locations = Object.values(locationMap);

        // send response
        callback(null, result);
      })
      .catch(callback);
  };

  /**
   * Export an empty case investigation for an existing case (has qrCode)
   * @param caseId
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportExistingEmptyCaseInvestigation = function (caseId, options, callback) {
    let self = this;

    this.__findById__cases(caseId, function (error, foundCase) {
      helpers.printCaseInvestigation(self, pdfUtils, 1, foundCase, options, callback);
    });
  };

  /**
   * Create multiple contacts for cases
   * @param caseId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createCaseMultipleContacts = function (caseId, data, options, callback) {
    Outbreak.createPersonMultipleContacts(this, app.models.case.modelName, caseId, data, options)
      .then(function (results) {
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Create multiple contacts for events
   * @param eventId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createEventMultipleContacts = function (eventId, data, options, callback) {
    Outbreak.createPersonMultipleContacts(this, app.models.event.modelName, eventId, data, options)
      .then(function (results) {
        callback(null, results);
      })
      .catch(callback);
  };

  /**
   * Bulk modify contacts
   * @param existingContacts
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkModifyContacts = function (existingContacts, options, callback) {
    Outbreak.modifyMultipleContacts(existingContacts, false, options)
      .then((results) => callback(null, results))
      .catch(callback);
  };

  /**
   * Restore a deleted outbreak
   * @param outbreakId
   * @param options
   * @param callback
   */
  Outbreak.restoreOutbreak = function (outbreakId, options, callback) {
    Outbreak
      .findOne({
        deleted: true,
        where: {
          id: outbreakId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {model: Outbreak.modelName, id: outbreakId});
        }

        // undo outbreak delete
        instance.undoDelete(options, (err) => {
          if (err) {
            return callback(err);
          }

          // restore related language tokens
          return app.dataSources.mongoDb.connector
            .collection('languageToken')
            .updateMany({
              deleted: true,
              token: {
                $regex: new RegExp(outbreakId, 'i')
              }
            }, {
              '$unset': {
                deletedAt: ''
              },
              '$set': {
                deleted: false
              }
            })
            .then(() => {
              // restore succeeded
              callback();
            })
            .catch(err => {
              options.remotingContext.req.logger.debug(`Failed to restore outbreak related language tokens. Error: ${err}`);

              // revert outbreak restore
              instance.destroy(err => {
                if (err) {
                  options.remotingContext.req.logger.debug(`Failed to delete outbreak after the related language tokens restore failed. Error: ${err}`);
                }

                // failed to revert changes
                callback(err);
              });
            });
        });
      })
      .catch(callback);
  };

  /**
   * Find relationship exposures for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findCaseRelationshipExposures = function (caseId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipExposures(this.id, caseId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Count relationship exposures for a case
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countCaseRelationshipExposures = function (caseId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipExposures(this.id, caseId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Find relationship contacts for a case. Relationship contacts are the relationships where the case is a source (it has nothing to do with person type contact)
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findCaseRelationshipContacts = function (caseId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipContacts(this.id, caseId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Count relationship contacts for a case. Relationship contacts are the relationships where the case is a source (it has nothing to do with person type contact)
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countCaseRelationshipContacts = function (caseId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipContacts(this.id, caseId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Find relationship exposures for a contact
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactRelationshipExposures = function (contactId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipExposures(this.id, contactId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Count relationship exposures for a contact
   * @param caseId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactRelationshipExposures = function (caseId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipExposures(this.id, caseId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Find relationship contacts for a contact. Relationship contacts are the relationships where the contact is a source (it has nothing to do with person type contact)
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactRelationshipContacts = function (contactId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipContacts(this.id, contactId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Count relationship contacts for a contact. Relationship contacts are the relationships where the contact is a source (it has nothing to do with person type contact)
   * @param contactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactRelationshipContacts = function (contactId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipContacts(this.id, contactId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Find relationship exposures for a contact
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findEventRelationshipExposures = function (eventId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipExposures(this.id, eventId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Count relationship exposures for a contact
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countEventRelationshipExposures = function (eventId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipExposures(this.id, eventId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Find relationship contacts for a event. Relationship contacts are the relationships where the event is a source (it has nothing to do with person type contact)
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findEventRelationshipContacts = function (eventId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipContacts(this.id, eventId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };


  /**
   * Count relationship contacts for a event. Relationship contacts are the relationships where the event is a source (it has nothing to do with person type contact)
   * @param eventId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countEventRelationshipContacts = function (eventId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipContacts(this.id, eventId, filter)
      .then(function (contacts) {
        callback(null, contacts);
      })
      .catch(callback);
  };

  /**
   * Create (upload) a new file
   * @param req
   * @param attachmentId
   * @param name
   * @param file
   * @param options
   * @param callback
   */
  Outbreak.prototype.attachmentUpload = function (req, attachmentId, name, file, options, callback) {
    app.models.fileAttachment
      .upload(this.id, req, attachmentId, name, file, options, callback);
  };

  /**
   * Download an attachment
   * @param attachmentId
   * @param callback
   */
  Outbreak.prototype.attachmentDownload = function (attachmentId, callback) {
    // try and find the attachment
    app.models.fileAttachment
      .findOne({
        where: {
          id: attachmentId,
          outbreakId: this.id,
        }
      })
      .then(function (attachment) {
        // if not found, stop with error
        if (!attachment) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.fileAttachment.modelName,
            id: attachmentId
          });
        }
        // download the attachment
        attachment.download(callback);
      })
      .catch(callback);
  };

  /**
   * Bulk create relationships
   * @param sources Source person Ids
   * @param targets Target person Ids
   * @param relationshipData Common relationship data
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkCreateRelationships = function (sources, targets, relationshipData, options, callback) {
    // inject platform identifier
    options.platform = Platform.BULK;

    // bulk create relationships
    app.models.relationship.bulkCreate(this.id, sources, targets, relationshipData, options)
      .then(function (result) {
        // if at least one relationship failed to be created
        if (result.failed.length) {
          // stop with error
          return callback(
            app.utils.apiError.getError('BULK_CREATE_RELATIONSHIP_ERRORS', {
              created: {
                records: result.created,
                count: result.created.length
              },
              failed: {
                errors: result.failed,
                count: result.failed.length
              }
            })
          );
        }
        // everything went fine
        return callback(null, result.created);
      })
      .catch(callback);
  };

  /**
   * Get movement for a case
   * Movement: list of addresses that contain geoLocation information, sorted from the oldest to newest based on date.
   * Empty date is treated as the most recent
   * @param caseId
   * @param callback
   */
  Outbreak.prototype.getCaseMovement = function (caseId, callback) {
    app.models.case
      .findOne({
        where: {
          id: caseId,
          outbreakId: this.id
        }
      })
      .then(function (caseRecord) {
        if (!caseRecord) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.case.modelName,
            id: caseId
          });
        }
        return caseRecord.getMovement()
          .then(function (movement) {
            callback(null, movement);
          });
      })
      .catch(callback);
  };

  /**
   * Get movement for a contact
   * Movement: list of addresses that contain geoLocation information, sorted from the oldest to newest based on date.
   * Empty date is treated as the most recent
   * @param contactId
   * @param callback
   */
  Outbreak.prototype.getContactMovement = function (contactId, callback) {
    app.models.contact
      .findOne({
        where: {
          id: contactId,
          outbreakId: this.id
        }
      })
      .then(function (contactRecord) {
        if (!contactRecord) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: contactId
          });
        }
        return contactRecord.getMovement()
          .then(function (movement) {
            callback(null, movement);
          });
      })
      .catch(callback);
  };

  /**
   * Restore a deleted lab result
   * @param caseId
   * @param labResultId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreCaseLabResult = function (caseId, labResultId, options, callback) {
    app.models.labResult
      .findOne({
        deleted: true,
        where: {
          id: labResultId,
          personId: caseId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError(
            'MODEL_NOT_FOUND',
            {
              model: app.models.labResult.modelName,
              id: labResultId
            }
          );
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Export a daily contact follow-up form for every contact from a specified date.
   * @param res
   * @param date
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.exportFullContactFollowUpListPerDay = function (res, date, filter, options, callback) {
    filter = filter || {};

    /**
     * Flow control, make sure callback is not called multiple times
     * @param error
     * @param result
     */
    function cb(error, result) {
      // execute callback
      callback(error, result);
      // replace callback with no-op to prevent calling it multiple times
      callback = function noOp() {
      };
    }

    const self = this;
    const languageId = options.remotingContext.req.authData.user.languageId;

    // define start date, end date for follow-ups
    let startDate;
    let endDate;
    // set them according to date
    if (date) {
      startDate = genericHelpers.getDate(date);
      endDate = genericHelpers.getDateEndOfDay(date);
    }

    // Filter to get all of the outbreak's contacts that are under follow-up, and all their follow-ups, from the specified date
    let _filter = {
      where: {
        and: [
          {outbreakId: this.id},
          {'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP'}
        ]
      },
      include: {
        relation: 'followUps',
        scope: {
          order: 'date ASC',
          filterParent: true
        }
      }
    };

    // include startDate and endDate
    if (startDate && endDate) {
      _filter.include.scope.where = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      };
    }

    // merge filters
    _filter = app.utils.remote.mergeFilters(_filter, filter);
    // get language dictionary
    app.models.language.getLanguageDictionary(languageId, function (error, dictionary) {
      if (error) {
        return cb(error);
      }
      // start the builder
      const dailyFollowUpListBuilder = fork(`${__dirname}../../../components/workers/buildFullDailyFollowUpList`,
        [], {
          execArgv: [],
          windowsHide: true
        }
      );

      /**
       * Event listener handler
       */
      function eventListener() {
        const error = new Error(`Processing failed. Worker stopped. Event Details: ${JSON.stringify(arguments)}`);
        res.req.logger.error(JSON.stringify(error));
        cb(error);
      }

      // listen to exit events
      ['error', 'exit'].forEach(function (event) {
        dailyFollowUpListBuilder.on(event, eventListener);
      });

      // listen to builder messages
      dailyFollowUpListBuilder.on('message', function (args) {
        // first argument is an error
        if (args[0]) {
          // handle it
          cb(args[0]);
        }
        // if the message is a chunk
        if (args[1] && args[1].chunk) {
          // write it on the response
          res.write(Buffer.from(args[1].chunk.data));
        }
        // if the worker finished
        if (args[1] && args[1].end) {
          // end the response
          res.end();
          // process will be closed gracefully, remove listeners
          ['error', 'exit'].forEach(function (event) {
            dailyFollowUpListBuilder.removeListener(event, eventListener);
          });
          // stop the builder
          dailyFollowUpListBuilder.kill();
        }
      });

      // set appropriate headers
      res.set('Content-type', 'application/pdf');
      res.set('Content-disposition', 'attachment;filename=Daily Contact Follow-up.pdf');

      /**
       * Process follow-ups in batches (avoid OOM situations)
       * @param skip
       * @param limit
       * @param maxCount
       * @returns {Promise<any | never>}
       */
      function processInBatches(skip, limit, maxCount) {
        // find contacts in batches
        return app.models.contact.rawFind(_filter.where, {
          projection: {
            firstName: 1,
            middleName: 1,
            lastName: 1,
            gender: 1,
            age: 1,
            dateOfLastContact: 1,
            addresses: 1
          },
          skip: skip,
          limit: limit
        })
          .then((contacts) => {
            // build a map of contacts
            const contactsMap = {};
            contacts.forEach(function (contact) {
              contactsMap[contact.id] = contact;
              contact.followUps = [];
            });

            // find followups filters
            let followUpsQuery = app.utils.remote.searchByRelationProperty
              .convertIncludeQueryToFilterQuery(_filter).followUps;

            // build followUps query
            followUpsQuery = {
              and: [
                followUpsQuery,
                {outbreakId: self.id},
                {
                  personId: {
                    inq: Object.keys(contactsMap)
                  }
                }
              ]
            };

            // find followUps that match the query
            return app.models.followUp
              .rawFind(followUpsQuery, {
                projection: {
                  personId: 1,
                  date: 1,
                  statusId: 1,
                  questionnaireAnswers: 1
                }
              })
              .then(function (followUps) {

                // add followUps to the list of contacts
                followUps.forEach(function (followUp) {
                  contactsMap[followUp.personId].followUps.push(followUp);
                });
                // Filter contacts with no follow-ups
                contacts = app.utils.remote.searchByRelationProperty.deepSearchByRelationProperty(contacts, _filter);

                // build data for the worker thread;
                let _data = [];
                // go through all the contacts
                contacts.forEach((contact, index) => {
                  // build data entry
                  _data[index] = {};
                  // Initiate the data
                  let data = [{
                    description: 'Date'
                  }];

                  // Initiate the headers
                  let headers = [{
                    id: 'description',
                    header: ''
                  }];

                  // add follow-up status row
                  data.push({description: dictionary.getTranslation('LNG_FOLLOW_UP_FIELD_LABEL_STATUSID')});

                  // go through all follow-usp
                  contact.followUps.forEach((followUp, i) => {
                    headers.push({
                      id: 'index' + i,
                      header: followUp.index
                    });
                    // add follow-up date
                    data[0]['index' + i] = localizationHelper.toMoment(followUp.date).format('YYYY-MM-DD');
                    // add follow-up status
                    data[data.length - 1]['index' + i] = dictionary.getTranslation(app.models.followUp.statusAcronymMap[followUp.statusId]);
                  });

                  // Add all questions as rows
                  templateParser.extractVariablesAndAnswerOptions(self.contactFollowUpTemplate).forEach((question) => {
                    data.push({description: dictionary.getTranslation(question.text)});
                    contact.followUps.forEach((followUp, i) => {
                      let questionAnswer = _.get(followUp, `questionnaireAnswers[${question.variable}]`);
                      questionAnswer = genericHelpers.convertQuestionAnswerToOldFormat(questionAnswer);

                      data[data.length - 1]['index' + i] = genericHelpers.translateQuestionAnswers(question, questionAnswer, dictionary);
                    });
                  });

                  // contact current address
                  const currentAddress = app.models.person.getCurrentAddress(contact);

                  // add contact information
                  _data[index].contactInformation = {
                    title: dictionary.getTranslation('LNG_PAGE_TITLE_CONTACT_DETAILS'),
                    rows: [
                      app.models.person.getDisplayName(contact),
                      `${dictionary.getTranslation('LNG_REFERENCE_DATA_CATEGORY_GENDER')}: ${pdfUtils.displayValue(dictionary.getTranslation(contact.gender))}`,
                      `${dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_AGE')}: ${_.get(contact, 'age.years')} ${dictionary.getTranslation('LNG_AGE_FIELD_LABEL_YEARS')} ${_.get(contact, 'age.months')} ${dictionary.getTranslation('LNG_AGE_FIELD_LABEL_MONTHS')}`,
                      `${dictionary.getTranslation('LNG_RELATIONSHIP_FIELD_LABEL_CONTACT_DATE')}: ${localizationHelper.toMoment(contact.dateOfLastContact).format('YYYY-MM-DD')}`,
                      `${dictionary.getTranslation('LNG_CONTACT_FIELD_LABEL_ADDRESSES')}: ${app.models.address.getHumanReadableAddress(currentAddress)}`,
                      `${dictionary.getTranslation('LNG_ADDRESS_FIELD_LABEL_PHONE_NUMBER')}: ${pdfUtils.displayValue(currentAddress ? currentAddress.phoneNumber : null)}`
                    ]
                  };

                  // add legend
                  _data[index].legend = {
                    title: dictionary.getTranslation('LNG_FOLLOW_UP_STATUS_LEGEND'),
                    rows: []
                  };
                  for (let statusId in app.models.followUp.statusAcronymMap) {
                    if (app.models.followUp.statusAcronymMap.hasOwnProperty(statusId)) {
                      _data[index].legend.rows.push(`${dictionary.getTranslation(statusId)} = ${dictionary.getTranslation(app.models.followUp.statusAcronymMap[statusId])}`);
                    }
                  }
                  // add data & headers
                  _data[index].data = data;
                  _data[index].headers = headers;

                });
                // process data using workers
                return new Promise(function (resolve, reject) {
                  // send data to the worker
                  dailyFollowUpListBuilder.send({fn: 'sendData', args: [_data, skip + limit >= maxCount]});

                  // worker communicates via messages, listen to them
                  function listener(args) {
                    // first argument is an error
                    if (args[0]) {
                      // handle it
                      return reject(args[0]);
                    }
                    // if the worker is ready for the next batch
                    if (args[1] && args[1].readyForNextBatch) {
                      // remove current listener
                      dailyFollowUpListBuilder.removeListener('message', listener);
                      // send move to next step
                      return resolve();
                    }
                  }

                  // listen to worker messages
                  dailyFollowUpListBuilder.on('message', listener);
                });
              });
          })
          .then(function () {
            // update skip for the next
            skip += limit;
            // if there is a next batch
            if (skip < maxCount) {
              // process it
              return processInBatches(skip, limit, maxCount);
            }
          });
      }

      // count the contacts that match the query
      return app.models.contact
        .count(_filter.where)
        .then(function (contactsNo) {
          // process contacts in batches
          return processInBatches(0, 100, contactsNo);
        })
        .then(function () {
          // all records processed, inform the worker that is time to finish
          dailyFollowUpListBuilder.send({fn: 'finish', args: []});
        })
        .catch(cb);
    });
  };

  /**
   * Retrieve a case isolated contacts and count
   * @param caseId
   * @param callback
   */
  Outbreak.prototype.getCaseIsolatedContacts = function (caseId, callback) {
    app.models.case.getIsolatedContacts(caseId, (err, isolatedContacts) => {
      if (err) {
        return callback(err);
      }
      return callback(null, {
        count: isolatedContacts.length,
        ids: isolatedContacts.map((entry) => entry.contact.id),
        contacts: isolatedContacts.map((entry) => ({
          id: entry.contact.id,
          firstName: entry.contact.firstName,
          middleName: entry.contact.middleName,
          lastName: entry.contact.lastName
        }))
      });
    });
  };

  /**
   * Retrieve an event isolated contacts and count
   * @param eventId
   * @param callback
   */
  Outbreak.prototype.getEventIsolatedContacts = function (eventId, callback) {
    app.models.event.getIsolatedContacts(eventId, (err, isolatedContacts) => {
      if (err) {
        return callback(err);
      }
      return callback(null, {
        count: isolatedContacts.length,
        ids: isolatedContacts.map((entry) => entry.contact.id),
        contacts: isolatedContacts.map((entry) => ({
          id: entry.contact.id,
          firstName: entry.contact.firstName,
          middleName: entry.contact.middleName,
          lastName: entry.contact.lastName
        }))
      });
    });
  };


  /**
   * Retrieve the isolated contacts for a contact and count
   * @param caseId
   * @param callback
   */
  Outbreak.prototype.getContactIsolatedContacts = function (contactId, callback) {
    app.models.contact.getIsolatedContacts(contactId, (err, isolatedContacts) => {
      if (err) {
        return callback(err);
      }
      return callback(null, {
        count: isolatedContacts.length,
        ids: isolatedContacts.map((entry) => entry.contact.id),
        contacts: isolatedContacts.map((entry) => ({
          id: entry.contact.id,
          firstName: entry.contact.firstName,
          middleName: entry.contact.middleName,
          lastName: entry.contact.lastName
        }))
      });
    });
  };

  /**
   * Change source and targets of a relationship
   * @param relationshipId
   * @param sourceTargetIds
   * @param callback
   */
  Outbreak.prototype.setTargetAndSourceForRelationship = function (relationshipId, sourceTargetIds, callback) {
    // outbreak id
    const outbreakId = this.id;

    // handle validation errors
    const throwValidationError = (msg) => {
      callback(app.utils.apiError.getError('VALIDATION_ERROR', {
        model: app.models.relationshipSourceTarget.modelName,
        details: msg
      }));
    };

    // validate input
    if (
      !sourceTargetIds ||
      !sourceTargetIds.sourceId ||
      !sourceTargetIds.targetId
    ) {
      return throwValidationError('Must contain sourceId & targetId');
    }

    // validate round relationships
    if (sourceTargetIds.sourceId === sourceTargetIds.targetId) {
      return throwValidationError('SourceId needs to be different from targetId');
    }

    // retrieve source & target models
    app.models.person
      .rawFind({
        outbreakId: outbreakId,
        _id: {
          inq: [sourceTargetIds.sourceId, sourceTargetIds.targetId]
        }
      })
      .then((records) => {
        // find source & target
        const sourceModel = _.find(records, (r) => r.id === sourceTargetIds.sourceId);
        const targetModel = _.find(records, (r) => r.id === sourceTargetIds.targetId);

        // did we found our records ?
        if (!sourceModel) {
          return throwValidationError('Source model is missing');
        }

        // did we found our records ?
        if (!targetModel) {
          return throwValidationError('Target model is missing');
        }

        // finished
        return {
          sourceModel: sourceModel,
          targetModel: targetModel
        };
      })
      .then((sourceAndTarget) => {
        return app.models.relationship
          .findById(relationshipId)
          .then((relationshipData) => {
            // found ?
            if (
              !relationshipData ||
              relationshipData.id !== relationshipId
            ) {
              return throwValidationError('Relationship model is missing');
            }

            // finished
            return Object.assign(
              sourceAndTarget, {
                relationshipData: relationshipData
              }
            );
          });
      })
      .then((replaceData) => {
        // update relationship
        return replaceData.relationshipData
          .updateAttributes({
            persons: [{
              id: replaceData.targetModel.id,
              type: replaceData.targetModel.type,
              target: true
            }, {
              id: replaceData.sourceModel.id,
              type: replaceData.sourceModel.type,
              source: true
            }]
          });
      })
      .then((updatedRelationship) => {
        // finished
        callback(null, updatedRelationship);
      })
      .catch(callback);
  };

  /**
   * Change target for all relationships matching specific conditions
   * @param targetId Case / Contact / Event
   * @param where Mongo Query
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkChangeTargetRelationships = function (targetId, where, options, callback) {
    app.models.relationship
      .bulkChangeSourceOrTarget(this.id, false, targetId, where, options)
      .then((changedCount) => {
        callback(null, changedCount);
      })
      .catch(callback);
  };

  /**
   * Change source for all relationships matching specific conditions
   * @param sourceId Case / Contact / Event
   * @param where Mongo Query
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkChangeSourceRelationships = function (sourceId, where, options, callback) {
    app.models.relationship
      .bulkChangeSourceOrTarget(this.id, true, sourceId, where, options)
      .then((changedCount) => {
        callback(null, changedCount);
      })
      .catch(callback);
  };

  /**
   * Bulk delete a list of follow ups
   * @param filter
   * @param callback
   */
  Outbreak.prototype.bulkDeleteFollowUps = function (filter, callback) {
    const outbreakId = this.id;
    filter = filter || {};
    filter.where = filter.where || {};
    app.models.followUp.destroyAll({
      and: [
        {
          outbreakId: outbreakId
        },
        filter.where
      ]
    }, callback);
  };

  /**
   * Bulk restore a list of deleted follow ups
   * @param filter
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkRestoreFollowUps = function (filter, options, callback) {
    const outbreakId = this.id;
    filter = filter || {};
    filter.where = filter.where || {};
    app.models.followUp
      .find({
        deleted: true,
        where: {
          and: [
            {
              outbreakId: outbreakId,
              deleted: true
            },
            filter.where
          ]
        }
      })
      .then(records => {
        async.series(records.map(r => doneRecord => r.undoDelete(options, doneRecord)), callback);
      })
      .catch(callback);
  };

  /**
   * Restore a deleted lab result
   * @param contactId
   * @param labResultId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContactLabResult = function (contactId, labResultId, options, callback) {
    app.models.labResult
      .findOne({
        deleted: true,
        where: {
          id: labResultId,
          personId: contactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError(
            'MODEL_NOT_FOUND',
            {
              model: app.models.labResult.modelName,
              id: labResultId
            }
          );
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Restore a deleted lab result
   * @param contactOfContactId
   * @param labResultId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContactOfContactLabResult = function (contactOfContactId, labResultId, options, callback) {
    app.models.labResult
      .findOne({
        deleted: true,
        where: {
          id: labResultId,
          personId: contactOfContactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError(
            'MODEL_NOT_FOUND',
            {
              model: app.models.labResult.modelName,
              id: labResultId
            }
          );
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Find relations for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactOfContactRelationships = function (contactOfContactId, filter, callback) {
    helpers.findPersonRelationships(contactOfContactId, filter, callback);
  };

  /**
   * Create relation for a contact of contact
   * @param contactOfContactId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createContactOfContactRelationship = function (contactOfContactId, data, options, callback) {
    app.models.contactOfContact
      .findById(contactOfContactId)
      .then((record) => {
        if (!record) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contactOfContact.modelName,
            id: contactOfContactId
          }));
        }
        helpers.createPersonRelationship(
          this.id,
          contactOfContactId,
          'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
          data,
          options,
          callback
        );
      })
      .catch(callback);
  };

  /**
   * Retrieve a relation for a contact of contact
   * @param contactOfContactId
   * @param relationshipId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.getContactOfContactRelationship = function (contactOfContactId, relationshipId, filter, callback) {
    helpers.getPersonRelationship(
      contactOfContactId,
      relationshipId,
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
      filter,
      callback
    );
  };

  /**
   * Update a relation for a contact of contact
   * @param contactOfContactId
   * @param relationshipId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.updateContactOfContactRelationship = function (contactOfContactId, relationshipId, data, options, callback) {
    helpers.updatePersonRelationship(
      contactOfContactId,
      relationshipId,
      'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
      data,
      options,
      callback
    );
  };

  /**
   * Delete a relation for a contact of contact
   * @param contactOfContactId
   * @param relationshipId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteContactOfContactRelationship = function (contactOfContactId, relationshipId, options, callback) {
    helpers.deletePersonRelationship(
      contactOfContactId,
      relationshipId,
      options,
      callback
    );
  };

  /**
   * Count relations for a contact of contact
   * @param contactOfContactId
   * @param where
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationships = function (contactOfContactId, where, callback) {
    app.models.contactOfContact
      .findById(contactOfContactId)
      .then((contact) => {
        if (!contact) {
          return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contactOfContact.modelName,
            id: contactOfContactId
          }));
        }
        helpers.countPersonRelationships(contactOfContactId, where, callback);
      })
      .catch(callback);
  };

  /**
   * Find relationship contacts for a contact of contact. Relationship contacts are the relationships where the contact of contact is a source (it has nothing to do with person type contact)
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactOfContactRelationshipContacts = function (contactOfContactId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipContacts(this.id, contactOfContactId, filter)
      .then(function (contactsOfContacts) {
        callback(null, contactsOfContacts);
      })
      .catch(callback);
  };

  /**
   * Count relationship contacts for a contact. Relationship contacts are the relationships where the contact is a source (it has nothing to do with person type contact)
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationshipContacts = function (contactOfContactId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipContacts(this.id, contactOfContactId, filter)
      .then(function (contactsOfContacts) {
        callback(null, contactsOfContacts);
      })
      .catch(callback);
  };


  /**
   * Find relationship exposures for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.findContactOfContactRelationshipExposures = function (contactOfContactId, filter, callback) {
    app.models.relationship
      .findPersonRelationshipExposures(this.id, contactOfContactId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Count relationship exposures for a contact of contact
   * @param contactOfContactId
   * @param filter
   * @param callback
   */
  Outbreak.prototype.countContactOfContactRelationshipExposures = function (contactOfContactId, filter, callback) {
    app.models.relationship
      .countPersonRelationshipExposures(this.id, contactOfContactId, filter)
      .then(function (exposures) {
        callback(null, exposures);
      })
      .catch(callback);
  };

  /**
   * Generate (next available) contact of contact visual id
   * @param visualIdMask
   * @param personId
   * @param callback
   */
  Outbreak.prototype.generateContactOfContactVisualId = function (visualIdMask, personId, callback) {
    Outbreak.helpers.validateOrGetAvailableContactOfContactVisualId(this, visualIdMask, personId)
      .then(function (visualId) {
        callback(null, visualId);
      })
      .catch(callback);
  };

  /**
   * Restore a deleted contact of contact
   * @param contactOfContactId
   * @param options
   * @param callback
   */
  Outbreak.prototype.restoreContactOfContact = function (contactOfContactId, options, callback) {
    app.models.contactOfContact
      .findOne({
        deleted: true,
        where: {
          id: contactOfContactId,
          deleted: true
        }
      })
      .then(function (instance) {
        if (!instance) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contactOfContact.modelName,
            id: contactOfContactId
          });
        }

        // undo delete
        instance.undoDelete(options, callback);
      })
      .catch(callback);
  };

  /**
   * Get movement for a contact of contact
   * Movement: list of addresses that contain geoLocation information, sorted from the oldest to newest based on date.
   * Empty date is treated as the most recent
   * @param contactOfContactId
   * @param callback
   */
  Outbreak.prototype.getContactOfContactMovement = function (contactOfContactId, callback) {
    app.models.contactOfContact
      .findOne({
        where: {
          id: contactOfContactId,
          outbreakId: this.id
        }
      })
      .then(record => {
        if (!record) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contactOfContact.modelName,
            id: contactOfContactId
          });
        }
        return record.getMovement().then(movement => callback(null, movement));
      })
      .catch(callback);
  };

  /**
   * Bulk modify contacts of contacts
   * @param records
   * @param options
   * @param callback
   */
  Outbreak.prototype.bulkModifyContactsOfContacts = function (records, options, callback) {
    Outbreak.modifyMultipleContacts(records, true, options)
      .then((results) => callback(null, results))
      .catch(callback);
  };

  /**
   * Create multiple contacts of contacts for a contact
   * @param contactId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.createContactMultipleContactsOfContacts = function (contactId, data, options, callback) {
    Outbreak.createContactMultipleContactsOfContacts(this, contactId, data, options, callback);
  };

  /**
   * Update a contact's follow-ups or a case that was contact
   * @param personId
   * @param followUpId
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.prototype.modifyContactFollowUp = function (personId, followUpId, data, options, callback) {
    const outbreakId = this.id;
    data = data || {};

    // make sure person is either a contact or was a contact
    app.models.person
      .findOne({
        where: {
          id: personId,
          outbreakId: outbreakId,
          or: [
            {
              type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
            },
            {
              wasContact: true
            }
          ]
        }
      })
      .then((contact) => {
        if (!contact) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: personId
          });
        }

        // find the desired follow-up and modify it
        return app.models.followUp
          .findOne({
            where: {
              id: followUpId,
              outbreakId: outbreakId,
              personId: personId
            }
          })
          .then((followUp) => {
            if (!followUp) {
              throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
                model: app.models.followUp.modelName,
                id: followUpId
              });
            }

            return followUp
              .updateAttributes(data, options)
              .then(updatedFollowUp => callback(null, updatedFollowUp));
          });
      })
      .catch(callback);
  };

  /**
   *
   * @param personId
   * @param followUpId
   * @param options
   * @param callback
   */
  Outbreak.prototype.deleteContactFollowUp = function (personId, followUpId, options, callback) {
    const outbreakId = this.id;

    // make sure person is either a contact or was a contact
    app.models.person
      .findOne({
        where: {
          id: personId,
          outbreakId: outbreakId,
          or: [
            {
              type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT'
            },
            {
              wasContact: true
            }
          ]
        }
      })
      .then((contact) => {
        if (!contact) {
          throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
            model: app.models.contact.modelName,
            id: personId
          });
        }

        // find the desired follow-up and modify it
        return app.models.followUp
          .findOne({
            where: {
              id: followUpId,
              outbreakId: outbreakId,
              personId: personId
            }
          })
          .then((followUp) => {
            if (!followUp) {
              throw app.utils.apiError.getError('MODEL_NOT_FOUND', {
                model: app.models.followUp.modelName,
                id: followUpId
              });
            }

            return followUp
              .destroy(options)
              .then(() => callback());
          });
      })
      .catch(callback);
  };

  /**
   * Get all records marked as not duplicates for a specific record
   * @param contactId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getContactMarkedAsNotDuplicates = function (contactId, filter = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        contactId,
        filter
      )
      .then((markedAsNotDuplicates) => callback(null, markedAsNotDuplicates))
      .catch(callback);
  };

  /**
   * Count records marked as not duplicates for a specific record
   * @param contactOfContactId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getContactMarkedAsNotDuplicatesCount = function (contactId, where = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        contactId, {
          where: where
        },
        true
      )
      .then((counted) => callback(null, counted))
      .catch(callback);
  };

  /**
   * Change contact duplicates
   */
  Outbreak.prototype.contactMarkPersonAsOrNotADuplicate = function (contactId, data, options, callback) {
    data = data || {};
    app.models.person
      .markAsOrNotADuplicate(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
        contactId,
        data.addRecords,
        data.removeRecords
      )
      .then((finalNotDuplicates) => {
        callback(null, finalNotDuplicates);
      })
      .catch(callback);
  };

  /**
   * Get all records marked as not duplicates for a specific record
   * @param caseId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getCaseMarkedAsNotDuplicates = function (caseId, filter = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        caseId,
        filter
      )
      .then((markedAsNotDuplicates) => callback(null, markedAsNotDuplicates))
      .catch(callback);
  };

  /**
   * Count records marked as not duplicates for a specific record
   * @param caseId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getCaseMarkedAsNotDuplicatesCount = function (caseId, where = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        caseId, {
          where: where
        },
        true
      )
      .then((counted) => callback(null, counted))
      .catch(callback);
  };

  /**
   * Change case duplicates
   */
  Outbreak.prototype.caseMarkPersonAsOrNotADuplicate = function (caseId, data, options, callback) {
    data = data || {};
    app.models.person
      .markAsOrNotADuplicate(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
        caseId,
        data.addRecords,
        data.removeRecords
      )
      .then((finalNotDuplicates) => {
        callback(null, finalNotDuplicates);
      })
      .catch(callback);
  };

  /**
   * Get all records marked as not duplicates for a specific record
   * @param contactOfContactId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getContactOfContactMarkedAsNotDuplicates = function (contactOfContactId, filter = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        contactOfContactId,
        filter
      )
      .then((markedAsNotDuplicates) => callback(null, markedAsNotDuplicates))
      .catch(callback);
  };

  /**
   * Count records marked as not duplicates for a specific record
   * @param contactOfContactId
   * @param filter pagination props (skip, limit)
   * @param callback
   */
  Outbreak.prototype.getContactOfContactMarkedAsNotDuplicatesCount = function (contactOfContactId, where = {}, callback) {
    app.models.person
      .findMarkedAsNotDuplicates(
        this.id,
        contactOfContactId, {
          where: where
        },
        true
      )
      .then((counted) => callback(null, counted))
      .catch(callback);
  };

  /**
   * Change contact of contact duplicates
   */
  Outbreak.prototype.contactOfContactMarkPersonAsOrNotADuplicate = function (contactOfContactId, data, options, callback) {
    data = data || {};
    app.models.person
      .markAsOrNotADuplicate(
        options,
        this.id,
        'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT_OF_CONTACT',
        contactOfContactId,
        data.addRecords,
        data.removeRecords
      )
      .then((finalNotDuplicates) => {
        callback(null, finalNotDuplicates);
      })
      .catch(callback);
  };

  /**
   * Returns export fields groups for a model
   * @param modelName
   * @param callback
   */
  Outbreak.exportFieldsGroup = function (modelName, callback) {
    // return the export fields groups of the model
    const items =
      app.models &&
      app.models[modelName] &&
      app.models[modelName].exportFieldsGroup ?
        app.models[modelName].exportFieldsGroup :
        {};

    return callback(null, items);
  };

  /**
   * [MOCKUP] Request to be used for checking connection in Pandem2
   * Count cases and contacts reached for follow-up
   * @param data
   * @param options
   * @param callback
   */
  Outbreak.countCasesContactsReached = function (data = {}, options, callback) {
    // for real data we should get the outbreaks for the given disease
    // and count cases/contacts that were followed-up in those outbreaks
    const missingProps = ['startDate', 'endDate', 'pathogen', 'locationCode'].filter(prop => !data[prop]);
    if (missingProps.length) {
      return callback(app.utils.apiError.getError('REQUEST_VALIDATION_ERROR', {
        errorMessages: `Missing required properties: ${missingProps.join(', ')}`
      }));
    }
    const { startDate, endDate, pathogen, locationCode } = data;

    const range = localizationHelper.getRange(startDate, endDate);

    // props to be filled
    const indicators = {
      case: [
        'noIdentified',
        'noIdentifiedAndReached',
        'noIdentifiedAndReached1day',
        'noFromContacts',
      ],
      contact: [
        'noIdentified',
        'noIdentifiedAndReached',
        'noIdentifiedAndReached1day'
      ]
    };

    // generate random data
    const result = {
      pathogen,
      locationCode,
      caseData: {},
      contactData: {}
    };

    for (const currentDate of range.by('day')) {
      const dateFormated = currentDate.toISOString();

      ['case', 'contact'].forEach(prop => {
        const resourceResult = {};
        indicators[prop].forEach((indicator, index) => {
          resourceResult[indicator] = index === 0 ?
            Math.floor(Math.random() * (100 + 1)) :
            Math.floor(Math.random() * (resourceResult[indicators[prop][index - 1]] + 1));
        });

        result[prop + 'Data'][dateFormated] = resourceResult;
      });
    }

    return callback(null, result);
  };
};
