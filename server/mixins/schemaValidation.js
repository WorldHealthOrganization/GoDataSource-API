'use strict';

const schemaFolder = '/../../common/validationSchemas/';
const app = require('../../server/server');
const fs = require('fs');

const prepareValidator = function () {
  const Ajv = require('ajv');
  const ajv = new Ajv({
    allErrors: true
  });

  loadSchemas(ajv, __dirname + schemaFolder);

  return ajv;
};

const loadSchemas = function(ajv, pathToFolder) {
  fs.readdirSync(pathToFolder).forEach((name) => {
    if (name.endsWith('.json')) {
      ajv.addSchema(require(pathToFolder + name));
    } else {
      loadSchemas(ajv, pathToFolder + name + '/');
    }
  });
};

module.exports = function (Model) {
  const modelName = Model.modelName;
  const validationMap = Model.definition.settings.validationSchemas;

  Object.keys(validationMap).forEach((method) => {

    Model.beforeRemote(method, function (context, modelInstance, next) {
      const ajv = prepareValidator();

      // The validate function will return either true or false after the validation
      let valid = ajv.validate(validationMap[method], context.req.body);

      if (!valid) {
        // We create an error similar to that of loopback's invalid model error
        let errors = {details: [], codes: {}, messages: {}};
        ajv.errors.forEach((error) => {
          let pathToProperty = (error.dataPath ? error.dataPath.substring(1) : '');

          // ajv does not offer the path to the missing/additional property (except when it's embedded property, but even then it does not contain the final key)
          // so we have to build it using the missing/additional property's key
          if (error.params.missingProperty) {
            pathToProperty ? pathToProperty += '.' + error.params.missingProperty : pathToProperty += error.params.missingProperty;
          } else if (error.params.additionalProperty) {
            pathToProperty ? pathToProperty += '.' + error.params.additionalProperty : pathToProperty += error.params.additionalProperty;
          }

          // We build a string with all the error messages, as per loopbacks error log system
          errors.details.push(`${modelName}.${error.dataPath} ${error.message}`);
          // We create a codes property, that logs what rule each property was failing
          errors.codes[pathToProperty] = [error.keyword];
          // We create a messages property, that shows the error message per property. In case the rule that was failing
          // was required, we use a non-default message so that the statement makes more sense
          errors.messages[pathToProperty] = error.keyword === 'required' ? ['can\'t be blank'] : [error.message];
        });

        next(app.utils.apiError.getError('VALIDATION_ERROR', {
          model: modelName,
          details: Object.assign({toString: function() {return errors.details.join(', ');}}, {codes: errors.codes, messages: errors.messages})
        }));
      } else {
        next();
      }
    });
  });
};


