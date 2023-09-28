'use strict';

// module dependencies
const MongoClient = require('mongodb').MongoClient;
const DbConfig = require('./../../server/datasources').mongoDb;
const _ = require('lodash');
const convertLoopbackFilterToMongo = require('../../components/convertLoopbackFilterToMongo');
const localizationHelper = require('../../components/localizationHelper');

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
  // make sure it doesn't timeout
  let mongoOptions = {
    keepAlive: true,
    connectTimeoutMS: 1800000, // 30 minutes
    socketTimeoutMS: 1800000 // 30 minutes
  };

  // attach auth credentials
  if (DbConfig.password) {
    mongoOptions = Object.assign(mongoOptions, {
      auth: {
        username: DbConfig.user,
        password: DbConfig.password
      },
      authSource: DbConfig.authSource
    });
  }

  // retrieve mongodb connection
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
   * @param endDate
   * @param whereFilter
   */
  get(
    outbreakId,
    startDate,
    endDate,
    whereFilter
  ) {
    // parse dates for mongodb conditions
    if (startDate) {
      startDate = localizationHelper.getDateStartOfDay(startDate).toDate();
    }

    endDate = endDate ?
      localizationHelper.getDateEndOfDay(endDate).toDate() :
      localizationHelper.getDateEndOfDay().toDate();

    // filter by classification ?
    const classification = _.get(whereFilter, 'classification');
    if (classification) {
      delete whereFilter.classification;
    }

    // create filter date
    let filterDate = {};
    if (startDate && endDate) {
      filterDate = {
        '$gte': startDate,
        '$lte': endDate
      };
    } else {
      filterDate = {
        '$lte': endDate
      };
    }

    // mongodb date between filter
    const filter = {
      $and: [
        {
          outbreakId: outbreakId,
          date: filterDate,
          deleted: false
        }
      ]
    };

    // attach client filter if necessary
    if (!_.isEmpty(whereFilter)) {
      filter.$and.push(convertLoopbackFilterToMongo(whereFilter));
    }

    // get range of days
    let days = [];

    // result props
    const result = {
      days: {},
      totalContacts: 0
    };

    // map of contacts and days in which it has follow ups
    // this is needed as follow ups come in batches and not always in right order
    const contactFollowUpsMap = new Map();

    // initialize mongodb connection
    return new Promise((resolve) => {
      getMongoDBConnection()
        .then((dbConnection) => {
          // retrieve cases with provided classifications ?
          if (!_.isEmpty(classification)) {
            return dbConnection
              .collection('person')
              .find({
                outbreakId: outbreakId,
                type: 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                deleted: false,
                classification: convertLoopbackFilterToMongo(classification)
              }, {
                projection: {
                  _id: 1
                }
              })
              .toArray()
              .then((caseData) => {
                if (_.isEmpty(caseData)) {
                  // there is nothing to retrieve further
                  filter.$and.push({
                    personId: {
                      $in: []
                    }
                  });

                  // finished
                  return dbConnection;
                } else {
                  // retrieve list of cases for which we need to retrieve contacts
                  const caseIds = caseData.map((caseModel) => caseModel._id);

                  // retrieve contact relationships
                  return dbConnection
                    .collection('relationship')
                    .find({
                      outbreakId: outbreakId,
                      deleted: false,
                      $or: [
                        {
                          'persons.0.source': true,
                          'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                          'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                          'persons.0.id': {
                            $in: caseIds
                          }
                        }, {
                          'persons.1.source': true,
                          'persons.1.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CASE',
                          'persons.0.type': 'LNG_REFERENCE_DATA_CATEGORY_PERSON_TYPE_CONTACT',
                          'persons.1.id': {
                            $in: caseIds
                          }
                        }
                      ]
                    }, {
                      projection: {
                        persons: 1
                      }
                    })
                    .toArray()
                    .then((relationshipData) => {
                      // determine contact ids
                      let contactIds = {};
                      (relationshipData || []).forEach((contact) => {
                        const id = contact.persons[0].target ?
                          contact.persons[0].id :
                          contact.persons[1].id;
                        contactIds[id] = true;
                      });
                      contactIds = Object.keys(contactIds);

                      // set filter by person id
                      filter.$and.push({
                        personId: {
                          $in: contactIds
                        }
                      });

                      // finished
                      return dbConnection;
                    });
                }
              });
          } else {
            return dbConnection;
          }
        })
        .then((dbConnection) => {
          // process records in batches
          // order records to find the start date
          (function getNextBatch(skip = 0) {
            const cursor = dbConnection
              .collection(collectionName)
              .find(
                filter,
                Object.assign(
                  {
                    skip: skip,
                    limit: batchSize,
                    projection: {
                      date: 1,
                      personId: 1,
                      statusId: 1
                    }
                  },
                  !startDate ? {sort: {date: 1}} : {}
                )
              );

            cursor
              .toArray()
              .then((records) => {
                // set start date to the older date if it's not set
                if (!startDate) {
                  startDate = records.length > 0 ? records[0].date : endDate;
                }

                // get range of days
                if (days.length < 1) {
                  const range = localizationHelper.getRange(startDate, endDate);
                  days = Array.from(range.by('days')).map((m => m.toString()));

                  // result props
                  days.forEach((day) => {
                    result.days[day] = {
                      followedUp: 0,
                      notFollowedUp: 0,
                      percentage: 0
                    };
                  });
                }

                if (records.length < 1) {
                  // get the total count of contacts into the result
                  result.totalContacts = contactFollowUpsMap.size;

                  // calculate the percentage for each day
                  for (let d in result.days) {
                    const currentDay = result.days[d];
                    const percentage = (currentDay.followedUp * 100) / (currentDay.followedUp + currentDay.notFollowedUp);
                    currentDay.percentage = percentage || 0;

                    // convert date back
                    result.days[localizationHelper.getDateStartOfDay(d).format()] = currentDay;
                    delete result.days[d];
                  }

                  return resolve(result);
                }

                // group follow ups by day
                const groupedByDayRecords = _.groupBy(records, function (record) {
                  return localizationHelper.getDateStartOfDay(record.date).toString();
                });

                for (let i = 0; i < days.length; i++) {
                  const currentDate = localizationHelper.getDateStartOfDay(days[i]);

                  // find all follow ups with same day
                  const day = Object.keys(groupedByDayRecords).find(day => localizationHelper.getDateStartOfDay(day).isSame(currentDate), 'day');
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
