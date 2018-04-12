'use strict';

const app = require('../../server/server');

module.exports = function (Role) {

  Role.availablePermissions = {
    read_sys_config: 'Read System Configuration',
    write_sys_config: 'Write System Configuration',
    read_user_account: 'Read User Account',
    write_user_account: 'Write User Account',
    read_role: 'Read Role',
    write_role: 'Write Role',
    read_outbreak: 'Read Outbreak',
    write_outbreak: 'Write Outbreak',
    read_team: 'Read Team',
    write_team: 'Write Team',
    read_report: 'Read Report',
    read_case: 'Read Case',
    write_own_case: 'Write Own Case',
    write_case: 'Write Case',
    read_contact: 'Read Contact',
    write_own_contact: 'Write Own Contact',
    write_contact: 'Write Contact',
    read_followup: 'Read Follow-up',
    write_followup: 'Write Follow-up'
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
