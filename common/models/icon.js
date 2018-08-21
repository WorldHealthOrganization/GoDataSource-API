'use strict';

const Jimp = require('jimp');
const uuid = require('uuid');
const app = require('../../server/server');


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

};
