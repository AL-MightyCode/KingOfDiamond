let ws;
let playerId;
let currentRoom;
let myPlayerNumber;  // Store current player's number

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const waitingRoom = document.getElementById('waiting-room');
const gameScreen = document.getElementById('game-screen');
const playerName = document.getElementById('player-name');
const roomId = document.getElementById('room-id');
const joinBtn = document.getElementById('join-btn');
const playerCounter = document.getElementById('player-counter');
const playerList = document.getElementById('player-list');
const numberGrid = document.getElementById('number-grid');
const selectedNumber = document.getElementById('selected-number');
const timer = document.getElementById('timer');
const playersGrid = document.getElementById('players-grid');
const bgMusic = document.getElementById('bg-music');
const musicToggle = document.getElementById('music-toggle');
const musicOn = musicToggle.querySelector('.music-on');
const musicOff = musicToggle.querySelector('.music-off');
let isMusicPlaying = false;

// Handle messages from server
function handleServerMessage(data) {
    switch (data.type) {
        case 'playerInfo':
            playerId = data.playerId;
            myPlayerNumber = data.playerNumber;
            updatePlayerIdentity();
            break;
        case 'playerJoined':
            updateWaitingRoom(data);
            if (data.count === 5 && !document.querySelector('.countdown-overlay')) {
                startGameCountdown();
            }
            break;
        case 'gameStart':
            startGame();
            startRound(data);
            break;
        case 'roundStart':
            startRound(data);
            break;
        case 'roundResult':
            showRoundResult(data);
            break;
        case 'gameOver':
            showGameOver(data);
            break;
        case 'playerLeft':
            updateWaitingRoom(data);
            break;
    }
}

// Add countdown animation function
function startGameCountdown() {
    const overlay = document.createElement('div');
    overlay.className = 'countdown-overlay';
    document.body.appendChild(overlay);

    let count = 5;
    
    function updateCount() {
        if (count === 0) {
            overlay.remove();
            return;
        }
        
        overlay.innerHTML = `
            <div class="countdown-number">${count}</div>
        `;
        
        count--;
        setTimeout(updateCount, 1000);
    }
    
    updateCount();
}

// Update waiting room UI
function updateWaitingRoom(data) {
    const count = Math.min(data.count, 4);
    playerCounter.textContent = `${count}/4 Players`;
    const playersList = data.playerNumbers
        .map(p => `
            <div class="player-item ${p.name === playerName.value ? 'current-player' : ''}">
                Player ${p.number}: ${p.name}
            </div>`)
        .join('');

    playerList.innerHTML = `
        <div class="players-list">
            ${playersList}
        </div>
        ${count >= 4 ? '<div class="starting-message">Game starting soon...</div>' : ''}
    `;
}

// Start the game
function startGame() {
    waitingRoom.classList.add('hidden');
    gameScreen.classList.remove('hidden');
}

// Start a new round
function startRound(data) {
    // Clear any existing countdown overlay
    const existingOverlay = document.querySelector('.countdown-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    // Check if current player is eliminated
    // Find player's box by matching the name
    const playerBoxes = document.querySelectorAll('.player-box');
    let isEliminated = false;
    playerBoxes.forEach(box => {
        const nameElement = box.querySelector('.player-name');
        if (nameElement && nameElement.textContent === playerName.value) {
            isEliminated = box.classList.contains('eliminated');
        }
    });
    
    // Create number grid
    numberGrid.innerHTML = '';
    for (let i = 0; i <= 100; i++) {
        const numberBox = document.createElement('div');
        numberBox.className = 'number-box';
        // Add disabled class if player is eliminated
        if (isEliminated) {
            numberBox.classList.add('disabled');
        }
        numberBox.textContent = i;
        // Only add click handler if player is not eliminated
        if (!isEliminated) {
            numberBox.onclick = () => selectNumber(i);
        }
        numberGrid.appendChild(numberBox);
    }
    selectedNumber.classList.add('hidden');
    selectedNumber.textContent = '';
    
    // If player is eliminated, show message instead of timer
    if (isEliminated) {
        timer.textContent = 'Eliminated';
        timer.style.backgroundColor = '#ff4747';
        return;
    }
    
    // Start with 30 seconds
    let timeLeft = 30;
    timer.textContent = timeLeft;
    
    const countdown = setInterval(() => {
        timeLeft--;
        timer.textContent = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(countdown);
            // Disable all number boxes
            document.querySelectorAll('.number-box').forEach(box => {
                box.classList.add('disabled');
            });
        }
    }, 1000);
}

// Handle number selection
function selectNumber(number) {
    // Double check if player is eliminated before sending number
    // Find player's box by matching the name
    const playerBoxes = document.querySelectorAll('.player-box');
    let isEliminated = false;
    playerBoxes.forEach(box => {
        const nameElement = box.querySelector('.player-name');
        if (nameElement && nameElement.textContent === playerName.value) {
            isEliminated = box.classList.contains('eliminated');
        }
    });
    
    if (isEliminated) {
        return;
    }
    
    // Send number to server
    ws.send(JSON.stringify({
        type: 'number',
        number: number
    }));
    
    // Update UI
    document.querySelectorAll('.number-box').forEach(box => {
        box.classList.add('disabled');
        if (parseInt(box.textContent) === number) {
            box.classList.add('selected');
        }
    });
    
    selectedNumber.textContent = `Selected: ${number}`;
    selectedNumber.classList.remove('hidden');
}

// Show round results
function showRoundResult(data) {
    const players = data.players;
    const resultInfo = document.createElement('div');
    resultInfo.className = 'result-info';
    const average = data.average || 0;
    const target = data.target || 0;
    resultInfo.innerHTML = `
        <div class="result-numbers">
            <div class="average">Average: ${average.toFixed(2)}</div>
            <div class="target">Target (0.8×): ${target.toFixed(2)}</div>
            ${data.noChoicePlayers && data.noChoicePlayers.length > 0 ? 
                `<div class="no-choice">No choice made by: ${data.noChoicePlayers.join(', ')}</div>` 
                : ''}
        </div>
    `;
    playersGrid.innerHTML = '';
    playersGrid.appendChild(resultInfo);

    playersGrid.innerHTML += players.map(player => `
        <div class="player-box ${player.eliminated ? 'eliminated' : ''}">
            <div class="player-name">${player.name}</div>
            <div class="player-points">Points: ${player.points}</div>
            <div class="player-number">
                Number: ${data.numbers[player.id]}
                ${data.numbers[player.id] === undefined ? ' (No choice)' : ''}
            </div>
            ${player.id === data.winner ? '<div class="winner-badge">Winner!</div>' : ''}
        </div>
    `).join('');
}

// Show game over screen
function showGameOver(data) {
    // Create confetti
    for (let i = 0; i < 50; i++) {
        createConfetti();
    }
    
    gameScreen.innerHTML = `
        <div class="game-over">
            <div class="winner-announcement">🎉 CONGRATULATIONS! 🎉</div>
            <div class="trophy">🏆</div>
            <div class="winner-name">${data.winner}</div>
            <p>is the Balance Scale Champion!</p>
            <button class="play-again-btn" onclick="location.reload()">Play Again</button>
        </div>
    `;
}

// Function to create a single confetti piece
function createConfetti() {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    
    // Random position, color and delay
    confetti.style.left = Math.random() * 100 + 'vw';
    confetti.style.animationDelay = Math.random() * 3 + 's';
    confetti.style.backgroundColor = `hsl(${Math.random() * 360}, 100%, 50%)`;
    
    document.body.appendChild(confetti);
    
    // Remove confetti after animation
    setTimeout(() => {
        confetti.remove();
    }, 3000);
}

// Function to continuously create confetti
function startConfettiAnimation() {
    setInterval(() => {
        createConfetti();
    }, 300);
}

// Handle music toggle
function toggleMusic() {
    if (isMusicPlaying) {
        bgMusic.pause();
        musicOn.classList.add('hidden');
        musicOff.classList.remove('hidden');
    } else {
        // Try to load and play the audio
        bgMusic.load();
        bgMusic.play().catch(error => {
            console.log("Audio play failed:", error);
            alert("Please click anywhere to enable audio!");
        });
        musicOn.classList.remove('hidden');
        musicOff.classList.add('hidden');
    }
    isMusicPlaying = !isMusicPlaying;
    localStorage.setItem('musicEnabled', isMusicPlaying);
}

// Initialize music based on saved preference
function initializeMusic() {
    isMusicPlaying = localStorage.getItem('musicEnabled') === 'true';
    bgMusic.volume = 0.5;
    bgMusic.src = 'sounds/game.m4a';  // Make sure path is lowercase
    bgMusic.preload = 'auto';
    
    if (isMusicPlaying) {
        musicOn.classList.remove('hidden');
        musicOff.classList.remove('hidden');
        // Try to play on first user interaction
        document.addEventListener('click', function playOnFirstClick() {
            bgMusic.play().catch(console.error);
            document.removeEventListener('click', playOnFirstClick);
        }, { once: true });
    }
}

// Add click handler to document for audio
document.addEventListener('click', () => {
    if (isMusicPlaying && bgMusic.paused) {
        bgMusic.play().catch(error => {
            console.log("Audio play failed:", error);
        });
    }
});

// Event Listeners
joinBtn.addEventListener('click', () => {
    if (playerName.value && roomId.value) {
        connectWebSocket();
    }
});

// Add some validation for inputs
playerName.addEventListener('input', validateInputs);
roomId.addEventListener('input', validateInputs);

function validateInputs() {
    joinBtn.disabled = !playerName.value || !roomId.value;
}

// Add function to update player identity
function updatePlayerIdentity() {
    const identityDiv = document.createElement('div');
    identityDiv.className = 'player-identity';
    identityDiv.innerHTML = `You are: Player ${myPlayerNumber} (${playerName.value})`;
    
    // Add to both waiting room and game screen
    waitingRoom.insertBefore(identityDiv.cloneNode(true), waitingRoom.firstChild);
    gameScreen.insertBefore(identityDiv.cloneNode(true), gameScreen.firstChild);
}

// Add event listeners
musicToggle.addEventListener('click', toggleMusic);

// Initialize music when page loads
initializeMusic();

// Connect to WebSocket server
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.host;
    ws = new WebSocket(`${protocol}//${host}`);
    
    // Wait for connection to be established before sending join message
    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'join',
            playerName: playerName.value,
            roomId: roomId.value
        }));
        loginScreen.classList.add('hidden');
        waitingRoom.classList.remove('hidden');
        
        // Try to play music after user interaction
        if (isMusicPlaying) {
            bgMusic.load();
            bgMusic.play().catch(() => {
                // Will be handled by document click handler
            });
        }
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // Handle error messages
            if (data.type === 'error') {
                alert(data.message);
                // Reset the room ID input
                roomId.value = '';
                roomId.focus();
                return;
            }
            handleServerMessage(data);
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed');
        // Optional: Attempt to reconnect
        setTimeout(connectWebSocket, 3000);
    };
} 
