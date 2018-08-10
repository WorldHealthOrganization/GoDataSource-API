'use strict';

const app = require('../../server');
const referenceData = app.models.referenceData;
const referenceDataParser = require('./../../../components/referenceDataParser');
const defaultReferenceData = require('./defaultReferenceData.json');

/**
 * Run initiation
 * @param callback
 */
function run(callback) {
  let promises = [];

  // go through all reference data categories
  Object.keys(defaultReferenceData).forEach(function (referenceDataCategory) {
    // go through all reference data items
    defaultReferenceData[referenceDataCategory].forEach(function (referenceDataItem) {
      // build item key
      let referenceDataItemKey = referenceDataParser.getTranslatableIdentifierForValue(referenceDataCategory, referenceDataItem);
      // create reference data item (if not already there
      promises.push(
        referenceData.findById(referenceDataItemKey)
          .then(function (foundReferenceData) {
            if (!foundReferenceData) {
              return referenceData.create({
                id: referenceDataItemKey,
                value: referenceDataItemKey,
                description: `${referenceDataItemKey}_DESCRIPTION`,
                categoryId: referenceDataCategory,
                languageId: "english_us",
                readOnly: true
              })
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
