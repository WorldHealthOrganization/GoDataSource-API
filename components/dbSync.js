'use strict';

// map of collections and their given corresponding collection name in database
const collectionsMap = {
  systemSettings: 'systemSettings',
  template: 'template',
  icon: 'icon',
  helpCategory: 'helpCategory',
  language: 'language',
  languageToken: 'languageToken',
  outbreak: 'outbreak',
  person: 'person',
  labResult: 'labResult',
  followUp: 'followUp',
  referenceData: 'referenceData',
  relationship: 'relationship',
  location: 'location',
  team: 'team',
  user: 'user',
  role: 'role',
  cluster: 'cluster'
};

/**
 * Sync a record of given model type with the main MongoDb database
 * Note: Deleted records are taken into consideration
 * Functionality description:
 * If no record is found or record is found and was created externally (no updateAt flag), create new record
 * If record has updateAt timestamp higher than the main database, update
 * @param model
 * @param record
 * @param done
 */
const syncRecord = function (model, record, done) {
  // check if a record with the given id exists
  model.findOne(
    {
      where: {
        id: record.id
      },
      deleted: true
    },
    (err, dbRecord) => {
      if (err) {
        return done(err);
      }

      if (!dbRecord) {
        return model.create(record, null, done);
      }

      if (dbRecord) {
        // if record was created from third parties, it might not have updated/created timestamps
        // in this case, just create a new record with new id
        if (!dbRecord.updatedAt) {
          delete record.id;
          return model.create(record, null, done);
        }

        // if updated timestamp is greater than the one in the main database, update
        // also make sure that if the record is soft deleted, it stays that way
        if (dbRecord.updatedAt.getTime() < new Date(record.updatedAt).getTime()) {
          if (dbRecord.deleted) {
            record.deleted = true;
          }
          return dbRecord.updateAttributes(record, done);
        }
      }

      return done();
    });
};

module.exports = {
  collectionsMap: collectionsMap,
  syncRecord: syncRecord
};
