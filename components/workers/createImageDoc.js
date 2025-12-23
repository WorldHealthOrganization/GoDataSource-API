'use strict';

// dependencies
const PdfUtils = require('../pdfDoc');
const Async = require('async');

// on 32 bit library is not installed
// suppress errors
let Sharp = null;
try {
  // load lib
  // !!!!!!!!!!!!!!!!!!
  // Note: Updating sharp library over version 0.28.3 will break current functionality in case of error as sharp will close the process and no longer throw error
  // See /lib/sharp.js in 0.29+ versions of sharp
  // Now we can upgrade sharp to >=0.29.2 as the process exiting instead of throwing error is fixed from this version.
  // !!!!!!!!!!!!!!!!!!
  Sharp = require('sharp');

  // do not allow concurrent executions
  // it uses too much memory on bigger scales (10+)
  Sharp.concurrency(1);
} catch (err) {
  // hack to not break the eslint
  Sharp = err;
  Sharp = null;
}

// A3 page - margins
const pageSize = {
  width: 1190,
  height: 840
};

// create the document
const doc = PdfUtils.createPdfDoc({
  borderLess: true,
  size: 'A3'
});

// define supported split types
const splitTypes = {
  horizontal: 'horizontal',
  vertical: 'vertical',
  grid: 'grid',
  auto: 'auto'
};

const worker = {
  /**
   * Add new image into the PDF
   * @param data
   */
  createImageDocument(data) {
    let { splitFactor, splitType } = data;

    // make sure the split type is one of the supported ones
    splitType = splitTypes[splitType];
    // default split type is auto
    if (!splitType) {
      splitType = splitTypes.auto;
    }

    // decode the image and try to remove the 'boring' pixels from the edges
    let originalImageBuffer = Buffer.from(data.imageBase64, 'base64');

    // remove the big base64 string from call stack
    data.imageBase64 = null;

    // decode the image
    let originalImage = Sharp(originalImageBuffer);
    originalImage
      .trim()
      .toBuffer((err, trimBuffer) => {
        // clean this up asap
        originalImageBuffer = null;

        let sharpInstance = null;

        // if trimming failed, might as well use the original image
        if (err) {
          sharpInstance = originalImage;
        } else {
          sharpInstance = Sharp(trimBuffer);
        }

        // clean this up asap
        originalImage = null;

        // get the image metadata (width, height)
        sharpInstance
          .metadata()
          .then((metadata) => {
            // compute image aspect ratio
            const imageAspectRatio = metadata.width / metadata.height;
            const pageAspectRatio = pageSize.width / pageSize.height;

            // resize image to fill the page based on aspect ratio
            // null values -> auto-scale to match the other axis
            let resizeWidth = null;
            let resizeHeight = null;
            if (imageAspectRatio > pageAspectRatio) {
              resizeHeight = pageSize.height * splitFactor;
            } else {
              resizeWidth = pageSize.width * splitFactor;
            }

            return sharpInstance
              .resize(resizeWidth, resizeHeight)
              .toBuffer({ resolveWithObject: true });
          })
          .then(({ data, info }) => {
            // decode the resized image
            const resizedImage = Sharp(data, {
              // remove pixels limit
              limitInputPixels: false,
              // it reduces the memory footprint and increases performance on some systems
              sequentialRead: true
            });

            // cache its sizes
            const imageWidth = info.width;
            const imageHeight = info.height;

            // compute width, height, rows and columns
            let width, height, rows, columns;

            // for split type auto, decide automatically how many pages to create
            if (splitType === splitTypes.auto) {
              // compute how many columns and rows are needed based on image dimensions
              columns = Math.ceil(imageWidth / pageSize.width);
              rows = Math.ceil(imageHeight / pageSize.height);
              // the width and height match page dimension
              width = pageSize.width;
              height = pageSize.height;
            } else {
              // decide image height and number of rows based on split type
              if ([splitTypes.grid, splitTypes.vertical].includes(splitType)) {
                height = imageHeight / splitFactor;
                rows = splitFactor;
              } else {
                height = imageHeight;
                rows = 1;
              }

              // decide image width and number of columns based on split type
              if ([splitTypes.grid, splitTypes.horizontal].includes(splitType)) {
                width = imageWidth / splitFactor;
                columns = splitFactor;
              } else {
                width = imageWidth;
                columns = 1;
              }
            }

            // flag that indicates this is the first page in the document
            // doing this to ensure we display one image per page
            let firstPage = true;

            // create an async queue for cropping images and adding them in the PDF
            const asyncQ = Async.queue((task, qCallback) => {
              // crop the image
              resizedImage
                .extract({
                  left: task.offsetWidth,
                  top: task.offsetHeight,
                  width: task.width,
                  height: task.height
                })
                .toBuffer()
                .then((buffer) => {
                  if (err) {
                    return qCallback(err);
                  }

                  if (!firstPage) {
                    doc.addPage();
                  }
                  firstPage = false;

                  // store it in the document (fit to document size - margins)
                  doc.image(buffer, 0, 0, { fit: [pageSize.width, pageSize.height] });

                  // overlay transparent logo
                  doc.addTransparentLogo();

                  return qCallback();
                })
                .catch(qCallback);
            }, 1 /* do not change!!!, otherwise we encounter race conditions */);

            // notify parent process that intensive task is done
            asyncQ.drain(function () {
              process.send([null, { done: true }]);
            });

            // if a image fails to be processed, kill the queue and notify the master process
            asyncQ.error(function (err) {
              asyncQ.kill();
              process.send([{ error: err.message }]);
            });

            // build a matrix of images, each cropped to its own position in the matrix
            for (let row = 0; row < rows; row++) {
              for (let column = 0; column < columns; column++) {
                let processedHeight = row * height;
                let processedWidth = column * width;
                // calculate crop size and position
                let cropWidth = Math.min(Math.max(0, imageWidth - processedWidth), width);
                let cropHeight = Math.min(Math.max(0, imageHeight - processedHeight), height);
                // if something was cropped, add it to the list of images
                if (cropWidth && cropHeight) {
                  asyncQ.push({
                    offsetWidth: processedWidth,
                    offsetHeight: processedHeight,
                    width: cropWidth,
                    height: cropHeight
                  });
                }
              }
            }
          })
          .catch((err) => process.send([{ error: err.message }]));
      });
  },
  // close the PDF stream
  finish() {
    doc.end();
  }
};

// store buffers
let buffers = [];
// store end flag
let end = false;

/**
 * Flush buffers every second
 */
(function flushBuffers() {
  // if there are buffers to be flushed
  if (buffers.length) {
    // flush them
    process.send([null, { chunk: Buffer.concat(buffers) }]);
    buffers = [];
  }
  // if doc finished
  if (end) {
    // inform the client
    process.send([null, { end: true }]);
  } else {
    // register next flush
    setTimeout(flushBuffers, 1000);
  }
})();

// buffer the data, don't flush it immediately (don't block the event loop)
doc.on('data', function (chunk) {
  buffers.push(chunk);
});
// document finished
doc.on('end', function () {
  end = true;
});

// handle client messages
process.on('message', function (message) {
  worker[message.fn](...message.args);
});
