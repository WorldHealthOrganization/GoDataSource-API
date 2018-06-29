'use strict';

module.exports = function (Followup) {
  // set flag to not get controller
  Followup.hasController = false;

  /**
   * Enhance follow up save to include index of the created follow up
   */
  Followup.observe('before save', function (ctx, next) {
    // we are interested only on new instances
    if (!ctx.isNewInstance) {
      return next();
    }

    // retrieve all the follow ups for the given contact, ordered by their date creation
    // to figure out the index of the follow up that should be created
    Followup.getDataSource().connector.collection(Followup.modelName)
      .aggregate([
        {
          $project: {
            _id: 1,
            personId: 1,
            day: {
              $dayOfMonth: '$createdAt'
            },
            month: {
              $month: '$createdAt'
            },
            year: {
              $year: '$createdAt'
            }
          }
        },
        {
          $project: {
            _id: 1,
            personId: 1,
            createdAt: {
              $concat: [{
                $substr: ['$year', 0, 4]
              },
                "-", {
                  $substr: ['$month', 0, 2]
                },
                "-", {
                  $substr: ['$day', 0, 2]
                }
              ]
            }
          }
        },
        {
          $match: {
            // contact's id
            personId: ctx.instance.personId
          }
        },
        {
          $group: {
            _id: {
              createdAt: '$createdAt',
              contactId: '$personId'
            }
          }
        },
        {
          $group: {
            _id: '$_id.createdAt'
          }
        }
      ], (err, results) => {
        if (err) {
          return next(err);
        }

        // results is a list of all follow up that were created prior to this date, distinct per created at date
        ctx.instance.index = ++results.length;

        return next();
      });
  });
};
