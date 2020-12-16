'use strict';

const app = require('../../server');
const referenceData = app.models.referenceData;
const defaultReferenceData = require('./defaultReferenceData.json');
const common = require('./_common');
const async = require('async');

// initialize action options; set _init, _sync flags to prevent execution of some after save scripts
let options = {
  _init: true,
  _sync: true
};

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  let setUpReferenceData = [];

  // go through all reference data categories
  Object.keys(defaultReferenceData).forEach(function (referenceDataCategory) {
    // go through all reference data items
    Object.keys(defaultReferenceData[referenceDataCategory]).forEach(function (referenceDataItem) {
      // build item key
      let referenceDataItemKey = referenceData.getTranslatableIdentifierForValue(referenceDataCategory, referenceDataItem);
      // create reference data item (if not already there
      setUpReferenceData.push(
        function (cb) {
          referenceData
            .findOne({
              deleted: true,
              where: {
                id: referenceDataItemKey
              }
            })
            .then(function (foundReferenceData) {
              if (!foundReferenceData) {
                return referenceData
                  .create(Object.assign({
                    id: referenceDataItemKey,
                    value: referenceDataItemKey,
                    description: `${referenceDataItemKey}_DESCRIPTION`,
                    categoryId: referenceDataCategory,
                    readOnly: defaultReferenceData[referenceDataCategory][referenceDataItem].readOnly,
                    colorCode: defaultReferenceData[referenceDataCategory][referenceDataItem].colorCode,
                    iconId: defaultReferenceData[referenceDataCategory][referenceDataItem].iconId,
                    order: defaultReferenceData[referenceDataCategory][referenceDataItem].order
                  }, common.install.timestamps), options);
              }

              // check if we need to update anything...
              if (
                (
                  defaultReferenceData[referenceDataCategory][referenceDataItem].colorCode !== undefined &&
                  defaultReferenceData[referenceDataCategory][referenceDataItem].colorCode !== foundReferenceData.colorCode
                ) || (
                  defaultReferenceData[referenceDataCategory][referenceDataItem].order !== undefined &&
                  defaultReferenceData[referenceDataCategory][referenceDataItem].order !== foundReferenceData.order
                )
              ) {
                // construct object to update
                const updateProps = {};

                // colorCode
                if (defaultReferenceData[referenceDataCategory][referenceDataItem].colorCode !== undefined) {
                  updateProps.colorCode = defaultReferenceData[referenceDataCategory][referenceDataItem].colorCode;
                }

                // order
                if (defaultReferenceData[referenceDataCategory][referenceDataItem].order !== undefined) {
                  updateProps.order = defaultReferenceData[referenceDataCategory][referenceDataItem].order;
                }

                // update
                return foundReferenceData
                  .updateAttributes(updateProps, options);
              }

              // nothing to do
              return foundReferenceData;
            })
            .then(function () {
              cb();
            })
            .catch(cb);
        }
      );
    });
  });

  // wait for all operations to be done
  async.parallelLimit(setUpReferenceData, 10, function (error) {
    if (error) {
      return callback(error);
    }
    console.log('Default Reference Data Installed');
    callback();
  });
}

module.exports = run;
