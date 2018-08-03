'use strict';

module.exports = function (Template) {

  Template.referenceDataFieldsToCategoryMap = {
    disease: 'LNG_REFERENCE_DATA_CATEGORY_DISEASE'
  };

  Template.referenceDataFields = Object.keys(Template.referenceDataFieldsToCategoryMap);
};
