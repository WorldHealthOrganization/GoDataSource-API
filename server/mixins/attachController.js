'use strict';

const app = require('../../server/server');
const _ = require('lodash');

/**
 * Attach controller for model
 * @param Model
 */
module.exports = function (Model) {
  const modelName = Model.modelName;
  const controllerName = _.kebabCase(modelName);

  // check for controller flag
  if (Model.hasController) {
    app.logger.debug(`'Model.hasController' flag is true. Requiring controller for model ${modelName}`);

    try {
      // execute controller
      require(`${__dirname}/../../common/controllers/${controllerName}`)(Model);
      // also save it as a controller, to be semantically correct when calling controller functions
      if (!app.controllers) {
        app.controllers = [];
      }
      app.controllers[modelName] = Model;
    }
    catch (e) {
      app.logger.log('error', `Controller "${controllerName}" cannot be loaded`, e);
      // stop process as the controller for the model cannot be found
      app.logger.exitProcessAfterFlush(1);
    }
  }
};
