'use strict';

const fs = require('fs');
const path = require('path');

const relativePath = '/../../server/storage';
const containers = {
  icons: 'icons'
};

module.exports = function (Storage) {

  // expose containers
  Storage.containers = containers;

  /**
   * Store a file in a container on the disk
   * @param container
   * @param fileName
   * @param data
   * @return {Promise<any>}
   */
  Storage.save = function (container, fileName, data) {
    return new Promise(function (resolve, reject) {
      if (Object.values(containers).indexOf(container) === -1) {
        return reject(new Error(`Invalid storage container: ${container}`));
      }
      const filePath = `${relativePath}/${container}/${fileName}`;
      const fullPath = path.resolve(`${__dirname}/${filePath}`);
      fs.writeFile(fullPath, data, function (error) {
        if (error) {
          return reject(error);
        }
        resolve(filePath);
      });
    });
  };

  /**
   * Read a file from the disk
   * @param filePath
   * @return {Promise<any>}
   */
  Storage.read = function (filePath) {
    return new Promise(function (resolve, reject) {
      const fullPath = path.resolve(`${__dirname}/${filePath}`);
      fs.readFile(fullPath, function (error, buffer) {
        if (error) {
          return reject(error);
        }
        resolve(buffer);
      });
    });
  };

  /**
   * Remove a file from the disk
   * @param filePath
   * @return {Promise<any>}
   */
  Storage.remove = function (filePath) {
    return new Promise(function (resolve, reject) {
      const fullPath = path.resolve(`${__dirname}/${filePath}`);
      fs.unlink(fullPath, function (error) {
        if (error) {
          return reject(error);
        }
        resolve();
      });
    });
  };

  /**
   * Resolves a relative path to a storage file
   * This is needed because file paths that are stored using this model, are relative to this file
   * @param relativePath
   */
  Storage.resolvePath = function (relativePath) {
    return path.resolve(`${__dirname}/${relativePath}`);
  };
};
