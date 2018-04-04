'use strict';

const disableCommonExtraRoutes = require('../../components/disableCommonExtraRoutes');

module.exports = function (app) {
  /*
   * The `app` object provides access to a variety of LoopBack resources such as
   * models (e.g. `app.models.YourModelName`) or data sources (e.g.
   * `app.datasources.YourDataSource`). See
   * http://docs.strongloop.com/display/public/LB/Working+with+LoopBack+objects
   * for more info.
   */

  app.models().forEach(function (Model) {
    app.utils.remote.disableCommonExtraRoutes(Model)
  });
};
