'use strict';

const app = require('../server');
const _ = require('lodash');
const localizationHelper = require('../../components/localizationHelper');

// default obfuscate fields
const obfuscateDefault = {
  password: true
};
const obfuscateAccessToken = Object.assign(
  {}, {
    id: true
  },
  obfuscateDefault
);
const obfuscateUser = Object.assign(
  {}, {
    securityQuestions: true
  },
  obfuscateDefault
);

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
  return ['createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'dbUpdatedAt', 'deleted', 'deletedAt'].indexOf(field) === -1;
}

/**
 * Check if a model is monitored for logging
 * @param model
 * @returns {boolean}
 */
function isMonitoredModel(model) {
  return ['auditLog', 'extendedPersistedModel', 'person'].indexOf(model.modelName) === -1;
}

/**
 * Check if we need to obfuscate a field
 * @param field
 * @param model
 * @param value Original value
 * @param obfuscateString Obfuscate string (default '***')
 * @param compareValue Used to determine if something changed for arrays / objects
 * @param compareValueSameObfuscateString Same value obfuscate string
 * @returns {string} The value (obfuscated or not depending of the rules)
 */
function obfuscateFieldValue(
  field,
  model,
  value,
  obfuscateString = '***',
  compareValue = undefined,
  compareValueSameObfuscateString = '***'
) {
  const modelName = model ? model.modelName : null;
  switch (modelName) {
    // access token
    case app.models.accessToken.modelName:
      // access token specific fields
      return obfuscateAccessToken[field] ? obfuscateString : value;

    // system settings
    case app.models.systemSettings.modelName:
      // system settings specific fields
      if (
        field === 'clientApplications' &&
        value &&
        value.length > 0
      ) {
        // clone so we don't alter the original one and replace critical keys
        value = JSON.parse(JSON.stringify(value));
        value.forEach((item, index) => {
          // no credentials ?
          if (!item.credentials) {
            return;
          }

          // client secret
          if (item.credentials.clientSecret) {
            if (
              compareValue &&
              compareValue[index] &&
              compareValue[index].credentials &&
              compareValue[index].credentials.clientSecret &&
              compareValue[index].credentials.clientSecret === item.credentials.clientSecret
            ) {
              item.credentials.clientSecret = compareValueSameObfuscateString;
            } else {
              item.credentials.clientSecret = obfuscateString;
            }
          }
        });
      }

      // finished
      return value;

    // user
    case app.models.user.modelName:
      // security questions
      // password
      return obfuscateUser[field] ? obfuscateString : value;

    // remaining models
    default:
      return obfuscateDefault[field] ? obfuscateString : value;
  }
}


/**
 * Check if an action is monitored for logging
 * @param context
 * @returns {boolean}
 */
function isMonitoredAction(context) {
  // init actions are not monitored
  return !_.get(context, 'options._init', false);
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
      role: loggedInUser && loggedInUser.roles ? loggedInUser.roles.reduce((rolesStr, role) => rolesStr += `${role.name} `, '') : 'unavailable'
    };
  }

  if (isMonitoredModel(Model)) {
    /**
     * Store changed fields (if any) before the model is saved
     */
    Model.observe('before save', function (context, callback) {
      let changedFields = [];
      if (isMonitoredAction(context)) {
        if (context.data) {
          if (context.currentInstance) {
            Object.keys(context.data).forEach(function (field) {
              if (
                isMonitoredField(field) &&
                context.data[field] !== undefined &&
                !_.isEqual(
                  context.currentInstance[field] && context.currentInstance[field].toJSON ? context.currentInstance[field].toJSON() : context.currentInstance[field],
                  context.data[field] && context.data[field].toJSON ? context.data[field].toJSON() : context.data[field]
                )
              ) {
                // parse new value as for Moment instances Loopback doesn't parse them to date
                let newValue = _.cloneDeepWith(context.data[field], function (value) {
                  if (localizationHelper.isInstanceOfMoment(value)) {
                    return value.toDate();
                  }
                });

                changedFields.push({
                  field: field,
                  oldValue: obfuscateFieldValue(
                    field,
                    Model,
                    context.currentInstance[field]
                  ),
                  newValue: obfuscateFieldValue(
                    field,
                    Model,
                    newValue,
                    '*****',
                    context.currentInstance[field]
                  )
                });
              }
            });
          }
        }
        context.options.changedFields = changedFields;
      }
      callback();
    });

    /**
     * Log changed fields after the model is saved
     */
    Model.observe('after save', function (context, callback) {
      // check if current action is monitored by audit log
      if (isMonitoredAction(context)) {

        const user = getUserContextInformation(context);

        // for new instances log everything
        if (context.isNewInstance) {
          let logData = {
            action: app.models.auditLog.actions.created,
            modelName: Model.modelName,
            userId: user.id,
            userRole: user.role,
            userIPAddress: user.iPAddress,
            changedData: []
          };
          let instanceData = context.instance.toJSON();
          // add record id
          logData.recordId = obfuscateFieldValue(
            'id',
            Model,
            context.instance.id
          );

          // add changes
          Object.keys(instanceData).forEach(function (field) {
            if (isMonitoredField(field) && instanceData[field] !== undefined) {
              logData.changedData.push({
                field: field,
                newValue: obfuscateFieldValue(
                  field,
                  Model,
                  instanceData[field]
                )
              });
            }
          });
          app.models.auditLog
            .create(logData, context.options)
            .catch(function (error) {
              // just log the error
              app.logger.log(error);
            });
        } else {
          // for updated records, log only what was changed
          if (context.options.changedFields && context.options.changedFields.length) {
            let logData = {
              action: app.models.auditLog.actions.modified,
              modelName: Model.modelName,
              recordId: obfuscateFieldValue(
                'id',
                Model,
                context.instance.id
              ),
              userId: user.id,
              userRole: user.role,
              userIPAddress: user.iPAddress,
              changedData: context.options.changedFields
            };
            app.models.auditLog
              .create(logData, context.options)
              .catch(function (error) {
                // just log the error
                app.logger.log(error);
              });

          }
        }
      }
      // call the callback without waiting for the audit log changes to be persisted
      callback();
    });

    /**
     * Store instance before it's deleted
     */
    Model.observe('before delete', function (context, callback) {
      // check if current action is monitored by audit log
      if (isMonitoredAction(context) && context.where.id) {
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
      // check if current action is monitored by audit log
      if (isMonitoredAction(context) && context.options.deletedInstance) {
        const user = getUserContextInformation(context);
        let logData = {
          action: app.models.auditLog.actions.removed,
          modelName: Model.modelName,
          recordId: obfuscateFieldValue(
            'id',
            Model,
            context.options.deletedInstance.id
          ),
          userId: user.id,
          userRole: user.role,
          userIPAddress: user.iPAddress,
          changedData: []
        };
        Object.keys(context.options.deletedInstance).forEach(function (field) {
          if (context.options.deletedInstance[field] !== undefined) {
            logData.changedData.push({
              field: field,
              oldValue: obfuscateFieldValue(
                field,
                Model,
                context.options.deletedInstance[field]
              )
            });
          }
        });
        app.models.auditLog
          .create(logData, context.options)
          .catch(function (error) {
            // just log the error
            app.logger.log(error);
          });
        // call the callback without waiting for the audit log changes to be persisted
        callback();
      } else {
        callback();
      }
    });

    /**
     * Log restored instances after the model is restored
     */
    Model.observe('after restore', function (context, callback) {
      // check if current action is monitored by audit log
      if (isMonitoredAction(context)) {
        const user = getUserContextInformation(context);
        let logData = {
          action: app.models.auditLog.actions.restored,
          modelName: Model.modelName,
          userId: user.id,
          userRole: user.role,
          userIPAddress: user.iPAddress,
          changedData: []
        };
        let instance = context.instance;
        if (instance.toJSON) {
          instance = instance.toJSON();
        }
        // add record id
        logData.recordId = obfuscateFieldValue(
          'id',
          Model,
          instance.id
        );

        // add changes
        Object.keys(instance).forEach(function (field) {
          if (isMonitoredField(field) && instance[field] !== undefined) {
            logData.changedData.push({
              field: field,
              newValue: obfuscateFieldValue(
                field,
                Model,
                instance[field]
              )
            });
          }
        });
        app.models.auditLog
          .create(logData, context.options)
          .catch(function (error) {
            // just log the error
            app.logger.log(error);
          });
      }
      // call the callback without waiting for the audit log changes to be persisted
      callback();
    });
  }
};
