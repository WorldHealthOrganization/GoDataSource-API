'use strict';

let qrImage = require('qr-image');
let uuid = require('uuid');

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

/**
 * Add a QR code and additional information to a person export file
 * @param qrCode
 * @param document
 * @param person
 */
function addPersonQRCode(document, outbreakId, personType, person) {
  // Cache initial cursor position
  let initialXPosition = document.x;
  let initialYPosition = document.y;
  let qrCode = {};

  // Generate the QR code and add it to the page, together with some extra
  // details for either an existing or a new person
  if (person) {
    qrCode = createResourceLink(personType, {
      outbreakId: outbreakId,
      [`${personType}Id`]: person.id
    });

    document.image(qrCode, 465, 15, {width: 100, height: 100});
    document.text(`${person.id}`, 420, 115, {align: 'right'});
    document.text(`${person.firstName || ''} ${person.middleName || ''} ${person.lastName || ''}`, {align: 'right'});
  } else {
    let newId = uuid.v4();

    qrCode = createResourceLink(personType, {
      outbreakId: outbreakId,
      [`${personType}Id`]: newId
    });

    document.image(qrCode, 465, 15, {width: 100, height: 100});
    document.text(newId, 420, 115, {align: 'right'});
    document.text('_ '.repeat(52), {align: 'right'});
  }

  // Reset cursor position
  document.x = initialXPosition;
  document.y = initialYPosition;
}

module.exports = {
  createResourceLink: createResourceLink,
  addPersonQRCode: addPersonQRCode
};
