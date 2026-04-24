const {
  GRAPH, MRX_STARTS, DETECTIVE_STARTS,
  SURFACE_TURNS, DETECTIVE_TICKETS, MRX_TICKETS
} = require('./gameData');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createGame(players) {
  // players: [{id, name, role}]  role: 'mrx' | 'detective'
  const mrxPlayer = players.find(p => p.role === 'mrx');
  const detectives = players.filter(p => p.role === 'detective');

  // Assign starting positions
  const mrxStarts = shuffle(MRX_STARTS);
  const detStarts = shuffle(DETECTIVE_STARTS);

  const mrxPos = mrxStarts[0];
  const detPositions = {};
  const used = new Set([mrxPos]);
  let di = 0;
  for (const det of detectives) {
    while (used.has(detStarts[di])) di++;
    detPositions[det.id] = detStarts[di];
    used.add(detStarts[di]);
    di++;
  }

  const state = {
    phase: 'playing',    // 'lobby' | 'playing' | 'ended'
    turn: 1,             // 1..24
    subPhase: 'mrx',     // 'mrx' | 'detectives'
    detectiveTurn: 0,    // index into detectives array who moves next

    mrx: {
      id: mrxPlayer.id,
      name: mrxPlayer.name,
      pos: mrxPos,
      tickets: { ...MRX_TICKETS },
      log: [],           // [{turn, transport, pos}]  pos only revealed on surface turns
      lastSeen: null,    // pos on last surface turn
      lastSeenTurn: null
    },

    detectives: detectives.map((p, i) => ({
      id: p.id,
      name: p.name,
      pos: detPositions[p.id],
      tickets: { ...DETECTIVE_TICKETS },
      color: ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6'][i % 5],
      moved: false       // for this detective-phase
    })),

    winner: null,        // 'mrx' | 'detectives'
    winReason: null,
    pendingDouble: false // if Mr X played double-move, still has a move left
  };

  return state;
}

function getValidMoves(state, playerId) {
  const isMrx = state.mrx.id === playerId;

  if (isMrx) {
    const pos = state.mrx.pos;
    const tickets = state.mrx.tickets;
    const detPos = new Set(state.detectives.map(d => d.pos));
    const moves = [];

    const addMoves = (type) => {
      const neighbors = GRAPH[pos][type] || [];
      for (const dest of neighbors) {
        if (!detPos.has(dest)) {
          moves.push({ dest, transport: type });
        }
      }
    };

    // Normal tickets (Mr X picks these up during game, starts with 0)
    // In this implementation Mr X earns tickets from detectives
    if (tickets.taxi > 0) addMoves('taxi');
    if (tickets.bus > 0) addMoves('bus');
    if (tickets.underground > 0) addMoves('underground');
    // Black ticket: any transport + ferry
    if (tickets.black > 0) {
      const allNeighbors = [
        ...GRAPH[pos].taxi.map(d=>({dest:d,transport:'black'})),
        ...GRAPH[pos].bus.map(d=>({dest:d,transport:'black'})),
        ...GRAPH[pos].underground.map(d=>({dest:d,transport:'black'})),
        ...GRAPH[pos].ferry.map(d=>({dest:d,transport:'black'}))
      ].filter(m => !detPos.has(m.dest));
      moves.push(...allNeighbors);
    }

    return moves;
  } else {
    const det = state.detectives.find(d => d.id === playerId);
    if (!det) return [];
    const pos = det.pos;
    const tickets = det.tickets;
    const occupied = new Set([
      ...state.detectives.filter(d => d.id !== playerId).map(d => d.pos)
    ]);
    const moves = [];
    if (tickets.taxi > 0) {
      for (const dest of GRAPH[pos].taxi) {
        if (!occupied.has(dest)) moves.push({ dest, transport: 'taxi' });
      }
    }
    if (tickets.bus > 0) {
      for (const dest of GRAPH[pos].bus) {
        if (!occupied.has(dest)) moves.push({ dest, transport: 'bus' });
      }
    }
    if (tickets.underground > 0) {
      for (const dest of GRAPH[pos].underground) {
        if (!occupied.has(dest)) moves.push({ dest, transport: 'underground' });
      }
    }
    return moves;
  }
}

function applyMove(state, playerId, dest, transport) {
  const newState = deepClone(state);
  const isMrx = newState.mrx.id === playerId;

  if (isMrx) {
    const mrx = newState.mrx;
    const prevPos = mrx.pos;

    // Consume ticket
    if (transport === 'black') {
      mrx.tickets.black--;
    } else {
      mrx.tickets[transport]--;
    }

    mrx.pos = dest;

    // Check surface turn
    const isSurface = SURFACE_TURNS.includes(newState.turn);
    const logEntry = {
      turn: newState.turn,
      transport,
      revealed: isSurface,
      pos: isSurface ? dest : null
    };
    mrx.log.push(logEntry);

    if (isSurface) {
      mrx.lastSeen = dest;
      mrx.lastSeenTurn = newState.turn;
    }

    // Check win: any detective on Mr X?
    for (const det of newState.detectives) {
      if (det.pos === mrx.pos) {
        newState.phase = 'ended';
        newState.winner = 'detectives';
        newState.winReason = `${det.name} caught Mr. X!`;
        return newState;
      }
    }

    // Handle double move
    if (newState.pendingDouble) {
      newState.pendingDouble = false;
      // stay in mrx phase for second move (turn not incremented)
    } else {
      // Advance to detectives
      newState.subPhase = 'detectives';
      newState.detectiveTurn = 0;
      newState.detectives.forEach(d => d.moved = false);
    }

    return newState;
  } else {
    const det = newState.detectives.find(d => d.id === playerId);
    if (!det) return newState;

    // Transfer ticket to Mr X
    if (transport !== 'black') {
      newState.mrx.tickets[transport] = (newState.mrx.tickets[transport] || 0) + 1;
    }
    det.tickets[transport]--;
    det.pos = dest;
    det.moved = true;

    // Check if detective landed on Mr X
    if (det.pos === newState.mrx.pos) {
      newState.phase = 'ended';
      newState.winner = 'detectives';
      newState.winReason = `${det.name} caught Mr. X!`;
      return newState;
    }

    // Advance detective turn
    newState.detectiveTurn++;

    // Check if all detectives have moved
    const allMoved = newState.detectiveTurn >= newState.detectives.length;
    if (allMoved) {
      // Check if Mr X is cornered (no valid moves)
      newState.subPhase = 'mrx';
      newState.turn++;

      if (newState.turn > 24) {
        newState.phase = 'ended';
        newState.winner = 'mrx';
        newState.winReason = 'Mr. X evaded all detectives for 24 rounds!';
        return newState;
      }

      // Check if Mr X has any moves
      const mrxMoves = getValidMoves(newState, newState.mrx.id);
      if (mrxMoves.length === 0) {
        newState.phase = 'ended';
        newState.winner = 'detectives';
        newState.winReason = 'Mr. X has no valid moves — cornered!';
        return newState;
      }
    }

    return newState;
  }
}

function applyDoubleMove(state, playerId) {
  const newState = deepClone(state);
  if (newState.mrx.id !== playerId) return newState;
  if (newState.mrx.tickets.double <= 0) return newState;
  newState.mrx.tickets.double--;
  newState.pendingDouble = true;
  return newState;
}

function skipMove(state, playerId) {
  // Detective skips if stuck (no valid moves)
  const newState = deepClone(state);
  const det = newState.detectives.find(d => d.id === playerId);
  if (!det) return newState;
  det.moved = true;
  newState.detectiveTurn++;
  const allMoved = newState.detectiveTurn >= newState.detectives.length;
  if (allMoved) {
    newState.subPhase = 'mrx';
    newState.turn++;
    if (newState.turn > 24) {
      newState.phase = 'ended';
      newState.winner = 'mrx';
      newState.winReason = 'Mr. X evaded all detectives for 24 rounds!';
    }
  }
  return newState;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Build a view of state safe to send to detectives (hides Mr X position)
function detectiveView(state) {
  const view = deepClone(state);
  if (view.phase !== 'ended') {
    view.mrx.pos = null; // hide actual position
  }
  return view;
}

// Build a full view for Mr X
function mrxView(state) {
  return deepClone(state);
}

module.exports = {
  createGame,
  getValidMoves,
  applyMove,
  applyDoubleMove,
  skipMove,
  detectiveView,
  mrxView
};
