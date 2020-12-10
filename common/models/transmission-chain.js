'use strict';

const fs = require('fs');
const baseTransmissionChainModel = require('../../components/baseModelOptions/transmissionChain');
const app = require('../../server/server');

module.exports = function (TransmissionChain) {
  // set flag to not get controller
  TransmissionChain.hasController = false;

  /**
   * Case after delete
   * Actions:
   * Remove any contacts that remain isolated after the case deletion
   */
  TransmissionChain.observe('after delete', (context, next) => {
    // remove file even if this is soft delete - to reduce used space
    const filePath = baseTransmissionChainModel.helpers.getFilePath(context.instance.id);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      // It failed, doesn't matter...
      app.logger.error(`Error removing snapshot: '${filePath}'`);
    }

    // finished
    next();
  });
};
