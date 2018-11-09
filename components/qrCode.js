'use strict';

let qrImage = require('qr-image');

const TYPES = {
  RESOURCE_LINK: 'resource-link'
};

/**
 * Encode JSON data in QR image
 * @param data
 */
function encodeDataInQr(data) {
  return qrImage.imageSync(JSON.stringify(data));
}

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
  return encodeDataInQr(encodedResource);
}

/**
 * Add a QR code and additional information to a person export file
 * @param document
 * @param outbreakId
 * @param personType
 * @param identifier
 */
function addPersonQRCode(document, outbreakId, personType, identifier) {
  // Cache initial cursor position
  let initialXPosition = document.x;
  let initialYPosition = document.y;
  let qrCode = {};

  // Generate the QR code and add it to the page, together with some extra
  // details for either an existing or a new person
  if (identifier && typeof(identifier) === 'object') {
    qrCode = createResourceLink(personType, {
      outbreakId: outbreakId,
      [`${personType}Id`]: identifier.id
    });

    document.image(qrCode, 465, 15, {width: 100, height: 100});
    document.text(`${identifier.id}`, 420, 115, {align: 'right'});
    document.text(`${identifier.firstName || ''} ${identifier.middleName || ''} ${identifier.lastName || ''}`, {align: 'right'});
  } else {
    qrCode = createResourceLink(personType, {
      outbreakId: outbreakId,
      [`${personType}Id`]: identifier
    });

    document.image(qrCode, 465, 15, {width: 100, height: 100});
    document.text(identifier, 420, 115, {align: 'right'});
    document.text('_ '.repeat(52), {align: 'right'});
  }

  // Reset cursor position
  document.x = initialXPosition;
  document.y = initialYPosition;
}

module.exports = {
  createResourceLink: createResourceLink,
  addPersonQRCode: addPersonQRCode,
  encodeDataInQr: encodeDataInQr
};
