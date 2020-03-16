'use strict';

const MongoClient = require('mongodb').MongoClient;
const dbConfig = require('./../server/datasources').mongoDb;

/**
 * Create MongoDB connection and return it
 * @returns {Promise<Db | never>}
 */
function getMongoDBConnection(mongoOptions = {}) {
  if (dbConfig.password) {
    mongoOptions = Object.assign(mongoOptions, {
      auth: {
        user: dbConfig.user,
        password: dbConfig.password
      },
      authSource: dbConfig.authSource
    });
  }
  return MongoClient
    .connect(`mongodb://${dbConfig.host}:${dbConfig.port}`, mongoOptions)
    .then(function (client) {
      return client
        .db(dbConfig.database);
    });
}

module.exports = {
  getMongoDBConnection
};

