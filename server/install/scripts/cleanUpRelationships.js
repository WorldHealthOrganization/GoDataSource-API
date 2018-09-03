/**
 * This is a mongo script that will delete/modify relationships that are incorrect.
 *
 * The purpose of this script is to make sure that the DB has only correct relationships (with 2 persons)
 * This script does not verify that the persons actually exists. All it does is force relationships to
 * have 2 persons with types that are compatible (case-case, case-event, case-contact, event-event, event-contact).
 *
 * To run the script, simply type 'mongo <path-to-this-file> in the terminal'
 */

db = db.getSiblingDB('go-data');

db.relationship.find({}).forEach((relationship) => {
    // We use var since mongo cannot interpret let
    var source;
    var target;

    source = relationship.persons.slice().reverse().find(person => person.type === 'case' || person.type === 'event');

    //If the relationship does not have a case or an event, it cannot be a valid relationship
    if (!source) {
      db.relationship.remove({'_id': relationship._id});
    } else {
      var firstContact = relationship.persons.find(person => person.type === 'contact');
      if (firstContact) {
        target = firstContact;
        // We make sure the target property is set to true, in case the data did not contain this information
        target.target = true;
        db.relationship.updateOne({'_id': relationship._id}, {$set: {persons: [target, source]}});
      }

      // If the relationship does not contain any contacts, try to look for an event, but make sure it is not the one we
      // set as the source
      if (!target) {
        var firstEvent = relationship.persons.find(person => person.type === 'event' && person.id != source.id);
        if (firstEvent) {
          target = firstEvent;
          // We make sure the target property is set to true, in case the data did not contain this information
          target.target = true;
          db.relationship.updateOne({'_id': relationship._id}, {$set: {persons: [target, source]}});
        }
      }

      // If the relationship does not contain any contacts or events, try to look for a case, but make sure it is not the one we
      // set as the source
      if (!target) {
        var firstCase = relationship.persons.find(person => person.type === 'case' && person.id != source.id);
        if (firstCase) {
          target = firstCase;
          // We make sure the target property is set to true, in case the data did not contain this information
          target.target = true;
          db.relationship.updateOne({'_id': relationship._id}, {$set: {persons: [target, source]}})
        }
      }

      // If after all these steps we could not find a target, it is safe to assume that the document is corrupt and we can
      // delete it.
      if (!target) {
        db.relationship.remove({'_id': relationship._id});
      }
    }
});
