'use strict';

/**
 * Check geo-restriction access
 * @param app
 */
module.exports = function (app) {
  app.remotes().phases
    .addAfter('authentication-context', 'check-geo-restrictions-access')
    .use(function (context, next) {
      const geographicRestrictions = context.req.authData.user.geographicRestrictions;
      // if geographic restrictions do not apply, skip checks
      if (!geographicRestrictions) {
        return next();
      }
      // find accessed model and it's id (if any) - monitored models: case, contact
      const match = context.req.originalUrl.match(/^\/api\/outbreaks\/[^\/]+\/(case|contact)s(?:\/([^\/?]+)|(?:$|\?))/);
      // not one of the monitored models, skip checks
      if (!match) {
        return next();
      }
      // if this is a create method
      if (!match[2] && context.req.method.toLowerCase() === 'post') {
        // and it contains a location
        if (context.args.data && context.args.data.address && context.args.data.address.locationId) {
          // location is in the allowed list of locations, allow access
          if (geographicRestrictions.indexOf(context.args.data.address.locationId) !== -1) {
            return next();
          }
          // location is not in the allowed list, deny access
          return next(app.utils.apiError.getError('GEOGRAPHIC_CREATE_RESTRICTION', {
            model: match[1],
            locationId: context.args.data.address.locationId,
            locationIds: geographicRestrictions.join('", "')
          }));
        }
        // user is not associated with a location, allow access
        return next();
      } else if (!match[2]) {
        // not a create request, but also no specific record accessed, allow access
        return next();
      }
      // try to find the model
      app.models[match[1]]
        .findById(match[2])
        .then(function (record) {
          // record not found, allow access (the action will throw 404)
          if (!record) {
            return next();
          }

          // if this is a create/modify request that uses a location not in the allowed list, deny access
          if (context.args.data && context.args.data.address && context.args.data.address.locationId && geographicRestrictions.indexOf(context.args.data.address.locationId) === -1) {
            return next(app.utils.apiError.getError('GEOGRAPHIC_MODIFY_RESTRICTION', {
              model: match[1],
              id: match[2],
              locationId: context.args.data.address.locationId,
              locationIds: geographicRestrictions.join('", "')
            }));
          }

          // if the record has a location
          if (record.address && record.address.locationId) {
            // location is in the allowed list, allow access
            if (geographicRestrictions.indexOf(record.address.locationId) !== -1) {
              return next();
            }
            // location is not in the allowed list, deny access
            return next(app.utils.apiError.getError('GEOGRAPHIC_ACCESS_RESTRICTION', {
              model: match[1],
              id: match[2],
              locationId: record.address.locationId,
              locationIds: geographicRestrictions.join('", "')
            }));
          }
          return next();
        })
        .catch(next);
    });
};
