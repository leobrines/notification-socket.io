var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http, {
	path: '/socket.io',
	cors: {
		origin: process.env.CORS_ORIGIN || '*',
		methods: ["GET", "POST"]
	}
});
var bodyParser = require('body-parser');
const { MongoClient } = require("mongodb");

app.set('port', (process.env.PORT || 3000));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

/**
 * Configuration from package.json
 */
var pjson = require('./package.json');

var connectionService = connectionServiceInMemory();

function connectionServiceMongo(client) {
	console.log("Using mongo storage")

	const database = client.db(process.env.MONGO_DBNAME);
	const users = database.collection('users')

	return {
		registerUser: async function(userId, connectionId) {
			const filter = { _id: userId };
			const options = { upsert: true };

			const updateDoc = {
				$push: {
				  connections: {
					  id: connectionId,
					  body: null,
					  registeredDate: new Date()
				  }
				}
			};
		  
			await users.updateOne(filter, updateDoc, options);
		
			console.log(`[Mongo] Connection '${connectionId}' added to user ${userId}`)
		},
		isEmptyConnection: async function(userId, connectionId) {
			const query = { _id: userId };

			const user = await users.findOne(query);
			if (!user) {
				return false
			}

			for (let connection of user.connections) {
				if (connection.id === connectionId) {
					return connection.body == null
				}
			}

			return false
		},
		saveConnection: async function(userId, connectionId, body) {
			const filter = { _id: userId };

			const options = { upsert: true };

			const updateDoc = {
				$push: {
					connections: {
						id: connectionId,
						body: body,
						savedDate: new Date()
					}
				}
			};
			
			await users.updateOne(filter, updateDoc, options);
		
			console.log(`[Mongo] Body connection '${connectionId}' saved to user ${userId}`)
		},
		removeConnection: async function(userId, connectionId) {
			const filter = { _id: userId };

			const updateDoc = {
				$pull: {
					connections: {
						id: connectionId
					}
				}
			};
			
			await users.updateOne(filter, updateDoc);
		
			console.log(`[Mongo] Connection '${connectionId}' removed from user ${userId}`)
		},
		getConnection: async function(userId, connectionId) {
			const query = { _id: userId };

			const user = await users.findOne(query);
			if (!user) {
				return null
			}

			for (let connection of user.connections) {
				if (connection.id === connectionId) {
					return connection.body
				}
			}

			return null
		}
	}
}

function connectionServiceInMemory() {
	console.log("Using in-memory storage")

	var connections = {}
	return {
		registerUser: function(userId, connectionId) {
			if (connections[userId] === undefined) {
				connections[userId] = {};
			}

			connections[userId][connectionId] = null;
		},
		isEmptyConnection: function(userId, connectionId) {
			return userId && connectionId && connections[userId] != null && connections[userId][connectionId] == null
		},
		saveConnection: function(userId, connectionId, body) {
			connections[userId][connectionId] = body;
		},
		removeConnection: function(userId, connectionId) {
			delete connections[userId][connectionId];
		},
		getConnection: function(userId, connectionId) {
			var userConnections = connections[userId];
			if (userConnections) {
				for (var connectionId in  userConnections) {
					if (userConnections.hasOwnProperty(connectionId)) {
						return userConnections[connectionId];
					}
				}
			}

			return null
		}
	}
}

var pushService = newPushService()

function newPushService() {
	return {
		/**
		 * Register user in connections. This method must be executed as first in whole registration process.
		 * @param userId id of user.
		 * @param connectionId id of connection.
		 */
		registerUser: async function(userId, connectionId) {
			console.log(`Register user: userId '${userId}' connectionId '${connectionId}'`)

			await connectionService.registerUser(userId, connectionId)

			console.log('Registered connection ' + connectionId.substring(0, 4) + '*** for user ' + userId);
		},
		/**
		 * Register socket to communication. Must be executed after registerUser.
		 * Modify socket object and set field userId and connectionId.
		 * @param userId id of user.
		 * @param connectionId id of connection.
		 * @param socket socket.
		 * @returns {boolean} if socket was registered or not, if false then you have to do everything again.
		 */
		registerSocket: async function(userId, connectionId, socket) {
			console.log(`Register socket: userId '${userId}' connectionId '${connectionId}' socket '${socket}'`)

			if (await connectionService.isEmptyConnection(userId, connectionId)) {
				socket.userId = userId;
				socket.connectionId = connectionId;
				await connectionService.saveConnection(userId, connectionId, socket);
				console.log('Registered socket for connection ' + connectionId.substring(0, 4) + '*** and  user ' + userId);
				return true;
			} else {
				console.log('Not found empty conn for connection ' + connectionId.substring(0, 4) + '*** and  user ' + userId);
				return false;
			}
		},
		/**
		 * Remove connection.
		 * @param socket socket to remove.
		 */
		removeConnection: async function(socket) {
			console.log(`Remove connection: socket '${socket}'`)

			var userId = socket.userId;
			var connectionId = socket.connectionId;

			await connectionService.removeConnection(userId, socket.connectionId);
			
			console.log('Removed socket for user ' + userId + ' and connection: ' + connectionId.substring(0, 4) + '***');
		},
		/**
		 * Send notification to user.
		 * @param userId id of user.
		 * @param message message.
		 */
		pushMessage: async function(userId, message) {
			console.log(`Push message: userId '${userId}' message '${message}'`)

			var socket = await connectionService.getConnection(userId, connectionId);
			if (socket != null) {
				socket.emit('message', message);
			}
		}
	}
};

/**
 * Handle connection to socket.io.
 */
io.on('connection', function(socket) {
	console.log(`New connection: socket '${socket}`)
		
	/**
	 * On registered socket from client.
	 */
	socket.on('register', async function(userId, connectionId) {
		await pushService.registerSocket(userId, connectionId, socket);
	});

	/**
	 * On disconnected socket.
	 */
	socket.on('disconnect', async function() {
		await pushService.removeConnection(socket);
	});
});

/**
 * Api to register user.
 */
app.put('/api/:userId/register', async function(req, res) {
	if (req.header('X-AUTH-TOKEN') != process.env['AUTH_TOKEN']) {
		res.status(401).send();
	} else {
		var userId = req.params['userId'];
		var connectionId = req.query['connectionId'];
		if (userId && connectionId) {
			await pushService.registerUser(userId, connectionId);
			res.send();
		} else {
			res.status(400).send('Bad Request');
		}
	}
});

/**
 * Api to send message to user.
 */
app.post('/api/:userId/push', async function(req, res) {
	if (req.header('X-AUTH-TOKEN') != process.env['AUTH_TOKEN']) {
		res.status(401).send();
	} else {
		var userId = req.params['userId'];
		if (userId && req.body.message) {
			await pushService.pushMessage(userId, req.body.message);
			res.send();
		}
		else {
			res.status(400).send('Bad Request');
		}
	}
});

/**
 * Ping endpoint.
 */
app.get('/api/status/ping', function(req, res) {
	res.send('pong')
});

/**
 * Info endpoint.
 */
app.get('/api/status/info', function(req, res) {
	res.setHeader('Content-Type', 'application/json');
	var info = {
		'name': pjson.name,
		'version': pjson.version
	};
	res.send(info)
});

(async function() {
	if (process.env.NOTIFICATOR_STORAGE == "mongo") {
		const username = process.env.MONGO_USERNAME
		const pw = process.env.MONGO_PASSWORD
		const domain = process.env.MONGO_DOMAIN
		const dbname = process.env.MONGO_DBNAME
		const uri = `mongodb://${username}:${pw}@${domain}/${dbname}?retryWrites=true&writeConcern=majority&authSource=admin`;
		
		const client = new MongoClient(uri, { useUnifiedTopology: true });	
		await client.connect()

		connectionService = connectionServiceMongo(client)
	};

	http.listen(app.get('port'), function() {
		console.log('Node app is running on port', app.get('port'));
	});	
}())
