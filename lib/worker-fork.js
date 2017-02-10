var minimist = require('minimist');
var Worker = require('./worker');
var Config = require('./config');

var argv = minimist(process.argv.slice(2));
var configPath = argv['c'];
var config = Config.createFromFile(configPath).asHash();
var socketPort = argv['socket-port'];

new Worker(process, socketPort, config.sockjsClientUrl, config.ssl);
