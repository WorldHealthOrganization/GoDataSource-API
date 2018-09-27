'use strict';

const Jimp = require('jimp');
const uuid = require('uuid');
const app = require('../../server/server');
const helpers = require('../../components/helpers');

module.exports = function (Icon) {

  /**
   * Save an icon on the disk
   * @param filePath
   * @return {Promise<any>}
   */
  Icon.saveOnDisk = function (filePath) {
    return new Promise(function (resolve, reject) {
      // the icon should be at most 50px on the biggest side
      Jimp.read(filePath)
        .then(function (image) {
          // resize width to 50px, preserve ratio
          let resizeParams = [50, Jimp.AUTO];
          // if the height is bigger than the width
          if (image.bitmap.width < image.bitmap.height) {
            // change the height to 50px, preserve ratio
            resizeParams = resizeParams.reverse();
          }
          return image.resize(...resizeParams)
            .getBuffer(Jimp.AUTO, function (error, buffer) {
              if (error) {
                return reject(error);
              }
              return app.models.storage
                .save(app.models.storage.containers.icons, `${uuid.v4()}.${image.getExtension()}`, buffer)
                .then(resolve);
            });
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
   * @param ctx
   * @param next
   */
  Icon.observe('before delete', function (ctx, next) {
    app.models.referenceData
      .count({
        iconId: context.instance.id
      })
      .then(function (count) {
        if (count) {
          return next(app.utils.apiError.getError('MODEL_IN_USE', { model: Icon.name, id: context.instance.id }));
        }
        // store the instance that's about to be deleted to remove the resource from the disk later
        return Icon.findById(context.instance.id)
          .then(function (icon) {
            if (icon) {
              helpers.setOriginalValueInContextOptions(context, 'deletedIcon', icon.toJSON());
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
    let deletedIcon = helpers.getOriginalValueFromContextOptions(context, 'deletedIcon');
    if (deletedIcon) {
      Icon.removeFromDisk(deletedIcon.path)
        .catch(function (error) {
          // only log the error, fail silently as the DB entry was removed
          context.remotingContext.req.logger.error(error);
        });
    }
    // do not wait for disk resource removal to complete, it's irrelevant for this operation
    next();
  });
};
