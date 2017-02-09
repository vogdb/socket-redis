var util = require('util');
var EventEmitter = require('events').EventEmitter;
var _ = require('underscore');
var uuid = require('uuid');

/**
 * @constructor
 */
function StatusRequest() {
  StatusRequest.super_.call(this);

  /** @type {String} */
  this.id = uuid.v4();
  /** @type {Number} */
  this.responsesPending = null;
  /** @type {Object} */
  this.channelsData = {};
}

util.inherits(StatusRequest, EventEmitter);

/**
 * @returns {String}
 */
StatusRequest.prototype.getId = function() {
  return this.id;
};

/**
 * @param {Number} responsesTotal
 */
StatusRequest.prototype.setThreshold = function(responsesTotal) {
  this.responsesPending = responsesTotal;
};

/**
 * @param {Object} channels
 */
StatusRequest.prototype.addResponse = function(channels) {
  _.each(channels, function(clients, channelId) {
    if (!this.channelsData[channelId]) {
      this.channelsData[channelId] = {subscribers: {}};
    }
    _.each(clients, function(client) {
      this.channelsData[channelId].subscribers[client.clientKey] = client;
    }, this);
  }, this);
  this.responsesPending--;
  if (!this.responsesPending) {
    this.emit('complete');
  }
};

/**
 * @returns {Object}
 */
StatusRequest.prototype.getChannelsData = function() {
  return this.channelsData;
};

module.exports = StatusRequest;
