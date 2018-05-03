'use strict';

const app = require('../../server/server');

module.exports = function (Role) {

  Role.availablePermissions = {
    read_sys_config: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_SYS_CONFIG',
    write_sys_config: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_SYS_CONFIG',
    read_user_account: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_USER_ACCOUNT',
    write_user_account: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_USER_ACCOUNT',
    read_role: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_ROLE',
    write_role: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_ROLE',
    read_outbreak: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_OUTBREAK',
    write_outbreak: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OUTBREAK',
    read_team: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_TEAM',
    write_team: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_TEAM',
    read_report: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_REPORT',
    write_own_case: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OWN_CASE',
    write_case: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CASE',
    read_contact: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_CONTACT',
    write_own_contact: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_OWN_CONTACT',
    write_contact: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_CONTACT',
    read_followup: 'LNG_ROLE_AVAILABLE_PERMISSIONS_READ_FOLLOW_UP',
    write_followup: 'LNG_ROLE_AVAILABLE_PERMISSIONS_WRITE_FOLLOW_UP'
  };

  // disable access to principals
  app.utils.remote.disableStandardRelationRemoteMethods(Role, 'principals');

  /**
   * Do not allow deletion of Roles that are in use
   */
  Role.beforeRemote('deleteById', function (context, modelInstance, next) {
    app.models.user
      .find({
        where: {
          roleId: context.args.id
        }
      })
      .then(function (users) {
        if (users.length) {
          next(app.utils.apiError.getError('MODEL_IN_USE', {model: 'Role', id: context.args.id}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * Do not allow modifying own role
   */
  Role.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    if (context.instance.id === context.req.authData.user.roleId) {
      return next(app.utils.apiError.getError('MODIFY_OWN_RECORD', {model: 'Role', id: context.instance.id}, 403));
    }
    next();
  });

  /**
   * Get available permissions
   * @param callback
   */
  Role.getAvailablePermissions = function (callback) {
    callback(null, Role.availablePermissions);
  };
};
