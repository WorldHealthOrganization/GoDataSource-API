/**
 * Timer - Use High Resolution time for tracking times (in milliseconds)
 * @constructor
 */
function Timer() {
  let time;
  this.start = function () {
    time = process.hrtime();
  };
  this.getElapsedMilliseconds = function () {
    let elapsed = process.hrtime(time);
    return ((elapsed[0] * 1e9 + elapsed[1]) / 1e6).toFixed(3);
  };
}

module.exports = Timer;
