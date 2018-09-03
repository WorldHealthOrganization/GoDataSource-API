db = db.getSiblingDB("go-data");

db.relationship.find({}).forEach((relationship) => {
    var newPersons = [relationship.persons[0], relationship.persons[relationship.persons.length - 1]];
    persons = [];
    db.relationship.updateOne({"_id": relationship._id}, {$set: {persons: newPersons}});
});
