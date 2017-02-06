#!/usr/bin/env node
var fs = require('fs');
var childProcess = require('child_process');
var minimist = require('minimist');
var socketRedis = require('../socket-redis.js');
var utils = require('../lib/utils.js');
var Config = require('../lib/config');

var argv = minimist(process.argv.slice(2));
var configPath = argv['c'] || __dirname + '/config.yaml';
var config = Config.createFromFile(configPath).asHash();

if (config.logDir) {
  utils.logProcessInto(process, config.logDir + '/socket-redis.log');
}

if (!process.send) {
  var socketPorts = String(config.socketPorts).split(',');
  var publisher = new socketRedis.Server(config.redisHost, config.statusPort);

  socketPorts.forEach(function(socketPort) {
    var startWorker = function() {
      var worker = childProcess.fork(__filename, ['-c=' + configPath, '--socket-port=' + socketPort]);
      console.log('Starting worker `' + worker.pid + '` to listen on port `' + socketPort + '`');
      publisher.addWorker(worker);
      worker.on('exit', function() {
        console.error('Worker `' + worker.pid + '` exited');
        publisher.removeWorker(worker);
        startWorker();
      });
      worker.on('message', function(event) {
        publisher.triggerEventUp(event.type, event.data);
      });
    };
    startWorker();
  });

  process.on('SIGTERM', function() {
    publisher.stop();
    process.exit();
  });

} else {
  var socketPort = argv['socket-port'];
  var worker = new socketRedis.Worker(process, socketPort, config.sockjsClientUrl, config.ssl);
  process.on('message', function(event) {
    worker.triggerEventDown(event.type, event.data);
  });
}
