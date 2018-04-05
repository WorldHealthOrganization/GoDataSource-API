'use strict';

const app = require('../server');

/**
 * Extract request form options (if available)
 * @param options
 * @returns {*}
 */
function getRequestFromOptions(options) {
  let request;

  if (options.remotingContext && options.remotingContext.req) {
    request = options.remotingContext.req;
  }

  return request;
}

/**
 * Get logged in user from options (if available)
 * @param options
 * @returns {*}
 */
function getLoggedInUserFromOptions(options) {
  const request = getRequestFromOptions(options);
  let loggedInUser;

  if (request && request.authData) {
    loggedInUser = request.authData.user;
  }

  return loggedInUser;
}

/**
 * Extract remote address from options (if available)
 * @param options
 * @returns {string}
 */
function getRemoteAddressFromOptions(options) {
  const request = getRequestFromOptions(options);
  let remoteAddress;

  if (request) {
    remoteAddress = request.headers['x-forwarded-for'];
    if (!remoteAddress) {
      remoteAddress = request.connection.remoteAddress;
    }
  }
  return remoteAddress;
}

/**
 * Check if monitored for logging
 * @param field
 * @returns {boolean}
 */
function isMonitoredField(field) {
  return ['createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deleted'].indexOf(field) === -1;
}

/**
 * Check if a model is monitored for logging
 * @param model
 * @returns {boolean}
 */
function isMonitoredModel(model) {
  return ['auditLog', 'extendedPersistedModel'].indexOf(model.name) === -1;
}

module.exports = function (Model) {

  /**
   * Extract user information from request
   * @param context
   * @returns {{iPAddress: string, id: string, role: string}}
   */
  function getUserContextInformation(context) {
    let loggedInUser = getLoggedInUserFromOptions(context.options);
    let remoteAddress = getRemoteAddressFromOptions(context.options);

    return {
      iPAddress: remoteAddress ? remoteAddress : 'unavailable',
      id: loggedInUser ? loggedInUser.id : 'unavailable',
      role: loggedInUser ? loggedInUser.role.name : 'unavailable'
    }
  }

  if (isMonitoredModel(Model)) {
    /**
     * Store changed fields (if any) before the model is saved
     */
    Model.observe('before save', function (context, callback) {
      let changedFields = [];

      if (context.data) {
        if (context.currentInstance) {

          if (context.data.deleted && context.data.deleted != context.currentInstance.deleted) {
            context.options.deletedInstance = context.currentInstance.toJSON();
            return callback();
          }

          Object.keys(context.data).forEach(function (field) {
            if (isMonitoredField(field) && context.data[field] !== undefined && (context.currentInstance[field] !== context.data[field])) {
              changedFields.push({
                field: field,
                oldValue: context.currentInstance[field],
                newValue: context.data[field]
              });
            }
          });
        }
      }
      context.options.changedFields = changedFields;
      callback();
    });

    /**
     * Log changed fields after the model is saved
     */
    Model.observe('after save', function (context, callback) {
      const user = getUserContextInformation(context);

      // for new instances log everything
      if (context.isNewInstance) {
        let logData = {
          action: app.models.auditLog.actions.created,
          modelName: Model.name,
          userId: user.id,
          userRole: user.role,
          userIPAddress: user.iPAddress,
          changedData: []
        };
        let instanceData = context.instance.toJSON();
        Object.keys(instanceData).forEach(function (field) {
          if (isMonitoredField(field)) {
            logData.changedData.push({
              field: field,
              newValue: instanceData[field]
            });
          }
        });
        app.models.auditLog
          .create(logData);
        // call the callback without waiting for the audit log changes to be persisted
        callback();
      } else {
        // for updated records, log only what was changed
        if (context.options.changedFields && context.options.changedFields.length) {
          let logData = {
            action: app.models.auditLog.actions.modified,
            modelName: Model.name,
            userId: user.id,
            userRole: user.role,
            userIPAddress: user.iPAddress,
            changedData: context.options.changedFields
          };
          app.models.auditLog
            .create(logData);
        } else if (context.options.deletedInstance) {
          let logData = {
            action: app.models.auditLog.actions.removed,
            modelName: Model.name,
            userId: user.id,
            userRole: user.role,
            userIPAddress: user.iPAddress,
            changedData: []
          };
          Object.keys(context.options.deletedInstance).forEach(function (field) {
            logData.changedData.push({
              field: field,
              oldValue: context.options.deletedInstance[field]
            });
          });
          app.models.auditLog
            .create(logData);
        }
        // call the callback without waiting for the audit log changes to be persisted
        callback();
      }
    });

    /**
     * Store instance before it's deleted
     */
    Model.observe('before delete', function (context, callback) {
      if (context.where.id) {
        Model.findById(context.where.id)
          .then(function (instance) {
            if (instance) {
              context.options.deletedInstance = instance.toJSON();
            }
            callback();
          });
      } else {
        callback();
      }
    });

    /**
     * Log deleted instance after the model is deleted
     */
    Model.observe('after delete', function (context, callback) {
      if (context.options.deletedInstance) {
        const user = getUserContextInformation(context);
        let logData = {
          action: app.models.auditLog.actions.removed,
          modelName: Model.name,
          userId: user.id,
          userRole: user.role,
          userIPAddress: user.iPAddress,
          changedData: []
        };
        Object.keys(context.options.deletedInstance).forEach(function (field) {
          logData.changedData.push({
            field: field,
            oldValue: context.options.deletedInstance[field]
          });
        });
        app.models.auditLog
          .create(logData);
        // call the callback without waiting for the audit log changes to be persisted
        callback();
      } else {
        callback();
      }
    });
  }
};
