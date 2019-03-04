'use strict';

// module dependencies
const MongoClient = require('mongodb').MongoClient;
const DbConfig = require('./../../server/datasources').mongoDb;
const Logger = require('./../logger');
const MomentLibrary = require('moment');
const MomentRange = require('moment-range');
const _ = require('lodash');
const Helpers = require('../../components/helpers');

// add moment-range plugin
const Moment = MomentRange.extendMoment(MomentLibrary);

// follow ups collection name
const collectionName = 'followUp';

// collection records batch size
const batchSize = 1000;

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
    endDate = Helpers.getDateEndOfDay(endDate).toDate();

    // mongodb date between filter
    const filter = {
      outbreakId: outbreakId,
      date: {
        $gte: startDate,
        $lte: endDate
      }
    };

    // get range of days
    const range = Moment.range(startDate, endDate);
    const days = Array.from(range.by('days')).map((m => m.toDate()));

    // result props
    const result = {
      days: {},
      totalContacts: 0
    };
    days.forEach((day) => {
      result.days[day.toISOString()] = {
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
              .collection('followUp')
              .find(filter, {
                skip: skip,
                limit: batchSize
              });

            cursor
              .toArray()
              .then((records) => {
                if (!records) {
                  // get the total count of contacts into the result
                  result.totalContacts = contactFollowUpsMap.size;

                  // calculate the percentage for each day
                  result.days.forEach(day => {
                    day.percentage = (day.followedUp * 100) / (day.followedUp + day.notFollowedUp);
                  });

                  return resolve(result);
                }

                // transform date to actual Date objects
                records = records.map((r) => {
                  r.date = new Date(r.date);
                  return r;
                });

                // group follow ups by day
                const groupedByDayRecords = _.groupBy(records, function (record) {
                  return Helpers.getDate(record.date).toDate().toISOString();
                });

                for (let i = 0; i < days.length; i++) {
                  const currentDate = Moment(days[i]);

                  // find all follow ups with same day
                  const day = Object.keys(groupedByDayRecords).find(day => Moment(day).isSame(currentDate), 'day');
                  if (day) {
                    // group them by contact
                    // as a contact may have multiple follow ups on same day
                    const groupedByContact = _.groupBy(groupedByDayRecords[day], 'personId');

                    // go trough list of contacts
                    // if we have an entry in the contacts map
                    // check if it was already counted for this day
                    // if so skip it
                    // otherwise check status of the follow up and count him as expected
                    for (let contactId in groupedByContact) {
                      if (!contactFollowUpsMap.has[contactId]) {
                        contactFollowUpsMap.set(contactId, new Set());
                      }
                      const contactSeenDates = contactFollowUpsMap.get(contactId);
                      const seenDateIdx = contactSeenDates.findIndex(day => day.isSame(currentDate, 'day'));
                      if (seenDateIdx === -1) {
                        continue;
                      }
                      // check if at least one is performed
                      const isPerformed = groupedByContact[contactId].filter(fp => isFollowUpPerformed(fp)).length;
                      if (isPerformed) {
                        result.days[currentDate.toISOString()].followedUp++;
                      } else {
                        result.days[currentDate.toISOString()].notFollowedUp++;
                      }

                      // add it as seen for current date
                      contactFollowUpsMap[contactId].add(currentDate);
                    }
                  }
                }

                // continue with next batch
                return getNextBatch(skip + batchSize);
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
