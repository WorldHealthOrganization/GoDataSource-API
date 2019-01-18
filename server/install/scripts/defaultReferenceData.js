'use strict';

const app = require('../../server');
const referenceData = app.models.referenceData;
const defaultReferenceData = require('./defaultReferenceData.json');
const common = require('./_common');

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
  let promises = [];

  // go through all reference data categories
  Object.keys(defaultReferenceData).forEach(function (referenceDataCategory) {
    // go through all reference data items
    Object.keys(defaultReferenceData[referenceDataCategory]).forEach(function (referenceDataItem) {
      // build item key
      let referenceDataItemKey = referenceData.getTranslatableIdentifierForValue(referenceDataCategory, referenceDataItem);
      // create reference data item (if not already there
      promises.push(
        referenceData
          .findById(referenceDataItemKey)
          .then(function (foundReferenceData) {
            if (!foundReferenceData) {
              return referenceData.create(Object.assign({
                id: referenceDataItemKey,
                value: referenceDataItemKey,
                description: `${referenceDataItemKey}_DESCRIPTION`,
                categoryId: referenceDataCategory,
                readOnly: defaultReferenceData[referenceDataCategory][referenceDataItem].readOnly,
                colorCode: defaultReferenceData[referenceDataCategory][referenceDataItem].colorCode,
                iconId: defaultReferenceData[referenceDataCategory][referenceDataItem].iconId
              }, common.install.timestamps), options);
            }
            return foundReferenceData;
          })
      );
    });
  });

  // wait for all operations to be done
  Promise.all(promises)
    .then(function () {
      console.log('Default Reference Data Installed');
      callback();
    })
    .catch(callback);
}

module.exports = run;
