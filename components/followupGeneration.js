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
module.exports.getContactsEligibleForFollowup = function (startDate, endDate, outbreakId) {
  return App.models.contact
    .rawFind({
      $and: [
        {
          outbreakId: outbreakId,
          // should have relationships
          hasRelationships: true,
          // at least one of the relationships needs to be active
          'relationshipsRepresentation.active': true,
          // only contacts that are under follow up
          'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP',
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
        personId: 1,
        statusId: 1
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
  let followUpsToUpdate = {};

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

    // ids to delete for the current date
    let followUpIdsToUpdateForDate = [];

    // get list of follow ups that are on the same day as the day we want to generate
    let followUpsInThisDay = contact.followUpsList.filter((followUp) => Helpers.getDate(followUp.date).isSame(followUpDate, 'd'));
    let followUpsInThisDayCount = followUpsInThisDay.length;

    // do not generate over the daily quota
    numberOfFollowUpsPerDay -= followUpsInThisDayCount;

    // for today and in the future,
    // recreate the follow ups that are not performed
    // and generate follow ups until the quota is reached
    if (followUpDate.isSameOrAfter(Helpers.getDateEndOfDay(), 'day')) {
      followUpIdsToUpdateForDate.push(...followUpsInThisDay
        .filter(f => f.statusId === 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED')
        .map(f => f.id)
      );
    }

    // recreate deleted follow ups, by retaining the UID
    followUpIdsToUpdateForDate.forEach(id => {
      followUpsToUpdate[id] = _createFollowUpEntry({
        // used to easily trace all follow ups for a given outbreak
        outbreakId: contact.outbreakId,
        id: id,
        personId: contact.id,
        date: followUpDate.toDate(),
        targeted: targeted,
        // split the follow ups work equally across teams
        teamId: RoundRobin(teams),
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED'
      }, contact);
    });

    // add brand new follow ups, until the daily quota is reached
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
    update: followUpsToUpdate
  };
};

module.exports.dbOperationsQueue = function (opts) {
  const queue = new PromiseQueue({
    autoStart: true,
    concurrency: 10 // we do 10 parallel operation across the entire app
  });

  // count of inserted items into database
  queue.count = 0;

  // we do insert operations in database in batches of 100000
  queue.insertBatchSize = 1e5;

  // for remove operations we need to use at most 1000 operations
  // otherwise mongodb throw error because $in operator is too long
  queue.deleteBatchSize = 900;

  // temporary lists of follow ups to be deleted and added in database
  let addList = [];
  let delList = [];

  // list of records waiting to be added after the deletion of existing record with the same id
  let waitingList = {};

  const _insert = function (arr) {
    return () => App.models.followUp
      .rawBulkInsert(arr, null, opts)
      .then(result => {
        queue.count += result.insertedCount;
        return Promise.resolve();
      });
  };

  const _recreate = function (arr, ignore) {
    return () => App.models.followUp
      .rawBulkHardDelete({
        _id: {
          $in: arr
        }
      })
      .then(() => {
        const records = [];
        arr.forEach(id => {
          records.push(waitingList[id]);
          delete waitingList[id];
        });
        _enqueueForInsert(records, ignore);
      });
  };

  const _enqueueForInsert = function (items, ignore) {
    if (ignore) {
      queue.add(_insert(items));
    } else {
      addList.push(...items);
      if (addList.length >= queue.insertBatchSize) {
        queue.add(_insert(addList));
        addList = [];
      }
    }
  };

  const _enqueueForRecreate = function (items, ignore) {
    if (ignore) {
      queue.add(_recreate(items, ignore));
    } else {
      delList.push(...items);
      if (delList.length >= queue.deleteBatchSize) {
        queue.add(_recreate(delList));
        delList = [];
      }
    }
  };

  return {
    // count of follow ups inserted into database
    insertedCount() {
      return queue.count;
    },
    // adds records into queue to be recreated
    // if the batch size is not reached it waits
    enqueueForRecreate(list) {
      const ids = [];
      for (let id in list) {
        waitingList[id] = list[id];
        ids.push(id);
      }
      _enqueueForRecreate(ids);
    },
    // adds records into queue to be inserted
    // if the batch size is not reached it waits
    enqueueForInsert: _enqueueForInsert,
    // internal queue reference, needed to check when the queue is empty
    internalQueue: queue,
    // settle remaining record to be inserted from database
    // this is needed because at the end there might be records left in the list and the limit is not reached
    // those should be processed as well
    settleRemaining() {
      // make sure there are not left item to process
      // doing this to avoid case when the number of follow ups didn't reach the threshold
      // and were never processed
      if (delList.length) {
        _enqueueForRecreate(delList, true);
      }
      if (addList.length) {
        _enqueueForInsert(addList, true);
      }
      return queue.onIdle();
    }
  };
};
