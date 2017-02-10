var assert = require('chai').assert;
var _ = require('underscore');
var sinon = require('sinon');
var requestPromise = require('request-promise');
var redis = require('redis');
var RedisServer = require('redis-server');
var Config = require('../lib/config');
var Server = require('../lib/server');

describe('Server tests', function() {

  var config;
  var REDIS_PORT = 6379;

  before(function() {
    config = Config.createFromFile('test/config.test.yml');
    this.redisServer = new RedisServer(REDIS_PORT);
    return this.redisServer.open();
  });

  after(function() {
    return this.redisServer.close();
  });

  beforeEach(function(done) {
    this.server = new Server(config);
    setTimeout(done, 100);
  });

  afterEach(function() {
    return this.server.stop();
  });

  it('creates Server', function() {
    var server = this.server;
    assert(server._redisClientDown.connected);
    assert(server._redisClientUp.connected);
    assert(server._statusServer._server.listening);
  });

  it('stops Server', function() {
    var server = this.server;
    return server.stop().then(function() {
      assert(!server._redisClientDown.connected);
      assert(!server._redisClientUp.connected);
      assert(!server._statusServer.listening);
    });
  });

  context('triggerEventUp', function() {
    context('up messages', function() {
      var originalPublish;
      beforeEach(function() {
        originalPublish = this.server._redisClientUp.publish;
      });
      afterEach(function() {
        this.server._redisClientUp.publish = originalPublish;
      });

      it('up-message', function(done) {
        var sampleMessage = {clientKey: 'up-message-clientKey', data: 'up-message-data'};
        this.server._redisClientUp.publish = function(type, message) {
          assert.equal(type, 'socket-redis-up');
          message = JSON.parse(message);
          assert.equal(message.type, 'message');
          assert.deepEqual(message.data, sampleMessage);
          done();
        };
        this.server.triggerEventUp('up-message', sampleMessage);
      });

      it('up-subscribe', function(done) {
        var sampleMessage = {clientKey: 'up-subscribe-clientKey', data: 'up-subscribe-data', channel: 'up-subscribe-channel'};
        this.server._redisClientUp.publish = function(type, message) {
          assert.equal(type, 'socket-redis-up');
          message = JSON.parse(message);
          assert.equal(message.type, 'subscribe');
          assert.deepEqual(message.data, sampleMessage);
          done();
        };
        this.server.triggerEventUp('up-subscribe', sampleMessage);
      });

      it('up-unsubscribe', function(done) {
        var sampleMessage = {clientKey: 'up-unsubscribe-clientKey', channel: 'up-unsubscribe-channel'};
        this.server._redisClientUp.publish = function(type, message) {
          assert.equal(type, 'socket-redis-up');
          message = JSON.parse(message);
          assert.equal(message.type, 'unsubscribe');
          assert.deepEqual(message.data, sampleMessage);
          done();
        };
        this.server.triggerEventUp('up-unsubscribe', sampleMessage);
      });
    });

    context('down messages', function() {
      var worker;
      beforeEach(function() {
        var workers = this.server._workers;
        worker = workers[Object.keys(workers)[0]];
      });

      it('up-publish', function(done) {
        var sampleMessage = {channel: 'up-publish-channel', event: 'up-publish-clientKey', data: 'up-publish-data'};
        var workerSpy = sinon.spy(worker, 'send');
        this.server.triggerEventUp('up-publish', sampleMessage);
        _.defer(function() {
          assert(workerSpy.calledOnce);
          var message = workerSpy.getCall(0).args[0];
          assert.equal(message.type, 'down-publish');
          assert.deepEqual(message.data, sampleMessage);
          done();
        });
      });
    });

    context('up-status-request', function() {
      var statusRequest;
      beforeEach(function() {
        statusRequest = {
          getId: function() {
            return 111;
          }
        };
        this.server._statusServer.addStatusRequest(statusRequest);
      });

      afterEach(function() {
        this.server._statusServer.removeStatusRequest(statusRequest);
      });

      it('up-status-request', function(done) {
        var sampleMessage = {requestId: statusRequest.getId(), channels: {channelId: []}};
        statusRequest.addResponse = function(channels) {
          assert.deepEqual(channels, sampleMessage.channels);
          done();
        };
        this.server.triggerEventUp('up-status-request', sampleMessage);
      });

    });
  });

  context('status server', function() {
    var statusServerUri;

    before(function() {
      statusServerUri = 'http://localhost:' + config.asHash().statusPort;
    });

    it('statusRequest is added/removed', function() {
      var addStatusSpy = sinon.spy(this.server._statusServer, 'addStatusRequest');
      var removeStatusSpy = sinon.spy(this.server._statusServer, 'removeStatusRequest');
      return requestPromise({uri: statusServerUri, headers: {'Authorization': 'Token ' + config.asHash().statusSecret}, simple: false}).then(function() {
        assert(addStatusSpy.calledOnce);
        assert(removeStatusSpy.calledOnce);
      });
    });

    it('request is sent down', function() {
      var workers = this.server._workers;
      var worker = workers[Object.keys(workers)[0]];
      var workerSpy = sinon.spy(worker, 'send');
      return requestPromise({uri: statusServerUri, headers: {'Authorization': 'Token ' + config.asHash().statusSecret}}).then(function() {
        var message = workerSpy.getCall(0).args[0];
        assert.equal(message.type, 'down-status-request');
      });
    });

    it('rejects unauthenticated', function() {
      return requestPromise(statusServerUri)
        .then(function() {
          throw new Error('Unauthenticated request must be rejected');
        })
        .catch(function(error) {
          assert.include(error.message, 'not authenticated');
        });
    });
  });

  context('redisClientDown', function() {
    var downPublisher;
    var publishDown;
    var worker;
    beforeEach(function() {
      var workers = this.server._workers;
      worker = workers[Object.keys(workers)[0]];
      downPublisher = redis.createClient(REDIS_PORT, config.asHash().redisHost);
      publishDown = function(message) {
        downPublisher.publish('socket-redis-down', JSON.stringify(message));
      };
    });

    afterEach(function() {
      downPublisher.quit();
    });

    it('handles publish event', function(done) {
      var workerSpy = sinon.spy(worker, 'send');
      var sampleMessage = {type: 'publish', data: {channel: 'publish-channel', event: 'publish-event', data: 'publish-data'}};
      publishDown(sampleMessage);

      _.delay(function() {
        assert(workerSpy.calledOnce);
        var message = workerSpy.getCall(0).args[0];
        assert.equal(message.type, 'down-publish');
        assert.deepEqual(message.data, sampleMessage.data);
        done();
      }, 100);
    });
  });

});

