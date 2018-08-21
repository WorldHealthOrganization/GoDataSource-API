'use strict';

const disableRemoteMethods = require('./disableRemoteMethods');

module.exports = function (model) {
  disableRemoteMethods(model,
    [
      'upsert',
      'findOne',
      'exists',
      'updateAll',
      'replaceById',
      'upsertWithWhere',
      'replaceOrCreate',
      'createChangeStream'
    ]
  );
};
