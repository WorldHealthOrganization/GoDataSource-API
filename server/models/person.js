'use strict';

module.exports = function(Person) {

  // define a list of custom (non-loopback-supported) relations
  Person.customRelations = {
    relationships: {
      type: 'hasManyEmbedded',
      model: 'relationship',
      foreignKey: 'persons.id'
    }
  };

};
