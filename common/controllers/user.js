'use strict';

const app = require('../../server/server');
const _ = require('lodash');

module.exports = function (User) {

  // get model helpers
  const helpers = User.helpers;

  // disable access to access tokens
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'accessTokens');
  // disable access to role
  app.utils.remote.disableStandardRelationRemoteMethods(User, 'role');
  // disable email verification, confirm endpoints
  app.utils.remote.disableRemoteMethods(User, ['prototype.verify', 'confirm']);

  /**
   * Do not allow deletion own user or the last user
   */
  User.beforeRemote('deleteById', function (context, modelInstance, next) {
    if (context.args.id === context.req.authData.user.id) {
      return next(app.utils.apiError.getError('DELETE_OWN_RECORD', {model: 'Role', id: context.args.id}, 403));
    }
    User.count()
      .then(function (userCount) {
        if (userCount < 2) {
          next(app.utils.apiError.getError('DELETE_LAST_USER', {}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * User cannot change its own role or location +
   * Validate user password
   */
  User.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    if (context.instance.id === context.req.authData.user.id) {
      delete context.args.data.roleId;
      delete context.args.data.locationIds;
    }
    // validate password (if any)
    helpers.validatePassword(context.args.data.password, next);
  });

  /**
   * Validate user password
   */
  User.beforeRemote('create', function (context, modelInstance, next) {
    // validate password (if any)
    helpers.validatePassword(context.args.data.password, next);
  });

  /**
   * Validate user password
   */
  User.beforeRemote('changePassword', function (context, modelInstance, next) {
    // validate password (if any)
    helpers.validatePassword(context.args.newPassword, next);
  });

  /**
   * Filter results by related model properties
   * Applying a filter on related model properties Loopback only filters the related model inclusion in the result
   * This hook removes from the result the items that don't contain the filtered related model
   * eg filter: {
        "include": [
          {
            "relation": "role",
            "scope": {"where": {"name": "System Administrator"}}
          },
          {
            "relation": "accessTokens"
          }
        ]
      }
   * Based on the above example the hook removes the entries that don't contain the embedded role model (this is already filtered by Loopback)
   */
  User.afterRemote('find', function (context, models, next) {
    // check for include filter
    let includeFilter = _.get(context, 'args.filter.include', []);
    // normalize the include filter as an array
    includeFilter = Array.isArray(includeFilter) ? includeFilter : [includeFilter];

    // get from the include filter the properties that need to be checked for each item in the result; these are the 'relation' values from each item in the includeFilter that has a scope.where clause
    let props = [];
    props = includeFilter.map(function (rel) {
      return rel.scope && rel.scope.where ? rel.relation : null;
    }).filter(function (rel) {
      return rel !== null;
    });

    // initialize the new results list
    let results = [];

    // check is there are properties to be checked in each model instance
    if (props.length) {
      // get from the models list only the ones that contain all the props
      results = models.filter(function (model) {
        model = model.toJSON();
        return props.filter(function (prop) {
          return !!model[prop];
        }).length === props.length;
      });
    } else {
      results = models;
    }

    // overwrite the found results
    context.result = results;

    next();
  })
};
