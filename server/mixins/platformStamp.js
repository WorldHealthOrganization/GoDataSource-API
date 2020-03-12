'use strict';

// deps
const Platform = require('../../components/platform');

/**
 * Add createdOn/updatedOn properties
 * @param Model
 */
module.exports = function (Model) {

  Model.defineProperty('createdOn', {
    type: 'string',
    readOnly: true,
    safeForImport: true
  });

  Model.observe('before save', function (context, next) {
    // get platform identifier from context
    // if not found there, then take it directly from request headers
    // if its missing here still, default to API
    context.options = context.options || {};
    let platformId = Platform.API;
    if (context.options.platform) {
      platformId = context.options.platform;
    }
    if (context.options.remotingContext && context.options.remotingContext.req) {
      let platformHeader = context.options.remotingContext.req.headers['platform'];
      if (platformHeader) {
        platformHeader = platformHeader.toUpperCase();
        if (Platform[platformHeader]) {
          platformId = Platform[platformHeader];
        }
      }
    }

    if (context.instance) {
      if (context.isNewInstance) {
        if (context.options._sync) {
          if (!context.instance.createdOn) {
            context.instance.createdOn = platformId === Platform.API ? Platform.SYNC : platformId;
          }
        } else {
          context.instance.createdOn = platformId;
        }
      }
    }

    return next();
  });
};
