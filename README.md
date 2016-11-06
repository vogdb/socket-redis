socket-redis [![Version](https://img.shields.io/npm/v/socket-redis.svg)](https://www.npmjs.com/package/socket-redis)
============
*socket-redis* is a WebSocket pub/sub server and client, exposing an API over Redis
(allowing you to use WebSocket functionality in your application using a Redis client).

About
-----
*socket-redis* starts a WebSocket emulation server ([SockJS](http://sockjs.org/)) where clients can connect to, and subscribe to multiple channels.
The server will let you consume client-related events like `message`, `subscribe` and `unsubscribe` on a [Redis](http://redis.io/) pub/sub channel `socket-redis-up`. Additionally it will subscribe to another pub/sub channel `socket-redis-down` where you can send messages to all clients in a channel.

When specifying multiple `--socket-ports` the script will spawn a child process for each port. This is provided as a simple way to make use of all your CPU cores.

### Publishing
 - update package.json with a new version
 - release a new git tag with the updated package.json

After that the npm release should be done automatically. If it didn't happen then release it manually:
```
npm publish https://github.com/cargomedia/socket-redis/archive/<GitTagWithUpdatedPackageJson>.tar.gz
```


Server
------

### Installation
Package is in nodejs and is available through npm registry:
```
npm install socket-redis [-g]
```


### Running
You can run socket-redis using default arguments or specify them on your own.

Example:
```sh
socket-redis --socket-ports=8090,8091,8092
```

Available options:
- `--redis-host` Specify host of redis server. Defaults to `localhost`.
- `--socket-ports` Comma separated public ports which SockJS workers will listen on. Defaults to `8090`.
- `--log-dir` Directory where log is stored. Script will try to create directory if needed. Defaults to `null` which means it will output to stdout.
- `--sockjs-client-url` Specify custom url for sockjs-client library.
- `--status-port` Specify port for http status requests. It should not be publicly accesible. Defaults to `8085`
- `--ssl-key` Specify ssl private key file. Combine with `ssl-cert` option.
- `--ssl-cert` Specify ssl public certificate file. Combine with `ssl-key` option. Append CA-chain within this file.
- `--ssl-pfx` Specify ssl pfx file (key + cert). Overrides `ssl-key` and `ssl-cert` options.
- `--ssl-passphrase` Specify file containing the ssl passphrase.


### Messages published to redis pub/sub channel `socket-redis-up`:
- `{type: "subscribe", data: {channel: <channel>, clientKey: <clientKey>, data: <subscribe-data>}}`
- `{type: "unsubscribe", data: {channel: <channel>, clientKey: <clientKey>}}`
- `{type: "message", data: {clientKey: <clientKey>, data: <data>}}`

### Messages which are detected on redis pub/sub channel `socket-redis-down`:
- `{type: "publish", data: {channel: <channel>, event: <event>, data: <data>}}`

For example you could publish messages using *Redis CLI*:
```sh
redis-cli 'publish' 'socket-redis-down' '{"type":"publish", "data": {"channel":"<channel>", "event":"<event>", "data":"<data>"}}'
```

### Status request
Server also answers http requests (on port 8085 by default). You can request on-demand state of all subscribers grouped by channels.

Status response schema:

```javascript
{<channel>: {
	"subscribers": {
		<clientKey>: {
			"clientKey": <clientKey>,
			"subscribeStamp": <subscribe-stamp>,
			"data": {}
		}
	}
}
```

Client
------
### Building
Client is written as a node module. If you want to access it as a global variable in browser then you need to browserify `client/index.js`. It will be exposed under `SocketRedis`. Also it requires a global variable `SockJS` that contains sockjs client.
```
browserify --standalone SocketRedis ./client/index.js -o ./client/socket-redis.js
```

### Installation
Include the SockJS and socket-redis client libraries in your html file:
```html
<script src="http://cdn.sockjs.org/sockjs-0.3.min.js"></script>
<script src="https://raw.github.com/cargomedia/socket-redis/master/client/socket-redis.js"></script>
```

### Example
To receive messages from the server create a new `SocketRedis` instance and subscribe to some channels:
```
var socketRedis = new SocketRedis('http://example.com:8090');
socketRedis.onopen = function() {
	socketRedis.subscribe('channel-name', null, {foo: 'bar'}, function(event, data) {
		console.log('New event `' + event + '` on channel `channel-name`:', data);
	});

	socketRedis.unsubscribe('channel-name');
};
```

To publish messages to a channel from the client:
```
socketRedis.publish('channel-name', 'event-name', {foo: 'bar'});
```
(The event name will be prefixed with `client-` and thus become `client-event-name`.)


To send messages to the server:
```
socketRedis.send({foo: 'bar'});
```
