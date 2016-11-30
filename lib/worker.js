var redis = require('redis');
var sockjs = require('sockjs');
var _ = require('underscore');
var validator = require('validator');

module.exports = (function() {

  /**
   * @type {Object}
   */
  var channels = {};

  /**
   * @type {Object}
   */
  var sockjsServer;

  /**
   * @param {Number} port
   * @param {String} [sockjsClientUrl]
   * @param {Object}  [sslOptions]
   * @constructor
   */
  function Worker(port, sockjsClientUrl, sslOptions) {
    var allowedLogs = ['error'];
    var sockjsOptions = {};

    sockjsOptions.log = function(severity, message) {
      if (allowedLogs.indexOf(severity) > -1) {
        console.log(severity + "\t" + message);
      }
    };
    if (sockjsClientUrl) {
      sockjsOptions.sockjs_url = sockjsClientUrl;
    }

    sockjsServer = sockjs.createServer(sockjsOptions);
    this._connectionTimeouts = {};
    this._httpServer = null;
    listen.call(this, port, sslOptions);
  }

  Worker.prototype.stop = function() {
    this._httpServer.close();
  };

  /**
   * @param {String} type
   * @param {Object} data
   */
  Worker.prototype.triggerEventDown = function(type, data) {
    switch (type) {
      case 'down-publish':
        sendDownPublish(data.channel, data.event, data.data);
        break;
      case 'down-status-request':
        sendUpStatusRequest(data.requestId, getChannelsData());
        break;
      default:
        console.log("Invalid down event type: `" + type + "`");
        break;
    }
  };

  Worker.prototype._startConnectionTimeout = function(connection) {
    if (this._connectionTimeouts[connection]) {
      this._stopConnectionTimeout(connection);
    }
    this._connectionTimeouts[connection] = setTimeout(function() {
      connection.close();
    }.bind(this), 1000 * 1000);
  };

  Worker.prototype._stopConnectionTimeout = function(connection) {
    clearTimeout(this._connectionTimeouts[connection]);
    this._connectionTimeouts[connection] = null;
  };

  /**
   * @param {String} channelId
   * @param {String} event
   * @param {Object} data
   */
  var sendDownPublish = function(channelId, event, data) {
    var channel = channels[channelId];
    if (!channel) {
      channel = createChannel(channelId);
      delayedCloseChannel(channelId);
    }
    var content = {channel: channelId, event: event, data: data};
    channel.msgs.push({timestamp: new Date().getTime(), content: content});
    if (channel.msgs.length > 10) {
      channel.msgs.splice(0, channel.msgs.length - 10)
    }
    _.each(channel.subscribers, function(subscriber) {
      subscriber.connection.write(JSON.stringify(content));
    });
  };

  /**
   * @param {String} clientKey
   * @param {Object} data
   */
  var sendUpMessage = function(clientKey, data) {
    process.send({type: 'up-message', data: {clientKey: clientKey, data: data}});
  };

  /**
   * @param {String} channel
   * @param {String} clientKey
   * @param {Object} data
   */
  var sendUpSubscribe = function(channel, clientKey, data) {
    process.send({type: 'up-subscribe', data: {channel: channel, clientKey: clientKey, data: data}});
  };

  /**
   * @param {String} channel
   * @param {String} clientKey
   */
  var sendUpUnsubscribe = function(channel, clientKey) {
    process.send({type: 'up-unsubscribe', data: {channel: channel, clientKey: clientKey}});
  };

  /**
   * @param {Number} requestId
   * @param {Object} channels
   */
  var sendUpStatusRequest = function(requestId, channels) {
    process.send({type: 'up-status-request', data: {requestId: requestId, channels: channels}});
  };

  /**
   * @param {Number} channelId
   * @returns {Object} channel
   */
  var createChannel = function(channelId) {
    channels[channelId] = {subscribers: [], msgs: [], closeTimeout: null};
    return channels[channelId];
  };

  /**
   * @param {Number} channelId
   */
  var delayedCloseChannel = function(channelId) {
    var channel = channels[channelId];
    if (channel) {
      if (channel.closeTimeout) {
        clearTimeout(channel.closeTimeout);
      }
      channel.closeTimeout = setTimeout(function() {
        delete channels[channelId];
      }, 10000);
    }
  };

  /**
   * @return {Object}
   */
  var getChannelsData = function() {
    var channelsData = {};
    _.each(channels, function(channel, channelId) {
      channelsData[channelId] = _.map(channel.subscribers, function(subscriber) {
        return {clientKey: subscriber.connection.id, data: subscriber.data, subscribeStamp: subscriber.subscribeStamp};
      });
    });
    return channelsData;
  };

  /**
   * @param {Number} port
   * @param {Object}  [sslOptions]
   */
  var listen = function(port, sslOptions) {
    var self = this;
    sockjsServer.on('connection', function(connection) {
      if (!connection) {
        // See https://github.com/cargomedia/socket-redis/issues/41
        console.error('Empty WebSocket connection');
        return;
      }
      self._startConnectionTimeout(connection);

      var connectionChannelIds = [];

      /**
       * @param {String} channelId
       */
      var unsubscribe = function(channelId) {
        connectionChannelIds = _.without(connectionChannelIds, channelId);
        var channel = channels[channelId];
        if (!channel) {
          return;
        }
        sendUpUnsubscribe(channelId, connection.id);
        channel.subscribers = _.reject(channel.subscribers, function(subscriber) {
          return subscriber.connection === connection;
        });
        if (channel.subscribers.length == 0) {
          delayedCloseChannel(channelId);
        }
      };

      /**
       * @param {String} channelId
       * @param {String} data
       * @param {Number} [msgStartTime]
       */
      var subscribe = function(channelId, data, msgStartTime) {
        if (_.contains(connectionChannelIds, channelId)) {
          return;
        }
        msgStartTime = msgStartTime || new Date().getTime();
        connectionChannelIds.push(channelId);
        if (!channels[channelId]) {
          createChannel(channelId);
        }
        var channel = channels[channelId];
        clearTimeout(channel.closeTimeout);
        channel.subscribers.push({connection: connection, data: data, subscribeStamp: new Date().getTime()});
        _.each(channel.msgs, function(msg) {
          if (msg.timestamp > msgStartTime) {
            connection.write(JSON.stringify(msg.content));
          }
        });
        sendUpSubscribe(channelId, connection.id, data);
      };

      /**
       * @param {String} channelId
       * @param {String} event
       * @param {Object} data
       */
      var publish = function(channelId, event, data) {
        event = 'client-' + event;
        process.send({type: 'up-publish', data: {channel: channelId, event: event, data: data}});
      };

      /**
       * @param {String} clientKey
       * @param {Object} data
       */
      var message = function(clientKey, data) {
        sendUpMessage(clientKey, data);
      };

      connection.on('data', function(data) {
        try {
          data = JSON.parse(data);

          if (validator.isNull(data.event)) {
            throw new Error('Missing `data.event`: `' + JSON.stringify(data) + '`')
          }
          var eventData = data.data;
          switch (data.event) {
            case 'subscribe':
              if (validator.isNull(eventData.channel) || validator.isNull(eventData.data) || !validator.isInt(eventData.start)) {
                throw new Error('Missing data: `' + JSON.stringify(eventData) + '`')
              }

              subscribe(eventData.channel, eventData.data, eventData.start);
              break;

            case 'unsubscribe':
              if (validator.isNull(eventData.channel)) {
                throw new Error('Missing `data.channel`: `' + JSON.stringify(eventData) + '`')
              }

              unsubscribe(eventData.channel);
              break;

            case 'message':
              if (validator.isNull(eventData.data)) {
                throw new Error('Missing `data.data`: `' + JSON.stringify(eventData) + '`')
              }

              message(connection.id, eventData.data);
              break;

            case 'publish':
              if (typeof eventData.data === 'undefined') {
                eventData.data = null;
              }
              if (validator.isNull(eventData.channel) || validator.isNull(eventData.event)) {
                throw new Error('Missing channel or event: `' + JSON.stringify(eventData) + '`')
              }

              publish(eventData.channel, eventData.event, eventData.data);
              break;

            case 'heartbeat':
              /**
               * SockJS usually sends heartbeats from the server to the client.
               * If a client directly connects to the low level `/websocket` endpoint it
               * should send heartbeats itself from the client to the server.
               */
              self._startConnectionTimeout(connection);
              break;

            default:
              throw new Error('Unexpected event type `' + data.event + '`.');
              break;
          }
        } catch (error) {
          console.error('Error processing WebSocket data: ' + error);
        }
      });
      connection.on('close', function() {
        _.each(connectionChannelIds, function(channelId) {
          unsubscribe(channelId);
        });
        self._stopConnectionTimeout(connection);
      });
    });

    if (sslOptions) {
      this._httpServer = require('https').createServer(sslOptions);
    } else {
      this._httpServer = require('http').createServer();
    }
    sockjsServer.installHandlers(this._httpServer);
    this._httpServer.listen(port);
  };

  return Worker;
})();
