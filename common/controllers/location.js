'use strict';

const app = require('../../server/server');

module.exports = function (Location) {

  Location.beforeRemote("create", function (context, modelInstance, next) {
    Location.validateModelIdentifiers(context.args.data)
      .then(() => {
        next();
      })
      .catch(next);
  });

  Location.beforeRemote("prototype.patchAttributes", function (context, modelInstance, next) {
    Location.validateModelIdentifiers(context.args.data, context.instance.id)
      .then(() => {
        return Location.checkIfCanDeactivate(context.args.data, context.instance.id);
      })
      .then(() => {
        next();
      })
      .catch((error) => {
        next(error);
      });
  });

  Location.beforeRemote("deleteById", function(context, modelInstance, next) {
    Location.checkIfCanDelete(context.args.id)
      .then(() => {
        next();
      })
      .catch(next);
  })
};
