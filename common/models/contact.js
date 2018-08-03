'use strict';

module.exports = function (Contact) {
  // set flag to not get controller
  Contact.hasController = false;

  Contact.referenceDataFieldsToCategoryMap = {
    riskLevel: 'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL',
    gender: 'LNG_REFERENCE_DATA_CATEGORY_GENDER',
    occupation: 'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION',
    'documents.type': 'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE'
  };

  Contact.referenceDataFields = Object.keys(Contact.referenceDataFieldsToCategoryMap);
};
