'use strict';

module.exports = function (model, methods) {
  methods.forEach(function (method) {
    model.disableRemoteMethodByName(method);
  });
};
