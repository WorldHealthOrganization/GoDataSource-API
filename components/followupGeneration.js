'use strict';

// dependencies
const App = require('../server/server');
const RoundRobin = require('rr');
const Helpers = require('./helpers');
const Moment = require('moment');
const _ = require('lodash');
const PromiseQueue = require('p-queue');

// attach author timestamps (createdAt, updatedAt, createdBy, updatedBy)
// attach follow up index and address
const _createFollowUpEntry = function (props, contact) {
  // set index based on the difference in days from start date until the follow up set date
  // index is incremented by 1 because if follow up is on exact start day, the counter starts with 0
  props.index = Helpers.getDaysSince(Moment(contact.followUp.startDate), props.date) + 1;

  // set follow up address to match contact's current address
  props.address = App.models.person.getCurrentAddress(contact);

  return props;
};

// get contacts that have follow up period between the passed start/end dates
module.exports.getContactsEligibleForFollowup = function (startDate, endDate, outbreakId, allowedContactIds) {
  return App.models.contact
    .rawFind({
      $and: [
        {
          outbreakId: outbreakId
        },
        {
          id: {
            $in: allowedContactIds
          }
        },
        {
          followUp: {
            $ne: null
          }
        },
        // only contacts that are under follow up
        {
          'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP'
        },
        {
          $or: [
            {
              // follow up period is inside contact's follow up period
              $and: [
                {
                  'followUp.startDate': {
                    $lte: startDate
                  }
                },
                {
                  'followUp.endDate': {
                    $gte: endDate
                  }
                }
              ]
            },
            {
              // period starts before contact's start date but ends before contact's end date
              $and: [
                {
                  'followUp.startDate': {
                    $gte: startDate
                  }
                },
                {
                  'followUp.startDate': {
                    $lte: endDate
                  }
                },
                {
                  'followUp.endDate': {
                    $gte: endDate
                  }
                }
              ]
            },
            {
              // period starts before contact's end date and after contact's start date
              // but stops after contact's end date
              $and: [
                {
                  'followUp.startDate': {
                    $lte: startDate
                  }
                },
                {
                  'followUp.endDate': {
                    $gte: startDate
                  }
                },
                {
                  'followUp.endDate': {
                    $lte: endDate
                  }
                }
              ]
            },
            {
              // contact's period is inside follow up period
              $and: [
                {
                  'followUp.startDate': {
                    $gte: startDate
                  }
                },
                {
                  'followUp.endDate': {
                    $gte: startDate
                  }
                },
                {
                  'followUp.endDate': {
                    $lte: endDate
                  }
                }
              ]
            }
          ]
        }
      ]
    });
};

// get list of follow ups ordered by created date for a given contact
module.exports.getContactFollowups = function (startDate, endDate, contactIds) {
  return App.models.followUp
    .rawFind({
      personId: {
        $in: contactIds
      },
      $and: [
        {
          date: {
            $gte: startDate
          }
        },
        {
          date: {
            $lte: endDate
          }
        }
      ]
    }, {
      projection: {
        _id: 1,
        date: 1,
        personId: 1
      }
    })
    .then((followUps) => _.groupBy(followUps, (f) => f.personId));
};

// retrieve all teams and corresponding location/sub location
module.exports.getAllTeamsWithLocationsIncluded = function () {
  return App.models.team.find()
    .then((teams) => Promise.all(teams.map((team) => {
      return new Promise((resolve, reject) => {
        return App.models.location
          .getSubLocations(team.locationIds || [], [], (err, locations) => {
            if (err) {
              return reject(err);
            }
            return resolve(locations);
          });
      })
        .then((locations) => {
          team.locations = locations;
          return team;
        });
    })));
};

// get a contact's teams that are eligible for assignment on generated follow ups
module.exports.getContactFollowupEligibleTeams = function (contact, teams) {
  // find all the teams that are matching the contact's location ids from addresses
  let eligibleTeams = [];
  // normalize addresses
  contact.addresses = contact.addresses || [];

  // first get the contact's usual place of residence
  let contactResidence = contact.addresses.find(address => address.typeId === 'LNG_REFERENCE_DATA_CATEGORY_ADDRESS_TYPE_USUAL_PLACE_OF_RESIDENCE');
  if (contactResidence) {
    // try to find index of the address location in teams locations
    let filteredTeams = teams.filter((team) => team.locations.indexOf(contactResidence.locationId) !== -1);
    if (filteredTeams.length) {
      eligibleTeams = filteredTeams.map((team) => team.id);
    }
  } else {
    // check all contact addresses; stop at first address that has a matching team
    for (let i = 0; i < contact.addresses.length; i++) {
      // try to find index of the address location in teams locations
      let filteredTeams = teams.filter((team) => team.locations.indexOf(contact.addresses[i].locationId) !== -1);
      if (filteredTeams.length) {
        eligibleTeams = eligibleTeams.concat(filteredTeams.map((team) => team.id));
        break;
      }
    }
  }

  return Promise.resolve(eligibleTeams);
};

// generate follow ups for a given passed period
module.exports.generateFollowupsForContact = function (contact, teams, period, freq, freqPerDay, targeted) {
  let followUpsToAdd = [];
  let followUpsIdsToDelete = [];

  // if passed period is higher than contact's follow up period
  // restrict follow up start/date to a maximum of contact's follow up period
  let firstIncubationDay = Helpers.getDate(contact.followUp.startDate);
  let lastIncubationDay = Helpers.getDate(contact.followUp.endDate);
  if (period.endDate.isAfter(lastIncubationDay)) {
    period.endDate = lastIncubationDay.clone();
  }
  if (period.startDate.isBefore(firstIncubationDay)) {
    period.startDate = firstIncubationDay.clone();
  }

  // generate follow up, starting from today
  for (let followUpDate = period.startDate.clone(); followUpDate <= period.endDate; followUpDate.add(freq, 'day')) {
    // number of follow ups to be generated per day
    let numberOfFollowUpsPerDay = freqPerDay;

    // get list of follow ups that are on the same day as the day we want to generate
    let followUpsInThisDay = contact.followUpsList.filter((followUp) => Helpers.getDate(followUp.date).isSame(followUpDate, 'd'));
    let followUpsInThisDayCount = followUpsInThisDay.length;

    // if there are follow ups on the same day and day is in the future
    // and frequency per day is less than the count of follow ups in that day
    // delete follow ups until the length is the same as the frequency
    if (followUpDate.isAfter(Helpers.getDateEndOfDay())) {
      // get number of follow ups that should be deleted
      let dustCount = followUpsInThisDayCount - freqPerDay;
      if (dustCount > 0) {
        followUpsIdsToDelete.push(...followUpsInThisDay.splice(0, dustCount).map((f) => f.id));
        // number of follow ups exceeds the frequency per day
        // we no longer need to generate any follow ups on this day
        numberOfFollowUpsPerDay = 0;
      } else {
        // doing this so we can covert negative to positive
        // when frequency per day is bigger than number of follow ups
        numberOfFollowUpsPerDay = Math.abs(dustCount);
      }
    } else {
      // otherwise if the day is in the past, do not delete any follow ups
      // just generate until the limit per day is reached
      // if the result of the operation below is 0 or negative, nothing is generated (limit is reached already)
      numberOfFollowUpsPerDay -= followUpsInThisDayCount;
    }

    for (let i = 0; i < numberOfFollowUpsPerDay; i++) {
      let followUp = _createFollowUpEntry({
        // used to easily trace all follow ups for a given outbreak
        outbreakId: contact.outbreakId,
        personId: contact.id,
        date: followUpDate.toDate(),
        targeted: targeted,
        // split the follow ups work equally across teams
        teamId: RoundRobin(teams),
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED'
      }, contact);

      followUpsToAdd.push(followUp);
    }
  }

  return {
    add: followUpsToAdd,
    remove: followUpsIdsToDelete
  };
};

/**
 * Creates a promise queue for handling database operations
 * This is needed because delete operations with more than 1000 ids in the query will throw an error on the driver
 * @param reqOpts
 * @returns {*}
 */
module.exports.createPromiseQueue = function (reqOpts) {
  let queue = new PromiseQueue({
    autoStart: true,
    concurrency: 10 // we do 10 parallel operation across the entire app
  });

  // count of inserted items into database
  let count = 0;

  // we do insert operations in database in batches of 100000
  const insertBatchSize = 1e5;
  // for remove operations we need to use at most 1000 operations
  // otherwise mongodb throw error because $in operator is too long
  const deleteBatchSize = 900;

  let followUpsToAdd = [];
  let followUpsToDelete = [];

  const _insert = function (arr) {
    return () => App.models.followUp
      .rawBulkInsert(arr, null, reqOpts)
      .then(result => {
        count += result.insertedCount;
        return Promise.resolve();
      });
  };

  const _remove = function (arr) {
    return () => App.models.followUp.rawBulkDelete({
      _id: {
        $in: arr
      }
    });
  };

  return {
    // count of follow ups inserted into database
    insertedCount() {
      return count;
    },
    // internal queue reference, needed to check when the queue is empty
    internalQueue: queue,
    // adds follow ups into queue to be inserted
    // if the batch size is not reached it waits
    addFollowUps(items, ignore) {
      if (ignore) {
        queue.add(_insert(items));
      } else {
        followUpsToAdd.push(...items);
        if (followUpsToAdd.length >= insertBatchSize) {
          queue.add(_insert(followUpsToAdd));
          followUpsToAdd = [];
        }
      }
    },
    // adds follow ups into remove queue
    // if the batch size is not reached it waits
    removeFollowUps(items, ignore) {
      if (ignore) {
        queue.add(_remove(items));
      } else {
        followUpsToDelete.push(...items);
        if (followUpsToDelete.length >= deleteBatchSize) {
          queue.add(_remove(followUpsToDelete));
          followUpsToDelete = [];
        }
      }
    },
    // settle remaining follow ups to be inserted/removed from database
    // this is needed because at the end there might be follow ups left in the list and the limit is not reached
    // those should be processed as well
    settleRemaining() {
      // make sure there are not left item to process
      // doing this to avoid case when the number of follow ups didn't reach the treshold
      // and were never processed
      if (followUpsToAdd.length) {
        this.addFollowUps(followUpsToAdd, true);
      }
      if (followUpsToDelete.length) {
        this.removeFollowUps(followUpsToDelete, true);
      }

      return queue.onIdle();
    }
  };
};
