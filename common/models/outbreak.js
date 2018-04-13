'use strict';

const app = require('../../server/server');

module.exports = function (Outbreak) {

  Outbreak.availableDateFormats = {
    'dd-mm-yyyy': 'dd-mm-yyyy',
    'yyyy-mm-dd': 'yyyy-mm-dd',
    'mm/dd/yyyy': 'mm/dd/yyyy',
    'mm-dd-yyyy': 'mm-dd-yyyy'
  };

  /**
   * Do not allow deletion of a active Outbreak
   */
  Outbreak.beforeRemote('deleteById', function (context, modelInstance, next) {
    Outbreak.findById(context.args.id)
      .then(function (outbreak) {
        if (outbreak && outbreak.active) {
          next(app.utils.apiError.getError('DELETE_ACTIVE_OUTBREAK', {id: context.args.id}, 422));
        } else {
          next();
        }
      })
      .catch(next);
  });

  /**
   * Allow only one active outbreak
   * @param context
   * @param instanceId
   * @param next
   */
  function validateActiveOutbreak(context, instanceId, next) {
    if (context.args.data.active) {
      const query = {
        active: true
      };
      // if existing instance, make sure its excluded from search
      if (instanceId) {
        query.id = {
          neq: instanceId
        };
      }
      Outbreak
        .findOne({where: query})
        .then(function (activeOutbreak) {
          if (activeOutbreak) {
            return next(app.utils.apiError.getError('ONE_ACTIVE_OUTBREAK', {id: activeOutbreak.id}, 422));
          }
          next();
        })
        .catch(next);
    } else {
      next();
    }
  }

  /**
   * Allow only one active outbreak on create
   */
  Outbreak.beforeRemote('create', function (context, modelInstance, next) {
    validateActiveOutbreak(context, true, next);
  });

  /**
   * Allow only one active outbreak on update
   */
  Outbreak.beforeRemote('prototype.patchAttributes', function (context, modelInstance, next) {
    validateActiveOutbreak(context, context.instance.id, next);
  });

  /**
   * Get available date formats
   * @param callback
   */
  Outbreak.getAvailableDateFormats = function (callback) {
    callback(null, Outbreak.availableDateFormats);
  };
};
