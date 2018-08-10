'use strict';

/**
 * Convert a read to a buffer
 * @param stream
 * @param callback
 */
function streamToBuffer(stream, callback) {
  const chunks = [];
  stream.on('data', function (chunk) {
    chunks.push(chunk);
  });
  stream.on('end', function () {
    callback(null, Buffer.concat(chunks));
  });
}

module.exports = {
  streamToBuffer: streamToBuffer
};
