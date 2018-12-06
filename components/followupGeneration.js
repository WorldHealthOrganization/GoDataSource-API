'use strict';

// dependencies
const App = require('../server/server');
const RoundRobin = require('rr');
const Helpers = require('./helpers');
const Moment = require('moment');
const _ = require('lodash');

/**
 *
 * @param startDate
 * @param endDate
 */
const _daysSince = function (startDate, endDate) {
  return (Helpers.getDate(endDate)).diff(Helpers.getDate(startDate), 'days');
};

// attach author timestamps (createdAt, updatedAt, createdBy, updatedBy)
// attach follow up index and address
const _createFollowUpEntry = function (props, contact) {
  // set index based on the difference in days from start date until the follow up set date
  // index is incremented by 1 because if follow up is on exact start day, the counter starts with 0
  props.index = _daysSince(Moment(contact.followUp.startDate), props.date) + 1;

  // set follow up address to match contact's current address
  props.address = App.models.person.getCurrentAddress(contact);

  return props;
};

// get contacts that has inconclusive follow up period
module.exports.getContactsWithInconclusiveLastFollowUp = function (startDate, outbreakId) {
  return App.models.contact
    .rawFind({
      $and: [
        {
          outbreakId: outbreakId
        },
        {
          followUp: {
            $ne: null
          }
        },
        {
          'followUp.endDate': {
            $lt: startDate
          }
        },
        {
          'followUp.status': 'LNG_REFERENCE_DATA_CONTACT_FINAL_FOLLOW_UP_STATUS_TYPE_UNDER_FOLLOW_UP'
        }
      ]
    })
    // filter out contacts whose last follow up is not completed or lost
    .then((contacts) => {
      return contacts.map((contact) => {
        contact.inconclusive = true;
        return contact;
      });
    });
};

// get contacts that have follow up period between the passed start/end dates
module.exports.getContactsEligibleForFollowup = function (startDate, endDate, outbreakId) {
  return App.models.contact
    .rawFind({
      $and: [
        {
          outbreakId: outbreakId
        },
        {
          followUp: {
            $ne: null
          }
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
module.exports.getContactFollowups = function (contactIds) {
  return App.models.followUp
    .rawFind({
      personId: {
        $in: contactIds
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
// if ignore period flag is set, then contact's follow up period is no longer checked
// and follow ups are generated for the passed period no matter what
// this flag is used for generating follow ups for contacts whose last follow up was inconclusive
module.exports.generateFollowupsForContact = function (contact, teams, period, freq, freqPerDay, targeted, ignorePeriod) {
  // list of follow up create promise functions that should be executed
  let followUpsToAdd = [];

  if (!ignorePeriod) {
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
  }

  // generate follow up, starting from today
  for (let followUpDate = period.startDate.clone(); followUpDate <= period.endDate; followUpDate.add(freq, 'day')) {
    // number of follow ups to be generated per day
    let numberOfFollowUpsPerDay = freqPerDay;

    // check if the number of existing follow ups is the same as the generate frequency per day
    // if so, do not generate any follow ups
    let followUpsInThisDay = contact.followUpsList.filter((followUp) => Moment(followUp.date).isSame(followUpDate, 'd'));
    numberOfFollowUpsPerDay = numberOfFollowUpsPerDay - followUpsInThisDay.length;

    for (let i = 0; i < numberOfFollowUpsPerDay; i++) {
      let followUp = _createFollowUpEntry({
        // used to easily trace all follow ups for a given outbreak
        outbreakId: contact.outbreakId,
        personId: contact.id,
        date: followUpDate.toDate().toISOString(),
        targeted: targeted,
        // split the follow ups work equally across teams
        teamId: RoundRobin(teams),
        statusId: 'LNG_REFERENCE_DATA_CONTACT_DAILY_FOLLOW_UP_STATUS_TYPE_NOT_PERFORMED'
      }, contact);

      followUpsToAdd.push(followUp);
    }
  }

  return followUpsToAdd;
};
