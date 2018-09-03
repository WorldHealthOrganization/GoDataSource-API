// Example of an update across multiple documents using the multi option.

var MongoClient = require('mongodb').MongoClient;
MongoClient.connect('mongodb://localhost:27017/go-data', function(err, db) {

  // Get a collection
  var collection = db.collection('relationship');

  // Insert a couple of documentations
  collection.insertMany([{a:1, b:1}, {a:1, b:2}], {w:1}, function(err, result) {

    var o = {w:1};
    collection.updateMany({a:1}, {$set:{b:0}}, o, function(err, r) {
      db.close();
    })
  });
});
