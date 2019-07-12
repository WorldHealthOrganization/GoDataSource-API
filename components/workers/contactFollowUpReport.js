'use strict';

// module dependencies
const MongoClient = require('mongodb').MongoClient;
const DbConfig = require('./../../server/datasources').mongoDb;
const MomentLibrary = require('moment');
const MomentRange = require('moment-range');
const _ = require('lodash');
const Helpers = require('../../components/helpers');

// add moment-range plugin
const Moment = MomentRange.extendMoment(MomentLibrary);

// follow ups collection name
const collectionName = 'followUp';

// collection records batch size
const batchSize = 10000;

// copying this here to not load the whole application in the child process
// too much overhead
const isFollowUpPerformed = function (obj) {
  return [
    'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_OK',
    'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_SEEN_NOT_OK'
  ].indexOf(obj.statusId) >= 0;
};

// create MongoDB connection and return it
const getMongoDBConnection = function () {
  let mongoOptions = {};
  if (DbConfig.password) {
    mongoOptions = {
      auth: {
        user: DbConfig.user,
        password: DbConfig.password
      },
      authSource: DbConfig.authSource
    };
  }
  return MongoClient
    .connect(`mongodb://${DbConfig.host}:${DbConfig.port}`, mongoOptions)
    .then(client => client.db(DbConfig.database));
};

const worker = {
  /**
   * Get total number of contacts that have performed/not performed follow ups in the given range of dates
   * Get % of total contact followed up
   * Get total contacts followed up or not in the given date range
   * @param outbreakId
   * @param startDate
   *
   * @param endDate
   */
  get(outbreakId, startDate, endDate) {
    // parse dates for mongodb conditions
    startDate = Helpers.getDate(startDate).toDate();
    endDate = Helpers.getDateEndOfDay('2019-08-04T06:11:01.354Z').toDate();

    // mongodb date between filter
    const filter = {
      $and: [
        {
          outbreakId: outbreakId,
          date: {
            $gte: startDate,
            $lte: endDate
          }
        }, {
          $or: [
            {
              deleted: false
            },
            {
              deleted: {
                $eq: null
              }
            }
          ]
        }
      ]
    };

    // get range of days
    const range = Moment.range(startDate, endDate);
    const days = Array.from(range.by('days')).map((m => m.toString()));

    // result props
    const result = {
      days: {},
      totalContacts: 0
    };
    days.forEach((day) => {
      result.days[day] = {
        followedUp: 0,
        notFollowedUp: 0,
        percentage: 0
      };
    });

    // map of contacts and days in which it has follow ups
    // this is needed as follow ups come in batches and not always in right order
    const contactFollowUpsMap = new Map();

    // initialize mongodb connection
    return new Promise((resolve) => {
      getMongoDBConnection()
        .then((dbConnection) => {
          // process records in batches
          (function getNextBatch(skip = 0) {
            const cursor = dbConnection
              .collection(collectionName)
              .find(filter, {
                skip: skip,
                limit: batchSize,
                projection: {
                  date: 1,
                  personId: 1,
                  statusId: 1
                }
              });

            cursor
              .toArray()
              .then((records) => {
                if (!records.length) {
                  // get the total count of contacts into the result
                  result.totalContacts = contactFollowUpsMap.size;

                  // calculate the percentage for each day
                  for (let d in result.days) {
                    const currentDay = result.days[d];
                    const percentage = (currentDay.followedUp * 100) / (currentDay.followedUp + currentDay.notFollowedUp);
                    currentDay.percentage = percentage || 0;

                    // convert date back to UTC
                    result.days[Helpers.getDate(d).format()] = currentDay;
                    delete result.days[d];
                  }

                  return resolve(result);
                }

                // group follow ups by day
                const groupedByDayRecords = _.groupBy(records, function (record) {
                  return Helpers.getDate(record.date).toString();
                });

                for (let i = 0; i < days.length; i++) {
                  const currentDate = Helpers.getDate(days[i]);

                  // find all follow ups with same day
                  const day = Object.keys(groupedByDayRecords).find(day => Helpers.getDate(day).isSame(currentDate), 'day');
                  if (day) {
                    // group them by contact
                    // as a contact may have multiple follow ups on same day
                    const groupedByContact = _.groupBy(groupedByDayRecords[day], 'personId');

                    // go trough list of contacts
                    // if we have an entry in the contacts map
                    // if so, check if in the current date, the contact has the follow up performed, if so, skip it
                    // otherwise check status of the follow up and count him as followed up or not
                    for (let contactId in groupedByContact) {
                      if (!contactFollowUpsMap.has(contactId)) {
                        contactFollowUpsMap.set(contactId, []);
                      }
                      const contactSeenDates = contactFollowUpsMap.get(contactId);
                      const seenDateIdx = contactSeenDates.findIndex(dateInfo => dateInfo.date.isSame(currentDate, 'day'));

                      // check if at least one is performed
                      const isPerformed = !!groupedByContact[contactId].filter(fp => isFollowUpPerformed(fp)).length;

                      // if it has a followed up performed now, but the last one for the contact was not
                      // substract one for not followed up count and add one in the followed up count
                      // consequent follow ups for the current day will not be taken into consideration
                      if (seenDateIdx !== -1) {
                        if (contactSeenDates[seenDateIdx].isPerformed) {
                          continue;
                        }
                        // now is performed
                        if (isPerformed) {
                          result.days[days[i]].notFollowedUp--;
                          result.days[days[i]].followedUp++;
                        }
                      } else {
                        if (isPerformed) {
                          result.days[days[i]].followedUp++;
                        } else {
                          result.days[days[i]].notFollowedUp++;
                        }
                      }

                      // add it to history
                      const dateHistory = {
                        date: currentDate,
                        isPerformed: isPerformed
                      };
                      if (seenDateIdx !== -1) {
                        contactSeenDates[seenDateIdx] = dateHistory;
                      } else {
                        contactSeenDates.push(dateHistory);
                      }

                      contactFollowUpsMap.set(contactId, contactSeenDates);
                    }
                  }
                }

                // continue with next batch
                getNextBatch(skip + batchSize);
              });
          })();
        });
    });
  }
};

process.on('message', function (message) {
  worker[message.fn](...message.args)
    .then((result) => {
      process.send([null, result]);
    })
    .catch((error) => {
      process.send([error]);
    });
});
