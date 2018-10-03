'use strict';

// dependencies
const App = require('../server/server');
const RoundRobin = require('rr');
const Helpers = require('./helpers');
const Moment = require('moment');

// get contacts that has inconclusive follow up period (IN THE PAST)
// this means the last follow up has one of the following flags set (completed, lost)
module.exports.getContactsWithInconclusiveLastFollowUp = function (date) {
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
          lt: date
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

// get contacts that are eligible for follow up generation
// this means their follow up period is greater than passed date
module.exports.getContactsEligibleForFollowup = function (date) {
  return App.models.contact
    .find({
      where: {
        followUp: {
          neq: null
        },
        'followUp.endDate': {
          gte: date
        }
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
module.exports.generateFollowupsForContact = function (contact, teams, period, freq, freqPerDay, reqOpts, ignorePeriod) {
  // list of follow up create promise functions that should be executed
  let followUpsToAdd = [];
  // list of follow ups that are in the future and should be deleted, as the newly generated will take their place
  let followUpsToDelete = [];

  // last follow up day, based on the given period, starting from today
  // doing this to not generate follow ups for today and next day in case period is 1
  let lastToGenerateFollowUpDay = Helpers.getUTCDate().add(period <= 1 ? 0 : period, 'days');

  if (!ignorePeriod) {
    // if given follow up period is higher than the last incubation day, just use it as a threshold for generation
    let lastIncubationDay = Helpers.getUTCDate(contact.followUp.endDate);
    if (lastToGenerateFollowUpDay.diff(lastIncubationDay, 'days') > 0) {
      lastToGenerateFollowUpDay = lastIncubationDay;
    }
  }

  // generate follow up, starting from today
  for (let now = Helpers.getUTCDate(); now <= lastToGenerateFollowUpDay; now.add(freq, 'day')) {
    let generatedFollowUps = [];
    for (let i = 0; i < freqPerDay; i++) {
      generatedFollowUps.push(
        App.models.followUp
          .create({
            // used to easily trace all follow ups for a given outbreak
            outbreakId: contact.outbreakId,
            personId: contact.id,
            date: now.toDate(),
            performed: false,
            // split the follow ups work equally across teams
            teamId: RoundRobin(teams),
          }, reqOpts)
      );
    }

    // if there is generated follow ups on that day, delete it and re-create
    let existingFollowups = contact.followUpsLists.filter((followUp) => Moment(followUp.date).isSame(now, 'd'));
    if (existingFollowups.length) {
      followUpsToDelete.push(
        App.models.followUp.destroyAll({
          id: {
            inq: existingFollowups.map((f) => f.id)
          }
        })
      );
    }

    followUpsToAdd.push(...generatedFollowUps);
  }

  return Promise.all(followUpsToAdd).then(() => Promise.all(followUpsToDelete));
};
