'use strict';

const disableRemoteMethods = require(`./disableRemoteMethods`);

module.exports = function (model, relation) {
  disableRemoteMethods(model,
    [
      `prototype.__count__${relation}`,
      `prototype.__create__${relation}`,
      `prototype.__delete__${relation}`,
      `prototype.__destroyById__${relation}`,
      `prototype.__findById__${relation}`,
      `prototype.__get__${relation}`,
      `prototype.__updateById__${relation}`,
      // belongs to
      `prototype.__update__${relation}`,
      `prototype.__destroy__${relation}`
    ]
  );
};
