'use strict';

const helpers = require('./helpers');

/**
 * Offer a file to be downloaded
 * @param fileBuffer
 * @param mimeType
 * @param fileName
 * @param remoteCallback
 */
function offerFileToDownload(fileBuffer, mimeType, fileName, remoteCallback) {
  remoteCallback(null, fileBuffer, mimeType, `attachment;filename=${helpers.getAsciiString(fileName)}`);
}

module.exports = {
  offerFileToDownload: offerFileToDownload
};
