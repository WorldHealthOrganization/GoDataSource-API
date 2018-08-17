'use strict';

const app = require('../../server');
const referenceData = app.models.referenceData;
const referenceDataParser = require('./../../../components/referenceDataParser');

const defaultReferenceData = {
  'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION': [
    'Confirmed',
    'Probable',
    'Suspect',
    'Not a case (discarded)'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION_CONFIRMED_BY_LAB_RESULT': [
    'Confirmed by PCR',
    'Confirmed by Serology (IgC or IgM)'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_GENDER': [
    'Male',
    'Female'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_OCCUPATION': [
    'Health Care Worker',
    'Civil Servant',
    'Farmer',
    'Teacher',
    'Child',
    'Student',
    'Traditional Healer',
    'Religious Leader',
    'Hunter',
    'Butcher',
    'Taxi Driver',
    'Other',
    'Unknown'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE': [
    'Blood',
    'Skin Biopsy',
    'Throat swab',
    'Sputum'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST': [
    'RT-PCR',
    'IgC or IgM'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT': [
    'Positive',
    'Negative',
    'Inconclusive'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT_STATUS': [
    'In Progress',
    'Completed'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE': [
    'National ID Card',
    'Passport',
    'Vaccination Card',
    "External ID",
    'Other'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_DISEASE': [
    'Ebola Virus disease',
    'Marburg virus disease',
    'Plague, pneumonic',
    'Middle Easi Respiratory Syndrome Coronavirus (MERS-CoV)'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE': [
    'Touched Body Fluids',
    'Direct Physical contact',
    'Touched Or Shared Linens, Clothes, Dishes',
    'Slept, Ate Or Spend Time In Same Household'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_INTENSITY': [
    '1 - Low',
    '2 - Medium',
    '3 - High'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY': [
    '1-5 Times',
    '6-10 Times',
    '11-20 Times',
    'Over 21 Times',
    'Unknown'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_DURATION': [
    'Very Short (seconds)',
    'Short (minutes)',
    'Medium (hours)',
    'Long (days)'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL': [
    '1 - Low',
    '2 - Medium',
    '3 - High'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL': [
    '1 - Low',
    '2 - Medium',
    '3 - High'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION': [
    'Family',
    'Neighbor',
    'Nosocomial Transmission',
    'Co-workers',
    'Friends',
    'Funeral',
    'Travel To Outbreak Area',
    'Unknown'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_OUTCOME': [
    'Alive',
    'Recovered',
    'Deceased'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_QUESTION_ANSWER_TYPE': [
    'Free Text',
    'Numeric',
    'Date/Time',
    'Single Answer',
    'Multiple Answers',
    'File Upload'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_MISCELLANEOUS_CUSTOMIZABLE_UI_ELEMENT': [
    'Hospitalized Case'
  ],
  'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE': [
    'Case',
    'Contact',
    'Event'
  ]
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
