"use strict";
// This script creates a partial unique index on the 'code' field of the 'referenceData' collection
// in MongoDB, ensuring that the index only applies to documents where 'deleted' is false
module.exports = function (app) {
  const ds = app.dataSources.mongoDb; // mimic mongoDb naming

  // Ensure partial unique index on 'code' (only for deleted=false)
  ds.once("connected", () => {
    const coll = ds.connector.collection("referenceData");

    // Drop old global index on 'code' if it exists
    coll.dropIndex("code_1", (dropErr) => {
      if (dropErr && dropErr.codeName !== "IndexNotFound") {
        app.logger.error(
          `[PartialIndex] Failed to drop old index 'code_1': ${dropErr.message}`
        );
      }

      // Create partial unique index enforcing uniqueness when deleted=false
      // and code is not null
      // This is a workaround for MongoDB's limitation on unique indexes on fields that can be null
      // See: https://www.mongodb.com/docs/manual/core/index-compound/#partial-indexes
      // and https://www.mongodb.com/docs/manual/core/index-unique/#unique-indexes
      coll.createIndex(
        { code: 1 },
        {
          unique: true,
          partialFilterExpression: {
            deleted: { $eq: false },
            code: { $gt: '' }
          },
        },
        (createErr, result) => {
          if (createErr) {
            app.logger.error(
              `[PartialIndex] Failed to create partial unique index on 'code': ${createErr.message}`
            );
          } else {
            app.logger.info(
              `[PartialIndex] Partial unique index on 'code' created: ${result}`
            );
          }
        }
      );
    });
  });
};