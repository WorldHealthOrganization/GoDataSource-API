'use strict';

const app = require('../../server');
const referenceData = app.models.referenceData;

const defaultReferenceData = {
  "LNG_REFERENCE_DATA_CATEGORY_CASE_CLASSIFICATION": [
    {
      value: 'Confirmed',
      description: ''
    },
    {
      value: 'Probable',
      description: ''
    },
    {
      value: 'Suspect',
      description: ''
    },
    {
      value: 'Not a case (discarded)',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_GENDER": [
    {
      value: 'Male',
      description: ''
    },
    {
      value: 'Female',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_OCCUPATION": [
    {
      value: 'Health Care Worker',
      description: ''
    },
    {
      value: 'Civil Servant',
      description: ''
    },
    {
      value: 'Farmer',
      description: ''
    },
    {
      value: 'Teacher',
      description: ''
    },
    {
      value: 'Child',
      description: ''
    },
    {
      value: 'Student',
      description: ''
    },
    {
      value: 'Traditional Healer',
      description: ''
    },
    {
      value: 'Religious Leader',
      description: ''
    },
    {
      value: 'Hunter',
      description: ''
    },
    {
      value: 'Butcher',
      description: ''
    },
    {
      value: 'Taxi Driver',
      description: ''
    },
    {
      value: 'Other',
      description: ''
    },
    {
      value: 'Unknown',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_LAB_NAME": [],
  "LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_SAMPLE": [
    {
      value: 'Blood',
      description: ''
    },
    {
      value: 'Skin Biopsy',
      description: ''
    },
    {
      value: 'Throat swab',
      description: ''
    },
    {
      value: 'Sputum',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_TYPE_OF_LAB_TEST": [
    {
      value: 'RT-PCR',
      description: ''
    },
    {
      value: 'IgC or IgM',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_LAB_TEST_RESULT": [
    {
      value: 'Positive',
      description: ''
    },
    {
      value: 'Negative',
      description: ''
    },
    {
      value: 'Inconclusive',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_DOCUMENT_TYPE": [
    {
      value: 'National ID Card',
      description: ''
    },
    {
      value: 'Passport',
      description: ''
    },
    {
      value: 'Vaccination Card',
      description: ''
    },
    {
      value: 'Other',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_DISEASE": [
    {
      value: 'Ebola Virus disease',
      description: ''
    },
    {
      value: 'Marburg virus disease',
      description: ''
    },
    {
      value: 'Plague, pneumonic',
      description: ''
    },
    {
      value: 'Middle Easi Respiratory Syndrome Coronavirus (MERS-CoV)',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_TYPE": [
    {
      value: 'Touched Body Fluids',
      description: ''
    },
    {
      value: 'Direct Physical contact',
      description: ''
    },
    {
      value: 'Touched Or Shared Linens, Clothes, Dishes',
      description: ''
    },
    {
      value: 'Slept, Ate Or Spend Time In Same Household',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_INTENSITY": [
    {
      value: '1 - Low',
      description: ''
    },
    {
      value: '2 - Medium',
      description: ''
    },
    {
      value: '3 - High',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_EXPOSURE_FREQUENCY": [
    {
      value: '1-5 Times',
      description: ''
    },
    {
      value: '6-10 Times',
      description: ''
    },
    {
      value: '11-20 Times',
      description: ''
    },
    {
      value: 'Over 21 Times',
      description: ''
    },
    {
      value: 'Unknown',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_CERTAINTY_LEVEL": [
    {
      value: '1 - Low',
      description: ''
    },
    {
      value: '2 - Medium',
      description: ''
    },
    {
      value: '3 - High',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_RISK_LEVEL": [
    {
      value: '1 - Low',
      description: ''
    },
    {
      value: '2 - Medium',
      description: ''
    },
    {
      value: '3 - High',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_CONTEXT_OF_TRANSMISSION": [
    {
      value: 'Family',
      description: ''
    },
    {
      value: 'Neighbor',
      description: ''
    },
    {
      value: 'Nosocomial Transmission',
      description: ''
    },
    {
      value: 'Co-workers',
      description: ''
    },
    {
      value: 'Friends',
      description: ''
    },
    {
      value: 'Funeral',
      description: ''
    },
    {
      value: 'Travel To Outbreak Area',
      description: ''
    },
    {
      value: 'Unknown',
      description: ''
    }
  ],
  "LNG_REFERENCE_DATA_CATEGORY_OUTCOME": [
    {
      value: 'Alive',
      description: ''
    },
    {
      value: 'Recovered',
      description: ''
    },
    {
      value: 'Deceased',
      description: ''
    }
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
      let referenceDataItemKey = referenceData.getTranslatableIdentifierForValue(referenceDataCategory, referenceDataItem.value);
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
                languageId: "english_us"
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
