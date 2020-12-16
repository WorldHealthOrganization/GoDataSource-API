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
 * @param opts
 */
function addPersonQRCode(document, outbreakId, personType, identifier, opts) {
  // Cache initial cursor position
  let initialXPosition = document.x;
  let initialYPosition = document.y;
  let qrCode = {};

  // options defensive checks and defaults
  opts = opts || {};

  opts.imageSize = opts.imageSize || {};
  opts.imageSize.width = opts.imageSize.width || 100;
  opts.imageSize.height = opts.imageSize.height || 100;

  opts.imagePosition = opts.imagePosition || {};
  opts.imagePosition.x = opts.imagePosition.x || 465;
  opts.imagePosition.y = opts.imagePosition.y || 10;

  opts.identifierPosition = opts.identifierPosition || {};
  opts.identifierPosition.x = opts.identifierPosition.x || 400;
  opts.identifierPosition.y = opts.identifierPosition.y || 110;

  // if we have a custom font size
  // then use it for QR texts and reset to original size after all the QR text is displayed
  const initialFontSize = document._fontSize;
  if (opts.fontSize) {
    document.fontSize(opts.fontSize);
  }

  // Generate the QR code and add it to the page, together with some extra
  // details for either an existing or a new person
  if (identifier && typeof(identifier) === 'object') {
    qrCode = createResourceLink(personType, {
      outbreakId: outbreakId,
      [`${personType}Id`]: identifier.id
    });

    document.image(qrCode, opts.imagePosition.x, opts.imagePosition.y, {
      width: opts.imageSize.width,
      height: opts.imageSize.height
    });
    document.text(`${identifier.id}`, opts.identifierPosition.x, opts.identifierPosition.y, {align: 'right'});
    document.text(`${identifier.firstName || ''} ${identifier.middleName || ''} ${identifier.lastName || ''}`, {align: 'right'});
  } else {
    qrCode = createResourceLink(personType, {
      outbreakId: outbreakId,
      [`${personType}Id`]: identifier
    });

    document.image(qrCode, opts.imagePosition.x, opts.imagePosition.y, {
      width: opts.imageSize.width,
      height: opts.imageSize.height
    });
    document.text(identifier, opts.identifierPosition.x, opts.identifierPosition.y, {align: 'right'});
    if (opts.displayDashLines) {
      document.text('_ '.repeat(52), {align: 'right'});
    }
  }

  // Reset cursor position
  document.x = initialXPosition;
  document.y = initialYPosition;

  // reset font size
  document.fontSize(initialFontSize);
}

module.exports = {
  createResourceLink: createResourceLink,
  addPersonQRCode: addPersonQRCode,
  encodeDataInQr: encodeDataInQr
};
