#!/usr/bin/env node
var minimist = require('minimist');
var Server = require('../lib/server');
var utils = require('../lib/utils');
var Config = require('../lib/config');

var argv = minimist(process.argv.slice(2));
var configPath = argv['c'] || __dirname + '/config.yaml';
var config = Config.createFromFile(configPath);
var configOptions = config.asHash();

if (configOptions.logDir) {
  utils.logProcessInto(process, config.logDir + '/socket-redis.log');
}

var publisher = new Server(config);
process.on('SIGTERM', function() {
  publisher.stop().then(function() {
    process.exit();
  });
});