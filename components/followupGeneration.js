'use strict';

// dependencies
const App = require('../server/server');
const RoundRobin = require('rr');
const Helpers = require('./helpers');
const Moment = require('moment');

// get contacts that has inconclusive follow up period (IN THE PAST)
// this means the last follow up has one of the following flags set (completed, lost)
module.exports.getContactsWithInconclusiveLastFollowUp = function (startDate) {
  return App.models.contact
    .find({
      include: [
        {
          relation: 'followUps',
          scope: {
            order: ['createdAt DESC'],
            limit: 1
          }
        }
      ],
      where: {
        followUp: {
          neq: null
        },
        'followUp.endDate': {
          lt: startDate
        }
      }
    })
    // filter out contacts whose last follow up is not completed or lost
    .then((contacts) => {
      return contacts
        .filter((contact) =>
          contact.followUps().length ?
            (!contact.followUps()[0].completed || contact.followUps()[0].lostToFollowUp) : false
        )
        .map((contact) => {
          contact.inconclusive = true;
          return contact;
        });
    });
};

// get contacts that have follow up period between the passed start/end dates
module.exports.getContactsEligibleForFollowup = function (startDate, endDate) {
  return App.models.contact
    .find({
      where: {
        and: [
          {
            followUp: {
              neq: null
            }
          },
          {
            or: [
              {
                // follow up period is inside contact's follow up period
                and: [
                  {
                    'followUp.startDate': {
                      lte: startDate
                    }
                  },
                  {
                    'followUp.endDate': {
                      gte: endDate
                    }
                  }
                ]
              },
              {
                // period starts before contact's start date but ends before contact's end date
                and: [
                  {
                    'followUp.startDate': {
                      gte: startDate
                    }
                  },
                  {
                    'followUp.startDate': {
                      lte: endDate
                    }
                  },
                  {
                    'followUp.endDate': {
                      gte: endDate
                    }
                  }
                ]
              },
              {
                // period starts before contact's end date and after contact's start date
                // but stops after contact's end date
                and: [
                  {
                    'followUp.startDate': {
                      lte: startDate
                    }
                  },
                  {
                    'followUp.endDate': {
                      gte: startDate
                    }
                  },
                  {
                    'followUp.endDate': {
                      lte: endDate
                    }
                  }
                ]
              },
              {
                // contact's period is inside follow up period
                and: [
                  {
                    'followUp.startDate': {
                      lte: startDate
                    }
                  },
                  {
                    'followUp.endDate': {
                      gte: startDate
                    }
                  },
                  {
                    'followUp.endDate': {
                      lte: endDate
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    });
};

// get list of follow ups ordered by created date for a given contact
module.exports.getContactFollowups = function (contactId) {
  return App.models.followUp
    .find({
      where: {
        personId: contactId
      },
      order: 'createdAt DESC'
    });
};

// retrieve all teams and corresponding location/sub location
module.exports.getAllTeamsWithLocationsIncluded = function () {
  return App.models.team.find()
    .then((teams) => Promise.all(teams.map((team) => {
      return new Promise((resolve, reject) => {
        return App.models.location
          .getSubLocations(team.locationIds, [], (err, locations) => {
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
module.exports.generateFollowupsForContact = function (contact, teams, period, freq, freqPerDay, reqOpts, targeted, ignorePeriod) {
  // list of follow up create promise functions that should be executed
  let followUpsToAdd = [];
  // list of follow ups that are in the future and should be deleted, as the newly generated will take their place
  let followUpsToDelete = [];

  if (!ignorePeriod) {
    // if passed period is higher than contact's follow up period
    // restrict follow up start/date to a maximum of contact's follow up period
    let firstIncubationDay = Helpers.getUTCDate(contact.followUp.startDate);
    let lastIncubationDay = Helpers.getUTCDate(contact.followUp.endDate);
    if (period.endDate.isAfter(lastIncubationDay)) {
      period.endDate = lastIncubationDay.clone();
    }
    if (period.startDate.isBefore(firstIncubationDay)) {
      period.startDate = firstIncubationDay.clone();
    }
  }

  // generate follow up, starting from today
  for (let followUpDate = period.startDate.clone(); followUpDate <= period.endDate; followUpDate.add(freq, 'day')) {
    let generatedFollowUps = [];

    // number of follow ups to be generated per day
    let numberOfFollowUpsPerDay = freqPerDay;

    // check if the follow up date is in the past
    // if so, check if the number of existing follow ups is the same as the generate frequency per day
    // if so, do not generate any follow ups
    if (followUpDate.isBefore(Helpers.getUTCDate())) {
      let followUpsInThisDay = contact.followUpsLists
        .filter((followUp) => Moment(followUp.date).isSame(followUpDate, 'd'));
      numberOfFollowUpsPerDay = numberOfFollowUpsPerDay - followUpsInThisDay.length;
    }

    for (let i = 0; i < numberOfFollowUpsPerDay; i++) {
      generatedFollowUps.push(
        App.models.followUp
          .create({
            // used to easily trace all follow ups for a given outbreak
            outbreakId: contact.outbreakId,
            personId: contact.id,
            date: followUpDate.toDate().toISOString(),
            performed: false,
            targeted: targeted,
            // split the follow ups work equally across teams
            teamId: RoundRobin(teams),
          }, reqOpts)
      );
    }

    // if there are follow ups on the same day and day is in the future
    // delete them and then insert the newly generated
    if (!followUpDate.isBefore(Helpers.getUTCDate())) {
      let existingFollowups = contact.followUpsLists.filter((followUp) => Moment(followUp.date).isSame(followUpDate, 'd'));
      if (existingFollowups.length) {
        followUpsToDelete.push(
          App.models.followUp.destroyAll({
            id: {
              inq: existingFollowups.map((f) => f.id)
            }
          })
        );
      }
    }

    followUpsToAdd.push(...generatedFollowUps);
  }

  return Promise.all(followUpsToAdd)
    .then((createdFollowups) => Promise.all(followUpsToDelete).then(() => createdFollowups));
};
