const { WebSocketServer } = require('ws');
const http = require('http');
const { createGame, getValidMoves, applyMove, applyDoubleMove, skipMove, detectiveView, mrxView } = require('./gameLogic');

const PORT = process.env.PORT || 3001;

// rooms: Map<roomCode, RoomState>
const rooms = new Map();

function generateCode() {
  const words = ['WOLF','HAWK','RAVEN','FOX','CROW','OWL','LYNX','BEAR','VIPER','COBRA'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${word}-${num}`;
}

function broadcastToRoom(room, messageObj, excludeId = null) {
  for (const [playerId, ws] of room.clients.entries()) {
    if (playerId === excludeId) continue;
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(messageObj));
    }
  }
}

function sendToPlayer(room, playerId, messageObj) {
  const ws = room.clients.get(playerId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(messageObj));
  }
}

function buildStatePayload(room, playerId) {
  if (!room.gameState) return null;
  const isMrx = room.gameState.mrx.id === playerId;
  const state = isMrx ? mrxView(room.gameState) : detectiveView(room.gameState);
  const validMoves = room.gameState.phase === 'playing'
    ? getValidMoves(room.gameState, playerId)
    : [];
  const isMyTurn = isPlayerTurn(room.gameState, playerId);
  return { state, validMoves, isMyTurn };
}

function isPlayerTurn(state, playerId) {
  if (state.phase !== 'playing') return false;
  if (state.subPhase === 'mrx') {
    return state.mrx.id === playerId;
  } else {
    const det = state.detectives[state.detectiveTurn];
    return det && det.id === playerId;
  }
}

function broadcastGameState(room) {
  for (const [playerId] of room.clients.entries()) {
    const payload = buildStatePayload(room, playerId);
    if (payload) {
      sendToPlayer(room, playerId, { type: 'game_state', ...payload });
    }
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let currentPlayerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create_room': {
        let code;
        do { code = generateCode(); } while (rooms.has(code));
        const room = {
          code,
          host: msg.playerId,
          players: [{ id: msg.playerId, name: msg.name, role: null, ready: false }],
          clients: new Map([[msg.playerId, ws]]),
          gameState: null,
          chat: []
        };
        rooms.set(code, room);
        currentRoomCode = code;
        currentPlayerId = msg.playerId;
        ws.send(JSON.stringify({
          type: 'room_created',
          code,
          players: room.players,
          playerId: msg.playerId
        }));
        break;
      }

      case 'join_room': {
        const room = rooms.get(msg.code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (room.gameState && room.gameState.phase === 'playing') {
          ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' }));
          return;
        }
        if (room.players.length >= 6) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full (max 6 players)' }));
          return;
        }
        // Reconnect logic
        const existing = room.players.find(p => p.id === msg.playerId);
        if (existing) {
          room.clients.set(msg.playerId, ws);
        } else {
          room.players.push({ id: msg.playerId, name: msg.name, role: null, ready: false });
          room.clients.set(msg.playerId, ws);
        }
        currentRoomCode = msg.code;
        currentPlayerId = msg.playerId;

        ws.send(JSON.stringify({
          type: 'room_joined',
          code: msg.code,
          players: room.players,
          playerId: msg.playerId,
          chat: room.chat.slice(-50)
        }));

        broadcastToRoom(room, {
          type: 'player_joined',
          players: room.players
        }, msg.playerId);

        // Send game state if game in progress
        if (room.gameState) {
          const payload = buildStatePayload(room, msg.playerId);
          if (payload) ws.send(JSON.stringify({ type: 'game_state', ...payload }));
        }
        break;
      }

      case 'set_role': {
        const room = rooms.get(currentRoomCode);
        if (!room) return;
        const player = room.players.find(p => p.id === currentPlayerId);
        if (!player) return;

        // Only one Mr X allowed
        if (msg.role === 'mrx') {
          const existingMrx = room.players.find(p => p.role === 'mrx' && p.id !== currentPlayerId);
          if (existingMrx) {
            ws.send(JSON.stringify({ type: 'error', message: 'Mr. X role already taken' }));
            return;
          }
        }
        player.role = msg.role;
        broadcastToRoom(room, { type: 'players_updated', players: room.players });
        ws.send(JSON.stringify({ type: 'players_updated', players: room.players }));
        break;
      }

      case 'set_ready': {
        const room = rooms.get(currentRoomCode);
        if (!room) return;
        const player = room.players.find(p => p.id === currentPlayerId);
        if (!player) return;
        player.ready = msg.ready;
        broadcastToRoom(room, { type: 'players_updated', players: room.players });
        ws.send(JSON.stringify({ type: 'players_updated', players: room.players }));
        break;
      }

      case 'start_game': {
        const room = rooms.get(currentRoomCode);
        if (!room) return;
        if (room.host !== currentPlayerId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game' }));
          return;
        }
        const hasMrx = room.players.some(p => p.role === 'mrx');
        const hasDetective = room.players.some(p => p.role === 'detective');
        if (!hasMrx || !hasDetective) {
          ws.send(JSON.stringify({ type: 'error', message: 'Need at least 1 Mr. X and 1 detective' }));
          return;
        }
        room.gameState = createGame(room.players);
        broadcastToRoom(room, { type: 'game_started' });
        ws.send(JSON.stringify({ type: 'game_started' }));
        broadcastGameState(room);
        break;
      }

      case 'use_double': {
        const room = rooms.get(currentRoomCode);
        if (!room || !room.gameState) return;
        if (room.gameState.mrx.id !== currentPlayerId) return;
        if (room.gameState.subPhase !== 'mrx') return;
        room.gameState = applyDoubleMove(room.gameState, currentPlayerId);
        broadcastGameState(room);
        break;
      }

      case 'move': {
        const room = rooms.get(currentRoomCode);
        if (!room || !room.gameState) return;
        if (!isPlayerTurn(room.gameState, currentPlayerId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not your turn' }));
          return;
        }
        const { dest, transport } = msg;
        const validMoves = getValidMoves(room.gameState, currentPlayerId);
        const isValid = validMoves.some(m => m.dest === dest && m.transport === transport);
        if (!isValid) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid move' }));
          return;
        }
        const prevTurn = room.gameState.turn;
        room.gameState = applyMove(room.gameState, currentPlayerId, dest, transport);

        const isMrx = room.gameState.mrx.id === currentPlayerId;
        // Notify detectives of Mr X's transport (not position)
        const moveAnnouncement = isMrx
          ? { type: 'mrx_moved', transport, turn: prevTurn }
          : { type: 'detective_moved', playerId: currentPlayerId, dest, transport };
        broadcastToRoom(room, moveAnnouncement);

        broadcastGameState(room);

        if (room.gameState.phase === 'ended') {
          broadcastToRoom(room, {
            type: 'game_ended',
            winner: room.gameState.winner,
            reason: room.gameState.winReason,
            mrxFinalPos: room.gameState.mrx.pos
          });
          ws.send(JSON.stringify({
            type: 'game_ended',
            winner: room.gameState.winner,
            reason: room.gameState.winReason,
            mrxFinalPos: room.gameState.mrx.pos
          }));
        }
        break;
      }

      case 'skip_turn': {
        const room = rooms.get(currentRoomCode);
        if (!room || !room.gameState) return;
        if (!isPlayerTurn(room.gameState, currentPlayerId)) return;
        const validMoves = getValidMoves(room.gameState, currentPlayerId);
        if (validMoves.length > 0) {
          ws.send(JSON.stringify({ type: 'error', message: 'You have valid moves, cannot skip' }));
          return;
        }
        room.gameState = skipMove(room.gameState, currentPlayerId);
        broadcastGameState(room);
        break;
      }

      case 'chat': {
        const room = rooms.get(currentRoomCode);
        if (!room) return;
        const player = room.players.find(p => p.id === currentPlayerId);
        const chatMsg = {
          type: 'chat',
          name: player ? player.name : 'Unknown',
          text: String(msg.text).slice(0, 200),
          ts: Date.now()
        };
        room.chat.push(chatMsg);
        if (room.chat.length > 200) room.chat.shift();
        broadcastToRoom(room, chatMsg);
        ws.send(JSON.stringify(chatMsg));
        break;
      }

      case 'restart': {
        const room = rooms.get(currentRoomCode);
        if (!room || room.host !== currentPlayerId) return;
        room.gameState = null;
        room.players.forEach(p => { p.ready = false; p.role = null; });
        broadcastToRoom(room, { type: 'game_reset', players: room.players });
        ws.send(JSON.stringify({ type: 'game_reset', players: room.players }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    room.clients.delete(currentPlayerId);
    broadcastToRoom(room, {
      type: 'player_disconnected',
      playerId: currentPlayerId,
      players: room.players
    });
    // Clean up empty rooms
    if (room.clients.size === 0) {
      setTimeout(() => {
        const r = rooms.get(currentRoomCode);
        if (r && r.clients.size === 0) rooms.delete(currentRoomCode);
      }, 60000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Scotland Yard server running on port ${PORT}`);
});
