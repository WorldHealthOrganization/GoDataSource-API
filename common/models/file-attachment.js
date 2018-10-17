'use strict';

const uuid = require('uuid');
const app = require('../../server/server');
const helpers = require('../../components/helpers');
const fs = require('fs');
const path = require('path');

module.exports = function (fileAttachment) {

  /**
   * Save a file on the disk
   * @param file
   * @return {Promise<any>}
   */
  fileAttachment.saveOnDisk = function (file) {
    return new Promise(
      function (resolve, reject) {
        fs.readFile(file.path, function (error, buffer) {
          if (error) {
            return reject(error);
          }
          return resolve(buffer);
        });
      })
      .then(function (buffer) {
        return app.models.storage
          .save(app.models.storage.containers.files, `${uuid.v4()}${path.extname(file.name)}`, buffer);
      });
  };

  /**
   * Read file from the disk
   * @param filePath
   * @return {*}
   */
  fileAttachment.readFromDisk = function (filePath) {
    return app.models.storage.read(filePath);
  };

  /**
   * Remove file from the disk
   * @param filePath
   * @return {*}
   */
  fileAttachment.removeFromDisk = function (filePath) {
    return app.models.storage.remove(filePath);
  };

  /**
   * Store deleted file data in context, we need it for cleanup in after delete hook
   * @param ctx
   * @param next
   */
  fileAttachment.observe('before delete', function (ctx, next) {
    const fileId = ctx.currentInstance.id;
    // store the instance that's about to be deleted to remove the resource from the disk later
    fileAttachment.findById(fileId)
      .then(function (file) {
        if (file) {
          helpers.setOriginalValueInContextOptions(ctx, 'deletedFile', file);
        }
        next();
      })
      .catch(next);
  });

  /**
   * After a file is deleted, also remove the resource from disk
   * @param ctx
   * @param next
   */
  fileAttachment.observe('after delete', function (ctx, next) {
    // try to get the deleted file from context
    let deletedFile = helpers.getOriginalValueFromContextOptions(ctx, 'deletedFile');
    if (deletedFile) {
      fileAttachment.removeFromDisk(deletedFile.path)
        .catch(function (error) {
          // only log the error, fail silently as the DB entry was removed
          ctx.options.remotingContext.req.logger.error(error);
        });
    }
    // do not wait for disk resource removal to complete, it's irrelevant for this operation
    next();
  });
};
