'use strict';

let qrImage = require("qr-image");
const TYPES = {
  RESOURCE_LINK: 'resource-link'
};

/**
 * Create a QR Resource Link
 * @param resourceName
 * @param contextInfo
 */
function createResourceLink(resourceName, contextInfo) {
  let encodedResource = {
    type: TYPES.RESOURCE_LINK,
    targetResource: resourceName,
    resourceContext: contextInfo
  };
  return qrImage.imageSync(JSON.stringify(encodedResource));
}

module.exports = {
  createResourceLink: createResourceLink
};
