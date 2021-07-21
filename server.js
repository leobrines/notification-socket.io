var express = require('express')
var app = express();
var http = require('http').Server(app);

var socketOpts = {
	path: '/socket.io',
	cors: process.env.CORS_ORIGIN ? {
		origin: process.env.CORS_ORIGIN,
		methods: ["GET", "POST"],
		credentials: true,
	} : null
}

var io = require('socket.io')(http, socketOpts);

app.set('port', (process.env.PORT || 3000));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/**
 * Configuration from package.json
 */
var pjson = require('./package.json');

var connectionService = connectionServiceInMemory();

function connectionServiceInMemory() {
	console.log("Using in-memory storage")

	var socketStorage = {}
	var userSocketStorage = {}

	return {
		associateSocketToUser: function(userId, socketId) {
			console.log(`[Associate socket] Socket '${socketId}'`)

			if (socketStorage[socketId] === undefined || socketStorage[socketId] === null) {
				console.log("[Associate socket] Socket does not exists")
				return
			}

			if (socketStorage[socketId].userId & socketStorage[socketId].userId !== "") {
				console.log("[Associate socket] Socket already associated to other user")
				return
			}

			if (userSocketStorage[socketId] === undefined || userSocketStorage[userId] === null) {
				userSocketStorage[userId] = {};

				console.log(`[Associate socket] Initialized user '${userId}''`)
			}

			// Just for know if associated to user
			userSocketStorage[userId][socketId] = socketStorage[socketId];

			socketStorage[socketId].userId = userId

			console.log(`[Associate socket] Socket '${socketId}' asociated to user '${userId}''`)
		},
		saveSocket: function(socket) {
			socketStorage[socket.id] = socket
			console.log(`[Save socket] Socket saved '${socket.id}'`)
		},
		removeConnection: function(socketId) {
			var userId = socketStorage[socketId].userId

			if (userId && userSocketStorage[userId]) {
				delete userSocketStorage[userId][socketId];
			}
			if (socketStorage[socketId]) {
				delete socketStorage[socketId];
			}

			console.log(`[Remove socket] Socket removed '${socketId}'`)
		},
		getUserSockets: function(userId) {
			var socketsMap = userSocketStorage[userId];
			if (socketsMap === undefined || socketsMap === null) {
				console.log("[Get user sockets] Not found user sockets")
				return []
			}

			var result = []
			for (let socketId in socketsMap) {
				result.push(socketsMap[socketId])
			}

			console.log(`[Get user sockets] User sockets got '${userId}'`)

			return result
		}
	}
}

var pushService = newPushService()

function newPushService() {
	return {
		/**
		 * Register user in connections. This method must be executed as first in whole registration process.
		 * @param userId id of user.
		 * @param socketId id of connection.
		 */
		registerUserSocketId: async function(userId, socketId) {
			console.log(`Associate socket '${socketId}' to user '${userId}'`)

			await connectionService.associateSocketToUser(userId, socketId)

			console.log(`Success socket association '${socketId}' to user '${userId}'`)
		},
		/**
		 * Save socket. This method must be executed as first in whole registration process.
		 * @param socket socket.
		 */
		saveSocket: async function(socket) {
			console.log(`Saving socket:  '${socket.id}'`)

			await connectionService.saveSocket(socket);

			console.log(`Success socket saved:  '${socket.id}'`)
		},
		/**
		 * Remove connection.
		 * @param socket socket to remove.
		 */
		removeConnection: async function(socketId) {
			console.log(`Remove socket '${socketId}'`)

			await connectionService.removeConnection(socketId);

			console.log(`Success removing socket '${socketId}'`)
		},
		/**
		 * Send notification to user.
		 * @param userId id of user.
		 * @param message message.
		 */
		pushMessage: async function(userId, message) {
			console.log(`Push message: userId '${userId}' message '${message}'`)

			var userSockets = await connectionService.getUserSockets(userId);

			for (let socket of userSockets) {
				socket.emit('message', message);
				console.log("Success push message")
			}
		}
	}
};

/**
 * Handle connection to socket.io.
 */
io.on('connection', function(socket) {
	console.log(`New connection: socket '${socket}`)

	pushService.saveSocket(socket)

	/**
	 * On disconnected socket.
	 */
	socket.on('disconnect', async function() {
		await pushService.removeConnection(socket.id);
	});
});

/**
 * Api to register user socket id.
 */
app.post('/users/:userId/sockets', async function(req, res) {
	if (req.header('X-AUTH-TOKEN') != process.env['AUTH_TOKEN']) {
		res.status(401).send();
	} else {
		var userId = req.params['userId'];
		var socketId = req.body.socket_id;
		if (userId && socketId) {
			await pushService.registerUserSocketId(userId, socketId);
			res.send();
		} else {
			res.status(400).send('Bad Request');
		}
	}
});

/**
 * Api to send message to user.
 */
app.post('/users/:userId/push', async function(req, res) {
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
	http.listen(app.get('port'), function() {
		console.log('Node app is running on port', app.get('port'));
	});	
}())
