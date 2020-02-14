'use strict';

const fs = require('fs');
const _ = require('lodash');
const app = require('../../server');
const referenceData = app.models.referenceData;
const defaultReferenceData = require('./defaultReferenceData.json');
const defaultOutbreakTemplateData = require('./defaultOutbreakTemplateData.json');

function run(callback) {
  // map defaultReferenceData to so we can later map them properly
  const mapRefItemToDumpData = {};
  if (module.methodRelevantArgs.checkDefaultReferenceData) {
    _.each(defaultReferenceData, (referenceDataCategoryItems, referenceDataCategory) => {
      _.each(referenceDataCategoryItems, (refDataItem, refDataItemKey) => {
        // build item key
        let referenceDataItemKey = referenceData.getTranslatableIdentifierForValue(referenceDataCategory, refDataItemKey);
        mapRefItemToDumpData[referenceDataItemKey] = refDataItem;
      });
    });
  }

  // map defaultOutbreakTemplateData to so we can later map them properly
  const mapRefItemToOutbreakTemplate = {};
  if (module.methodRelevantArgs.checkDefaultOutbreakTemplateData) {
    (defaultOutbreakTemplateData.referenceData || []).forEach((item) => {
      mapRefItemToOutbreakTemplate[item.id] = item;
    });
  }

  // retrieve reference data items from database
  referenceData
    .find()
    .then((refDataItems) => {
      // checking items
      (refDataItems || []).forEach((refDataItem) => {
        // check if ref data item is missing from our default reference data item list
        // or something is different :)
        let sameDataInDB = false;
        if (
          (
            module.methodRelevantArgs.checkDefaultReferenceData && (
              mapRefItemToDumpData[refDataItem.id] &&
              // handle differences
              refDataItem.colorCode === mapRefItemToDumpData[refDataItem.id].colorCode &&
              refDataItem.order === mapRefItemToDumpData[refDataItem.id].order
            )
          ) || (
            module.methodRelevantArgs.checkDefaultOutbreakTemplateData && (
              mapRefItemToOutbreakTemplate[refDataItem.id]
              // !IMPORTANT: in this case differences are handled by dumpOutbreakTemplateData
            )
          )
        ) {
          sameDataInDB = true;
        }

        // not found, or different ?
        if (!sameDataInDB) {
          // add / update defaultReferenceData
          let itemToUpdate;
          if (mapRefItemToDumpData[refDataItem.id]) {
            // update
            itemToUpdate = mapRefItemToDumpData[refDataItem.id];
          } else {
            // approximate ref data item key
            const refDataItemKey = refDataItem.id.substr(refDataItem.categoryId.length + 1).trim();

            // create
            itemToUpdate = {
              readOnly: false
            };

            // add it to the list
            defaultReferenceData[refDataItem.categoryId][refDataItemKey] = itemToUpdate;
          }

          // update fields
          itemToUpdate.colorCode = refDataItem.colorCode;
          itemToUpdate.order = refDataItem.order;
        }
      });

      // output
      if (module.methodRelevantArgs.export) {
        fs.writeFile(
          module.methodRelevantArgs.export,
          JSON.stringify(defaultReferenceData, null, 2),
          (err) => {
            // an error occurred ?
            if (err) {
              return callback(err);
            }

            // finished
            console.log('Dumped reference data to file');
            callback();
          }
        );
      } else {
        // finished
        console.log('Finished determining reference data items');
        callback();
      }
    })
    .catch(callback);
}

module.exports = (methodRelevantArgs) => {
  // keep arguments
  module.methodRelevantArgs = methodRelevantArgs;

  // finished
  return run;
};
