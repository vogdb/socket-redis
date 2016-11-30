var assert = require('chai').assert;
var _ = require('underscore');
var SockjsClient = require('sockjs-client');
var Worker = require('../lib/worker');

describe('Worker tests', function() {

  var MESSAGES = Object.freeze({
    subscribe: {
      event: 'subscribe', data: {
        channel: 'channel-sample',
        data: 'subscribe data',
        start: new Date().getTime()
      }
    },
    unsubscribe: {
      event: 'unsubscribe', data: {
        channel: 'channel-sample'
      }
    },
    message: {
      event: 'message', data: {
        data: 'message data'
      }
    },
    publish: {
      event: 'publish', data: {
        channel: 'channel-sample',
        data: 'publish data',
        event: 'publish event'
      }
    }
  });

  beforeEach(function() {
    this.worker = new Worker(9090);
  });

  afterEach(function() {
    this.worker.stop();
  });

  it('creates SockJS server', function(done) {
    var client = new SockjsClient('http://localhost:9090');
    client.onopen = function() {
      done();
      client.close();
    };
  });

  context('Proxy of messages', function() {
    var processSend;

    before(function() {
      processSend = process.send;
    });

    after(function() {
      process.send = processSend;
    });

    beforeEach(function(done) {
      this.client = new SockjsClient('http://localhost:9090');
      this.client.onopen = function() {
        done();
      };
      this.client.onerror = done;
    });

    afterEach(function(done) {
      this.client.onclose = function() {
        done();
      };
      this.client.close();
    });

    context('connection send messages', function() {
      it('subscribe', function(done) {
        var expectedMessage = MESSAGES.subscribe;
        process.send = function(actualMessage) {
          process.send = _.noop;
          assert.equal(actualMessage.type, 'up-subscribe');
          assert.equal(actualMessage.data.channel, expectedMessage.data.channel);
          assert.equal(actualMessage.data.data, expectedMessage.data.data);
          done();
        };
        this.client.send(JSON.stringify(expectedMessage));
      });

      it('unsubscribe', function(done) {
        this.client.send(JSON.stringify(MESSAGES.subscribe));

        setTimeout(function() {
          var expectedMessage = MESSAGES.unsubscribe;
          process.send = function(actualMessage) {
            process.send = _.noop;
            assert.equal(actualMessage.type, 'up-unsubscribe');
            assert.equal(actualMessage.data.channel, expectedMessage.data.channel);
            done();
          };
          this.client.send(JSON.stringify(expectedMessage));
        }.bind(this), 0);
      });

      it('message', function(done) {
        var expectedMessage = MESSAGES.message;
        process.send = function(actualMessage) {
          process.send = _.noop;
          assert.equal(actualMessage.type, 'up-message');
          assert.equal(actualMessage.data.data, expectedMessage.data.data);
          done();
        };
        this.client.send(JSON.stringify(expectedMessage));
      });

      it('publish', function(done) {
        var expectedMessage = MESSAGES.publish;
        process.send = function(actualMessage) {
          process.send = _.noop;
          assert.equal(actualMessage.type, 'up-publish');
          assert.equal(actualMessage.data.channel, expectedMessage.data.channel);
          assert.equal(actualMessage.data.data, expectedMessage.data.data);
          assert.equal(actualMessage.data.event, 'client-' + expectedMessage.data.event);
          done();
        };
        this.client.send(JSON.stringify(expectedMessage));
      });
    });

    context('triggerEventDown', function() {
      it('down-status-request', function(done) {
        var subscribeMessage = MESSAGES.subscribe;
        this.client.send(JSON.stringify(subscribeMessage));

        setTimeout(function() {
          var eventData = {requestId: 'request-id'};
          process.send = function(actualMessage) {
            process.send = _.noop;
            assert.equal(actualMessage.type, 'up-status-request');
            assert.equal(actualMessage.data.requestId, eventData.requestId);
            var actualChannel = actualMessage.data.channels[subscribeMessage.data.channel][0];
            assert(actualChannel);
            assert(actualChannel.clientKey);
            assert(actualChannel.subscribeStamp);
            assert.equal(actualChannel.data, subscribeMessage.data.data);
            done();
          };
          this.worker.triggerEventDown('down-status-request', eventData);
        }.bind(this), 0);
      });

      it('down-publish', function(done) {
        var subscribeMessage = MESSAGES.subscribe;
        process.send = function(message) {
          process.send = _.noop;
          assert.equal(message.type, 'up-subscribe');
          this.client.onmessage = function(event) {
            var message = JSON.parse(event.data);
            assert.equal(message.channel, eventData.channel);
            assert.equal(message.event, eventData.event);
            assert.equal(message.data, eventData.data);
            done();
          };
          var eventData = {channel: subscribeMessage.data.channel, event: 'down-publish-event', data: 'down publish data'};
          this.worker.triggerEventDown('down-publish', eventData);
        }.bind(this);

        this.client.send(JSON.stringify(subscribeMessage));
      })
    });
  });


});

