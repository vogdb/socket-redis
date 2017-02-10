var fs = require('fs');
var _ = require('underscore');
var yaml = require('js-yaml');
var Validator = require('jsonschema').Validator;

function Config() {
  this._path = null;
  this._hash = {};
  this._validator = new Validator();
}

/**
 * @param {String} path
 */
Config.prototype.load = function(path) {
  this._path = path;
  var content = yaml.safeLoad(fs.readFileSync(path, {encoding: 'utf8', flag: 'r'}));
  this._setDefaults(content);
  this.validate(content);
  this._hash = content;
  if (this._hash.ssl) {
    this._processSSL();
  }
};

/**
 * @returns {Object}
 */
Config.prototype.asHash = function() {
  return this._hash;
};

/**
 * @returns {String}
 */
Config.prototype.getPath = function() {
  return this._path;
};

/**
 * @param {Object} config
 */
Config.prototype.validate = function(config) {
  var result = this._validator.validate(config, this._getValidationSchema(), {propertyName: 'config'});
  if (result.errors.length) {
    throw new Error(result.errors.join(';\n'));
  }
};

Config.prototype._setDefaults = function(content) {
  content.redisHost = content.redisHost || 'localhost';
  content.socketPorts = content.socketPorts || [8090];
  content.statusPort = content.statusPort || 8085;
};

Config.prototype._getValidationSchema = function() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      redisHost: {
        type: 'string',
        required: true
      },
      socketPorts: {
        type: 'array',
        required: true
      },
      statusPort: {
        type: 'number',
        required: true
      },
      sockjsClientUrl: {
        type: 'string'
      },
      statusSecret: {
        type: 'string'
      },
      logDir: {
        type: 'string'
      },
      ssl: {
        type: 'object',
        validateSslPfx: true,
        properties: {
          key: {type: 'string'},
          cert: {type: 'string'},
          pfx: {type: 'string'},
          passphrase: {type: 'string'}
        }
      }
    }
  };
};

Config.prototype._processSSL = function() {
  var ssl = this._hash.ssl;
  var sslOptions = null;
  if (ssl && ssl.key && ssl.cert) {
    sslOptions = {
      key: fs.readFileSync(ssl.key)
    };

    var certFile = fs.readFileSync(ssl.cert).toString();
    var certs = certFile.match(/(-+BEGIN CERTIFICATE-+[\s\S]+?-+END CERTIFICATE-+)/g);
    if (certs && certs.length) {
      sslOptions.cert = certs.shift();
      if (certs.length) {
        sslOptions.ca = certs;
      }
    } else {
      sslOptions.cert = certFile;
    }
  }
  if (ssl.pfx) {
    sslOptions = {
      pfx: fs.readFileSync(ssl.pfx)
    };
  }
  if (sslOptions && ssl.passphrase) {
    sslOptions.passphrase = fs.readFileSync(ssl.passphrase).toString().trim();
  }
  _.extend(ssl, sslOptions);
};

Config.createFromFile = function(path) {
  var config = new Config();
  config.load(path);
  return config;
};

module.exports = Config;
