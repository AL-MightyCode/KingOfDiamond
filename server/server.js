const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Create HTTP server
const httpServer = http.createServer((req, res) => {
    let filePath = path.join(__dirname, '../public', req.url === '/' ? 'index.html' : req.url);
    
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    
    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
        case '.m4a':
        case '.M4A':
            contentType = 'audio/mp4';
            break;
        case '.mp3':
            contentType = 'audio/mpeg';
            break;
    }
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if(error.code == 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server Error: '+error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ server: httpServer });

// Define GameRoom class first
class GameRoom {
    constructor() {
        this.players = new Map();
        this.gameState = 'waiting'; // waiting, playing, finished
        this.currentRound = {
            numbers: new Map(),
            timer: null,
            endTime: null
        };
    }

    // Get the next available player number (1-5)
    getNextPlayerNumber() {
        const usedNumbers = new Set(
            Array.from(this.players.values())
                .map(player => player.playerNumber)
        );
        
        // Find first available number from 1 to 5
        for (let i = 1; i <= 5; i++) {
            if (!usedNumbers.has(i)) {
                return i;
            }
        }
        return null; // Should never happen as we check size before adding
    }

    addPlayer(playerId, playerName, ws) {
        // Don't add more than 5 players
        if (this.players.size >= 5) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room is full'
            }));
            return false;
        }

        const playerNumber = this.getNextPlayerNumber();
        this.players.set(playerId, {
            name: playerName,
            playerNumber: playerNumber,
            points: 0,
            ws: ws,
            eliminated: false
        });

        // Send player their number
        ws.send(JSON.stringify({
            type: 'playerInfo',
            playerNumber: playerNumber,
            playerId: playerId
        }));

        return true;
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
    }

    broadcast(message) {
        this.players.forEach(player => {
            if (player.ws.readyState === WebSocket.OPEN) {
                // Add player numbers to the message for player list
                if (message.type === 'playerJoined' || message.type === 'playerLeft') {
                    message.playerNumbers = Array.from(this.players.entries())
                        .map(([id, p]) => ({ 
                            name: p.name, 
                            number: p.playerNumber 
                        }))
                        .sort((a, b) => a.number - b.number); // Sort by player number
                }
                player.ws.send(JSON.stringify(message));
            }
        });
    }

    startGame() {
        this.gameState = 'playing';
        this.broadcast({
            type: 'gameStart'
        });
        // Start first round immediately after game starts
        this.startRound();
    }

    startRound() {
        this.currentRound.numbers.clear();
        if (this.currentRound.timer) {
            clearTimeout(this.currentRound.timer);
        }
        this.broadcast({
            type: 'roundStart'
        });
        
        // 30-second timer for number submission
        this.currentRound.timer = setTimeout(() => {
            this.processRound();
        }, 30000);
    }

    processRound() {
        let submittedNumbers = [];
        let allPlayersEliminated = true;
        
        this.players.forEach((player, playerId) => {
            if (!player.eliminated) {
                allPlayersEliminated = false;
                if (!this.currentRound.numbers.has(playerId)) {
                    player.points = player.points + 2;
                    console.log(`${player.name} didn't choose, points: ${player.points}`);
                } else {
                    submittedNumbers.push(this.currentRound.numbers.get(playerId));
                }
            }
        });

        // Only process if there are any active players
        if (!allPlayersEliminated) {
            // Calculate average only from submitted numbers
            const average = submittedNumbers.length > 0 
                ? submittedNumbers.reduce((a, b) => a + b, 0) / submittedNumbers.length 
                : 0;
            const target = average * 0.8;

            // Find closest player (only among those who submitted numbers)
            let closestDiff = Infinity;
            let winner = null;

            if (submittedNumbers.length > 0) {
                this.currentRound.numbers.forEach((number, playerId) => {
                    const diff = Math.abs(number - target);
                    if (diff < closestDiff && !this.players.get(playerId).eliminated) {
                        closestDiff = diff;
                        winner = playerId;
                    }
                });
            }

            // Update points and check eliminations
            this.players.forEach((player, playerId) => {
                if (!player.eliminated) {
                    if (playerId !== winner && this.currentRound.numbers.has(playerId)) {
                        player.points++;  // Single point for losing
                        console.log(`${player.name} lost, points: ${player.points}`); // Debug log
                    }
                    
                    // Check for elimination
                    if (player.points >= 10) {
                        player.eliminated = true;
                        console.log(`${player.name} eliminated!`); // Debug log
                    }
                }
            });

            // Broadcast results
            this.broadcast({
                type: 'roundResult',
                target: target,
                average: average,
                winner: winner,
                numbers: Object.fromEntries(this.currentRound.numbers),
                noChoicePlayers: Array.from(this.players.entries())
                    .filter(([id]) => !this.currentRound.numbers.has(id))
                    .map(([_, player]) => player.name),
                players: Array.from(this.players.entries()).map(([id, player]) => ({
                    id,
                    name: player.name,
                    points: player.points,
                    eliminated: player.eliminated
                }))
            });

            // Check if game is over
            const activePlayers = Array.from(this.players.values()).filter(p => !p.eliminated);
            if (activePlayers.length <= 1) {
                this.gameState = 'finished';
                this.broadcast({
                    type: 'gameOver',
                    winner: activePlayers[0]?.name || 'No one'
                });
            } else {
                // Clear numbers and start next round after delay
                this.currentRound.numbers.clear();
                if (this.currentRound.timer) {
                    clearTimeout(this.currentRound.timer);
                    this.currentRound.timer = null;
                }
                // Make sure to start next round
                setTimeout(() => this.startRound(), 5000);
            }
        }
    }

    // Add method to check if all active players have submitted numbers
    allPlayersSubmitted() {
        let activeCount = 0;
        let submittedCount = 0;
        this.players.forEach((player, playerId) => {
            if (!player.eliminated) {
                activeCount++;
                if (this.currentRound.numbers.has(playerId)) {
                    submittedCount++;
                }
            }
        });
        return activeCount > 0 && submittedCount === activeCount;
    }
}

// Store multiple rooms
const rooms = new Map();

wss.on('connection', (ws) => {
    let playerId = null;
    let currentRoom = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'join':
                playerId = Math.random().toString(36).substr(2, 9);
                // Create new room if it doesn't exist
                if (!rooms.has(data.roomId)) {
                    rooms.set(data.roomId, new GameRoom());
                }
                currentRoom = rooms.get(data.roomId);
                
                const playerAdded = currentRoom.addPlayer(playerId, data.playerName, ws);
                
                if (playerAdded) {
                    currentRoom.broadcast({
                        type: 'playerJoined',
                        count: currentRoom.players.size,
                        players: Array.from(currentRoom.players.values()).map(p => p.name)
                    });

                    // If we just added the 5th player, trigger game start
                    if (currentRoom.players.size === 5) {
                        setTimeout(() => currentRoom.startGame(), 6000);
                    }
                }
                break;

            case 'number':
                if (playerId) {
                    // Check if player is eliminated before allowing number selection
                    const player = currentRoom.players.get(playerId);
                    if (player && !player.eliminated) {
                        currentRoom.currentRound.numbers.set(playerId, data.number);
                        // Process round immediately if all players have submitted
                        if (currentRoom.allPlayersSubmitted()) {
                            clearTimeout(currentRoom.currentRound.timer);
                            currentRoom.processRound();
                        }
                    }
                }
                break;
        }
    });

    ws.on('close', () => {
        if (currentRoom && playerId) {
            currentRoom.removePlayer(playerId);
            if (currentRoom.players.size === 0) {
                rooms.delete(currentRoom);
            } else {
                currentRoom.broadcast({
                    type: 'playerLeft',
                    count: currentRoom.players.size,
                    players: Array.from(currentRoom.players.values()).map(p => p.name)
                });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 