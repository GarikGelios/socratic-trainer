// In-memory session state for both chat and training modes.
const sessions = new Map(); // chat sessionId -> messages[]
const trainSessions = new Map(); // training sessionId -> session state object

function generateSessionId() {
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function createTrainSession() {
  return {
    history: [],
    stats: { asked: 0, totalScore: 0 },
    suggestLevel: true,
    suggestThreshold: 3,
    dedupWindow: 10,
    level: 1,
    levelStats: {
      1: { asked: 0, totalScore: 0 },
      2: { asked: 0, totalScore: 0 },
      3: { asked: 0, totalScore: 0 },
      4: { asked: 0, totalScore: 0 },
      5: { asked: 0, totalScore: 0 },
      6: { asked: 0, totalScore: 0 },
      7: { asked: 0, totalScore: 0 },
    },
  };
}

module.exports = { sessions, trainSessions, generateSessionId, createTrainSession };
