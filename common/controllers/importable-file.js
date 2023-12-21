'use strict';

const app = require('../../server/server');
const WorkerRunner = require('./../../components/workerRunner');
const importableFileHelpers = require('./../../components/importableFile');

/**
 * Get a list of model names associated with passed model name
 * Usually the list consists from the passed model name, but there are some special cases
 * @param modelName
 * @return {*[]}
 */
function getModelNamesFor(modelName) {
  const modelNames = [];
  // add model name to the list
  if (modelName) {
    modelNames.push(modelName);
  }
  // when importing contact / contact of contact model, relationships are also imported
  if (
    modelName === app.models.contact.modelName ||
    modelName === app.models.contactOfContact.modelName
  ) {
    modelNames.push('relationship');
  }
  return modelNames;
}

module.exports = function (ImportableFile) {

  /**
   * Upload a file
   * @param req
   * @param file
   * @param modelName
   * @param decryptPassword
   * @param options
   * @param [outbreakId]
   * @param callback
   */
  ImportableFile.upload = function (req, file, modelName, decryptPassword, options, outbreakId, callback) {
    // outbreakId is optional
    if (typeof outbreakId === 'function') {
      callback = outbreakId;
      outbreakId = undefined;
    }
    // loopback cannot parse multipart requests
    app.utils.remote.helpers.parseMultipartRequest(req, [], ['file'], ImportableFile, [], function (error, fields, files) {
      // handle errors
      if (error) {
        return callback(error);
      }

      file = files.file;
      modelName = fields.model;
      decryptPassword = null;

      // if the decrypt password is valid, use it
      if (typeof fields.decryptPassword === 'string' && fields.decryptPassword.length) {
        decryptPassword = fields.decryptPassword;
      }

      // get user information from request options
      const contextUser = app.utils.remote.getUserFromOptions(options);

      return Promise.resolve()
        .then(() => {
          if (outbreakId) {
            return app.models.outbreak
              .findById(outbreakId)
              .then(outbreak => {
                if (!outbreak) {
                  return callback(app.utils.apiError.getError('MODEL_NOT_FOUND', {
                    model: app.models.outbreak.modelName,
                    id: outbreakId
                  }));
                }
                return Promise.resolve(outbreak);
              });
          } else {
            return Promise.resolve({});
          }
        })
        .then(outbreak => {
          return WorkerRunner.importableFile.upload(
            file,
            decryptPassword,
            outbreak,
            contextUser.languageId,
            {
              modelName: modelName,
              // get model's extended form; doing this in a ultra safe manner, as not all the models have a template
              extendedForm: app.models[modelName].extendedForm || {},
              // array props
              arrayProps: app.models[modelName].arrayProps || [],
              // associated model options
              associatedModels: getModelNamesFor(modelName).reduce((acc, modelName) => {
                // check for valid models
                if (!modelName || !app.models[modelName]) {
                  return acc;
                }

                // determine model options
                const fieldLabelsMap = Object.assign({}, app.models[modelName].fieldLabelsMap || {});
                let importableProperties = app.models[modelName]._importableProperties;

                // remove properties that should be excluded from import
                if (
                  fieldLabelsMap &&
                  fieldLabelsMap.createdOn
                ) {
                  delete fieldLabelsMap.createdOn;
                }
                if (
                  importableProperties &&
                  importableProperties.length > 0
                ) {
                  // create shallow copy
                  importableProperties = importableProperties.filter((prop) => prop !== 'createdOn');
                }

                // gather model options
                acc[modelName] = {
                  fieldLabelsMap,
                  importableProperties,
                  referenceDataFieldsToCategoryMap: app.models[modelName].referenceDataFieldsToCategoryMap,
                  extendedForm: app.models[modelName].extendedForm,
                  foreignKeyFields: app.models[modelName].foreignKeyFields
                };

                return acc;
              }, {}),
              referenceDataModelName: app.models.referenceData.modelName,
              referenceDataAvailableCategories: app.models.referenceData.availableCategories
            }
          );
        })
        .then(result => callback(null, result))
        .catch(callback);
    });
  };

  /**
   * Get a file (contents) using file id
   * @param id
   * @param callback
   */
  ImportableFile.getJsonById = function (id, callback) {
    // read file
    importableFileHelpers
      .getTemporaryFileById(id)
      .then(result => {
        // send back JSON file
        callback(null, result.data);
      })
      .catch(callback);
  };

  /**
   * Get a file distinct values for given headers using file id
   * @param {string} id - file ID
   * @param {Object} data - request body; should contain headers
   * @param {Object} options - options from request
   * @param callback
   */
  ImportableFile.getJsonDistinctValuesById = function (id, data, options, callback) {
    WorkerRunner.importableFile.getDistinctValuesForHeaders(
      id,
      data.headers
    )
      .then(result => callback(null, result))
      .catch(callback);
  };
};
