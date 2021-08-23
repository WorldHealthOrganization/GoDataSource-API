'use strict';

const Sharp = require('sharp');
const uuid = require('uuid');
const app = require('../../server/server');
const helpers = require('../../components/helpers');

// do not allow concurrent executions
// it uses too much memory on bigger scales (10+)
Sharp.concurrency(1);

module.exports = function (Icon) {

  /**
   * Save an icon on the disk
   * @param filePath
   * @return {Promise<any>}
   */
  Icon.saveOnDisk = function (filePath) {
    return new Promise(function (resolve, reject) {
      // the icon should be at most 50px on the biggest side
      Sharp(filePath, {
        // remove pixels limit
        limitInputPixels: false,
        // it reduces the memory footprint and increases performance on some systems
        sequentialRead: true
      })
        .resize({
          width: 50,
          height: 50,
          fit: 'inside'
        })
        .toBuffer({resolveWithObject: true})
        .then(({data, info}) => {
          return app.models.storage
            .save(app.models.storage.containers.icons, `${uuid.v4()}.${info.format}`, data)
            .then(resolve);
        })
        .catch(reject);
    });
  };

  /**
   * Read icon from the disk
   * @param filePath
   * @return {*}
   */
  Icon.readFromDisk = function (filePath) {
    return app.models.storage.read(filePath);
  };

  /**
   * Remove icon from the disk
   * @param filePath
   * @return {*}
   */
  Icon.removeFromDisk = function (filePath) {
    return app.models.storage.remove(filePath);
  };

  /**
   * Do not allow removal of items that are in use
   * Check reference data and cluster
   * @param ctx
   * @param next
   */
  Icon.observe('before delete', function (ctx, next) {
    let iconId = ctx.currentInstance.id;

    app.models.referenceData
      .count({
        iconId: iconId
      })
      .then(function (count) {
        if (count) {
          return Promise.reject(app.utils.apiError.getError('MODEL_IN_USE', {model: Icon.name, id: iconId}));
        }

        // store the instance that's about to be deleted to remove the resource from the disk later
        return Icon.findById(iconId)
          .then(function (icon) {
            if (icon) {
              helpers.setOriginalValueInContextOptions(ctx, 'deletedIcon', icon);
            }
            next();
          });
      })
      .catch(next);
  });

  /**
   * After an icon is deleted, also remove the resource from disk
   * @param ctx
   * @param next
   */
  Icon.observe('after delete', function (ctx, next) {
    // try to get the deleted icon from context
    let deletedIcon = helpers.getOriginalValueFromContextOptions(ctx, 'deletedIcon');
    if (deletedIcon) {
      Icon.removeFromDisk(deletedIcon.path)
        .catch(function (error) {
          // only log the error, fail silently as the DB entry was removed
          ctx.options.remotingContext.req.logger.error(error);
        });
    }
    // do not wait for disk resource removal to complete, it's irrelevant for this operation
    next();
  });
};
