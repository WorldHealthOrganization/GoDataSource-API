'use strict';

module.exports = function (Person) {

  Person.hasController = false;

  // define a list of custom (non-loopback-supported) relations
  Person.customRelations = {
    relationships: {
      type: 'hasManyEmbedded',
      model: 'relationship',
      foreignKey: 'persons.id'
    }
  };

  // define a list of nested GeoPoints (they need to be handled separately as loopback does not handle them automatically)
  Person.nestedGeoPoints = [
    'addresses[].geoLocation',
    'address.geoLocation'
  ];

  /**
   * Construct and return the display name of the person
   */
  Person.prototype.getDisplayName = function () {
    return Person.getDisplayName(this);
  };

  /**
   * Construct and return the display name of a given person
   * @param person Model or JSON representation
   */
  Person.getDisplayName = function (person) {
    if (person.toJSON) {
      person = person.toJSON();
    }

    // construct display name
    if (person.name) {
      // for events if they have the name set return the name
      return this.name;
    } else {
      // for case/contact return 'firstName middleName lastName'
      return ['firstName', 'middleName', 'lastName'].reduce(function (result, property) {
        if (person[property]) {
          result += (result.length ? ' ' : '') + person[property];
        }
        return result;
      }, '');
    }
  };
};
