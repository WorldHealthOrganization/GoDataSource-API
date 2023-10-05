'use strict';

module.exports = function(SecurityQuestion) {
  // hidden fields safe for import
  SecurityQuestion.safeForImportHiddenFields = [
    'answer'
  ];
};
