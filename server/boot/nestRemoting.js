'use strict';

module.exports = function (app) {
  /*
   * The `app` object provides access to a variety of LoopBack resources such as
   * models (e.g. `app.models.YourModelName`) or data sources (e.g.
   * `app.datasources.YourDataSource`). See
   * http://docs.strongloop.com/display/public/LB/Working+with+LoopBack+objects
   * for more info.
   */

  app.models.outbreak.nestRemoting('cases');
  app.models.outbreak.nestRemoting('contacts');
  app.models.outbreak.nestRemoting('contactsOfContacts');
  app.models.outbreak.nestRemoting('clusters');
  app.models.outbreak.nestRemoting('attachments');
};
