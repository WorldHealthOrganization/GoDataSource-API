const excel = require('exceljs');
const uuid = require('uuid');
const tmp = require('tmp');
const path = require('path');
const csvStringify = require('csv-stringify');
const _ = require('lodash');
const fs = require('fs');
const moment = require('moment');
const archiver = require('archiver');
const xlsx = require('xlsx');
const pdfkit = require('pdfkit');
const pdfkitTable = require('voilab-pdf-table');
const config = require('../server/config');
const MongoDBHelper = require('./mongoDBHelper');
const mergeFilters = require('./mergeFilters');
const genericHelpers = require('./helpers');
const aesCrypto = require('./aesCrypto');
const convertLoopbackQueryToMongo = require('./convertLoopbackFilterToMongo');

// default language - in case we don't have user language
// - or if user language token translations are missing then they are replaced by default language tokens which should have all tokens...
const DEFAULT_LANGUAGE = 'english_us';

// temporary database prefix
const TEMPORARY_DATABASE_PREFIX = 'zExport_';

// string used to anonymize values
const ANONYMIZE_VALUE = '***';

// flat specific properties
// - used to determine max number of columns for questionnaire values (kinda try to make column unique, to not conflict with model properties)
const FLAT_MAX_ANSWERS_PREFIX = '_';
// - used to determine max number of columns for questionnaire with multiple answer dropdowns
const FLAT_MULTIPLE_ANSWER_SUFFIX = '_multiple';
// - used to determine max number of columns for questionnaire with multiple answer dropdowns
const PREFILTER_PREFIX = '___';
// - used to determine max number of columns for questionnaire with multiple answer dropdowns
const PREFILTER_SUFFIX = '_v';
// - used to make sure join field names don't conflict with prefilter names
const JOIN_PREFIX = '_join_';

// FLAT / NON FLAT TYPES
const EXPORT_TYPE = {
  JSON: 'json',
  XLSX: 'xlsx',
  CSV: 'csv',
  XLS: 'xls',
  ODS: 'ods',
  PDF: 'pdf'
};
const NON_FLAT_TYPES = [
  EXPORT_TYPE.JSON
];

// default export type - in case export type isn't provided
const DEFAULT_EXPORT_TYPE = EXPORT_TYPE.JSON;

// export custom columns
const CUSTOM_COLUMNS = {
  ALERTED: 'alerted',
  CREATED_BY_USER: 'createdByUser',
  CREATED_BY_USER_ID: 'createdByUser.id',
  CREATED_BY_USER_FIRST_NAME: 'createdByUser.firstName',
  CREATED_BY_USER_LAST_NAME: 'createdByUser.lastName',
  UPDATED_BY_USER: 'updatedByUser',
  UPDATED_BY_USER_ID: 'updatedByUser.id',
  UPDATED_BY_USER_FIRST_NAME: 'updatedByUser.firstName',
  UPDATED_BY_USER_LAST_NAME: 'updatedByUser.lastName'
};

// spreadsheet limits
const SHEET_LIMITS = {
  XLSX: {
    MAX_COLUMNS: config && config.export && config.export.xlsx && config.export.xlsx.maxColumnsPerSheet ?
      config.export.xlsx.maxColumnsPerSheet :
      16000,
    MAX_ROWS: config && config.export && config.export.xlsx && config.export.xlsx.maxRowsPerFile ?
      config.export.xlsx.maxRowsPerFile :
      1000000
  },
  XLS: {
    MAX_COLUMNS: config && config.export && config.export.xls && config.export.xls.maxColumnsPerSheet ?
      config.export.xls.maxColumnsPerSheet :
      250,
    MAX_ROWS: config && config.export && config.export.xls && config.export.xls.maxRowsPerFile ?
      config.export.xls.maxRowsPerFile :
      12000
  },
  ODS: {
    MAX_COLUMNS: config && config.export && config.export.ods && config.export.ods.maxColumnsPerSheet ?
      config.export.ods.maxColumnsPerSheet :
      250,
    MAX_ROWS: config && config.export && config.export.ods && config.export.ods.maxRowsPerFile ?
      config.export.ods.maxRowsPerFile :
      12000
  }
};

// pdf file config
const PDF_CONFIG = {
  size: '4A0',
  widthForPageSize: 6740,
  autoFirstPage: false,
  layout: 'landscape',
  margin: 20,
  fontSize: 8,
  lineWidth: 1,
  compress: false
};

// precompile regex replace new lines expression
const REPLACE_NEW_LINE_EXPR = /\r?\n|\r/g;

// relations types
const RELATION_TYPE = {
  HAS_ONE: 'HAS_ONE',
  HAS_MANY: 'HAS_MANY',
  GET_ONE: 'GET_ONE'
};

// relations types retrieval mode
const RELATION_RETRIEVAL_TYPE = {
  KEY_IN: 'KEY_IN',
  GET_ONE: 'GET_ONE'
};

// join types
const JOIN_TYPE = {
  HAS_ONE: 'HAS_ONE'
};

// replace undefined with null constants
const JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE = {
  OBJECT: 'O',
  ARRAY: 'A',
  VALUE: 'V'
};

/**
 * Export filtered model list
 * @param parentCallback Used to send data to parent (export log id / errors)
 * @param modelOptions Options for the model that will be exported
 * @param filter
 * @param exportType
 * @param encryptPassword {string|null}
 * @param anonymizeFields
 * @param fieldsGroupList
 * @param options
 * @param prefilters Uses joins to filter data (e.g. filter follow-ups by contact information)
 * @param relations Made after records are retrieved
 * @param joins Made while constructing what will be exported and concatenated with records to be processed. Also, can be used to determine missing data like 'person.address.locationId'
 */
function exportFilteredModelsList(
  parentCallback,
  modelOptions,
  filter,
  exportType,
  encryptPassword,
  anonymizeFields,
  fieldsGroupList,
  options,
  prefilters,
  relations,
  joins
) {
  try {
    // initialize custom relations
    const initializeCustomRelations = () => {
      // add createdByUser ?
      if (options.includeCreatedByUser) {
        relations = relations || {};
        relations.createdByUser = {
          type: RELATION_TYPE.HAS_ONE,
          collection: 'user',
          project: [
            '_id',
            'firstName',
            'lastName'
          ],
          key: '_id',
          keyValue: `(item) => {
            return item && item.createdBy ?
              item.createdBy :
              undefined;
          }`
        };
      }

      // add updatedByUser ?
      if (options.includeUpdatedByUser) {
        relations = relations || {};
        relations.updatedByUser = {
          type: RELATION_TYPE.HAS_ONE,
          collection: 'user',
          project: [
            '_id',
            'firstName',
            'lastName'
          ],
          key: '_id',
          keyValue: `(item) => {
            return item && item.updatedBy ?
              item.updatedBy :
              undefined;
          }`
        };
      }
    };

    // validate & parse relations
    const validateAndParseRelations = () => {
      // no relations to validate ?
      if (_.isEmpty(relations)) {
        return;
      }

      // throw error
      const throwError = (
        relationName,
        details
      ) => {
        throw new Error(`Invalid relation "${relationName}" - ${details}`);
      };

      // go through relations and check that we have the expected data
      // - name needs to be unique, when 1 level that shouldn't be a problem due to linter but multiple levels create problems
      const validateRelationsUsedNames = {};
      const validateRelations = (relationsToValidate) => {
        Object.keys(relationsToValidate).forEach((relationName) => {
          // get relation data
          const relationData = relationsToValidate[relationName];

          // did we initialize a relation with this name already ?
          if (validateRelationsUsedNames[relationName]) {
            throwError(
              relationName,
              'duplicate relation name'
            );
          }

          // add relation name to unique names
          validateRelationsUsedNames[relationName] = true;

          // not an object ?
          if (
            !relationData ||
            !_.isObject(relationData)
          ) {
            throwError(
              relationName,
              'expecting object'
            );
          }

          // no type or invalid type ?
          if (
            !relationData.type ||
            RELATION_TYPE[relationData.type] === undefined
          ) {
            throwError(
              relationName,
              'invalid type'
            );
          }

          // must have collection name
          if (
            !relationData.collection ||
            typeof relationData.collection !== 'string'
          ) {
            throwError(
              relationName,
              `invalid collection name (${typeof relationData.collection})`
            );
          }

          // must have project, so we force retrieval of only what is necessary
          if (
            !relationData.project ||
            !Array.isArray(relationData.project) ||
            relationData.project.length < 1
          ) {
            throwError(
              relationName,
              'invalid project provided'
            );
          }

          // validate accordingly to its type
          switch (relationData.type) {
            case RELATION_TYPE.HAS_ONE:
              // must have key
              if (
                !relationData.key ||
                typeof relationData.key !== 'string'
              ) {
                throwError(
                  relationName,
                  `invalid key name (${typeof relationData.key})`
                );
              }

              // must have keyValue
              if (
                !relationData.keyValue ||
                typeof relationData.keyValue !== 'string'
              ) {
                // invalid content
                throwError(
                  relationName,
                  `invalid key value (${typeof relationData.keyValue})`
                );
              } else {
                // transform to method
                try {
                  relationData.keyValue = eval(relationData.keyValue);
                } catch (e) {
                  throwError(
                    relationName,
                    'invalid key value method content'
                  );
                }
              }

              // after is optional
              if (
                relationData.after &&
                typeof relationData.after !== 'string'
              ) {
                // invalid content
                throwError(
                  relationName,
                  `invalid after (${typeof relationData.after})`
                );
              } else {
                // transform to method
                try {
                  relationData.after = eval(relationData.after);
                } catch (e) {
                  throwError(
                    relationName,
                    'invalid after method content'
                  );
                }
              }

              // replace
              if (
                relationData.replace &&
                typeof relationData.replace !== 'object'
              ) {
                // invalid definition
                throwError(
                  relationName,
                  `invalid replace (${typeof relationData.replace})`
                );
              } else {
                _.each(relationData.replace, (value, key) => {
                  if (
                    !key ||
                    typeof key !== 'string' ||
                    !value ||
                    typeof value !== 'object' ||
                    !value.value ||
                    typeof value.value !== 'string'
                  ) {
                    // invalid definition
                    throwError(
                      relationName,
                      `invalid replace (${typeof relationData.replace})`
                    );
                  }
                });
              }

              // finished
              break;

            case RELATION_TYPE.HAS_MANY:
              // must have key
              if (
                !relationData.key ||
                typeof relationData.key !== 'string'
              ) {
                throwError(
                  relationName,
                  `invalid key name (${typeof relationData.key})`
                );
              }

              // must have keyValues
              if (
                !relationData.keyValues ||
                typeof relationData.keyValues !== 'string'
              ) {
                // invalid content
                throwError(
                  relationName,
                  `invalid key values (${typeof relationData.keyValues})`
                );
              } else {
                // transform to method
                try {
                  relationData.keyValues = eval(relationData.keyValues);
                } catch (e) {
                  throwError(
                    relationName,
                    'invalid key values method content'
                  );
                }
              }

              // must have format
              if (
                !relationData.format ||
                typeof relationData.format !== 'string'
              ) {
                // invalid content
                throwError(
                  relationName,
                  `invalid format (${typeof relationData.format})`
                );
              } else {
                // transform to method
                try {
                  relationData.format = eval(relationData.format);
                } catch (e) {
                  throwError(
                    relationName,
                    'invalid format method content'
                  );
                }
              }

              // after is optional
              if (
                relationData.after &&
                typeof relationData.after !== 'string'
              ) {
                // invalid content
                throwError(
                  relationName,
                  `invalid after (${typeof relationData.after})`
                );
              } else {
                // transform to method
                try {
                  relationData.after = eval(relationData.after);
                } catch (e) {
                  throwError(
                    relationName,
                    'invalid after method content'
                  );
                }
              }

              // finished
              break;

            case RELATION_TYPE.GET_ONE:
              // must have query
              if (
                !relationData.query ||
                typeof relationData.query !== 'string'
              ) {
                // invalid content
                throwError(
                  relationName,
                  `invalid query (${typeof relationData.query})`
                );
              } else {
                // transform to method
                try {
                  relationData.query = eval(relationData.query);
                } catch (e) {
                  throwError(
                    relationName,
                    'invalid query method content'
                  );
                }
              }

              // must have sort
              if (
                !relationData.sort ||
                typeof relationData.sort !== 'object'
              ) {
                // invalid content
                throwError(
                  relationName,
                  `invalid sort (${typeof relationData.sort})`
                );
              }

              // after is optional
              if (
                relationData.after &&
                typeof relationData.after !== 'string'
              ) {
                // invalid content
                throwError(
                  relationName,
                  `invalid after (${typeof relationData.after})`
                );
              } else {
                // transform to method
                try {
                  relationData.after = eval(relationData.after);
                } catch (e) {
                  throwError(
                    relationName,
                    'invalid after method content'
                  );
                }
              }

              // finished
              break;
          }

          // do we have children relations ?
          if (relationData.relations) {
            // validate base
            if (
              typeof relationData.relations !== 'object' ||
              Array.isArray(relationData.relations)
            ) {
              throwError(
                relationName,
                'invalid children relations provided'
              );
            }

            // validate children relations
            validateRelations(relationData.relations);
          }
        });
      };

      // validate the main ones
      validateRelations(relations);
    };

    // initialize custom relations
    initializeCustomRelations();

    // validate & parse relations
    validateAndParseRelations();

    // validate & parse joins
    const validateAndParseJoins = () => {
      // no joins to validate ?
      if (_.isEmpty(joins)) {
        return;
      }

      // throw error
      const throwError = (
        joinName,
        details
      ) => {
        throw new Error(`Invalid join "${joinName}" - ${details}`);
      };

      // go through joins and check that we have the expected data
      Object.keys(joins).forEach((joinName) => {
        // get join data
        const joinData = joins[joinName];

        // not an object ?
        if (
          !joinData ||
          !_.isObject(joinData)
        ) {
          throwError(
            joinName,
            'expecting object'
          );
        }

        // no type or invalid type ?
        if (
          !joinData.type ||
          JOIN_TYPE[joinData.type] === undefined
        ) {
          throwError(
            joinName,
            'invalid type'
          );
        }

        // must have collection name
        if (
          !joinData.collection ||
          typeof joinData.collection !== 'string'
        ) {
          throwError(
            joinName,
            `invalid collection name (${typeof joinData.collection})`
          );
        }

        // must have project so we force retrieval of only what is necessary
        if (
          !joinData.project ||
          !_.isObject(joinData.project)
        ) {
          throwError(
            joinName,
            'invalid project provided'
          );
        }

        // must have local key
        if (
          !joinData.localField ||
          typeof joinData.localField !== 'string'
        ) {
          throwError(
            joinName,
            `invalid local field (${typeof joinData.localField})`
          );
        }

        // must have foreign key
        if (
          !joinData.foreignField ||
          typeof joinData.foreignField !== 'string'
        ) {
          throwError(
            joinName,
            `invalid foreign field (${typeof joinData.foreignField})`
          );
        }
      });
    };

    // validate & parse joins
    validateAndParseJoins();

    // prepare query filters
    const initializeQueryFilters = () => {
      // filter
      let dataFilter = filter ?
        _.cloneDeep(filter) :
        {};

      // check for additional scope query that needs to be added
      if (modelOptions.scopeQuery) {
        dataFilter = mergeFilters(
          modelOptions.scopeQuery,
          dataFilter
        );
      }

      // check for deleted flag; by default all items will be retrieved including deleted
      if (!dataFilter.deleted) {
        dataFilter = mergeFilters(dataFilter, {
          where: {
            deleted: false
          }
        });
      }

      // convert loopback query to mongodb query
      dataFilter = MongoDBHelper.getMongoDBOptionsFromLoopbackFilter(dataFilter);

      // finished
      return dataFilter;
    };

    // initialize column headers
    const initializeColumnHeaders = () => {
      // get fields that need to be exported from model options
      let fieldLabelsMap = Object.assign(
        {},
        modelOptions.fieldLabelsMap
      );

      // remove createdByUser ?
      if (!options.includeCreatedByUser) {
        delete fieldLabelsMap[CUSTOM_COLUMNS.CREATED_BY_USER];
        delete fieldLabelsMap[CUSTOM_COLUMNS.CREATED_BY_USER_ID];
        delete fieldLabelsMap[CUSTOM_COLUMNS.CREATED_BY_USER_FIRST_NAME];
        delete fieldLabelsMap[CUSTOM_COLUMNS.CREATED_BY_USER_LAST_NAME];
      }

      // remove updatedByUser ?
      if (!options.includeUpdatedByUser) {
        delete fieldLabelsMap[CUSTOM_COLUMNS.UPDATED_BY_USER];
        delete fieldLabelsMap[CUSTOM_COLUMNS.UPDATED_BY_USER_ID];
        delete fieldLabelsMap[CUSTOM_COLUMNS.UPDATED_BY_USER_FIRST_NAME];
        delete fieldLabelsMap[CUSTOM_COLUMNS.UPDATED_BY_USER_LAST_NAME];
      }

      // remove alerted ?
      if (!options.includeAlerted) {
        delete fieldLabelsMap[CUSTOM_COLUMNS.ALERTED];
      }

      // filter field labels list if fields groups were provided
      let modelExportFieldsOrder = modelOptions.exportFieldsOrder;
      if (
        fieldsGroupList &&
        fieldsGroupList.length > 0 &&
        modelOptions.exportFieldsGroup
      ) {
        // get all properties from each fields group
        const exportFieldLabelsMap = {};
        Object.keys(modelOptions.exportFieldsGroup).forEach((groupName) => {
          if (fieldsGroupList.includes(groupName)) {
            if (
              modelOptions.exportFieldsGroup[groupName].properties &&
              modelOptions.exportFieldsGroup[groupName].properties.length
            ) {
              modelOptions.exportFieldsGroup[groupName].properties.forEach((propertyName) => {
                // add property and token
                if (fieldLabelsMap[propertyName]) {
                  exportFieldLabelsMap[propertyName] = fieldLabelsMap[propertyName];
                }
              });
            }
          }
        });

        // use the headers come from export
        if (!_.isEmpty(exportFieldLabelsMap)) {
          // update the new list of exported fields
          fieldLabelsMap = exportFieldLabelsMap;

          // ignore export fields order
          modelExportFieldsOrder = undefined;
        }
      }

      // some models may have a specific order for headers
      let fieldsList = [];
      const fieldLabelsKeys = Object.keys(fieldLabelsMap);
      if (!_.isEmpty(modelExportFieldsOrder)) {
        // start with items from our order
        fieldsList = modelExportFieldsOrder;
        const alreadyIncludedFields = _.invert(modelExportFieldsOrder);

        // add the rest of the fields
        fieldLabelsKeys.forEach((field) => {
          // already include ?
          if (alreadyIncludedFields[field] !== undefined) {
            return;
          }

          // add it to the list
          fieldsList.push(field);
        });
      } else {
        fieldsList = fieldLabelsKeys;
      }

      // must exclude properties ?
      // - this applies mostly for person extended models because they clone person.fieldLabelMap which contains properties from all 4 models
      if (!_.isEmpty(modelOptions.excludeBaseProperties)) {
        // map excluded properties for easy check later
        const excludeBasePropertiesMap = {};
        modelOptions.excludeBaseProperties.forEach((excludedProperty) => {
          excludeBasePropertiesMap[excludedProperty] = true;
        });

        // go through fields list and remove excluded properties
        // - start from the end to be able to remove data on the go, otherwise the for won't work
        for (let checkPropertyIndex = fieldsList.length - 1; checkPropertyIndex >= 0; checkPropertyIndex--) {
          // get an determine root property
          let checkProperty = fieldsList[checkPropertyIndex];

          // remove array
          checkProperty = checkProperty.replace(/\[\]/g, '');

          // get root property
          const checkPropertyRootPropIndex = checkProperty.indexOf('.');
          if (checkPropertyRootPropIndex > -1) {
            checkProperty = checkProperty.substr(0, checkPropertyRootPropIndex);
          }

          // do we need to exclude this field ?
          if (excludeBasePropertiesMap[checkProperty]) {
            fieldsList.splice(checkPropertyIndex, 1);
          }
        }
      }

      // replace id with _id since were using mongo without loopback
      // id should always be at the start
      // - remove to add at the start
      const idIndex = fieldsList.indexOf('id');
      if (idIndex > -1) {
        // remove id
        fieldsList.splice(
          idIndex,
          1
        );
      }

      // remove _id to add at the start
      const _idIndex = fieldsList.indexOf('_id');
      if (_idIndex > -1) {
        // remove _id
        fieldsList.splice(
          _idIndex,
          1
        );
      }

      // add _id to the start of items order to be exported
      // always include id
      fieldsList.splice(
        0,
        0,
        '_id'
      );

      // map id to _id label, so we replace _id with token translation later
      if (fieldLabelsMap.id) {
        fieldLabelsMap._id = fieldLabelsMap.id;
        delete fieldLabelsMap.id;
      } else {
        // always include id
        if (!fieldLabelsMap._id) {
          fieldLabelsMap._id = 'LNG_COMMON_MODEL_FIELD_LABEL_ID';
        }
      }

      // attach additional fields
      if (!_.isEmpty(modelOptions.additionalFieldsToExport)) {
        // attach fields
        fieldsList.push(
          ...Object.keys(modelOptions.additionalFieldsToExport.fields)
        );

        // attach fields tokens
        Object.assign(
          fieldLabelsMap,
          modelOptions.additionalFieldsToExport.fields
        );

        // make sure we add array information
        modelOptions.arrayProps = Object.assign(
          {},
          modelOptions.arrayProps,
          modelOptions.additionalFieldsToExport.arrayProps
        );

        // make sure we add location information
        modelOptions.locationFields.push(...modelOptions.additionalFieldsToExport.locationFields);
      }

      // keep only what we need if a projection was included
      if (
        dataFilter &&
        !_.isEmpty(dataFilter.projection)
      ) {
        // replace id
        if (dataFilter.projection.id) {
          delete dataFilter.projection.id;
          dataFilter.projection._id = 1;
        }

        // clean fields that we don't need to export
        const projectionAsArray = Object.keys(dataFilter.projection);
        Object.keys(fieldLabelsMap).forEach((field) => {
          // must exclude field ?
          let excludeField = !dataFilter.projection[field];

          // check for parent properties
          if (excludeField) {
            // split into parent values
            const fieldParts = field.split('.');
            if (fieldParts.length > 1) {
              let checkField = '';
              for (let partIndex = 0; partIndex < fieldParts.length; partIndex++) {
                // attach this part
                checkField += `${checkField ? '.' : ''}${fieldParts[partIndex]}`;

                // must include ?
                if (
                  dataFilter.projection[checkField] ||
                  dataFilter.projection[checkField.replace(/\[\]/g, '')]
                ) {
                  // include field
                  excludeField = false;

                  // finished
                  break;
                }
              }
            } else {
              // check if there is a child that includes it
              const fieldAsParent = `${field}.`;
              const fieldAsParentArray = `${field}[].`;
              for (let projFieldIndex = 0; projFieldIndex < projectionAsArray.length; projFieldIndex++) {
                if (
                  projectionAsArray[projFieldIndex].startsWith(fieldAsParent) ||
                  projectionAsArray[projFieldIndex].startsWith(fieldAsParentArray)
                ) {
                  // include field
                  excludeField = false;

                  // finished
                  break;
                }
              }
            }
          }

          // check if we need to exclude field
          if (excludeField) {
            // delete from map
            delete fieldLabelsMap[field];

            // delete from list of exported fields
            const fieldIndex = fieldsList.indexOf(field);
            if (fieldIndex > -1) {
              fieldsList.splice(fieldIndex, 1);
            }
          }
        });
      }

      // exclude array count if there is no need to retrieve that data
      if (!_.isEmpty(modelOptions.arrayProps)) {
        Object.keys(modelOptions.arrayProps).forEach((arrayField) => {
          if (!fieldLabelsMap[arrayField]) {
            delete modelOptions.arrayProps[arrayField];
          } else {
            if (
              dataFilter &&
              !_.isEmpty(dataFilter.projection) &&
              !dataFilter.projection[arrayField]
            ) {
              Object.keys(modelOptions.arrayProps[arrayField]).forEach((arrayFieldProperty) => {
                if (
                  !dataFilter.projection[`${arrayField}.${arrayFieldProperty}`] &&
                  !dataFilter.projection[`${arrayField}[].${arrayFieldProperty}`]
                ) {
                  delete modelOptions.arrayProps[arrayField][arrayFieldProperty];
                }
              });
            }
          }
        });
      }

      // exclude locations if no location data is exported
      if (modelOptions.locationFields) {
        modelOptions.locationFields = modelOptions.locationFields.filter((locationField) => fieldLabelsMap[locationField]);
      }

      // finished
      return {
        headerKeys: fieldsList,
        headerKeysMap: {
          keys: [],
          definitions: {}
        },
        headerColumns: [],
        arrayColumnMaxValues: {},
        labels: fieldLabelsMap,

        // don't process data fields
        dontProcessValue: modelOptions.dontProcessValue && modelOptions.dontProcessValue.length > 0 ?
          modelOptions.dontProcessValue.reduce(
            (acc, property) => {
              // attach prop
              acc[property] = true;

              // continue
              return acc;
            },
            {}
          ) : {},

        // location fields
        includeParentLocationData: fieldsGroupList && fieldsGroupList.length > 0 && modelOptions.exportFieldsGroup ?
          fieldsGroupList.includes('LNG_COMMON_LABEL_EXPORT_GROUP_LOCATION_ID_DATA') :
          true,
        locationsFieldsMap: !modelOptions.locationFields || modelOptions.locationFields.length < 1 ?
          {} :
          modelOptions.locationFields.reduce(
            (acc, property) => {
              // attach prop
              acc[property] = true;

              // continue
              return acc;
            },
            {}
          ),

        // anonymize fields
        anonymizeString: ANONYMIZE_VALUE,
        anonymizeMap: anonymizeFields && anonymizeFields.length > 0 ?
          anonymizeFields.reduce(
            (acc, property) => {
              // attach prop
              const ciprop = property.toLowerCase();
              acc[ciprop] = true;

              // id add it in both forms
              if (
                ciprop === 'id' ||
                ciprop === '_id'
              ) {
                acc.id = true;
                acc._id = true;
              }

              // continue
              return acc;
            },
            {}
          ) : {},
        shouldAnonymize: (path) => {
          // check all levels
          const levels = (path || '').toLowerCase().replace(/\[\]/g, '').split('.');
          let pathSoFar = '';
          for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
            // shouldn't have empty values...but
            if (!levels[levelIndex]) {
              continue;
            }

            // check if this is anonymize
            pathSoFar = `${pathSoFar ? pathSoFar + '.' : ''}${levels[levelIndex]}`;
            if (sheetHandler.columns.anonymizeMap[pathSoFar]) {
              return true;
            }
          }

          // check custom case - questionnaire answers
          const defaultQuestionnaireAnswersKeyLower = defaultQuestionnaireAnswersKey.toLowerCase();
          if (
            sheetHandler.columns.anonymizeMap[defaultQuestionnaireAnswersKeyLower] &&
            (path || '').toLowerCase().startsWith(`${defaultQuestionnaireAnswersKeyLower}[`)
          ) {
            return true;
          }
        }
      };
    };

    // prefix name so we don't encounter duplicates
    const getQuestionnaireQuestionUniqueKey = (key) => {
      return `${FLAT_MAX_ANSWERS_PREFIX}${key}`;
    };

    // prefix name so we don't encounter duplicates for multiple dropdown
    const getQuestionnaireQuestionUniqueKeyForMultipleAnswers = (key) => {
      return `${getQuestionnaireQuestionUniqueKey(key)}${FLAT_MULTIPLE_ANSWER_SUFFIX}`;
    };

    // prepare questionnaire data
    const prepareQuestionnaireData = (columns) => {
      // initialize response
      const response = {
        flat: [],
        nonFlat: []
      };

      // do we need to include questionnaire data ?
      if (!columns.labels[defaultQuestionnaireAnswersKey]) {
        return response;
      }

      // go through questionnaire questions and map them accordingly
      if (
        options.questionnaire &&
        options.questionnaire.length > 0
      ) {
        // what is important to keep from a question
        const addQuestionData = (
          flatArray,
          nonFlatArray,
          question,
          multiAnswer,
          isRootQuestion
        ) => {
          // some types are ignored since there is no point in exporting them ?
          if (
            !question.text ||
            !question.variable ||
            question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MARKUP'
          ) {
            return;
          }

          // init question
          const formattedQuestion = {
            variable: question.variable,
            text: question.text,
            answerType: question.answerType,
            multiAnswer: multiAnswer !== undefined ?
              multiAnswer :
              question.multiAnswer,
            childQuestions: [],
            answerKeyToLabelMap: {},
            isRootQuestion
          };

          // attach question to flat array
          flatArray.push(formattedQuestion);

          // add to non flat array if we have one
          if (nonFlatArray) {
            nonFlatArray.push(formattedQuestion);
          }

          // attach child question recursively so they keep the order of display
          if (
            question.answers &&
            question.answers.length > 0
          ) {
            question.answers.forEach((answer) => {
              // attach answers labels
              formattedQuestion.answerKeyToLabelMap[answer.value] = answer.label;

              // attach child questions if we have any
              if (
                answer &&
                answer.additionalQuestions &&
                answer.additionalQuestions.length > 0
              ) {
                answer.additionalQuestions.forEach((childQuestion) => {
                  addQuestionData(
                    flatArray,
                    formattedQuestion.childQuestions,
                    childQuestion,
                    formattedQuestion.multiAnswer,
                    false
                  );
                });
              }
            });
          }
        };

        // format questionnaire
        options.questionnaire.forEach((questionData) => {
          // attach our question and it children question one after another
          addQuestionData(
            response.flat,
            response.nonFlat,
            questionData,
            undefined,
            true
          );
        });
      }

      // finished
      return response;
    };

    //  map questions with alert answers for easy find
    const initializeQuestionsWithAlertAnswers = (questionsWithAlertAnswers, questions) => {
      // get alerted answers
      if (questions) {
        for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
          const question = questions[questionIndex];
          // alert applies only to those questions that have option values
          if (
            (
              question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER' ||
              question.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS'
            ) &&
            question.answers &&
            question.answers.length
          ) {
            for (let answerIndex = 0; answerIndex < question.answers.length; answerIndex++) {
              // get data
              const answer = question.answers[answerIndex];

              // answer alert ?
              if (answer.alert) {
                // init
                if (!questionsWithAlertAnswers[question.variable]) {
                  questionsWithAlertAnswers[question.variable] = {};
                }

                // mark answer as alert
                questionsWithAlertAnswers[question.variable][answer.value] = true;
              }

              // go through all sub questions
              if (
                answer.additionalQuestions &&
                answer.additionalQuestions.length
              ) {
                initializeQuestionsWithAlertAnswers(questionsWithAlertAnswers, answer.additionalQuestions);
              }
            }
          }
        }
      }
    };

    // prepare temporary workbook
    const initializeTemporaryWorkbook = () => {
      // format export type
      exportType = exportType || DEFAULT_EXPORT_TYPE;
      exportType = exportType.toLowerCase();

      // create stream workbook so we can write in it when we have data
      const exportLogId = uuid.v4();
      const filePath = path.resolve(tmp.tmpdir, `${exportLogId}.${exportType}`);

      // initialize workbook file - XLSX
      let xlsxWorkbook, xlsxWorksheets;
      const initializeXlsx = () => {
        // workbook
        xlsxWorkbook = new excel.stream.xlsx.WorkbookWriter({
          filename: filePath
        });
      };

      // initialize workbook file - XLS
      let xlsDataBuffer, xlsColumnsPerSheet;
      const initializeXls = () => {
        xlsDataBuffer = [];
      };

      // initialize workbook file - ODS
      let odsDataBuffer, odsColumnsPerSheet;
      const initializeOds = () => {
        odsDataBuffer = [];
      };

      // initialize workbook file - PDF
      let pdfDoc, pdfWriteStream, pdfTable, pdfDataBuffer;
      const initializePDF = () => {
        // create new pdf document
        pdfDoc = new pdfkit(PDF_CONFIG);

        // output
        pdfWriteStream = fs.createWriteStream(filePath);
        pdfDoc.pipe(pdfWriteStream);

        // handle errors
        // - for now just throw them further
        pdfWriteStream.on('error', (err) => {
          throw err;
        });

        // initialize table renderer
        pdfTable = new pdfkitTable(pdfDoc);

        // set default values for columns
        pdfTable.setColumnsDefaults({
          headerBorder: 'B',
          align: 'left',
          headerPadding: [2],
          padding: [2],
          fill: true
        });

        // alternate background on rows
        pdfTable.onCellBackgroundAdd((table, column, row, index) => {
          if (index % 2 === 0) {
            table.pdf.fillColor('#ececec');
          } else {
            table.pdf.fillColor('#ffffff');
          }
        });

        // reset fill color after setting background as the fill color is used for all elements
        pdfTable.onCellBackgroundAdded(function (table) {
          table.pdf.fillColor('#000000');
        });

        // add table header on all pages
        pdfTable.onPageAdded((tb) => {
          tb.addHeader();
        });

        // initialize data buffer
        pdfDataBuffer = [];
      };

      // initialize object needed by each type
      const exportIsNonFlat = NON_FLAT_TYPES.includes(exportType);
      let csvWriteStream, jsonWriteStream, jsonWroteFirstRow;
      let mimeType;
      switch (exportType) {
        case EXPORT_TYPE.XLSX:
          // set mime type
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

          // initialize workbook file
          initializeXlsx();

          // finished
          break;

        case EXPORT_TYPE.XLS:
          // set mime type
          mimeType = 'application/vnd.ms-excel';

          // initialize workbook file
          initializeXls();

          // finished
          break;

        case EXPORT_TYPE.ODS:
          // set mime type
          mimeType = 'application/vnd.oasis.opendocument.spreadsheet';

          // initialize workbook file
          initializeOds();

          // finished
          break;

        case EXPORT_TYPE.PDF:
          // set mime type
          mimeType = 'application/pdf';

          // initialize workbook file
          initializePDF();

          // finished
          break;

        case EXPORT_TYPE.CSV:
          // set mime type
          mimeType = 'text/csv';

          // initialize write stream
          csvWriteStream = fs.createWriteStream(
            filePath, {
              encoding: 'utf8'
            }
          );

          // handle errors
          // - for now just throw them further
          csvWriteStream.on('error', (err) => {
            throw err;
          });

          // finished
          break;

        case EXPORT_TYPE.JSON:
          // set mime type
          mimeType = 'application/json';

          // initialize write stream
          jsonWriteStream = fs.createWriteStream(
            filePath, {
              encoding: 'utf8'
            }
          );

          // write array starter
          jsonWriteStream.write('[');

          // handle errors
          // - for now just throw them further
          jsonWriteStream.on('error', (err) => {
            throw err;
          });

          // finished
          break;

        // not supported
        default:
          throw new Error('Export type not supported');
      }

      // set columns depending of export type
      // - must return promise
      const setColumns = () => {
        switch (exportType) {
          case EXPORT_TYPE.XLSX:
            // initialize worksheets accordingly to max number of columns per worksheet
            xlsxWorksheets = [];
            const requiredNoOfSheets = Math.floor(sheetHandler.columns.headerColumns.length / SHEET_LIMITS.XLSX.MAX_COLUMNS) + 1;
            for (let sheetIndex = 0; sheetIndex < requiredNoOfSheets; sheetIndex++) {
              // create sheet
              const sheet = xlsxWorkbook.addWorksheet(`Data ${sheetIndex + 1}`);

              // set columns per sheet
              const startColumnsPos = sheetIndex * SHEET_LIMITS.XLSX.MAX_COLUMNS;
              const columns = sheetHandler.columns.headerColumns.slice(
                startColumnsPos,
                startColumnsPos + SHEET_LIMITS.XLSX.MAX_COLUMNS
              );
              if (sheetIndex > 0) {
                // id column at the start
                columns.splice(
                  0,
                  0,

                  // 0 will always be _id column
                  sheetHandler.columns.headerColumns[0]
                );
              }

              // set columns
              sheet.columns = columns;

              // add it to the list
              xlsxWorksheets.push(sheet);
            }

            // finished
            return Promise.resolve();

          case EXPORT_TYPE.XLS:

            // no need to split ?
            if (sheetHandler.columns.headerColumns.length < SHEET_LIMITS.XLS.MAX_COLUMNS) {
              xlsColumnsPerSheet = [
                sheetHandler.columns.headerColumns.map((column) => column.header)
              ];
            } else {
              // must split columns
              xlsColumnsPerSheet = [];
              const requiredNoOfSheets = Math.floor(sheetHandler.columns.headerColumns.length / SHEET_LIMITS.XLS.MAX_COLUMNS) + 1;
              for (let sheetIndex = 0; sheetIndex < requiredNoOfSheets; sheetIndex++) {
                // determine columns for this sheet
                const startColumnsPos = sheetIndex * SHEET_LIMITS.XLS.MAX_COLUMNS;
                let columns = sheetHandler.columns.headerColumns.slice(
                  startColumnsPos,
                  startColumnsPos + SHEET_LIMITS.XLS.MAX_COLUMNS
                );
                if (sheetIndex > 0) {
                  // id column at the start
                  columns.splice(
                    0,
                    0,

                    // 0 will always be _id column
                    sheetHandler.columns.headerColumns[0]
                  );
                }

                // set columns
                columns = columns.map((column) => column.header);

                // attach sheet with columns
                if (
                  columns &&
                  columns.length > 0
                ) {
                  xlsColumnsPerSheet.push(columns);
                }
              }
            }

            // finished
            return Promise.resolve();

          case EXPORT_TYPE.ODS:

            // no need to split ?
            if (sheetHandler.columns.headerColumns.length < SHEET_LIMITS.ODS.MAX_COLUMNS) {
              odsColumnsPerSheet = [
                sheetHandler.columns.headerColumns.map((column) => column.header)
              ];
            } else {
              // must split columns
              odsColumnsPerSheet = [];
              const requiredNoOfSheets = Math.floor(sheetHandler.columns.headerColumns.length / SHEET_LIMITS.ODS.MAX_COLUMNS) + 1;
              for (let sheetIndex = 0; sheetIndex < requiredNoOfSheets; sheetIndex++) {
                // determine columns for this sheet
                const startColumnsPos = sheetIndex * SHEET_LIMITS.ODS.MAX_COLUMNS;
                let columns = sheetHandler.columns.headerColumns.slice(
                  startColumnsPos,
                  startColumnsPos + SHEET_LIMITS.ODS.MAX_COLUMNS
                );
                if (sheetIndex > 0) {
                  // id column at the start
                  columns.splice(
                    0,
                    0,

                    // 0 will always be _id column
                    sheetHandler.columns.headerColumns[0]
                  );
                }

                // set columns
                columns = columns.map((column) => column.header);

                // attach sheet with columns
                if (
                  columns &&
                  columns.length > 0
                ) {
                  odsColumnsPerSheet.push(columns);
                }
              }
            }

            // finished
            return Promise.resolve();

          case EXPORT_TYPE.PDF:

            // no need to split ?
            const tableColumns = sheetHandler.columns.headerColumns.map((column) => {
              return {
                id: column.uniqueKeyInCaseOfDuplicate,
                header: column.header,
                width: Math.max(50, Math.floor(PDF_CONFIG.widthForPageSize / sheetHandler.columns.headerColumns.length))
              };
            });

            // setup columns
            pdfTable.addColumns(tableColumns);

            // add page with table headers
            pdfDoc.addPage();

            // finished
            return Promise.resolve();

          case EXPORT_TYPE.CSV:
            // set columns
            return new Promise((resolve, reject) => {
              const columns = sheetHandler.columns.headerColumns.map((column) => column.header);
              csvStringify(
                [], {
                  header: true,
                  columns
                },
                (err, csvData) => {
                  // did we encounter an error ?
                  if (err) {
                    return reject(err);
                  }

                  // write data
                  csvWriteStream.write(
                    csvData,
                    (err) => {
                      // error occurred ?
                      if (err) {
                        return reject(err);
                      }

                      // flushed
                      resolve();
                    }
                  );
                }
              );
            });

          case EXPORT_TYPE.JSON:
            // split columns for easy map later
            if (options.jsonReplaceUndefinedWithNull) {
              // reset values
              sheetHandler.columns.headerKeysMap = {
                keys: [],
                definitions: {}
              };

              // check if array
              const attachData = (
                parent,
                prefixName,
                propertyName
              ) => {
                // nothing to do ?
                if (!propertyName) {
                  return;
                }

                // array ?
                // take action depending if field belong to an array of not
                const propertyArrayIndex = propertyName.indexOf('[]');
                if (propertyArrayIndex > -1) {
                  // get parent name
                  const arrayField = propertyName.substr(0, propertyArrayIndex);

                  // get array field translation if necessary
                  const arrayFieldTokenPath = `${prefixName}${arrayField}`;
                  const arrayFieldTranslated = sheetHandler.useDbColumns ?
                    arrayField : (
                      sheetHandler.columns.labels[arrayFieldTokenPath] && sheetHandler.dictionaryMap[sheetHandler.columns.labels[arrayFieldTokenPath]] ?
                        sheetHandler.dictionaryMap[sheetHandler.columns.labels[arrayFieldTokenPath]] :
                        arrayField
                    );

                  // set array
                  if (
                    !parent[arrayFieldTranslated] ||
                    parent[arrayFieldTranslated].type !== JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE.ARRAY
                  ) {
                    parent[arrayFieldTranslated] = {
                      type: JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE.ARRAY,
                      name: arrayFieldTranslated,
                      fields: {},
                      fieldsKeys: []
                    };
                  }

                  // attach property
                  attachData(
                    parent[arrayFieldTranslated].fields,
                    `${arrayFieldTokenPath}[].`,
                    propertyName.substr(propertyArrayIndex + 3)
                  );

                  // set fields keys
                  // kinda redundant to do it here, because we redo it multiple times, correctly would be to at the end a deep replace
                  parent[arrayFieldTranslated].fieldsKeys = Object.keys(parent[arrayFieldTranslated].fields);
                } else {
                  // not array, maybe object ?
                  const propertyObjectIndex = propertyName.indexOf('.');
                  if (propertyObjectIndex > -1) {
                    // get parent name
                    const objectField = propertyName.substr(0, propertyObjectIndex);

                    // get object field translation if necessary
                    const objectFieldTokenPath = `${prefixName}${objectField}`;
                    const objectFieldTranslated = sheetHandler.useDbColumns ?
                      objectField : (
                        sheetHandler.columns.labels[objectFieldTokenPath] && sheetHandler.dictionaryMap[sheetHandler.columns.labels[objectFieldTokenPath]] ?
                          sheetHandler.dictionaryMap[sheetHandler.columns.labels[objectFieldTokenPath]] :
                          objectField
                      );

                    // set object
                    if (
                      !parent[objectFieldTranslated] ||
                      parent[objectFieldTranslated].type !== JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE.OBJECT
                    ) {
                      parent[objectFieldTranslated] = {
                        type: JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE.OBJECT,
                        name: objectFieldTranslated,
                        fields: {},
                        fieldsKeys: []
                      };
                    }

                    // attach property
                    attachData(
                      parent[objectFieldTranslated].fields,
                      `${prefixName}${objectField}.`,
                      propertyName.substr(propertyObjectIndex + 1)
                    );

                    // set fields keys
                    // kinda redundant to do it here, because we redo it multiple times, correctly would be to at the end a deep replace
                    parent[objectFieldTranslated].fieldsKeys = Object.keys(parent[objectFieldTranslated].fields);
                  } else {
                    // get field translation if necessary
                    const propertyTokenPath = `${prefixName}${propertyName}`;
                    const propertyTranslated = sheetHandler.useDbColumns ?
                      propertyName : (
                        sheetHandler.columns.labels[propertyTokenPath] && sheetHandler.dictionaryMap[sheetHandler.columns.labels[propertyTokenPath]] ?
                          sheetHandler.dictionaryMap[sheetHandler.columns.labels[propertyTokenPath]] :
                          propertyName
                      );

                    // not array and not object
                    parent[propertyTranslated] = {
                      type: JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE.VALUE,
                      name: propertyTranslated
                    };
                  }
                }
              };

              // go through all columns
              for (let propIndex = 0; propIndex < sheetHandler.columns.headerKeys.length; propIndex++) {
                attachData(
                  sheetHandler.columns.headerKeysMap.definitions,
                  '',
                  sheetHandler.columns.headerKeys[propIndex]
                );
              }

              // update keys
              sheetHandler.columns.headerKeysMap.keys = Object.keys(sheetHandler.columns.headerKeysMap.definitions);
            }

            // finished
            return Promise.resolve();

          // not supported
          default:
            throw new Error('Export type not supported');
        }
      };

      // add row depending of export type
      // - returns a promise: wait for data to be written
      let addRowCounted = 0;
      const addRow = (data) => {
        return new Promise((resolve, reject) => {
          switch (exportType) {
            case EXPORT_TYPE.XLSX:
              // add row
              const actualAddRow = () => {
                // - must split into sheets if there are more columns than we are allowed to export per sheet ?
                if (sheetHandler.columns.headerColumns.length <= SHEET_LIMITS.XLSX.MAX_COLUMNS) {
                  // does commit wait for stream to flush
                  // - or we might loose data just as we did with jsonWriteStream.write until we waited for write to flush - promise per record ?
                  xlsxWorksheets[0].addRow(data).commit();
                } else {
                  // append data for each sheet
                  const requiredNoOfSheets = Math.floor(sheetHandler.columns.headerColumns.length / SHEET_LIMITS.XLSX.MAX_COLUMNS) + 1;
                  for (let sheetIndex = 0; sheetIndex < requiredNoOfSheets; sheetIndex++) {
                    // set data per sheet
                    const startColumnsPos = sheetIndex * SHEET_LIMITS.XLSX.MAX_COLUMNS;

                    // data
                    const dataSlice = data.slice(
                      startColumnsPos,
                      startColumnsPos + SHEET_LIMITS.XLSX.MAX_COLUMNS
                    );

                    // each sheet needs to have id as the first column
                    if (sheetIndex > 0) {
                      dataSlice.splice(
                        0,
                        0,
                        // always _id
                        data[0]
                      );
                    }

                    // does commit wait for stream to flush
                    // - or we might loose data just as we did with jsonWriteStream.write until we waited for write to flush - promise per record ?
                    xlsxWorksheets[sheetIndex].addRow(dataSlice).commit();
                  }
                }
              };

              // reached the limit of rows per file ?
              addRowCounted++;
              if (addRowCounted >= SHEET_LIMITS.XLSX.MAX_ROWS) {
                // reset row count
                // - take in account that we need to account for columns row
                addRowCounted = 1;

                // close file
                sheetHandler.process
                  .finalize()
                  .then(() => {
                    // rename file
                    fs.renameSync(
                      sheetHandler.filePath,
                      `${sheetHandler.filePath}_${sheetHandler.process.fileNo}`
                    );

                    // create new workbook
                    sheetHandler.process.fileNo++;

                    // initialize workbook file
                    initializeXlsx();

                    // set columns for the new file
                    setColumns();

                    // write row to the new workbook
                    actualAddRow();

                    // finished
                    resolve();
                  })
                  .catch(reject);
              } else {
                // write row
                actualAddRow();

                // finished
                resolve();
              }

              // finished
              break;

            case EXPORT_TYPE.XLS:
              // append row
              xlsDataBuffer.push(data);

              // reached the limit of rows per file ?
              // -1 because first row is contains headers
              if (xlsDataBuffer.length >= SHEET_LIMITS.XLS.MAX_ROWS - 1) {
                // close file
                sheetHandler.process
                  .finalize()
                  .then(() => {
                    // rename file
                    fs.renameSync(
                      sheetHandler.filePath,
                      `${sheetHandler.filePath}_${sheetHandler.process.fileNo}`
                    );

                    // create new workbook
                    sheetHandler.process.fileNo++;

                    // initialize workbook file
                    initializeXls();

                    // set columns for the new file
                    // - not really necessary to again, but for consistency sake..and since it not much of a fuss
                    setColumns();

                    // finished
                    resolve();
                  })
                  .catch(reject);
              } else {
                // finished
                resolve();
              }

              // finished
              break;

            case EXPORT_TYPE.ODS:
              // append row
              odsDataBuffer.push(data);

              // reached the limit of rows per file ?
              // -1 because first row is contains headers
              if (odsDataBuffer.length >= SHEET_LIMITS.ODS.MAX_ROWS - 1) {
                // close file
                sheetHandler.process
                  .finalize()
                  .then(() => {
                    // rename file
                    fs.renameSync(
                      sheetHandler.filePath,
                      `${sheetHandler.filePath}_${sheetHandler.process.fileNo}`
                    );

                    // create new workbook
                    sheetHandler.process.fileNo++;

                    // initialize workbook file
                    initializeOds();

                    // set columns for the new file
                    // - not really necessary to again, but for consistency sake..and since it not much of a fuss
                    setColumns();

                    // finished
                    resolve();
                  })
                  .catch(reject);
              } else {
                // finished
                resolve();
              }

              // finished
              break;

            case EXPORT_TYPE.PDF:

              // format row
              const row = {};
              data.forEach((value, index) => {
                row[sheetHandler.columns.headerColumns[index].uniqueKeyInCaseOfDuplicate] = value !== undefined && value !== null ?
                  value.toString() :
                  '';
              });

              // append row to buffer
              pdfDataBuffer.push(row);

              // finished
              resolve();

              // finished
              break;

            case EXPORT_TYPE.CSV:
              // add row
              csvStringify(
                [data],
                (err, csvData) => {
                  // did we encounter an error ?
                  if (err) {
                    return reject(err);
                  }

                  // write data
                  csvWriteStream.write(
                    csvData,
                    (err) => {
                      // error occurred ?
                      if (err) {
                        return reject(err);
                      }

                      // flushed
                      resolve();
                    }
                  );
                }
              );

              // finished
              break;

            case EXPORT_TYPE.JSON:
              // divider
              if (jsonWroteFirstRow) {
                jsonWriteStream.write(',');
              }

              // must replace undefined with null ?
              if (options.jsonReplaceUndefinedWithNull) {
                // map properties to null
                const jsonMapToNull = (
                  parentData,
                  jsonDefColumn
                ) => {
                  // handle accordingly to type
                  switch (jsonDefColumn.type) {
                    case JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE.VALUE:
                      // set value
                      if (parentData[jsonDefColumn.name] === undefined) {
                        parentData[jsonDefColumn.name] = null;
                      }

                      // finished
                      break;

                    case JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE.OBJECT:
                      // check if we have any data
                      if (parentData[jsonDefColumn.name] === undefined) {
                        parentData[jsonDefColumn.name] = null;
                      } else {
                        // must check children
                        for (let propIndex = 0; propIndex < jsonDefColumn.fieldsKeys.length; propIndex++) {
                          jsonMapToNull(
                            parentData[jsonDefColumn.name],
                            jsonDefColumn.fields[jsonDefColumn.fieldsKeys[propIndex]]
                          );
                        }
                      }

                      // finished
                      break;

                    case JSON_REPLACE_UNDEFINED_WITH_NULL_TYPE.ARRAY:
                      // check if we have any data
                      if (parentData[jsonDefColumn.name] === undefined) {
                        parentData[jsonDefColumn.name] = null;
                      } else {
                        // must check children
                        for (let itemIndex = 0; itemIndex < parentData[jsonDefColumn.name].length; itemIndex++) {
                          for (let propIndex = 0; propIndex < jsonDefColumn.fieldsKeys.length; propIndex++) {
                            jsonMapToNull(
                              parentData[jsonDefColumn.name][itemIndex],
                              jsonDefColumn.fields[jsonDefColumn.fieldsKeys[propIndex]]
                            );
                          }
                        }
                      }

                      // finished
                      break;
                  }
                };

                // go through custom definitions
                for (let propIndex = 0; propIndex < sheetHandler.columns.headerKeysMap.keys.length; propIndex++) {
                  jsonMapToNull(
                    data,
                    sheetHandler.columns.headerKeysMap.definitions[sheetHandler.columns.headerKeysMap.keys[propIndex]]
                  );
                }

                // attach custom case - questionnaire answers
                if (
                  options.questionnaire &&
                  sheetHandler.columns.labels[defaultQuestionnaireAnswersKey]
                ) {
                  // questionnaire key translated
                  const translatedQuestionnaireKey = sheetHandler.useDbColumns ?
                    defaultQuestionnaireAnswersKey : (
                      sheetHandler.columns.labels[defaultQuestionnaireAnswersKey] && sheetHandler.dictionaryMap[sheetHandler.columns.labels[defaultQuestionnaireAnswersKey]] ?
                        sheetHandler.dictionaryMap[sheetHandler.columns.labels[defaultQuestionnaireAnswersKey]] :
                        defaultQuestionnaireAnswersKey
                    );

                  // no questionnaire ?
                  if (!data[translatedQuestionnaireKey]) {
                    data[translatedQuestionnaireKey] = null;
                  } else {
                    for (let questionIndex = 0; questionIndex < sheetHandler.questionnaireQuestionsData.flat.length; questionIndex++) {
                      // get record data
                      const questionData = sheetHandler.questionnaireQuestionsData.flat[questionIndex];

                      // question header
                      const questionHeader = sheetHandler.questionnaireUseVariablesAsHeaders || sheetHandler.useDbColumns ?
                        questionData.variable : (
                          sheetHandler.dictionaryMap[questionData.text] ?
                            sheetHandler.dictionaryMap[questionData.text] :
                            questionData.text
                        );

                      // replace undefined with value
                      if (data[translatedQuestionnaireKey][questionHeader] === undefined) {
                        data[translatedQuestionnaireKey][questionHeader] = null;
                      }
                    }
                  }
                }
              }

              // append row
              jsonWriteStream.write(
                JSON.stringify(data),
                (err) => {
                  // error occurred ?
                  if (err) {
                    return reject(err);
                  }

                  // flushed
                  resolve();
                }
              );

              // first row was written
              jsonWroteFirstRow = true;

              // finished
              break;

            // not supported
            default:
              throw new Error('Export type not supported');
          }
        });
      };

      // entire batch added
      // - must return promise
      const addedBatch = () => {
        switch (exportType) {
          case EXPORT_TYPE.XLSX:
            // nothing to do
            return Promise.resolve();

          case EXPORT_TYPE.XLS:
            // nothing to do
            return Promise.resolve();

          case EXPORT_TYPE.ODS:
            // nothing to do
            return Promise.resolve();

          case EXPORT_TYPE.PDF:
            // add batch
            pdfTable.addBody(pdfDataBuffer);

            // empty buffer
            pdfDataBuffer = [];

            // finished
            return Promise.resolve();

          case EXPORT_TYPE.CSV:
            // nothing to do
            return Promise.resolve();

          case EXPORT_TYPE.JSON:
            // nothing to do
            return Promise.resolve();

          // not supported
          default:
            throw new Error('Export type not supported');
        }
      };

      /**
       * Finalize Xls
       */
      const finalizeXls = () => {
        // create workbook for current bulk of data
        const currentWorkBook = xlsx.utils.book_new();

        // create sheets
        for (let sheetIndex = 0; sheetIndex < xlsColumnsPerSheet.length; sheetIndex++) {
          // get columns
          const sheetColumns = xlsColumnsPerSheet[sheetIndex];

          // single sheet ?
          let rows;
          if (xlsColumnsPerSheet.length < 2) {
            rows = [
              sheetColumns,
              ...xlsDataBuffer
            ];
          } else {
            // multiple sheets, must split data
            // - append headers
            rows = [
              sheetColumns
            ];

            // go through rows and retrieve only our columns data
            const startColumnsPos = sheetIndex * SHEET_LIMITS.XLS.MAX_COLUMNS;
            for (let rowIndex = 0; rowIndex < xlsDataBuffer.length; rowIndex++) {
              // get record data
              const rowData = xlsDataBuffer[rowIndex];

              // data
              const dataSlice = rowData.slice(
                startColumnsPos,
                startColumnsPos + SHEET_LIMITS.XLS.MAX_COLUMNS
              );

              // each sheet needs to have id as the first column
              if (sheetIndex > 0) {
                dataSlice.splice(
                  0,
                  0,
                  // always _id
                  rowData[0]
                );
              }

              // add row
              rows.push(dataSlice);
            }
          }

          // write sheet
          xlsx.utils.book_append_sheet(
            currentWorkBook,
            xlsx.utils.aoa_to_sheet(rows),
            `Data ${sheetIndex + 1}`
          );
        }

        // write file
        xlsx.writeFile(
          currentWorkBook,
          sheetHandler.filePath, {
            type: 'buffer',
            bookType: 'biff8'
          }
        );

        // finished
        return Promise.resolve();
      };

      // finalize ods
      const finalizeOds = () => {
        // create workbook for current bulk of data
        const currentWorkBook = xlsx.utils.book_new();

        // create sheets
        for (let sheetIndex = 0; sheetIndex < odsColumnsPerSheet.length; sheetIndex++) {
          // get columns
          const sheetColumns = odsColumnsPerSheet[sheetIndex];

          // single sheet ?
          let rows;
          if (odsColumnsPerSheet.length < 2) {
            rows = [
              sheetColumns,
              ...odsDataBuffer
            ];
          } else {
            // multiple sheets, must split data
            // - append headers
            rows = [
              sheetColumns
            ];

            // go through rows and retrieve only our columns data
            const startColumnsPos = sheetIndex * SHEET_LIMITS.ODS.MAX_COLUMNS;
            for (let rowIndex = 0; rowIndex < odsDataBuffer.length; rowIndex++) {
              // get record data
              const rowData = odsDataBuffer[rowIndex];

              // data
              const dataSlice = rowData.slice(
                startColumnsPos,
                startColumnsPos + SHEET_LIMITS.ODS.MAX_COLUMNS
              );

              // each sheet needs to have id as the first column
              if (sheetIndex > 0) {
                dataSlice.splice(
                  0,
                  0,
                  // always _id
                  rowData[0]
                );
              }

              // add row
              rows.push(dataSlice);
            }
          }

          // write sheet
          xlsx.utils.book_append_sheet(
            currentWorkBook,
            xlsx.utils.aoa_to_sheet(rows),
            `Data ${sheetIndex + 1}`
          );
        }

        // write file
        xlsx.writeFile(
          currentWorkBook,
          sheetHandler.filePath, {
            type: 'buffer',
            bookType: 'ods'
          }
        );

        // finished
        return Promise.resolve();
      };

      // finalize pdf
      const finalizePDF = () => {
        return new Promise((resolve, reject) => {

          // stream error - not really relevant since we set it this ...far into the process
          pdfWriteStream.on('error', function (err) {
            reject(err);
          });

          // wait for stream to finish writing then finalize pdf
          pdfWriteStream.on('finish', function () {
            resolve();
          });

          // finished adding data, prepare doc to be closed
          pdfDoc.end();
        });
      };

      // close stream depending of export type
      // - must return promise
      const finalize = () => {
        // update number of records
        return sheetHandler
          .updateExportLog({
            processedNo: sheetHandler.processedNo,
            updatedAt: new Date(),
            dbUpdatedAt: new Date()
          })
          .then(() => {
            switch (exportType) {
              case EXPORT_TYPE.XLSX:
                // finalize
                return xlsxWorkbook.commit();

              case EXPORT_TYPE.XLS:
                // finalize
                return finalizeXls();

              case EXPORT_TYPE.ODS:
                // finalize
                return finalizeOds();

              case EXPORT_TYPE.PDF:
                // finalize
                return finalizePDF();

              case EXPORT_TYPE.CSV:
                // finalize
                csvWriteStream.close();
                return Promise.resolve();

              case EXPORT_TYPE.JSON:
                // write json end
                jsonWriteStream.write(']');

                // finalize
                jsonWriteStream.close();
                return Promise.resolve();

              // not supported
              default:
                throw new Error('Export type not supported');
            }
          });
      };

      // format relations
      const mappedRelations = {};
      const formattedRelationsPerLevel = [];
      const deepScanForRelations = (
        relationsInQuestion,
        level
      ) => {
        // must initialize list of relations for this level ?
        if (formattedRelationsPerLevel.length < level) {
          formattedRelationsPerLevel.push([]);
        }

        // go through relations and format them
        _.each(
          relationsInQuestion,
          (relationData, relationName) => {
            // create relation handler
            const relHandler = {
              name: relationName,
              data: relationData
            };

            // attach to map for easy access too
            mappedRelations[relHandler.name] = relHandler;

            // add to relations
            formattedRelationsPerLevel[level - 1].push(relHandler);

            // do we have children relations ?
            if (relHandler.data.relations) {
              deepScanForRelations(
                relHandler.data.relations,
                level + 1
              );
            }
          }
        );
      };

      // start scan from the root
      deepScanForRelations(
        relations,
        1
      );

      // format joins
      const formattedJoins = [];
      _.each(
        joins,
        (joinData, joinName) => {
          // create join handler
          const joinHandler = {
            name: joinName,
            data: joinData
          };

          // add to join
          formattedJoins.push(joinHandler);
        }
      );

      // fields to retrieve from db
      const columns = initializeColumnHeaders();
      const projection = {};
      columns.headerKeys.forEach((field) => {
        // we need to retrieve all values from a route property, otherwise there might be cases where we don't export data
        // - like address.geoLocation.lat doesn't exist in database, and since we do a projection on that geoLocation.coordinates isn't retrieved...and not lat & lng are exported
        const fieldRootIndex = field.indexOf('.');
        if (fieldRootIndex > -1) {
          field = field.substr(
            0,
            fieldRootIndex
          );
        }

        // attach prop
        projection[field] = 1;
      });

      // extra fields requested
      (modelOptions.projection || []).forEach((field) => {
        // attach prop
        projection[field] = 1;
      });

      // format prefilters
      const formatPrefilters = (prefiltersToFormat) => {
        // init
        const response = [];

        // go through and format prefilters
        _.each(prefiltersToFormat, (definition, relationName) => {
          // format
          response.push({
            name: relationName,
            definition
          });

          // prefilter has prefilters ?
          // format prefilters of prefilter
          if (definition.prefilters) {
            definition.prefilters = formatPrefilters(definition.prefilters);
          }
        });

        // finished
        return response;
      };

      // format prefilters
      const formattedPrefilters = formatPrefilters(prefilters);

      // determine replacements
      // - for now only relationships offer the possibility of replacements
      const replacements = {};
      formattedRelationsPerLevel.forEach((formattedRelations) => {
        formattedRelations.forEach((relation) => {
          // nothing to do here
          if (!relation.data.replace) {
            return;
          }

          // merge replacements
          Object.assign(
            replacements,
            relation.data.replace
          );
        });
      });

      // get questions with alert answers
      const questionsWithAlertAnswersMap = {};
      initializeQuestionsWithAlertAnswers(
        questionsWithAlertAnswersMap,
        options.questionnaire
      );

      // finished
      return {
        languageId: options.contextUserLanguageId || DEFAULT_LANGUAGE,
        exportLogId,
        temporaryCollectionName: `${TEMPORARY_DATABASE_PREFIX}${exportLogId}`,
        temporaryDistinctLocationsKey: 'allUsedLocationIds',
        processedNo: 0,
        batchSize: config.export && config.export.batchSize > 0 ?
          config.export.batchSize :
          5000,
        locationFindBatchSize: config.export && config.export.locationFindBatchSize > 0 ?
          config.export.locationFindBatchSize :
          1000,
        noLookupIfPrefilterTotalCountLessThen: config.export && config.export.noLookupIfPrefilterTotalCountLessThen > 0 ?
          config.export.noLookupIfPrefilterTotalCountLessThen :
          5000,
        saveFilter: config && config.export && !!config.export.saveFilter,
        saveAggregateFilter: config && config.export && !!config.export.saveAggregateFilter,
        filePath,
        mimeType,
        columns,

        // database connection
        // - configured later
        dbConnection: null,

        // process
        process: {
          fileNo: 1,
          exportIsNonFlat,
          setColumns,
          addRow,
          addedBatch,
          finalize
        },

        // questionnaire
        questionnaireQuestionsData: prepareQuestionnaireData(columns),
        questionnaireUseVariablesAsHeaders: !!options.useQuestionVariable,
        questionsWithAlertAnswersMap: questionsWithAlertAnswersMap,
        hasQuestionsWithAlertAnswers: Object.keys(questionsWithAlertAnswersMap).length > 0,

        // no need for header translations ?
        useDbColumns: !!options.useDbColumns,
        dontTranslateValues: !!options.dontTranslateValues,

        // dictionary
        dictionaryMap: {},

        // locations
        locationsMaxNumberOfIdentifiers: 0,
        locationsMaxSizeOfParentsChain: 0,
        locationsMap: {},

        // retrieve only the fields that we need
        projection,

        // update export log
        updateExportLog: (dataToUpdate) => {
          // prepare data
          return exportLog
            .updateOne({
              _id: sheetHandler.exportLogId
            }, {
              '$set': dataToUpdate
            });
        },

        // convert relations to array for easier access
        relationsPerLevel: formattedRelationsPerLevel,
        relationsMap: mappedRelations,
        replacements,

        // convert joins to array for easier access
        joins: formattedJoins,
        joinDistinctLocationsFields: {},

        // filters
        prefiltersDisableLookup: false,
        prefiltersOfPrefiltersDisableLookup: {},
        prefiltersIds: {},
        prefilters: formattedPrefilters
      };
    };

    // used collection
    let exportLog, temporaryCollection, languageToken, location;

    // defaultLanguage must be initialized before initializeTemporaryWorkbook
    const defaultQuestionnaireAnswersKey = 'questionnaireAnswers';
    const dataFilter = initializeQueryFilters();
    const sheetHandler = initializeTemporaryWorkbook();

    // drop collection
    const dropTemporaryCollection = () => {
      // temporary collection was initialized ?
      return (temporaryCollection ? temporaryCollection.drop() : Promise.resolve())
        .then(() => {
          temporaryCollection = undefined;
        })
        .then(() => {
          // drop collection
          const dropNextPrefilterCollection = (
            prefixPath,
            tmpPrefilters
          ) => {
            // nothing more ?
            if (
              !tmpPrefilters ||
              tmpPrefilters.length < 1
            ) {
              return Promise.resolve();
            }

            // retrieve prefilter
            const prefilter = tmpPrefilters.splice(0, 1)[0];
            return sheetHandler.dbConnection
              .collection(`${sheetHandler.temporaryCollectionName}${prefixPath ? '_' + prefixPath : ''}_${prefilter.name}`)
              .drop()
              .then(() => {
                // prefilter has prefilters ?
                if (
                  prefilter.definition.prefilters &&
                  prefilter.definition.prefilters.length > 0
                ) {
                  return dropNextPrefilterCollection(
                    `${prefixPath ? prefixPath + '_' : ''}${prefilter.name}`, [
                      ...prefilter.definition.prefilters
                    ]
                  );
                }
              })
              .then(() => {
                return dropNextPrefilterCollection(
                  prefixPath,
                  tmpPrefilters
                );
              });
          };

          // drop collections
          return dropNextPrefilterCollection('', [
            ...sheetHandler.prefilters
          ]);
        });
    };

    // delete secondary temporary files
    const deleteSecondaryFiles = (basePath) => {
      // check if there are further files to delete
      for (let fileIndex = 1; fileIndex <= sheetHandler.process.fileNo; fileIndex++) {
        const secondaryFile = `${basePath}_${fileIndex}`;
        if (fs.existsSync(secondaryFile)) {
          try {
            fs.unlinkSync(secondaryFile);
          } catch (e) {
            // NOTHING
          }
        }
      }
    };

    // delete file
    const deleteTemporaryFile = () => {
      return Promise.resolve()
        .then(() => {
          // temporary file was initialized ?
          if (
            sheetHandler &&
            sheetHandler.filePath
          ) {
            // main file
            if (fs.existsSync(sheetHandler.filePath)) {
              try {
                fs.unlinkSync(sheetHandler.filePath);
              } catch (e) {
                // NOTHING
              }
            }

            // check if there are further files to delete
            deleteSecondaryFiles(sheetHandler.filePath);

            // reset
            sheetHandler.filePath = null;
          }
        });
    };

    // encrypt exported file
    const encryptFiles = () => {
      // do we need to encrypt ?
      if (!encryptPassword) {
        return Promise.resolve();
      }

      // encrypt
      const encryptFile = (filePath) => {
        // encrypt
        const encryptPath = `${filePath}.encrypt`;
        const dataFileStream = fs.createReadStream(filePath);
        const encryptFileStream = fs.createWriteStream(encryptPath);
        return aesCrypto
          .encryptStream(
            dataFileStream,
            encryptFileStream,
            encryptPassword
          )
          .then(() => {
            // remove data file
            fs.unlinkSync(filePath);

            // replace file with encrypted file
            fs.renameSync(
              encryptPath,
              filePath
            );
          });
      };

      // start encrypting
      return sheetHandler
        .updateExportLog({
          statusStep: 'LNG_STATUS_STEP_ENCRYPT',
          updatedAt: new Date(),
          dbUpdatedAt: new Date()
        })
        .then(() => {
          // single file to encrypt ?
          if (sheetHandler.process.fileNo < 2) {
            return encryptFile(sheetHandler.filePath);
          }

          // process encryption for next file
          let fileNoToProcess = 0;
          const nextFile = () => {
            // next
            fileNoToProcess++;

            // nothing else to process ?
            // last one in this case is handled above / bellow (encryptFile(sheetHandler.filePath).then)
            if (fileNoToProcess >= sheetHandler.process.fileNo) {
              return Promise.resolve();
            }

            // encrypt
            return encryptFile(`${sheetHandler.filePath}_${fileNoToProcess}`)
              .then(nextFile);
          };

          // go through each file & encrypt
          return encryptFile(sheetHandler.filePath)
            .then(nextFile);
        });
    };

    // zip multiple files
    const zipIfMultipleFiles = () => {
      // single file ?
      if (sheetHandler.process.fileNo < 2) {
        return Promise.resolve();
      }

      // multiple files
      try {
        // rename main file to match the rest
        // - main file is actually the last one in the order of files
        fs.renameSync(
          sheetHandler.filePath,
          `${sheetHandler.filePath}_${sheetHandler.process.fileNo}`
        );

        // update file path to zip
        // Note: should be kept in sync with the extension used in import
        const zipExtension = 'zip';
        const oldFilePath = sheetHandler.filePath;
        sheetHandler.filePath = path.resolve(tmp.tmpdir, `${sheetHandler.exportLogId}.${zipExtension}`);

        // start archiving
        return sheetHandler
          .updateExportLog({
            statusStep: 'LNG_STATUS_STEP_ARCHIVE',
            extension: zipExtension,
            mimeType: 'application/zip',
            updatedAt: new Date(),
            dbUpdatedAt: new Date()
          })
          .then(() => {
            // handle archive async
            return new Promise((resolve, reject) => {
              try {
                // initialize output
                const output = fs.createWriteStream(sheetHandler.filePath);

                // initialize archived
                const archive = archiver('zip');

                // listen for all archive data to be written
                // 'close' event is fired only when a file descriptor is involved
                output.on('close', function () {
                  // cleanup
                  // - remove files that were archived
                  deleteSecondaryFiles(oldFilePath);

                  // finished
                  resolve();
                });

                // archiving errors
                archive.on('error', function (err) {
                  reject(err);
                });

                // pipe archive data to the output file
                archive.pipe(output);

                // append files
                for (let fileIndex = 1; fileIndex <= sheetHandler.process.fileNo; fileIndex++) {
                  archive.file(
                    `${oldFilePath}_${fileIndex}`, {
                      name: `${fileIndex}.${exportType}`
                    }
                  );
                }

                // wait for streams to complete
                archive.finalize();
              } catch (err) {
                reject(err);
              }
            });
          });
      } catch (err) {
        return Promise.reject(err);
      }
    };

    // retrieve mongo db connection - since this export will always run in a worker
    MongoDBHelper
      .getMongoDBConnection()
      .then((dbConn) => {
        // used collections
        const exportDataCollection = dbConn.collection(modelOptions.collectionName);
        exportLog = dbConn.collection('databaseActionLog');
        languageToken = dbConn.collection('languageToken');
        location = dbConn.collection('location');

        // keep for use if necessary
        sheetHandler.dbConnection = dbConn;

        // initialize export log
        const initializeExportLog = () => {
          return exportLog
            .insertOne({
              _id: sheetHandler.exportLogId,
              type: 'export-data',
              actionStartDate: new Date(),
              status: 'LNG_SYNC_STATUS_IN_PROGRESS',
              statusStep: 'LNG_STATUS_STEP_RETRIEVING_LANGUAGE_TOKENS',
              resourceType: modelOptions.modelName,
              totalNo: 0,
              processedNo: 0,
              outbreakIDs: [options.outbreakId],
              deleted: false,
              createdAt: new Date(),
              createdBy: options.userId,
              updatedAt: new Date(),
              dbUpdatedAt: new Date(),
              updatedBy: options.userId,
              mimeType: sheetHandler.mimeType,
              extension: exportType,
              filter: sheetHandler.saveFilter ?
                JSON.stringify(dataFilter) :
                null
            })
            .then(() => {
              // send id to parent and proceed with doing the export
              parentCallback(null, {
                subject: 'WAIT',
                response: sheetHandler.exportLogId
              });
            });
        };

        // retrieve missing tokens
        const retrieveMissingTokens = (languageId, tokenIds) => {
          // default token projection
          const languageTokenProjection = {
            token: 1,
            translation: 1
          };

          // retrieve tokens
          // - preferably in user language but if not found in default language (english_us)
          return languageToken
            .find({
              languageId: languageId,
              token: {
                $in: tokenIds
              }
            }, {
              projection: languageTokenProjection
            })
            .toArray()
            .then((tokens) => {
              // map tokens
              // for faster then forEach :) - monumental gain :)
              for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
                // get record data
                const record = tokens[tokenIndex];
                sheetHandler.dictionaryMap[record.token] = record.translation;
              }

              // if records not found in current language try english
              if (
                languageId !== DEFAULT_LANGUAGE &&
                tokenIds.length !== tokens.length
              ) {
                // find tokens that are missing
                const missingTokenIds = [];
                for (let missingTokenIndex = 0; missingTokenIndex < tokenIds.length; missingTokenIndex++) {
                  // check if we have this token
                  const token = tokenIds[missingTokenIndex];
                  if (sheetHandler.dictionaryMap[token] !== undefined) {
                    // retrieved already
                    continue;
                  }

                  // append to missing tokens
                  missingTokenIds.push(token);
                }

                // retrieve missing tokens
                return retrieveMissingTokens(
                  DEFAULT_LANGUAGE,
                  missingTokenIds
                );
              }
            });
        };

        // initialize language tokens
        const initializeLanguageTokens = () => {
          // retrieve general language tokens
          const languageTokensToRetrieve = sheetHandler.useDbColumns ?
            [] :
            Object.values(sheetHandler.columns.labels);

          // attach general tokens that are always useful to have in your pocket
          languageTokensToRetrieve.push(
            // questionnaire related
            'LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_VALUE',
            'LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_DATE'
          );

          // attach general tokens that are always useful to have in your pocket
          languageTokensToRetrieve.push(
            // location related
            'LNG_LOCATION_FIELD_LABEL_ID',
            'LNG_LOCATION_FIELD_LABEL_IDENTIFIERS',
            'LNG_LOCATION_FIELD_LABEL_IDENTIFIER',
            'LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL',
            'LNG_LOCATION_FIELD_LABEL_PARENT_LOCATION'
          );

          // attach questionnaire tokens
          if (sheetHandler.questionnaireQuestionsData.flat.length > 0) {
            sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
              // question
              languageTokensToRetrieve.push(questionData.text);

              // answers
              _.each(questionData.answerKeyToLabelMap, (labelToken) => {
                languageTokensToRetrieve.push(labelToken);
              });
            });
          }

          // retrieve language tokens
          return retrieveMissingTokens(
            sheetHandler.languageId,
            languageTokensToRetrieve
          );
        };

        // initialize filter collections
        // - returns promise
        const initializeFilterCollections = (
          prefixPath,
          tmpPrefilters
        ) => {

          // generate next collection
          const generateNextCollection = () => {
            // nothing more ?
            if (tmpPrefilters.length < 1) {
              return Promise.resolve();
            }

            // retrieve prefilter
            const prefilter = tmpPrefilters.splice(0, 1)[0];

            // handle prefilters of prefilters
            return Promise.resolve()
              .then(() => {
                // no prefilters ?
                if (
                  !prefilter.definition.prefilters ||
                  prefilter.definition.prefilters.length < 1
                ) {
                  return;
                }

                // has prefilters
                return initializeFilterCollections(
                  (prefixPath ? prefixPath + '_' : '') + prefilter.name, [
                    ...prefilter.definition.prefilters
                  ]
                ).then(() => {
                  return determineFilterIfNeedLookup(
                    (prefixPath ? prefixPath + '_' : '') + prefilter.name,
                    prefilter.definition.prefilters
                  );
                });
              })
              .then(() => {
                // construct project
                const aggregateFilter = [];
                const project = {
                  _id: 1
                };
                if (prefilter.definition.foreignKey !== '_id') {
                  // not array? no need for custom projection
                  const foreignKeyArrayIndex = prefilter.definition.foreignKey.indexOf('[]');
                  if (foreignKeyArrayIndex < 0) {
                    project[prefilter.definition.foreignKey] = 1;
                  } else {
                    // match key is an array ?
                    // transform match key array into multiple fields so $lookup works...because in 3.2 it doesn't work with arrays
                    const arrayKey = prefilter.definition.foreignKey.substr(0, foreignKeyArrayIndex);
                    for (let localKeyIndex = 0; localKeyIndex < prefilter.definition.foreignKeyArraySize; localKeyIndex++) {
                      // attach element
                      project[`${PREFILTER_PREFIX}${prefilter.name}_${localKeyIndex}${PREFILTER_SUFFIX}`] = {
                        $arrayElemAt: [
                          `$${arrayKey}`,
                          localKeyIndex
                        ]
                      };
                    }
                  }
                }

                // go through prefilters and determine if we need to add conditions
                let prefiltersConditions = [];
                if (prefilter.definition.prefilters) {
                  // add search criteria from prefilters of prefilter :))
                  const prefilterOfPrefilterPath = `${prefixPath ? prefixPath + '_' : ''}${prefilter.name}`;
                  if (sheetHandler.prefiltersOfPrefiltersDisableLookup[prefilterOfPrefilterPath]) {
                    // WITHOUT LOOKUP

                    // attach ids conditions
                    prefilter.definition.prefilters.forEach((prefilterOfPrefilter) => {
                      // add to prefilter condition
                      const prefiltersIdsKey = (prefilterOfPrefilterPath ? prefilterOfPrefilterPath + '_' : '') + prefilterOfPrefilter.name;
                      const prefilterKey = prefilterOfPrefilter.definition.localKey.replace(/\[\]/g, '');
                      prefiltersConditions.push({
                        [prefilterKey]: {
                          $in: sheetHandler.prefiltersIds[prefiltersIdsKey]
                        }
                      });

                      // no need to keep it in memory, release once we finish with this promise
                      delete sheetHandler.prefiltersIds[prefiltersIdsKey];
                    });
                  } else {
                    // WITH LOOKUP

                    // handle not arrays
                    // go through prefilters of prefilter and attach lookup
                    prefilter.definition.prefilters.forEach((prefilterOfPrefilter) => {
                      // local key array ?
                      const arrayIndex = prefilterOfPrefilter.definition.localKey.indexOf('[]');
                      if (arrayIndex > -1) {
                        // retrieve related data so we can do something like an 'inner join'
                        // #TODO - there are better ways to do it in newer mongo..
                        throw new Error('Not implemented: Prefilters of prefilters - localKey array');
                      }

                      // not array? no need for custom projection
                      const foreignKeyArrayIndex = prefilterOfPrefilter.definition.foreignKey.indexOf('[]');
                      if (foreignKeyArrayIndex > -1) {
                        // retrieve related data so we can do something like an 'inner join'
                        // #TODO - there are better ways to do it in newer mongo..
                        throw new Error('Not implemented: Prefilters of prefilters - foreignKey array');
                      }

                      // attach lookup
                      const asKey = `${PREFILTER_PREFIX}${prefilterOfPrefilterPath ? prefilterOfPrefilterPath + '_' : ''}${prefilterOfPrefilter.name}`;
                      aggregateFilter.push({
                        $lookup: {
                          from: `${sheetHandler.temporaryCollectionName}${prefilterOfPrefilterPath ? '_' + prefilterOfPrefilterPath : ''}_${prefilterOfPrefilter.name}`,
                          localField: prefilterOfPrefilter.definition.localKey,
                          foreignField: prefilterOfPrefilter.definition.foreignKey,
                          as: asKey
                        }
                      });

                      // make sure there is at least one key matching the prefilter, otherwise we need to take out the record
                      aggregateFilter.push({
                        $match: {
                          [`${asKey}._id`]: {
                            $exists: true
                          }
                        }
                      });

                    });
                  }
                }

                // construct where condition
                let whereConditions;
                if (!_.isEmpty(prefilter.definition.filter.where)) {
                  // attach where condition
                  whereConditions = convertLoopbackQueryToMongo(prefilter.definition.filter.where);
                }

                // attach prefilter if necessary
                if (prefiltersConditions.length > 0) {
                  whereConditions = {
                    $and: _.isEmpty(whereConditions) ?
                      prefiltersConditions : [
                        ...prefiltersConditions,
                        whereConditions
                      ]
                  };
                }

                // construct filter aggregation
                aggregateFilter.push(
                  {
                    $match: whereConditions
                  }, {
                    $project: project
                  }, {
                    $out: `${sheetHandler.temporaryCollectionName}${prefixPath ? '_' + prefixPath : ''}_${prefilter.name}`
                  }
                );

                // update export log in case we need the aggregate filter
                return sheetHandler
                  .updateExportLog({
                    [`aggregateFilter${prefixPath ? '_' + prefixPath : ''}_${prefilter.name}`]: sheetHandler.saveAggregateFilter ?
                      JSON.stringify(aggregateFilter) :
                      null,
                    updatedAt: new Date(),
                    dbUpdatedAt: new Date()
                  })
                  .then(() => {
                    // prepare records that will be exported
                    return dbConn
                      .collection(prefilter.definition.collection)
                      .aggregate(aggregateFilter, {
                        allowDiskUse: true
                      })
                      .toArray()
                      .then(generateNextCollection);
                  });
              });
          };

          // generate prefilters
          return generateNextCollection();
        };

        // get ids determined by prefilters
        const determineFilterIds = (
          prefixPath,
          tmpPrefilters
        ) => {
          // no prefilters used ?
          if (
            !tmpPrefilters ||
            tmpPrefilters.length < 1
          ) {
            return Promise.resolve();
          }

          // retrieve prefilter ids
          const nextPrefilterIds = () => {
            // nothing more ?
            if (tmpPrefilters.length < 1) {
              return Promise.resolve();
            }

            // retrieve prefilter
            const prefilter = tmpPrefilters.splice(0, 1)[0];

            // initiate prefilter ids list
            const prefilterKey = (prefixPath ? prefixPath + '_' : '') + prefilter.name;
            sheetHandler.prefiltersIds[prefilterKey] = [];

            // count no of records
            return sheetHandler.dbConnection
              .collection(`${sheetHandler.temporaryCollectionName}_${prefilterKey}`)
              .find({})
              .toArray()
              .then((prefilterRecords) => {
                // determine ids
                const prefilterIds = {};
                for (let foreignKeyIndex = 0; foreignKeyIndex < prefilterRecords.length; foreignKeyIndex++) {
                  // get record
                  const record = prefilterRecords[foreignKeyIndex];

                  // if array we need to handle it differently
                  const foreignKeyArrayIndex = prefilter.definition.foreignKey.indexOf('[]');
                  if (foreignKeyArrayIndex < 0) {
                    prefilterIds[record[prefilter.definition.foreignKey]] = true;
                  } else {
                    // get each item id
                    const childKey = prefilter.definition.foreignKey.substr(foreignKeyArrayIndex + 3);
                    for (let foreignKeyIndex = 0; foreignKeyIndex < prefilter.definition.foreignKeyArraySize; foreignKeyIndex++) {
                      const prefilterFieldKey = `${PREFILTER_PREFIX}${prefilter.name}_${foreignKeyIndex}${PREFILTER_SUFFIX}`;
                      const childValue = _.get(record, `${prefilterFieldKey}.${childKey}`);
                      if (childValue) {
                        prefilterIds[childValue] = true;
                      }
                    }
                  }
                }

                // set prefilter filter ids
                // - sort needed to keep order of items when comparing to remove from condition
                sheetHandler.prefiltersIds[prefilterKey] = Object.keys(prefilterIds).sort();

                // continue with next filter
                return nextPrefilterIds();
              });
          };

          // retrieve list of ids for each prefilter
          return nextPrefilterIds();
        };

        // determine if we need to do prefilter lookups
        const determineFilterIfNeedLookup = (
          prefixPath,
          prefilters
        ) => {
          // no prefilters used ?
          if (
            !prefilters ||
            prefilters.length < 1
          ) {
            return Promise.resolve();
          }

          // initialize count prefilters
          const tmpPrefilters = [
            ...prefilters
          ];

          // count found data for this prefilter
          let prefiltersToTalRows = 0;
          const nextPrefilterCount = () => {
            // nothing more ?
            if (tmpPrefilters.length < 1) {
              return Promise.resolve();
            }

            // retrieve prefilter
            const prefilter = tmpPrefilters.splice(0, 1)[0];

            // count no of records
            return sheetHandler.dbConnection
              .collection(`${sheetHandler.temporaryCollectionName}${prefixPath ? '_' + prefixPath : ''}_${prefilter.name}`)
              .countDocuments()
              .then((counted) => {
                // add count
                prefiltersToTalRows += counted;

                // continue with next filter
                return nextPrefilterCount();
              });
          };

          // count total number of records from all prefilters
          return nextPrefilterCount()
            .then(() => {
              // do we need to disable lookup since there is a faster way of doing things ?
              if (prefiltersToTalRows <= sheetHandler.noLookupIfPrefilterTotalCountLessThen) {
                // disable
                if (!prefixPath) {
                  sheetHandler.prefiltersDisableLookup = true;
                } else {
                  sheetHandler.prefiltersOfPrefiltersDisableLookup[prefixPath] = true;
                }

                // determine prefilters ids
                return determineFilterIds(prefixPath, [
                  ...prefilters
                ]);
              }
            });
        };

        // initialize collection view
        const initializeCollectionView = () => {
          // original project
          const project = {
            // force to keep object order by using the collection natural sort when retrieving data
            _id: 0,
            rowId: '$_id'
          };

          // go through location fields so we can construct the retrieval of location ids
          const locationProps = _.isEmpty(sheetHandler.columns.locationsFieldsMap) ?
            [] :
            Object.keys(sheetHandler.columns.locationsFieldsMap);
          const locationContactQuery = {
            $concatArrays: []
          };
          locationProps.forEach((propertyName) => {
            // take action depending if field belong to an array of not
            const propertyArrayIndex = propertyName.indexOf('[]');
            if (propertyArrayIndex > -1) {
              // get array item field name - most of the time should be locationId, but you never know when earth is flat :)
              const arrayField = `$${propertyName.substr(0, propertyArrayIndex)}`;
              const locationItemProp = propertyName.substr(propertyName.lastIndexOf('.') + 1);

              // array merge
              locationContactQuery.$concatArrays.push({
                $cond: {
                  if: {
                    $isArray: arrayField
                  },
                  then: {
                    $map: {
                      input: arrayField,
                      as: 'item',
                      in: `$$item.${locationItemProp}`
                    }
                  },
                  else: []
                }
              });
            } else {
              // not array
              locationContactQuery.$concatArrays.push([
                `$${propertyName}`
              ]);
            }
          });

          // attach location pipe if we have one
          if (locationContactQuery.$concatArrays.length > 0) {
            project[sheetHandler.temporaryDistinctLocationsKey] = locationContactQuery;
          }

          // we need to retrieve extra information only for flat file types
          if (!sheetHandler.process.exportIsNonFlat) {
            // IMPORTANT!!!
            // IMPORTANT!!!
            // IMPORTANT!!!
            // USING MongoDB 4.4+ would've allowed us to use $function to do all bellow which could've been much faster than having multiple lines of preparations
            // - we might change it after we upgrade from 3.2 to a newer version
            // #TODO

            // determine how many values we have for array properties
            const arrayProps = _.isEmpty(modelOptions.arrayProps) ?
              [] :
              Object.keys(modelOptions.arrayProps);
            arrayProps.forEach((property) => {
              // array field value
              const fieldValue = `$${property}`;

              // attach projection
              project[property] = {
                $cond: {
                  if: {
                    $isArray: fieldValue
                  },
                  then: {
                    $size: fieldValue
                  },
                  else: 0
                }
              };
            });

            // attach questionnaire count to know how many columns we should attach
            if (sheetHandler.questionnaireQuestionsData.flat.length > 0) {
              // needed as fix for Mongo 4.4 path collision since it detects wrong paths
              project[defaultQuestionnaireAnswersKey] = `$${defaultQuestionnaireAnswersKey}`;

              // construct the queries that will be used to determine the number of max columns
              sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
                // variable path
                const variableProp = `$${defaultQuestionnaireAnswersKey}.${questionData.variable}`;

                // attach size answers per date count (multiple answer flag)
                // - since only multiAnswer questions can have multi answers there is no point to count if not a root questions, because child question answers will be mapped accordingly to parent date
                if (questionData.isRootQuestion) {
                  project[getQuestionnaireQuestionUniqueKey(questionData.variable)] = {
                    $cond: {
                      if: {
                        $isArray: variableProp
                      },
                      then: {
                        $size: variableProp
                      },
                      else: 0
                    }
                  };
                }

                // attach max multiple answers per question answer (multi select dropdown)
                if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                  const variablePropMultiple = `${variableProp}.value`;
                  project[getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable)] = {
                    $let: {
                      vars: {
                        maxValue: {
                          $max: {
                            $map: {
                              input: {
                                $cond: {
                                  if: {
                                    $isArray: variablePropMultiple
                                  },
                                  then: {
                                    $concatArrays: variablePropMultiple
                                  },
                                  else: []
                                }
                              },
                              as: 'item',
                              in: {
                                $cond: {
                                  if: {
                                    $isArray: '$$item'
                                  },
                                  then: {
                                    $size: '$$item'
                                  },
                                  else: 0
                                }
                              }
                            }
                          }
                        }
                      },
                      in: {
                        $ifNull: ['$$maxValue', 0]
                      }
                    }
                  };
                }
              });
            }
          }

          // determine if we need to do lookup
          let prefiltersConditions = [];
          if (sheetHandler.prefiltersDisableLookup) {
            // attach ids conditions
            sheetHandler.prefilters.forEach((prefilter) => {
              // add to prefilter condition
              const prefilterKey = prefilter.definition.localKey.replace(/\[\]/g, '');
              prefiltersConditions.push({
                [prefilterKey]: {
                  $in: sheetHandler.prefiltersIds[prefilter.name]
                }
              });

              // no need to keep it in memory, release once we finish with this promise
              delete sheetHandler.prefiltersIds[prefilter.name];
            });
          }

          // aggregate filter
          const aggregateFilter = [];

          // construct where condition
          let whereConditions;
          if (!_.isEmpty(dataFilter.where)) {
            // attach where condition
            whereConditions = dataFilter.where;
          }

          // attach prefilter if necessary
          if (prefiltersConditions.length > 0) {
            whereConditions = {
              $and: _.isEmpty(whereConditions) ?
                prefiltersConditions : [
                  ...prefiltersConditions,
                  whereConditions
                ]
            };
          }

          // append where only if necessary
          if (!_.isEmpty(whereConditions)) {
            aggregateFilter.push({
              $match: whereConditions
            });
          }

          // append sort
          if (!_.isEmpty(dataFilter.sort)) {
            aggregateFilter.push({
              $sort: dataFilter.sort
            });
          }

          // do we have prefilters, then projection will be done here, before the lookup & match
          let localKeyProject;
          let cleanupProject;
          if (!sheetHandler.prefiltersDisableLookup) {
            if (sheetHandler.prefilters.length > 0) {
              // at the end keep only what is interesting for us
              cleanupProject = Object.keys(project).reduce(
                (accumulator, fieldKey) => {
                  // keep field
                  accumulator[fieldKey] = 1;

                  // continue
                  return accumulator;
                },
                {}
              );

              // make sure we do the math
              // - rowId, arrays sizes ...
              localKeyProject = project;
            }

            // prepare array for prefilters
            sheetHandler.prefilters.forEach((prefilter) => {
              // make sure we project the local key
              const localKeyParentPathIndex = prefilter.definition.localKey.indexOf('.');
              let tmpLocalKey = localKeyParentPathIndex > -1 ?
                prefilter.definition.localKey.substr(0, localKeyParentPathIndex) :
                prefilter.definition.localKey;

              // remove array
              tmpLocalKey = tmpLocalKey.replace(/\[\]/g, '');

              // get key
              localKeyProject[tmpLocalKey] = 1;

              // not array? no need for custom projection
              const arrayIndex = prefilter.definition.localKey.indexOf('[]');
              if (arrayIndex < 0) {
                return;
              }

              // match key is an array ?
              // transform match key array into multiple fields so $lookup works...because in 3.2 it doesn't work with arrays
              // @TODO - after Mongo upgrade use lookup with pipelines instead of having initializeCollectionView aggregates and all these hacks
              const arrayKey = prefilter.definition.localKey.substr(0, arrayIndex);
              for (let localKeyIndex = 0; localKeyIndex < prefilter.definition.localKeyArraySize; localKeyIndex++) {
                // attach element
                localKeyProject[`${PREFILTER_PREFIX}${prefilter.name}_${localKeyIndex}${PREFILTER_SUFFIX}`] = {
                  $arrayElemAt: [
                    `$${arrayKey}`,
                    localKeyIndex
                  ]
                };
              }
            });

            // attach match key project if necessary
            if (!_.isEmpty(localKeyProject)) {
              // attach join keys too
              if (
                sheetHandler.joins &&
                sheetHandler.joins.length > 0
              ) {
                sheetHandler.joins.forEach((join) => {
                  // make sure we project the local key
                  const localKeyParentPathIndex = join.data.localField.indexOf('.');
                  let tmpLocalKey = localKeyParentPathIndex > -1 ?
                    join.data.localField.substr(0, localKeyParentPathIndex) :
                    join.data.localField;

                  // remove array
                  tmpLocalKey = tmpLocalKey.replace(/\[\]/g, '');

                  // get key
                  localKeyProject[tmpLocalKey] = 1;
                });
              }

              // initial project
              aggregateFilter.push({
                $project: localKeyProject
              });
            }

            // prefilter if necessary
            sheetHandler.prefilters.forEach((prefilter) => {
              // not array? no need for custom projection
              const arrayIndex = prefilter.definition.localKey.indexOf('[]');
              if (arrayIndex < 0) {
                // not array? no need for custom projection
                const foreignKeyArrayIndex = prefilter.definition.foreignKey.indexOf('[]');
                if (foreignKeyArrayIndex < 0) {
                  // determine related prefilter
                  const asKey = `${PREFILTER_PREFIX}${prefilter.name}`;
                  aggregateFilter.push({
                    $lookup: {
                      from: `${sheetHandler.temporaryCollectionName}_${prefilter.name}`,
                      localField: prefilter.definition.localKey === '_id' ?
                        'rowId' : prefilter.definition.localKey,
                      foreignField: prefilter.definition.foreignKey,
                      as: asKey
                    }
                  });

                  // attach filter
                  aggregateFilter.push({
                    $match: {
                      [`${asKey}._id`]: {
                        $exists: true
                      }
                    }
                  });
                } else {
                  // match key is an array ?
                  // transform match key array into multiple fields so $lookup works...because in 3.2 it doesn't work with arrays
                  // @TODO - after Mongo upgrade use lookup with pipelines instead of having initializeCollectionView aggregates and all these hacks
                  const childKey = prefilter.definition.foreignKey.substr(foreignKeyArrayIndex + 2);
                  for (let foreignKeyIndex = 0; foreignKeyIndex < prefilter.definition.foreignKeyArraySize; foreignKeyIndex++) {
                    // determine related prefilter
                    aggregateFilter.push({
                      $lookup: {
                        from: `${sheetHandler.temporaryCollectionName}_${prefilter.name}`,
                        localField: prefilter.definition.localKey === '_id' ?
                          'rowId' : prefilter.definition.localKey,
                        foreignField: `${PREFILTER_PREFIX}${prefilter.name}_${foreignKeyIndex}${PREFILTER_SUFFIX}${childKey}`,
                        as: `${PREFILTER_PREFIX}${prefilter.name}_${foreignKeyIndex}`
                      }
                    });
                  }

                  // filter
                  // @TODO - must replace once upgrade to newer mongo version
                  const prefilterMatchArray = {
                    $or: []
                  };
                  for (let foreignKeyIndex = 0; foreignKeyIndex < prefilter.definition.foreignKeyArraySize; foreignKeyIndex++) {
                    // make sure there is at least one key matching the prefilter, otherwise we need to take out the record
                    prefilterMatchArray.$or.push({
                      [`${PREFILTER_PREFIX}${prefilter.name}_${foreignKeyIndex}._id`]: {
                        $exists: true
                      }
                    });
                  }

                  // attach filter
                  aggregateFilter.push({
                    $match: prefilterMatchArray
                  });
                }
              } else {
                // not array? no need for custom projection
                const foreignKeyArrayIndex = prefilter.definition.foreignKey.indexOf('[]');
                if (foreignKeyArrayIndex > -1) {
                  // retrieve related data so we can do something like an 'inner join'
                  // #TODO - there are better ways to do it in newer mongo..
                  throw new Error('Not implemented: Prefilters - local key array, foreignKey array');
                }

                // match key is an array ?
                // transform match key array into multiple fields so $lookup works...because in 3.2 it doesn't work with arrays
                // @TODO - after Mongo upgrade use lookup with pipelines instead of having initializeCollectionView aggregates and all these hacks
                const childKey = prefilter.definition.localKey.substr(arrayIndex + 2);
                for (let localKeyIndex = 0; localKeyIndex < prefilter.definition.localKeyArraySize; localKeyIndex++) {
                  // determine related prefilter
                  aggregateFilter.push({
                    $lookup: {
                      from: `${sheetHandler.temporaryCollectionName}_${prefilter.name}`,
                      localField: `${PREFILTER_PREFIX}${prefilter.name}_${localKeyIndex}${PREFILTER_SUFFIX}${childKey}`,
                      foreignField: prefilter.definition.foreignKey,
                      as: `${PREFILTER_PREFIX}${prefilter.name}_${localKeyIndex}`
                    }
                  });
                }

                // filter
                // @TODO - must replace once upgrade to newer mongo version
                const prefilterMatchArray = {
                  $or: []
                };
                for (let localKeyIndex = 0; localKeyIndex < prefilter.definition.localKeyArraySize; localKeyIndex++) {
                  // make sure there is at least one key matching the prefilter, otherwise we need to take out the record
                  prefilterMatchArray.$or.push({
                    [`${PREFILTER_PREFIX}${prefilter.name}_${localKeyIndex}._id`]: {
                      $exists: true
                    }
                  });
                }

                // attach filter
                aggregateFilter.push({
                  $match: prefilterMatchArray
                });
              }
            });
          }

          // attach joins
          const joinsProject = {};
          if (
            sheetHandler.joins &&
            sheetHandler.joins.length > 0
          ) {
            sheetHandler.joins.forEach((join) => {
              // $TODO - after mongo upgrade we can replace the 2 step lookup + project with one step lookup with project pipeline
              // attach lookup
              const joinName = `${JOIN_PREFIX}${join.name}`;
              aggregateFilter.push({
                $lookup: {
                  from: join.data.collection,
                  localField: join.data.localField,
                  foreignField: join.data.foreignField,
                  as: joinName
                }
              });

              // convert to proper type
              switch (join.data.type) {
                case JOIN_TYPE.HAS_ONE:
                  // bring first item to the top
                  joinsProject[joinName] = {
                    $let: {
                      vars: {
                        joinValue: {
                          $arrayElemAt: [
                            `$${joinName}`,
                            0
                          ]
                        }
                      },
                      in: join.data.project
                    }
                  };

                  // do we have any locations in this join result ?
                  locationProps.forEach((locationField) => {
                    // location field has a parent ?
                    const locationFieldParentIndex = locationField.indexOf('.');
                    if (locationFieldParentIndex > -1) {
                      // check if parent belongs to our join
                      const locationFieldParent = locationField.substr(0, locationFieldParentIndex);
                      if (locationFieldParent === join.name) {
                        sheetHandler.joinDistinctLocationsFields[`${JOIN_PREFIX}${locationField}`] = 1;
                      }
                    }
                  });

                  // finished
                  break;
              }
            });
          }

          // no need to do project with determining the limits, it was done above
          if (_.isEmpty(localKeyProject)) {
            aggregateFilter.push({
              $project: Object.assign(
                project,
                joinsProject
              )
            });
          } else {
            // do a cleanup since we don't want to save everything
            // #TODO - after upgrading to newer mongo we can use $unset if we still need it after lookup pipelines logic
            aggregateFilter.push({
              $project: Object.assign(
                cleanupProject,
                joinsProject
              )
            });
          }

          // make sure we save the collection
          aggregateFilter.push({
            $out: sheetHandler.temporaryCollectionName
          });

          // update export log in case we need the aggregate filter
          return Promise.resolve()

            // save aggregate filter
            .then(() => {
              return sheetHandler.saveAggregateFilter ?
                sheetHandler.updateExportLog({
                  aggregateFilter: JSON.stringify(aggregateFilter),
                  updatedAt: new Date(),
                  dbUpdatedAt: new Date()
                }) :
                null;
            })

            // retrieve records that will be exported
            .then(() => {
              // add hint to _id index ?
              const addIDHint = dataFilter && dataFilter.where && JSON.stringify(dataFilter.where).indexOf('"_id"') > -1;

              // prepare records that will be exported
              return exportDataCollection
                .aggregate(aggregateFilter,
                  addIDHint ?
                    {
                      allowDiskUse: true,
                      hint: {
                        _id: 1
                      }
                    } : {
                      allowDiskUse: true,
                    }
                )
                .toArray()
                .then(() => {
                  temporaryCollection = dbConn.collection(sheetHandler.temporaryCollectionName);
                });
            });
        };

        // retrieve missing locations
        const retrieveMissingLocations = (locationIds) => {
          // filter out locations that were retrieved already
          locationIds = (locationIds || []).filter((locationId) => locationId && !sheetHandler.locationsMap[locationId]);

          // retrieve locations in batches - just in case
          const locationIdsMap = {};
          return new Promise((resolve, reject) => {
            // batch handler
            const nextBatch = () => {
              // finished ?
              if (
                !locationIds ||
                locationIds.length < 1
              ) {
                return Promise.resolve();
              }

              // next batch to retrieve
              const batchLocationIds = locationIds.splice(
                0,
                sheetHandler.locationFindBatchSize
              );

              // retrieve locations
              return location
                .find({
                  _id: {
                    $in: batchLocationIds
                  }
                }, {
                  projection: {
                    _id: 1,
                    name: 1,
                    identifiers: 1,
                    parentLocationId: 1,
                    geographicalLevelId: 1
                  }
                })
                .toArray()
                .then((locations) => {
                  // map locations
                  for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
                    // get record data
                    const record = locations[locationIndex];
                    sheetHandler.locationsMap[record._id] = record;

                    // initialize parents chain
                    record.parentChain = [];
                    if (sheetHandler.process.exportIsNonFlat) {
                      record.parentChainGeoLvlArray = [];
                      record.parentLocationNamesArrayNames = [];
                      record.parentLocationNamesArrayIds = [];
                    }

                    // identifier map
                    if (sheetHandler.process.exportIsNonFlat) {
                      record.identifiersCodes = record.identifiers && record.identifiers.length > 0 ?
                        record.identifiers.map((identifier) => identifier.code) :
                        [];
                    }

                    // update max number of identifier if necessary
                    sheetHandler.locationsMaxNumberOfIdentifiers = record.identifiers && record.identifiers.length > 0 && record.identifiers.length > sheetHandler.locationsMaxNumberOfIdentifiers ?
                      record.identifiers.length :
                      sheetHandler.locationsMaxNumberOfIdentifiers;
                  }

                  // no need to retrieve parent locations ?
                  if (!sheetHandler.columns.includeParentLocationData) {
                    return;
                  }

                  // retrieve missing parent locations too
                  // - need to loop again because otherwise we might include in missing something that is already retrieved but not added to map
                  for (let locationIndex = 0; locationIndex < locations.length; locationIndex++) {
                    // get record data
                    const record = locations[locationIndex];

                    // doesn't have parent, no point in continuing
                    if (!record.parentLocationId) {
                      continue;
                    }

                    // parent already retrieved, or will be retrieved ?
                    if (
                      sheetHandler.locationsMap[record.parentLocationId] ||
                      locationIdsMap[record.parentLocationId]
                    ) {
                      continue;
                    }

                    // missing parent
                    locationIdsMap[record.parentLocationId] = true;
                    locationIds.push(record.parentLocationId);
                  }
                })
                .then(nextBatch);
            };

            // retrieve locations
            nextBatch()
              .then(resolve)
              .catch(reject);
          });

        };

        // update parent location names, identifiers, geo locations ...
        const updateLocationsData = (locationIds) => {
          for (let locationIndex = 0; locationIndex < locationIds.length; locationIndex++) {
            // get location
            const location = sheetHandler.locationsMap[locationIds[locationIndex]];

            // count parents
            // - include self location too
            // - create array only if we have at least one parent
            if (location.parentLocationId) {
              let parentLocationId = location._id;
              while (parentLocationId) {
                // attach parent to list
                location.parentChain.splice(
                  0,
                  0,
                  parentLocationId
                );

                // json file export ?
                if (sheetHandler.process.exportIsNonFlat) {
                  // attach geo levels for easy print
                  location.parentChainGeoLvlArray.splice(
                    0,
                    0,
                    sheetHandler.locationsMap[parentLocationId] ?
                      sheetHandler.locationsMap[parentLocationId].geographicalLevelId :
                      '-'
                  );

                  // attach parent levels for easy print
                  location.parentLocationNamesArrayNames.splice(
                    0,
                    0,
                    sheetHandler.locationsMap[parentLocationId] ?
                      sheetHandler.locationsMap[parentLocationId].name :
                      '-'
                  );
                  location.parentLocationNamesArrayIds.splice(
                    0,
                    0,
                    parentLocationId
                  );
                }

                // retrieve next parent from chain
                parentLocationId = sheetHandler.locationsMap[parentLocationId] ?
                  sheetHandler.locationsMap[parentLocationId].parentLocationId :
                  undefined;
              }
            }

            // update max chain size if necessary
            sheetHandler.locationsMaxSizeOfParentsChain = location.parentChain.length > sheetHandler.locationsMaxSizeOfParentsChain ?
              location.parentChain.length :
              sheetHandler.locationsMaxSizeOfParentsChain;
          }
        };

        // retrieve locations and determine how many columns we will have - depending of identifiers
        const initializeLocations = () => {
          // retrieve all locations which are used in this export
          // - should we split into bulk? shouldn't be necessary..just for some ids
          return temporaryCollection
            .distinct(sheetHandler.temporaryDistinctLocationsKey)
            .then(retrieveMissingLocations)

            // retrieve join locations too
            .then(() => {
              // nothing to do here ?
              if (_.isEmpty(sheetHandler.joinDistinctLocationsFields)) {
                return;
              }

              // retrieve joins locations
              const locationFields = Object.keys(sheetHandler.joinDistinctLocationsFields);
              const retrieveData = () => {
                // finished ?
                if (locationFields.length < 1) {
                  return Promise.resolve();
                }

                // get next field
                const locationField = locationFields.splice(0, 1)[0];
                return temporaryCollection
                  .distinct(locationField)
                  .then(retrieveMissingLocations)
                  .then(retrieveData);
              };

              // retrieve first join location field locations
              return retrieveData();
            })

            // update location data
            .then(() => {
              // determine longest parent location chain
              const locationIds = Object.keys(sheetHandler.locationsMap);
              updateLocationsData(locationIds);
            });
        };

        // determine header columns
        const initializeColumns = () => {
          // initialize columns
          return Promise.resolve()
            .then(() => {
              // max not needed for non flat file types
              if (sheetHandler.process.exportIsNonFlat) {
                return;
              }

              // determine the maximum number for each array field
              const projectMax = {
                _id: null
              };
              const arrayProps = _.isEmpty(modelOptions.arrayProps) ?
                [] :
                Object.keys(modelOptions.arrayProps);

              // go through array fields and construct query to determine maximum number of records
              arrayProps.forEach((property) => {
                // array field value
                const fieldValue = `$${property}`;

                // attach max projection
                projectMax[property] = {
                  $max: fieldValue
                };
              });

              // determine maximum number of values per questionnaire answers too
              if (sheetHandler.questionnaireQuestionsData.flat.length > 0) {
                // construct the queries that will be used to determine the number of max columns
                sheetHandler.questionnaireQuestionsData.flat.forEach((questionData) => {
                  // variable path
                  const variableProp = getQuestionnaireQuestionUniqueKey(questionData.variable);

                  // attach size answers per date count (multiple answer flag)
                  if (questionData.isRootQuestion) {
                    projectMax[variableProp] = {
                      $max: `$${variableProp}`
                    };
                  }

                  // attach max multiple answers per question answer (multi select dropdown)
                  if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                    const variablePropMultiple = getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable);
                    projectMax[variablePropMultiple] = {
                      $max: `$${variablePropMultiple}`
                    };
                  }
                });
              }

              // nothing to retrieve ?
              // - 1 is for the _id
              if (Object.keys(projectMax).length < 2) {
                return;
              }

              // determine maximum number of items for each array field
              return temporaryCollection
                .aggregate([{
                  $group: projectMax
                }], {
                  allowDiskUse: true
                })
                .toArray();
            })
            .then((maxValues) => {
              // keep a copy of max counts
              sheetHandler.columns.arrayColumnMaxValues = maxValues && maxValues.length > 0 ?
                maxValues[0] :
                {};

              // handle adding columns to make sure they are all unitary
              const addHeaderColumn = (
                header,
                path,
                pathWithoutIndexes,
                uniqueKeyInCaseOfDuplicate,
                formula,
                translate,
                doesntContainLanguageToken
              ) => {
                // create column
                const columnData = {
                  originalHeader: header,
                  uniqueKeyInCaseOfDuplicate,
                  header,
                  path,
                  pathWithoutIndexes,
                  formula,
                  anonymize: sheetHandler.columns.shouldAnonymize(pathWithoutIndexes),
                  translate,
                  doesntContainLanguageToken
                };

                // check for duplicates
                for (let columnIndex = 0; columnIndex < sheetHandler.columns.headerColumns.length; columnIndex++) {
                  // if not a duplicate header can jump over
                  const existingColumn = sheetHandler.columns.headerColumns[columnIndex];
                  if (existingColumn.originalHeader !== columnData.originalHeader) {
                    continue;
                  }

                  // duplicate header - append unique key
                  columnData.header = `${columnData.originalHeader} (${columnData.uniqueKeyInCaseOfDuplicate})`;
                  existingColumn.header = `${existingColumn.originalHeader} (${existingColumn.uniqueKeyInCaseOfDuplicate})`;

                  // continue to check for other duplicates & replace their header too
                }

                // append column
                sheetHandler.columns.headerColumns.push(columnData);

                // in case we need it
                return columnData;
              };

              // remove previous column if path condition is met
              const removeLastColumnIfSamePath = (path) => {
                // nothing to do
                if (sheetHandler.columns.headerColumns.length < 1) {
                  return;
                }

                // check if we need to remove it
                if (sheetHandler.columns.headerColumns[sheetHandler.columns.headerColumns.length - 1].path !== path) {
                  return;
                }

                // meets the criteria, need to remove column
                sheetHandler.columns.headerColumns.splice(
                  sheetHandler.columns.headerColumns.length - 1,
                  1
                );
              };

              // attach parent location identifiers
              const attachLocationIdentifiers = (
                header,
                headerFlatSuffix,
                path,
                pathWithoutIndexes
              ) => {
                // non flat ?
                if (sheetHandler.process.exportIsNonFlat) {
                  // attach location identifier
                  addHeaderColumn(
                    header,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (value) => {
                      return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].identifiers ?
                        sheetHandler.locationsMap[value].identifiersCodes :
                        [];
                    },
                    undefined,
                    true
                  );

                  // finished
                  return;
                }

                // attach location identifiers
                for (let identifierIndex = 0; identifierIndex < sheetHandler.locationsMaxNumberOfIdentifiers; identifierIndex++) {
                  // attach location identifier
                  addHeaderColumn(
                    `${header} ${headerFlatSuffix} [${identifierIndex + 1}]`,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (function (localIdentifierIndex) {
                      return (value) => {
                        return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].identifiers &&
                        sheetHandler.locationsMap[value].identifiers.length > localIdentifierIndex ?
                          sheetHandler.locationsMap[value].identifiers[localIdentifierIndex].code :
                          '';
                      };
                    })(identifierIndex),
                    undefined,
                    true
                  );
                }
              };

              // attach parent location geographical level details
              const attachParentLocationGeographicalLevelDetails = (
                header,
                path,
                pathWithoutIndexes
              ) => {
                // non flat ?
                if (sheetHandler.process.exportIsNonFlat) {
                  // attach parent location geographical level
                  addHeaderColumn(
                    header,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (value) => {
                      return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].parentChainGeoLvlArray ?
                        sheetHandler.locationsMap[value].parentChainGeoLvlArray :
                        [];
                    },
                    (value, pipeTranslator) => {
                      return sheetHandler.dontTranslateValues ?
                        value :
                        value.map(pipeTranslator);
                    },
                    false
                  );

                  // finished
                  return;
                }

                // attach parent location details - only first level parent
                for (let parentLocationIndex = 0; parentLocationIndex < sheetHandler.locationsMaxSizeOfParentsChain; parentLocationIndex++) {
                  // attach parent location geographical level
                  addHeaderColumn(
                    `${header} [${parentLocationIndex + 1}]`,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (function (localParentLocationIndex) {
                      return (value) => {
                        return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].parentChain &&
                        sheetHandler.locationsMap[value].parentChain.length > localParentLocationIndex &&
                        sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]] &&
                        sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]].geographicalLevelId ?
                          sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]].geographicalLevelId :
                          '';
                      };
                    })(parentLocationIndex),
                    undefined,
                    false
                  );
                }
              };

              // attach parent location geographical level details
              const attachParentLocationsNameDetails = (
                header,
                path,
                pathWithoutIndexes
              ) => {
                // non flat ?
                if (sheetHandler.process.exportIsNonFlat) {
                  // attach parent location geographical level
                  addHeaderColumn(
                    header,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (value) => {
                      return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].parentLocationNamesArrayNames ?
                        (
                          sheetHandler.dontTranslateValues ?
                            sheetHandler.locationsMap[value].parentLocationNamesArrayIds :
                            sheetHandler.locationsMap[value].parentLocationNamesArrayNames
                        ) :
                        [];
                    },
                    undefined,
                    true
                  );

                  // finished
                  return;
                }

                // attach parent location details
                for (let parentLocationIndex = 0; parentLocationIndex < sheetHandler.locationsMaxSizeOfParentsChain; parentLocationIndex++) {
                  // attach parent location names
                  addHeaderColumn(
                    `${header} [${parentLocationIndex + 1}]`,
                    path,
                    pathWithoutIndexes,
                    uuid.v4(),
                    (function (localParentLocationIndex) {
                      return (value) => {
                        return value && sheetHandler.locationsMap[value] && sheetHandler.locationsMap[value].parentChain &&
                        sheetHandler.locationsMap[value].parentChain.length > localParentLocationIndex &&
                        sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]] &&
                        sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]].name ?
                          (
                            sheetHandler.dontTranslateValues ?
                              sheetHandler.locationsMap[value].parentChain[localParentLocationIndex] :
                              sheetHandler.locationsMap[sheetHandler.locationsMap[value].parentChain[localParentLocationIndex]].name
                          ) :
                          '';
                      };
                    })(parentLocationIndex),
                    undefined,
                    true
                  );
                }
              };

              // get properties of type array definitions if current model has one
              const arrayProps = sheetHandler.process.exportIsNonFlat || _.isEmpty(modelOptions.arrayProps) ?
                undefined :
                modelOptions.arrayProps;

              // for faster then forEach :) - monumental gain :)
              for (let propIndex = 0; propIndex < sheetHandler.columns.headerKeys.length; propIndex++) {
                // get record data
                const propertyName = sheetHandler.columns.headerKeys[propIndex];
                const propertyLabelToken = sheetHandler.useDbColumns ?
                  undefined :
                  sheetHandler.columns.labels[propertyName];
                const propertyLabelTokenTranslation = propertyLabelToken && sheetHandler.dictionaryMap[propertyLabelToken] !== undefined ?
                  sheetHandler.dictionaryMap[propertyLabelToken] :
                  propertyName;

                // array property ?
                if (
                  arrayProps &&
                  arrayProps[propertyName]
                ) {
                  // go through each child property and create proper header columns
                  if (sheetHandler.columns.arrayColumnMaxValues[propertyName]) {
                    for (let arrayIndex = 0; arrayIndex < sheetHandler.columns.arrayColumnMaxValues[propertyName]; arrayIndex++) {
                      for (let childProperty in arrayProps[propertyName]) {
                        // determine child property information
                        const childPropertyTokenTranslation = sheetHandler.useDbColumns ?
                          childProperty :
                          sheetHandler.dictionaryMap[arrayProps[propertyName][childProperty]];

                        // child property contains parent info ?
                        const propertyOfAnObjectIndex = childProperty.indexOf('.');
                        if (propertyOfAnObjectIndex > -1) {
                          // determine parent property
                          const parentProperty = childProperty.substr(0, propertyOfAnObjectIndex);

                          // remove previous column if it was a parent column
                          if (parentProperty) {
                            removeLastColumnIfSamePath(`${propertyName}[${arrayIndex}].${parentProperty}`);
                          }
                        }

                        // add columns
                        const childPathWithoutIndexes = `${propertyName}[].${childProperty}`;
                        const childColumn = addHeaderColumn(
                          `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} [${arrayIndex + 1}]`,
                          `${propertyName}[${arrayIndex}].${childProperty}`,
                          childPathWithoutIndexes,
                          uuid.v4(),
                          undefined,
                          undefined,
                          !!sheetHandler.columns.locationsFieldsMap[childPathWithoutIndexes]
                        );

                        // if location column we need to push some extra columns
                        if (
                          sheetHandler.columns.includeParentLocationData &&
                          sheetHandler.columns.locationsFieldsMap[childColumn.pathWithoutIndexes]
                        ) {
                          // attach location guid
                          if (!sheetHandler.dontTranslateValues) {
                            addHeaderColumn(
                              `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_ID']} [${arrayIndex + 1}]`,
                              childColumn.path,
                              childColumn.pathWithoutIndexes,
                              uuid.v4(),
                              (value) => {
                                return value;
                              },
                              undefined,
                              true
                            );
                          }

                          // attach location identifiers
                          attachLocationIdentifiers(
                            `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIERS']} [${arrayIndex + 1}]`,
                            sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIER'],
                            childColumn.path,
                            childColumn.pathWithoutIndexes
                          );

                          // attach parent location geographical level details
                          attachParentLocationGeographicalLevelDetails(
                            `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} [${arrayIndex + 1}] ${sheetHandler.dictionaryMap['LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL']}`,
                            childColumn.path,
                            childColumn.pathWithoutIndexes
                          );

                          // attach parent locations name details
                          attachParentLocationsNameDetails(
                            `${propertyLabelTokenTranslation ? propertyLabelTokenTranslation + ' ' : ''}${childPropertyTokenTranslation} [${arrayIndex + 1}] ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_PARENT_LOCATION']}`,
                            childColumn.path,
                            childColumn.pathWithoutIndexes
                          );
                        }
                      }
                    }
                  }

                  // property addressed through its children, no need to continue, and yet we continue - dev joke :) - jump to next item in for loop
                  continue;
                }

                // do not handle array properties from field labels map when we have arrayProps set on the model
                const isPropertyOfAnArray = propertyName.indexOf('[]') > -1;
                if (
                  isPropertyOfAnArray &&
                  arrayProps
                ) {
                  continue;
                }

                // if a flat file is exported, data needs to be flattened, include 3 elements for each array
                if (isPropertyOfAnArray) {
                  // if non flat child columns are handled by parents
                  if (sheetHandler.process.exportIsNonFlat) {
                    continue;
                  }

                  // bad model configuration - missing definition
                  // #TODO
                  throw new Error(`Missing array definition for property '${propertyName}'`);
                } else {
                  // check if property belongs to an object
                  const propertyOfAnObjectIndex = propertyName.lastIndexOf('.');
                  let parentProperty, parentPropertyTokenTranslation;
                  if (propertyOfAnObjectIndex > -1) {
                    // if non flat child columns are handled by parents
                    if (sheetHandler.process.exportIsNonFlat) {
                      continue;
                    }

                    // determine entire parent property path
                    parentProperty = propertyName.substr(0, propertyOfAnObjectIndex);

                    // we're interested in removing columns only for non flat file types
                    if (!sheetHandler.process.exportIsNonFlat) {
                      // parent property is split between multiple levels ?
                      const parentPropertyValues = parentProperty.split('.');
                      parentPropertyTokenTranslation = '';
                      let splitParentFull = '';
                      for (let parentPropertyValueIndex = 0; parentPropertyValueIndex < parentPropertyValues.length; parentPropertyValueIndex++) {
                        // retrieve parent of parent :)
                        const splitParent = parentPropertyValues[parentPropertyValueIndex];

                        // remove parent column
                        splitParentFull = `${splitParentFull ? splitParentFull + '.' : splitParentFull}${splitParent}`;
                        removeLastColumnIfSamePath(splitParentFull);

                        // append parent name
                        const possibleParentToken = sheetHandler.columns.labels[splitParentFull] ?
                          sheetHandler.columns.labels[splitParentFull] :
                          sheetHandler.columns.labels[splitParent];
                        parentPropertyTokenTranslation = parentPropertyTokenTranslation ? parentPropertyTokenTranslation + ' ' : parentPropertyTokenTranslation;
                        parentPropertyTokenTranslation += !sheetHandler.useDbColumns && splitParent && possibleParentToken && sheetHandler.dictionaryMap[possibleParentToken] ?
                          sheetHandler.dictionaryMap[possibleParentToken] : (
                            sheetHandler.useDbColumns ?
                              splitParent :
                              undefined
                          );
                      }
                    }
                  }

                  // if property belongs to an object then maybe we should remove the parent column since it isn't necessary anymore
                  if (parentProperty) {
                    // if non flat child columns are handled by parents
                    if (sheetHandler.process.exportIsNonFlat) {
                      // if non flat child columns are handled by parents
                      // nothing
                    } else {
                      // add column
                      if (parentPropertyTokenTranslation) {
                        addHeaderColumn(
                          `${parentPropertyTokenTranslation} ${propertyLabelTokenTranslation}`,
                          propertyName,
                          propertyName,
                          uuid.v4(),
                          undefined,
                          undefined,
                          false
                        );
                      } else {
                        // add column
                        addHeaderColumn(
                          propertyLabelTokenTranslation,
                          propertyName,
                          propertyName,
                          uuid.v4(),
                          undefined,
                          undefined,
                          false
                        );
                      }
                    }
                  } else {
                    // questionnaire column needs to be handled differently
                    if (
                      propertyName === defaultQuestionnaireAnswersKey &&
                      options.questionnaire &&
                      sheetHandler.questionnaireQuestionsData.nonFlat.length > 0
                    ) {
                      // non flat file types have just one column
                      if (sheetHandler.process.exportIsNonFlat) {
                        // value
                        addHeaderColumn(
                          propertyLabelTokenTranslation,
                          propertyName,
                          propertyName,
                          uuid.v4(),
                          (value) => {
                            // no processing ?
                            if (
                              sheetHandler.useDbColumns &&
                              sheetHandler.dontTranslateValues
                            ) {
                              return value;
                            }

                            // map and translate questions in proper order even if questionnaireAnswers is an object, and it won't keep the order, so same label questions will be confusing
                            const originalAnswersMap = {};
                            const formattedAnswers = {};
                            for (let questionIndex = 0; questionIndex < sheetHandler.questionnaireQuestionsData.flat.length; questionIndex++) {
                              // get record data
                              const questionData = sheetHandler.questionnaireQuestionsData.flat[questionIndex];

                              // question header
                              const questionHeader = sheetHandler.questionnaireUseVariablesAsHeaders || sheetHandler.useDbColumns ?
                                questionData.variable : (
                                  sheetHandler.dictionaryMap[questionData.text] ?
                                    sheetHandler.dictionaryMap[questionData.text] :
                                    questionData.text
                                );

                              // determine value
                              const finalValue = value ?
                                value[questionData.variable] :
                                undefined;

                              // process answer value
                              if (finalValue) {
                                // replace date / value labels
                                for (let answerIndex = 0; answerIndex < finalValue.length; answerIndex++) {
                                  // retrieve answer data
                                  const answer = finalValue[answerIndex];

                                  // replace single / multiple answers with labels instead of answer text
                                  // - needs to be before replacing value / date labels
                                  if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_SINGLE_ANSWER') {
                                    if (
                                      !sheetHandler.dontTranslateValues &&
                                      answer.value
                                    ) {
                                      // answer to token
                                      answer.value = questionData.answerKeyToLabelMap[answer.value] ?
                                        questionData.answerKeyToLabelMap[answer.value] :
                                        answer.value;

                                      // translate if we have translation
                                      answer.value = sheetHandler.dictionaryMap[answer.value] ?
                                        sheetHandler.dictionaryMap[answer.value] :
                                        answer.value;
                                    }
                                  } else if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                                    // go through all dropdown answers
                                    if (
                                      !sheetHandler.dontTranslateValues &&
                                      answer.value &&
                                      answer.value.length
                                    ) {
                                      for (let multipleDropdownAnswerIndex = 0; multipleDropdownAnswerIndex < answer.value.length; multipleDropdownAnswerIndex++) {
                                        // answer to token
                                        answer.value[multipleDropdownAnswerIndex] = questionData.answerKeyToLabelMap[answer.value[multipleDropdownAnswerIndex]] ?
                                          questionData.answerKeyToLabelMap[answer.value[multipleDropdownAnswerIndex]] :
                                          answer.value[multipleDropdownAnswerIndex];

                                        // translate if we have translation
                                        answer.value[multipleDropdownAnswerIndex] = sheetHandler.dictionaryMap[answer.value[multipleDropdownAnswerIndex]] ?
                                          sheetHandler.dictionaryMap[answer.value[multipleDropdownAnswerIndex]] :
                                          answer.value[multipleDropdownAnswerIndex];
                                      }
                                    }
                                  }

                                  // replace value
                                  if (
                                    !sheetHandler.useDbColumns &&
                                    answer.hasOwnProperty('value')
                                  ) {
                                    answer[sheetHandler.dictionaryMap['LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_VALUE'] ?
                                      sheetHandler.dictionaryMap['LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_VALUE'] :
                                      'LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_VALUE'
                                    ] = answer.value;
                                    delete answer.value;
                                  }

                                  // replace date
                                  if (
                                    !sheetHandler.useDbColumns &&
                                    answer.hasOwnProperty('date')
                                  ) {
                                    answer[sheetHandler.dictionaryMap['LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_DATE'] ?
                                      sheetHandler.dictionaryMap['LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_DATE'] :
                                      'LNG_PAGE_IMPORT_DATA_LABEL_QUESTIONNAIRE_ANSWERS_DATE'
                                    ] = answer.date;
                                    delete answer.date;
                                  }
                                }
                              }

                              // do we have answers with same header ?
                              // - rename them
                              if (originalAnswersMap[questionHeader]) {
                                // rename previous answers if not named already
                                if (formattedAnswers.hasOwnProperty(questionHeader)) {
                                  // this changes the order, but it doesn't matter since in objects..order isn't guaranteed
                                  formattedAnswers[`${questionHeader} (${originalAnswersMap[questionHeader]})`] = formattedAnswers[questionHeader];
                                  delete formattedAnswers[questionHeader];
                                }

                                // attach current answer
                                formattedAnswers[`${questionHeader} (${questionData.variable})`] = finalValue;
                              } else {
                                // attach answer
                                formattedAnswers[questionHeader] = finalValue;

                                // make sure we know this header was used
                                originalAnswersMap[questionHeader] = questionData.variable;
                              }
                            }

                            // finished
                            return formattedAnswers;
                          },
                          undefined,
                          true
                        );
                      } else {
                        // add questionnaire columns - flat file
                        const addQuestionnaireColumns = (
                          questionData,
                          multiAnswerParentDatePath,
                          multiAnswerParentIndex
                        ) => {
                          // determine number of responses for this question
                          const queryKey = getQuestionnaireQuestionUniqueKey(questionData.variable);
                          let maxNoOfResponsesForThisQuestion = sheetHandler.columns.arrayColumnMaxValues[queryKey] ?
                            sheetHandler.columns.arrayColumnMaxValues[queryKey] :
                            0;

                          // determine how many columns we need to render for this question / children question
                          let answerIndex = 0;
                          if (multiAnswerParentDatePath) {
                            // multi answer children questions need to print only records with a specific date
                            answerIndex = multiAnswerParentIndex;
                            maxNoOfResponsesForThisQuestion = answerIndex + 1;
                          } else {
                            // we should export at least one round of columns even if we don't have data
                            maxNoOfResponsesForThisQuestion = maxNoOfResponsesForThisQuestion < 1 ?
                              1 :
                              maxNoOfResponsesForThisQuestion;
                          }

                          // we need to add question to which we don't have answers (we shouldn't have these cases)
                          // - because otherwise you will see child questions that you don't know for which parent question they were
                          // add number of column necessary to export all responses
                          while (answerIndex < maxNoOfResponsesForThisQuestion) {
                            // question header
                            const questionHeader = sheetHandler.questionnaireUseVariablesAsHeaders || sheetHandler.useDbColumns ?
                              questionData.variable : (
                                sheetHandler.dictionaryMap[questionData.text] ?
                                  sheetHandler.dictionaryMap[questionData.text] :
                                  questionData.text
                              );

                            // date needs to be printed just once
                            // - add column only if needed
                            let questionMultiAnswerDatePath;
                            if (questionData.multiAnswer) {
                              // get multi answer date
                              questionMultiAnswerDatePath = multiAnswerParentDatePath ?
                                multiAnswerParentDatePath :
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].date`;

                              // add date column
                              addHeaderColumn(
                                `${questionHeader} [MD ${answerIndex + 1}]`,
                                questionMultiAnswerDatePath,
                                questionMultiAnswerDatePath,
                                questionData.variable,
                                undefined,
                                undefined,
                                true
                              );
                            }

                            // multiple dropdown ?
                            if (questionData.answerType === 'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE_MULTIPLE_ANSWERS') {
                              // determine number of max responses
                              const queryKeyForMultiple = getQuestionnaireQuestionUniqueKeyForMultipleAnswers(questionData.variable);
                              let maxNoOfResponsesForThisMultipleQuestion = sheetHandler.columns.arrayColumnMaxValues[queryKeyForMultiple] ?
                                sheetHandler.columns.arrayColumnMaxValues[queryKeyForMultiple] :
                                0;

                              // we should export at least one round of columns even if we don't have data
                              maxNoOfResponsesForThisMultipleQuestion = maxNoOfResponsesForThisMultipleQuestion < 1 ?
                                1 :
                                maxNoOfResponsesForThisMultipleQuestion;

                              // attach responses
                              for (let multipleAnswerIndex = 0; multipleAnswerIndex < maxNoOfResponsesForThisMultipleQuestion; multipleAnswerIndex++) {
                                // path
                                const answerPath = multiAnswerParentDatePath ?
                                  `${defaultQuestionnaireAnswersKey}["${questionData.variable}"]` :
                                  `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value[${multipleAnswerIndex}]`;

                                // value
                                addHeaderColumn(
                                  `${questionHeader} [MV ${answerIndex + 1}] ${multipleAnswerIndex + 1}`,
                                  answerPath,
                                  answerPath,
                                  questionData.variable,
                                  (function (localQuestionData, localMultiAnswerParentDatePath, localMultipleAnswerIndex) {
                                    return (value, translatePipe, record) => {
                                      // multi answer map ?
                                      if (localMultiAnswerParentDatePath) {
                                        // determine answer date
                                        const multiAnswerDate = _.get(record, localMultiAnswerParentDatePath);

                                        // find answer
                                        value = (value || []).find((item) => item.date && moment(item.date).isSame(multiAnswerDate, 'day'));
                                        value = value ?
                                          (
                                            value.value ?
                                              value.value[localMultipleAnswerIndex] :
                                              value.value
                                          ) :
                                          value;
                                      }

                                      // not multi answer
                                      return !sheetHandler.dontTranslateValues && localQuestionData.answerKeyToLabelMap[value] ?
                                        (
                                          sheetHandler.dictionaryMap[localQuestionData.answerKeyToLabelMap[value]] !== undefined ?
                                            sheetHandler.dictionaryMap[localQuestionData.answerKeyToLabelMap[value]] :
                                            localQuestionData.answerKeyToLabelMap[value]
                                        ) :
                                        value;
                                    };
                                  })(questionData, multiAnswerParentDatePath, multipleAnswerIndex),
                                  undefined,
                                  true
                                );
                              }
                            } else {
                              // path
                              const answerPath = multiAnswerParentDatePath ?
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"]` :
                                `${defaultQuestionnaireAnswersKey}["${questionData.variable}"][${answerIndex}].value`;

                              // value
                              addHeaderColumn(
                                `${questionHeader} [MV ${answerIndex + 1}]`,
                                answerPath,
                                answerPath,
                                questionData.variable,
                                (function (localQuestionData, localMultiAnswerParentDatePath) {
                                  return (value, translatePipe, record) => {
                                    // multi answer map ?
                                    if (localMultiAnswerParentDatePath) {
                                      // determine answer date
                                      const multiAnswerDate = _.get(record, localMultiAnswerParentDatePath);

                                      // find answer
                                      value = (value || []).find((item) => item.date && moment(item.date).isSame(multiAnswerDate, 'day'));
                                      value = value ?
                                        value.value :
                                        value;
                                    }

                                    // not multi answer
                                    return !sheetHandler.dontTranslateValues && localQuestionData.answerKeyToLabelMap[value] ?
                                      (
                                        sheetHandler.dictionaryMap[localQuestionData.answerKeyToLabelMap[value]] !== undefined ?
                                          sheetHandler.dictionaryMap[localQuestionData.answerKeyToLabelMap[value]] :
                                          localQuestionData.answerKeyToLabelMap[value]
                                      ) :
                                      value;
                                  };
                                })(questionData, multiAnswerParentDatePath),
                                undefined,
                                true
                              );
                            }

                            // need to add child question columns before adding next index column for this question - to keep order of responses for each question
                            questionData.childQuestions.forEach((childQuestion) => {
                              addQuestionnaireColumns(
                                childQuestion,
                                multiAnswerParentDatePath ?
                                  multiAnswerParentDatePath : (
                                    questionData.multiAnswer ?
                                      questionMultiAnswerDatePath :
                                      undefined
                                  ),
                                multiAnswerParentIndex !== undefined ?
                                  multiAnswerParentIndex : (
                                    questionData.multiAnswer ?
                                      answerIndex :
                                      undefined
                                  )
                              );
                            });

                            // next answer index
                            answerIndex++;
                          }
                        };

                        // construct columns for our questionnaire
                        sheetHandler.questionnaireQuestionsData.nonFlat.forEach((questionData) => {
                          addQuestionnaireColumns(
                            questionData,
                            undefined,
                            undefined
                          );
                        });
                      }
                    } else {
                      // add normal column
                      addHeaderColumn(
                        propertyLabelTokenTranslation,
                        propertyName,
                        propertyName,
                        uuid.v4(),
                        !sheetHandler.process.exportIsNonFlat ?
                          undefined :
                          (function (localPropertyName) {
                            return (value, translatePipe) => {
                              // for non flat file types we might need to translate / format value
                              // - array condition must be before object since array ...is an object too...
                              if (
                                value && (
                                  Array.isArray(value) ||
                                  typeof value === 'object'
                                )
                              ) {
                                // format property value
                                const format = (
                                  prefix,
                                  childValue
                                ) => {
                                  // no value ?
                                  if (!childValue) {
                                    return childValue;
                                  }

                                  // response
                                  let response;

                                  // array ?
                                  if (sheetHandler.columns.dontProcessValue[prefix]) {
                                    response = childValue;
                                  } else if (Array.isArray(childValue)) {
                                    // initialize response
                                    response = [];

                                    // start formatting every item
                                    for (let arrayIndex = 0; arrayIndex < childValue.length; arrayIndex++) {
                                      response.push(
                                        format(
                                          `${prefix}[]`,
                                          childValue[arrayIndex]
                                        )
                                      );
                                    }
                                  } else if (
                                    childValue &&
                                    typeof childValue === 'object' &&
                                    !(childValue instanceof Date)
                                  ) {
                                    // initialize object
                                    response = {};

                                    // go through each property and translate both key & value
                                    for (const propertyKey in childValue) {
                                      // get object path
                                      const path = `${prefix}.${propertyKey}`;

                                      // check if we should exclude it
                                      if (
                                        dataFilter &&
                                        dataFilter.projection &&
                                        !dataFilter.projection[path] &&
                                        !sheetHandler.columns.labels[path]
                                      ) {
                                        // jump to next property
                                        continue;
                                      }

                                      // check if we have a label for property
                                      const propPath = sheetHandler.useDbColumns ?
                                        undefined :
                                        sheetHandler.columns.labels[path];
                                      const propPathTranslation = propPath && sheetHandler.dictionaryMap[propPath] ?
                                        sheetHandler.dictionaryMap[propPath] :
                                        propertyKey;

                                      // check if value is location type
                                      if (
                                        childValue[propertyKey] &&
                                        typeof childValue[propertyKey] === 'string' &&
                                        sheetHandler.columns.locationsFieldsMap[path]
                                      ) {
                                        // need to replace location id with location name ?
                                        const locationValue = childValue[propertyKey];
                                        response[propPathTranslation] = !sheetHandler.dontTranslateValues && sheetHandler.locationsMap[locationValue] ?
                                          sheetHandler.locationsMap[locationValue].name :
                                          locationValue;

                                        // attach extra information only if it was requested
                                        if (sheetHandler.columns.includeParentLocationData) {
                                          // attach location id
                                          if (!sheetHandler.dontTranslateValues) {
                                            response[`${propPathTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_ID']}`] = locationValue;
                                          }

                                          // attach location identifiers
                                          response[sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIERS']] = sheetHandler.locationsMap[locationValue] && sheetHandler.locationsMap[locationValue].identifiers ?
                                            sheetHandler.locationsMap[locationValue].identifiersCodes :
                                            [];

                                          // attach parent location geographical level details
                                          response[sheetHandler.dictionaryMap['LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL']] = sheetHandler.locationsMap[locationValue] && sheetHandler.locationsMap[locationValue].parentChainGeoLvlArray ?
                                            sheetHandler.locationsMap[locationValue].parentChainGeoLvlArray.map(translatePipe) :
                                            [];

                                          // attach parent location name details
                                          response[sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_PARENT_LOCATION']] = sheetHandler.locationsMap[locationValue] && sheetHandler.locationsMap[locationValue].parentLocationNamesArrayNames ?
                                            (
                                              sheetHandler.dontTranslateValues ?
                                                sheetHandler.locationsMap[locationValue].parentLocationNamesArrayIds :
                                                sheetHandler.locationsMap[locationValue].parentLocationNamesArrayNames
                                            ) :
                                            [];
                                        }
                                      } else {
                                        // set value
                                        response[propPathTranslation] = format(
                                          path,
                                          childValue[propertyKey]
                                        );
                                      }
                                    }
                                  } else {
                                    // no reason to change it if we don't have a value
                                    if (!childValue) {
                                      response = childValue;
                                    } else {
                                      // date value
                                      childValue = childValue instanceof Date ?
                                        moment(childValue).toISOString() :
                                        childValue;

                                      // normal value
                                      response = !sheetHandler.dontTranslateValues &&
                                      typeof childValue === 'string' && childValue.startsWith('LNG_') ?
                                        translatePipe(childValue) :
                                        childValue;
                                    }
                                  }

                                  // finished
                                  return response;
                                };

                                // start formatting
                                return format(
                                  localPropertyName,
                                  value
                                );
                              }

                              // check if value is location type
                              if (
                                value &&
                                typeof value === 'string' &&
                                sheetHandler.columns.locationsFieldsMap[localPropertyName]
                              ) {
                                // need to replace location id with location name ?
                                return !sheetHandler.dontTranslateValues && sheetHandler.locationsMap[value] ?
                                  sheetHandler.locationsMap[value].name :
                                  value;
                              }

                              // no custom formatter
                              // - translation takes place at next step
                              return value;
                            };
                          })(propertyName),
                        undefined,
                        false
                      );
                    }
                  }

                  // location field ?
                  if (
                    sheetHandler.columns.includeParentLocationData &&
                    sheetHandler.columns.locationsFieldsMap[propertyName]
                  ) {
                    // attach location id
                    if (!sheetHandler.dontTranslateValues) {
                      addHeaderColumn(
                        `${propertyLabelTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_ID']}`,
                        propertyName,
                        propertyName,
                        uuid.v4(),
                        (value) => {
                          return value;
                        },
                        undefined,
                        true
                      );
                    }

                    // attach location identifiers
                    attachLocationIdentifiers(
                      `${propertyLabelTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIERS']}`,
                      sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_IDENTIFIER'],
                      propertyName,
                      propertyName
                    );

                    // attach parent location geographical details
                    attachParentLocationGeographicalLevelDetails(
                      `${propertyLabelTokenTranslation} ${sheetHandler.dictionaryMap['LNG_OUTBREAK_FIELD_LABEL_LOCATION_GEOGRAPHICAL_LEVEL']}`,
                      propertyName,
                      propertyName
                    );

                    // attach parent locations name details
                    attachParentLocationsNameDetails(
                      `${propertyLabelTokenTranslation} ${sheetHandler.dictionaryMap['LNG_LOCATION_FIELD_LABEL_PARENT_LOCATION']}`,
                      propertyName,
                      propertyName
                    );
                  }
                }
              }

              // finished
              return sheetHandler.process.setColumns();
            });
        };

        // determine next batch of rows that we need to export
        const determineBatchOfRecordsToExport = (batchSize) => {
          // retrieve join information too
          const projection = {
            _id: 1,
            rowId: 1
          };
          if (
            sheetHandler.joins &&
            sheetHandler.joins.length > 0
          ) {
            sheetHandler.joins.forEach((join) => {
              projection[`${JOIN_PREFIX}${join.name}`] = 1;
            });
          }

          // determine what we need to export
          return temporaryCollection
            .find(
              {}, {
                limit: batchSize,
                projection
              }
            )
            .toArray();
        };

        // retrieve batch of rows to export
        const retrieveBatchToExport = (records) => {
          // prepare to retrieve records data
          records = records || [];
          const rowIdsToRetrieve = [];
          const rowJoinData = {};
          for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
            // get record data
            const recordInfo = records[recordIndex];

            // do we have joins to merge ?
            if (
              sheetHandler.joins &&
              sheetHandler.joins.length > 0
            ) {
              // attach join data
              rowJoinData[recordInfo.rowId] = {};

              // map join data to record id
              for (let joinIndex = 0; joinIndex < sheetHandler.joins.length; joinIndex++) {
                // get join definitions
                const joinInfo = sheetHandler.joins[joinIndex];

                // map join data to record id
                rowJoinData[recordInfo.rowId][joinInfo.name] = recordInfo[`${JOIN_PREFIX}${joinInfo.name}`];

                // format geo location coordinates
                genericHelpers.covertAddressesGeoPointToLoopbackFormat(rowJoinData[recordInfo.rowId][joinInfo.name]);
              }
            }

            // attach to records that we need to retrieve from database
            rowIdsToRetrieve.push(recordInfo.rowId);
          }

          // do we have something to retrieve ?
          return records.length < 1 ?
            [] :
            (exportDataCollection
              .find({
                _id: {
                  $in: rowIdsToRetrieve
                }
              }, {
                projection: sheetHandler.projection
              })
              .toArray()
              .then((recordsToExport) => {
                // delete records from temporary collection so we don't export them again
                return temporaryCollection
                  .deleteMany({
                    _id: {
                      $in: records.map((record) => record._id)
                    }
                  })
                  .then(() => {
                    // map for easy access because we need to keep order from rowIdsToRetrieve
                    const recordsToExportMap = {};
                    for (let recordIndex = 0; recordIndex < recordsToExport.length; recordIndex++) {
                      // get record data
                      const recordData = recordsToExport[recordIndex];

                      // attach joins data if we have any
                      const recordId = recordsToExport[recordIndex]._id;
                      if (rowJoinData[recordId]) {
                        Object.assign(
                          recordData,
                          rowJoinData[recordId]
                        );
                      }

                      // map for easy export
                      recordsToExportMap[recordId] = recordData;
                    }

                    // finished
                    return {
                      records: recordsToExportMap,
                      order: rowIdsToRetrieve
                    };
                  });
              }));
        };

        // handle relation
        const writeDataToFileDetermineMissingRelationsData = (
          relationsToRetrieve,
          relationsAccumulator,
          record
        ) => {
          for (let relationIndex = 0; relationIndex < relationsToRetrieve.length; relationIndex++) {
            // get relation data
            const relation = relationsToRetrieve[relationIndex];

            // take action accordingly
            // - relations should be ...valid at this point, at least the format
            switch (relation.data.type) {

              // has one
              case RELATION_TYPE.HAS_ONE:

                // determine if we have something to retrieve
                const keyValue = relation.data.keyValue(record);
                if (!keyValue) {
                  continue;
                }

                // initialize retrieval if necessary
                if (!relationsAccumulator[relation.data.collection]) {
                  relationsAccumulator[relation.data.collection] = {};
                }

                // specific type of retrieval
                if (!relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN]) {
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN] = {};
                }

                // attach request for our key if necessary
                if (!relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key]) {
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key] = {
                    relations: {},
                    values: {}
                  };
                }

                // attach relation if necessary, for identification
                if (!relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key].relations[relation.name]) {
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key].relations[relation.name] = {};
                }

                // map id with our relation
                relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key].relations[relation.name][keyValue] = true;

                // attach value to list of records to retrieve
                relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key].values[keyValue] = true;

                // finished
                break;

              // has many
              case RELATION_TYPE.HAS_MANY:

                // determine if we have something to retrieve
                const keyValues = relation.data.keyValues(record);
                if (
                  !keyValues ||
                  !keyValues.length
                ) {
                  continue;
                }

                // initialize retrieval if necessary
                if (!relationsAccumulator[relation.data.collection]) {
                  relationsAccumulator[relation.data.collection] = {};
                }

                // specific type of retrieval
                if (!relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN]) {
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN] = {};
                }

                // attach request for our key if necessary
                if (!relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key]) {
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key] = {
                    relations: {},
                    values: {}
                  };
                }

                // attach relation if necessary, for identification
                if (!relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key].relations[relation.name]) {
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key].relations[relation.name] = {};
                }

                // map ids
                keyValues.forEach((keyValue) => {
                  // map id with our relation
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key].relations[relation.name][keyValue] = true;

                  // attach value to list of records to retrieve
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.KEY_IN][relation.data.key].values[keyValue] = true;
                });

                // finished
                break;

              // get one
              case RELATION_TYPE.GET_ONE:

                // determine if we have something to retrieve
                const query = relation.data.query(record);
                if (!query) {
                  continue;
                }

                // initialize retrieval if necessary
                if (!relationsAccumulator[relation.data.collection]) {
                  relationsAccumulator[relation.data.collection] = {};
                }

                // specific type of retrieval
                if (!relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.GET_ONE]) {
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.GET_ONE] = {};
                }

                // attach request for our key if necessary
                if (!relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.GET_ONE][relation.name]) {
                  relationsAccumulator[relation.data.collection][RELATION_RETRIEVAL_TYPE.GET_ONE][relation.name] = true;
                }

                // finished
                break;
            }
          }
        };

        // process relations
        // - must return promise
        const writeDataToFileProcessRelations = (
          relationsToRetrieve,
          data
        ) => {
          // no relations ?
          if (relationsToRetrieve.length < 1) {
            return Promise.resolve();
          }

          // determine relations for which we need to retrieve data
          const relationsToProcess = {};

          // retrieve missing data
          for (let recordIndex = 0; recordIndex < data.order.length; recordIndex++) {
            // get record data
            const record = data.records[data.order[recordIndex]];

            // record doesn't exist anymore - deleted ?
            if (!record) {
              continue;
            }

            // do we have relations ?
            writeDataToFileDetermineMissingRelationsData(
              relationsToRetrieve,
              relationsToProcess,
              record
            );
          }

          // retrieve relations data
          return new Promise((resolve, reject) => {
            // used to keep data for all relations
            // relation name - relation data
            const relationsResults = {};

            // prepare requests that we need to do to db
            const dbRequests = [];
            Object.keys(relationsToProcess).forEach((collectionName) => {
              // retrieve collection relations
              const collectionRelations = relationsToProcess[collectionName];

              // go through all types of requests that we need to do on this collection
              Object.keys(collectionRelations).forEach((relationRetrieveType) => {
                dbRequests.push({
                  collection: collectionName,
                  retrieveType: relationRetrieveType
                });
              });
            });

            // KEY IN HANDLE
            const keyInHandler = (
              requestData
            ) => {
              // retrieve request definitions
              const requestDefinitions = relationsToProcess[requestData.collection][requestData.retrieveType];

              // do we need to create a simple request or ...and or
              const propKeys = Object.keys(requestDefinitions);
              const hasOrConditions = propKeys.length > 1;

              // construct query condition
              let query = hasOrConditions ? {
                $or: []
              } : null;

              // attach conditions
              const projection = {
                _id: 1
              };
              propKeys.forEach((key) => {
                // construct condition for this key
                const condition = {
                  [key]: {
                    $in: Object.keys(requestDefinitions[key].values)
                  }
                };

                // attach condition
                if (hasOrConditions) {
                  query.$or.push(condition);
                } else {
                  query = condition;
                }

                // make sure we retrieve key too
                projection[key] = 1;

                // construct project
                Object.keys(requestDefinitions[key].relations).forEach((relationName) => {
                  sheetHandler.relationsMap[relationName].data.project.forEach((field) => {
                    projection[field] = 1;
                  });
                });
              });

              // make the request
              return sheetHandler.dbConnection
                .collection(requestData.collection)
                .find(
                  query, {
                    projection
                  }
                )
                .toArray()

                // map data for these relations
                .then((relationRecords) => {
                  // retrieve
                  const propKeys = Object.keys(requestDefinitions);
                  propKeys.forEach((key) => {
                    // map records for fast access
                    const relationRecordsMap = {};
                    for (let relRecordIndex = 0; relRecordIndex < relationRecords.length; relRecordIndex++) {
                      // map
                      relationRecordsMap[relationRecords[relRecordIndex][key]] = relationRecords[relRecordIndex];

                      // replace id
                      relationRecords[relRecordIndex].id = relationRecords[relRecordIndex]._id;
                      delete relationRecords[relRecordIndex]._id;
                    }

                    // determine relations for this request and map ids
                    const relationsForThisRequest = requestDefinitions[key].relations;
                    Object.keys(relationsForThisRequest).forEach((relationName) => {
                      // initialize response if necessary
                      // - it should be necessary :)
                      if (!relationsResults[relationName]) {
                        relationsResults[relationName] = {};
                      }

                      // go through our records and map data
                      const relationExpectingRecords = relationsForThisRequest[relationName];
                      for (let keyValue in relationExpectingRecords) {
                        // not found
                        if (!relationRecordsMap[keyValue]) {
                          continue;
                        }

                        // map
                        relationsResults[relationName][keyValue] = relationRecordsMap[keyValue];
                      }
                    });
                  });
                });
            };

            // get one relation
            const getOneHandler = (
              requestData,
              data
            ) => {
              // retrieve request definitions
              const requestDefinitions = relationsToProcess[requestData.collection][requestData.retrieveType];

              // clone so we can change it
              const relationNames = Object.keys(requestDefinitions);

              // retrieve data for next relation
              let getOnRecordIndex = -1;
              const getOneHandlerGetNextRelation = () => {
                // finished ?
                if (relationNames.length < 1) {
                  return Promise.resolve();
                }

                // get next relation name
                const relationName = relationNames.splice(0, 1)[0];

                // get relation definition
                const relationDefinition = sheetHandler.relationsMap[relationName];

                // construct project
                const projection = {
                  _id: 1
                };
                relationDefinition.data.project.forEach((field) => {
                  projection[field] = 1;
                });

                // construct sort
                const sort = relationDefinition.data.sort;

                // make requests for each record
                const nextRecord = () => {
                  // finished ?
                  getOnRecordIndex++;
                  if (getOnRecordIndex >= data.order.length) {
                    return Promise.resolve();
                  }

                  // get record
                  const record = data.records[data.order[getOnRecordIndex]];

                  // construct query
                  const query = relationDefinition.data.query(record);

                  // make request
                  return sheetHandler.dbConnection
                    .collection(requestData.collection)
                    .find(
                      query, {
                        projection,
                        sort,
                        limit: 1
                      }
                    )
                    .toArray()
                    .then((relationData) => {
                      // get relation data
                      relationData = relationData && relationData.length > 0 ?
                        relationData[0] :
                        undefined;

                      // initialize relation results if necessary
                      if (!relationsResults[relationName]) {
                        relationsResults[relationName] = {};
                      }

                      // store it for later use
                      relationsResults[relationName][record._id] = relationData;
                    })
                    .then(nextRecord);
                };

                // get relations
                return nextRecord()
                  .then(getOneHandlerGetNextRelation);
              };

              // make db requests
              return getOneHandlerGetNextRelation();
            };

            // api request - we will do them synchronously so we use...less memory
            const getNextRelationData = () => {
              // finished ?
              if (dbRequests.length < 1) {
                return resolve(relationsResults);
              }

              // retrieve next request
              const requestData = dbRequests.splice(0, 1)[0];

              // depending on relation type we need to handle things differently
              switch (requestData.retrieveType) {
                case RELATION_RETRIEVAL_TYPE.KEY_IN:
                  keyInHandler(requestData)
                    .then(getNextRelationData)
                    .catch(reject);

                  // finish
                  break;

                case RELATION_RETRIEVAL_TYPE.GET_ONE:
                  getOneHandler(
                    requestData,
                    data
                  )
                    .then(getNextRelationData)
                    .catch(reject);

                  // finish
                  break;
              }

            };

            // start retrieving data
            getNextRelationData();
          });
        };

        // attach relations data to record
        const writeDataToFileAttachRelations = (
          relationsToRetrieve,
          record,
          relationsData
        ) => {
          for (let relIndex = 0; relIndex < relationsToRetrieve.length; relIndex++) {
            // get relation
            const relation = relationsToRetrieve[relIndex];

            // nothing to set here ?
            if (!relationsData[relation.name]) {
              continue;
            }

            // set data
            switch (relation.data.type) {
              case RELATION_TYPE.HAS_ONE:
                // relationship value
                const keyValue = relation.data.keyValue(record);

                // set value for this relationship
                record[relation.name] = relationsData[relation.name][keyValue] ?
                  _.cloneDeep(relationsData[relation.name][keyValue]) :
                  undefined;

                // do we have an after method ?
                if (relation.data.after) {
                  relation.data.after(record);
                }

                // finished
                break;

              case RELATION_TYPE.HAS_MANY:
                // relationship value
                const keyValues = relation.data.keyValues(record);

                // set value for this relationship
                if (
                  !keyValues ||
                  !keyValues.length
                ) {
                  record[relation.name] = undefined;
                } else {
                  record[relation.name] = [];
                  keyValues.forEach((keyValue) => {
                    // nothing to do ?
                    if (!relationsData[relation.name][keyValue]) {
                      return;
                    }

                    // add
                    record[relation.name].push(relation.data.format(
                      _.cloneDeep(relationsData[relation.name][keyValue]),
                      sheetHandler.dontTranslateValues
                    ));
                  });
                }

                // do we have an after method ?
                if (relation.data.after) {
                  relation.data.after(record);
                }

                // finished
                break;

              case RELATION_TYPE.GET_ONE:
                // set value for this relationship
                record[relation.name] = relationsData[relation.name][record._id];

                // do we have an after method ?
                if (relation.data.after) {
                  relation.data.after(record);
                }

                // finished
                break;
            }
          }
        };

        // retrieve data like missing tokens, ...
        // all locations should've been retrieved above - location initialization
        const writeDataToFileDetermineMissingData = (data) => {
          // missing data definitions
          const missingData = {
            tokens: {}
          };

          // since all we do here is to retrieve missing tokens for now
          // - if values don't need to be translated then there is no point in continuing
          if (sheetHandler.dontTranslateValues) {
            return missingData;
          }

          // retrieve missing data
          // faster than a zombie
          for (let recordIndex = 0; recordIndex < data.order.length; recordIndex++) {
            // get record data
            const record = data.records[data.order[recordIndex]];

            // record doesn't exist anymore - deleted ?
            if (!record) {
              continue;
            }

            // determine missing data
            for (let columnIndex = 0; columnIndex < sheetHandler.columns.headerColumns.length; columnIndex++) {
              // get data
              const column = sheetHandler.columns.headerColumns[columnIndex];

              // if column is anonymized then there is no need to retrieve data for this cell
              // - or column can't contain language tokens
              if (
                column.anonymize ||
                column.doesntContainLanguageToken ||
                column.path === '_id'
              ) {
                continue;
              }

              // do we have a formula ?
              let cellValue;
              if (column.formula) {
                // retrieve result from formula
                cellValue = column.formula(
                  // value
                  _.get(record, column.path),

                  // translate pipe
                  (token) => {
                    // add to translate if necessary
                    if (!sheetHandler.dictionaryMap[token]) {
                      missingData.tokens[token] = true;
                    }

                    // no need to return translation at this point
                    // nothing
                  },

                  // record data
                  record
                );
              } else {
                // determine value from column path
                cellValue = _.get(
                  record,
                  column.path
                );
              }

              // check if we have missing tokens, locations ...
              if (
                cellValue &&
                typeof cellValue === 'string'
              ) {
                // missing token ?
                if (cellValue.startsWith('LNG_')) {
                  if (!sheetHandler.dictionaryMap[cellValue]) {
                    missingData.tokens[cellValue] = true;
                  }
                }
              } else if (
                // custom token generator ?
                column.translate
              ) {
                column.translate(
                  cellValue,
                  (token) => {
                    // add to translate if necessary
                    if (!sheetHandler.dictionaryMap[token]) {
                      missingData.tokens[token] = true;
                    }

                    // no need to return translation at this point
                    // nothing
                  }
                );
              }
            }
          }

          // finished
          return missingData;
        };

        // handle write data to file
        const writeDataToFile = (data) => {
          // for context’s sake, need to define it locally
          // - promise visibility
          const recordData = data;

          // check if at least one answer is alerted
          const answersCheckAlerted = (modelInstance) => {
            // check if modelInstance has questionnaire answers
            if (
              !modelInstance ||
              !modelInstance.questionnaireAnswers
            ) {
              return false;
            }

            // check if we need to mark follow-up as alerted because of questionnaire answers
            const props = Object.keys(modelInstance.questionnaireAnswers);
            for (let propIndex = 0; propIndex < props.length; propIndex++) {
              // get answer data
              const questionVariable = props[propIndex];
              const answers = modelInstance.questionnaireAnswers[questionVariable];

              // retrieve answer value
              // only the newest one is of interest, the old ones shouldn't trigger an alert
              // the first item should be the newest
              const answerKey = answers && answers.length ?
                answers[0].value :
                undefined;

              // there is no point in checking the value if there isn't one
              if (
                !answerKey &&
                typeof answerKey !== 'number'
              ) {
                continue;
              }

              // at least one alerted ?
              if (Array.isArray(answerKey)) {
                // go through all answers
                for (let answerKeyIndex = 0; answerKeyIndex < answerKey.length; answerKeyIndex++) {
                  if (
                    sheetHandler.questionsWithAlertAnswersMap[questionVariable] &&
                    sheetHandler.questionsWithAlertAnswersMap[questionVariable][answerKey[answerKeyIndex]]
                  ) {
                    return true;
                  }
                }
              } else if (
                sheetHandler.questionsWithAlertAnswersMap[questionVariable] &&
                sheetHandler.questionsWithAlertAnswersMap[questionVariable][answerKey]
              ) {
                return true;
              }
            }

            // return false if no alerted found
            return false;
          };

          // handle relations and children relations
          const processRelations = (levelIndex) => {
            // retrieve relations data
            const relationsToRetrieve = sheetHandler.relationsPerLevel[levelIndex];
            return writeDataToFileProcessRelations(
              relationsToRetrieve,
              recordData
            ).then((relationsData) => {
              // map relation data
              // no relations ?
              if (
                relationsToRetrieve.length < 1 ||
                !relationsData
              ) {
                return;
              }

              // map relations
              for (let recordIndex = 0; recordIndex < data.order.length; recordIndex++) {
                // get record data
                const record = data.records[data.order[recordIndex]];

                // record doesn't exist anymore - deleted ?
                if (!record) {
                  continue;
                }

                // process relations
                writeDataToFileAttachRelations(
                  relationsToRetrieve,
                  record,
                  relationsData
                );
              }
            })
              // retrieve next level relations
              .then(() => {
                // nothing else to retrieve ?
                if (sheetHandler.relationsPerLevel.length <= levelIndex + 1) {
                  return Promise.resolve();
                }

                // retrieve next level of relations
                return processRelations(levelIndex + 1);
              });
          };

          // retrieve necessary data & write record to file
          return Promise.resolve()
            // retrieve relations data
            .then(() => {
              return sheetHandler.relationsPerLevel.length < 1 ?
                Promise.resolve() :
                processRelations(0);
            })

            // retrieve missing language tokens & write data
            .then(() => {
              // determine missing data like tokens, locations, ...
              // - the order doesn't matter here
              const missingData = writeDataToFileDetermineMissingData(recordData);

              // no missing tokens ?
              if (_.isEmpty(missingData.tokens)) {
                return;
              }

              // retrieve missing tokens
              return retrieveMissingTokens(
                sheetHandler.languageId,
                Object.keys(missingData.tokens)
              );
            })

            // write row to file
            .then(() => {
              // write data to file
              // - keep order from sort
              // - since next record increments at the start, to get first item we need to start with -1
              let recordIndex = -1;
              const nextRecord = () => {
                // next record
                recordIndex++;

                // finished ?
                if (recordIndex >= recordData.order.length) {
                  return sheetHandler.process.addedBatch();
                }

                // processed
                sheetHandler.processedNo++;

                // get record data
                const record = recordData.records[recordData.order[recordIndex]];

                // record doesn't exist anymore - deleted ?
                if (!record) {
                  return Promise.resolve();
                }

                // check alerted
                if (
                  options.includeAlerted &&
                  sheetHandler.hasQuestionsWithAlertAnswers
                ) {
                  record[CUSTOM_COLUMNS.ALERTED] = answersCheckAlerted(record);
                }

                // convert geo-points (if any)
                genericHelpers.covertAddressesGeoPointToLoopbackFormat(record);

                // go through data and add create data array taking in account columns order
                const dataArray = [], dataObject = {};
                for (let columnIndex = 0; columnIndex < sheetHandler.columns.headerColumns.length; columnIndex++) {
                  // get data
                  const column = sheetHandler.columns.headerColumns[columnIndex];

                  // if column is anonymized then there is no need to retrieve data for this cell
                  if (column.anonymize) {
                    // non flat data ?
                    if (sheetHandler.process.exportIsNonFlat) {
                      dataObject[column.header] = sheetHandler.columns.anonymizeString;
                    } else {
                      dataArray.push(sheetHandler.columns.anonymizeString);
                    }

                    // next column
                    continue;
                  }

                  // do we have a formula ?
                  let cellValue;
                  if (column.formula) {
                    cellValue = column.formula(
                      // value
                      _.get(record, column.path),

                      // translate pipe
                      (token) => {
                        // go through pipe
                        return !sheetHandler.dontTranslateValues && sheetHandler.dictionaryMap[token] ?
                          sheetHandler.dictionaryMap[token] :
                          token;
                      },

                      // record data
                      record
                    );
                  } else {
                    // determine value from column path
                    cellValue = _.get(
                      record,
                      column.path
                    );

                    // need to replace location id with location name ?
                    if (
                      cellValue &&
                      typeof cellValue === 'string' &&
                      sheetHandler.columns.locationsFieldsMap[column.pathWithoutIndexes]
                    ) {
                      cellValue = !sheetHandler.dontTranslateValues && sheetHandler.locationsMap[cellValue] ?
                        sheetHandler.locationsMap[cellValue].name :
                        cellValue;
                    }
                  }

                  // process data applies for all
                  // - formulas & values
                  if (!sheetHandler.dontTranslateValues) {
                    // replace value ?
                    if (sheetHandler.replacements[column.path]) {
                      cellValue = _.get(
                        record,
                        sheetHandler.replacements[column.path].value
                      );
                    }

                    // do we have a value ?
                    if (cellValue) {
                      // translate
                      if (
                        !column.doesntContainLanguageToken &&
                        column.path !== '_id' &&
                        typeof cellValue === 'string' &&
                        cellValue.startsWith('LNG_')
                      ) {
                        cellValue = sheetHandler.dictionaryMap[cellValue] !== undefined ?
                          sheetHandler.dictionaryMap[cellValue] :
                          cellValue;
                      } else if (
                        // custom token generator ?
                        column.translate
                      ) {
                        cellValue = column.translate(
                          cellValue,
                          (token) => {
                            // go through pipe
                            return sheetHandler.dictionaryMap[token] ?
                              sheetHandler.dictionaryMap[token] :
                              token;
                          }
                        );
                      }
                    }
                  }

                  // format dates
                  if (
                    cellValue &&
                    cellValue instanceof Date
                  ) {
                    // format date as string
                    cellValue = moment(cellValue).toISOString();

                    // remove new lines since these might break files like csv and others
                  } else if (
                    cellValue &&
                    typeof cellValue === 'string'
                  ) {
                    // remove eol from string
                    cellValue = cellValue.replace(
                      REPLACE_NEW_LINE_EXPR,
                      ' '
                    );
                  } else if (
                    typeof cellValue === 'boolean'
                  ) {
                    // convert boolean to a string that can be handled by import
                    cellValue = sheetHandler.process.exportIsNonFlat ?
                      cellValue : (
                        cellValue ? 'TRUE' : 'FALSE'
                      );
                  }

                  // add value to row
                  if (sheetHandler.process.exportIsNonFlat) {
                    dataObject[column.header] = cellValue;
                  } else {
                    dataArray.push(cellValue);
                  }
                }

                // append row
                return sheetHandler.process
                  .addRow(
                    sheetHandler.process.exportIsNonFlat ?
                      dataObject :
                      dataArray
                  )
                  .then(nextRecord);
              };

              // start row writing
              return nextRecord()
                .then(() => {
                  // update export log
                  return sheetHandler.updateExportLog({
                    processedNo: sheetHandler.processedNo,
                    updatedAt: new Date(),
                    dbUpdatedAt: new Date()
                  });
                });
            });
        };

        // process data in batches
        return genericHelpers.handleActionsInBatches(
          () => {
            // create export log entry
            return initializeExportLog()
              // retrieve general language tokens
              .then(initializeLanguageTokens)

              // change export status => Preparing records
              .then(() => {
                return sheetHandler.updateExportLog({
                  statusStep: 'LNG_STATUS_STEP_PREPARING_PREFILTERS',
                  updatedAt: new Date(),
                  dbUpdatedAt: new Date()
                });
              })

              // generate temporary filter collections
              .then(() => {
                return initializeFilterCollections('', [
                  ...sheetHandler.prefilters
                ]);
              })

              // count records from prefilters to determine the best approach of how to export data
              .then(() => {
                return determineFilterIfNeedLookup(
                  '',
                  sheetHandler.prefilters
                );
              })

              // change export status => Preparing records
              .then(() => {
                return sheetHandler.updateExportLog({
                  statusStep: 'LNG_STATUS_STEP_PREPARING_RECORDS',
                  updatedAt: new Date(),
                  dbUpdatedAt: new Date()
                });
              })

              // generate temporary collection - view
              .then(initializeCollectionView)

              // change export status => Preparing locations
              .then(() => {
                return sheetHandler.updateExportLog({
                  statusStep: 'LNG_STATUS_STEP_PREPARING_LOCATIONS',
                  aggregateCompletionDate: new Date(),
                  updatedAt: new Date(),
                  dbUpdatedAt: new Date()
                });
              })

              // retrieve locations
              .then(initializeLocations)

              // change export status => Preparing column headers
              .then(() => {
                return sheetHandler.updateExportLog({
                  statusStep: 'LNG_STATUS_STEP_CONFIGURE_HEADERS',
                  updatedAt: new Date(),
                  dbUpdatedAt: new Date()
                });
              })

              // generate column headers
              .then(initializeColumns)

              // count number of records that we need to export
              .then(() => {
                return temporaryCollection.countDocuments();
              })
              .then((counted) => {
                // change export status => Starting to export data
                return sheetHandler.updateExportLog(
                  {
                    totalNo: counted,
                    statusStep: 'LNG_STATUS_STEP_EXPORTING_RECORDS',
                    updatedAt: new Date(),
                    dbUpdatedAt: new Date()
                  })
                  .then(() => {
                    // start the actual exporting of data
                    return counted;
                  });
              });
          },
          (batchNo, batchSize) => {
            // get row records that we need to export from temporary collection
            // order is natual, which should be the order they were added on, so basically aggregate $sort order - resulting in order from client
            return determineBatchOfRecordsToExport(batchSize)
              .then(retrieveBatchToExport);
          },
          writeDataToFile,
          null,
          sheetHandler.batchSize,
          0,
          console
        );
      })
      .then(() => {
        // should've exported all records - redundant but better check
        return temporaryCollection
          .countDocuments()
          .then((counted) => {
            if (counted > 0) {
              throw new Error('Not all documents were exported');
            }
          });
      })
      .then(sheetHandler.process.finalize)
      .then(() => {
        // drop temporary collection since we finished the export and we don't need it anymore
        return dropTemporaryCollection();
      })
      .then(encryptFiles)
      .then(zipIfMultipleFiles)
      .then(() => {
        // get file size
        let sizeBytes;
        if (fs.existsSync(sheetHandler.filePath)) {
          const stats = fs.statSync(sheetHandler.filePath);
          sizeBytes = stats.size;
        }

        // finished exporting data
        return sheetHandler.updateExportLog({
          status: 'LNG_SYNC_STATUS_SUCCESS',
          statusStep: 'LNG_STATUS_STEP_EXPORT_FINISHED',
          updatedAt: new Date(),
          dbUpdatedAt: new Date(),
          actionCompletionDate: new Date(),
          sizeBytes
        });
      })
      .then(() => {
        // close db connection
        // sheetHandler.dbConnection.close();
        //  #TODO
      })
      .then(() => {
        // finished - stop worker
        parentCallback(null, {
          subject: 'KILL'
        });
      })
      .catch((err) => {
        sheetHandler.updateExportLog(
          {
            status: 'LNG_SYNC_STATUS_FAILED',
            // statusStep - keep as it is because it could help to know where it failed, on what step
            error: err.message,
            errStack: err.stack,
            updatedAt: new Date(),
            dbUpdatedAt: new Date()
          })

          // remove temporary collection if it was created ?
          .then(dropTemporaryCollection)

          // remove file if generated
          .then(deleteTemporaryFile)

          // update export log to contain errors
          .then(() => {
            // throw parent error
            parentCallback(err);
          })
          .catch(() => {
            // throw parent error
            parentCallback(err);
          });
      });
  } catch (err) {
    // something went wrong - stop worker
    parentCallback(err);
  }
}

// generate a filter that will be used by exportFilteredModelsList to do extra filtering based on other collections than the one that is exported
function generateAggregateFiltersFromNormalFilter(
  filter,
  appendWhere,
  acceptedDefinitions
) {
  // aggregate temporary collection definitions
  const collectionFilterDefinitions = {};

  // go through expected definitions
  _.each(acceptedDefinitions, (definition, relationName) => {
    // check if we have everything we need
    if (
      !definition.queryPath ||
      typeof definition.queryPath !== 'string' ||
      !definition.localKey ||
      typeof definition.localKey !== 'string' ||
      !definition.collection ||
      typeof definition.collection !== 'string'
    ) {
      throw new Error('Invalid definition');
    }

    // validate array match key
    if (definition.localKey.indexOf('[]') > -1) {
      if (
        !definition.localKeyArraySize ||
        typeof definition.localKeyArraySize !== 'number' ||
        typeof definition.localKeyArraySize < 1
      ) {
        throw new Error('Invalid definition');
      }
    }

    // validate array match key
    if (
      definition.foreignKey &&
      definition.foreignKey.indexOf('[]') > -1
    ) {
      if (
        !definition.foreignKeyArraySize ||
        typeof definition.foreignKeyArraySize !== 'number' ||
        typeof definition.foreignKeyArraySize < 1
      ) {
        throw new Error('Invalid definition');
      }
    }

    // format definitions
    let relationQuery = _.get(filter, definition.queryPath);
    if (relationQuery) {
      // cleanup
      _.unset(filter, definition.queryPath);

      // nothing to do here
      // - needed so we do unset if empty object is sent
      if (
        definition.ignore || (
          _.isEmpty(relationQuery) &&
          _.isEmpty(definition.prefilters)
        )
      ) {
        return;
      }

      // append deleted if necessary
      if (!filter.deleted) {
        relationQuery = {
          $and: [
            relationQuery, {
              deleted: false
            }
          ]
        };
      }

      // append extra details if necessary
      if (!_.isEmpty(appendWhere)) {
        relationQuery = {
          $and: [
            relationQuery,
            appendWhere
          ]
        };
      }

      // append extra details if necessary
      if (!_.isEmpty(definition.queryAppend)) {
        relationQuery = {
          $and: [
            relationQuery,
            definition.queryAppend
          ]
        };
      }

      // attach geo restrictions, outbreak, delete conditions, etc & other things ... ?
      // #TODO

      // construct collection aggregate query
      collectionFilterDefinitions[relationName] = {
        collection: definition.collection,
        filter: {
          where: relationQuery
        },
        localKey: definition.localKey,
        localKeyArraySize: definition.localKeyArraySize,
        foreignKey: definition.foreignKey ?
          definition.foreignKey :
          '_id',
        foreignKeyArraySize: definition.foreignKeyArraySize,
        prefilters: definition.prefilters
      };
    }
  });

  // finished
  return collectionFilterDefinitions;
}

/**
 * Construct file name for an exported dossier file
 * @param {Object} resource - Resource to be used
 * @param {Object} resource.rawData - Resource to be used
 * @param {Array} anonymousFields - List of fields that were anonymized
 * @returns {string}
 */
function getNameForExportedDossierFile(resource, anonymousFields = []) {
  // construct file name
  let fileName = '';
  // strip special characters from firstName and lastName if they were not anonymized
  !anonymousFields.includes('lastName') &&
  (fileName += resource.rawData.lastName ? resource.rawData.lastName.replace(/\r|\n|\s|[/\\?%*:|"<>]/g, '').toUpperCase() + ' ' : '');
  !anonymousFields.includes('firstName') &&
  (fileName += resource.rawData.firstName ? resource.rawData.firstName.replace(/\r|\n|\s|[/\\?%*:|"<>]/g, '') : '');
  fileName += (fileName.length ? ' - ' : '') + `${resource.rawData.id}.pdf`;

  return fileName;
}

// exported constants & methods
module.exports = {
  // constants
  RELATION_TYPE,
  JOIN_TYPE,
  TEMPORARY_DATABASE_PREFIX,
  CUSTOM_COLUMNS,

  // methods
  exportFilteredModelsList,
  generateAggregateFiltersFromNormalFilter,
  getNameForExportedDossierFile
};
