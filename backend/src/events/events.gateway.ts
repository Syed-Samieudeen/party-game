import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';

import { Server } from 'socket.io';

type Player = {
  id: string;
  name: string;
};

type GameState = 'lobby' | 'question' | 'voting' | 'result' | 'finished';

type Room = {
  players: Player[];
  hostId: string | null;

  gameState: GameState;

  questionsQueue: string[];
  currentQuestionIndex: number;

  votes: Record<string, string>;
  hasVoted: Set<string>;

  roundActive: boolean;

  // Monotonically increasing token. Any timer captures the token that was
  // current when it was scheduled; if the token has changed by the time the
  // timer fires, the timer is stale and does nothing. This is what prevents
  // "multiple setTimeouts racing" / phases changing on their own.
  roundToken: number;

  voteTimer?: NodeJS.Timeout;
  questionTimer?: NodeJS.Timeout;
  nextRoundTimer?: NodeJS.Timeout;
};

const rooms: Record<string, Room> = {};

const QUESTION_DELAY_MS = 3000;
const VOTE_DURATION_MS = 10_000;
const RESULT_DELAY_MS = 5000;

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: any) {
    console.log('🟢 CONNECTED:', client.id);
  }

  handleDisconnect(client: any) {
    console.log('🔴 DISCONNECTED:', client.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];

      const wasInRoom = room.players.some((p) => p.id === client.id);
      if (!wasInRoom) continue;

      room.players = room.players.filter((p) => p.id !== client.id);
      delete room.votes[client.id];
      room.hasVoted.delete(client.id);

      if (room.hostId === client.id) {
        room.hostId = room.players[0]?.id || null;
      }

      if (room.players.length === 0) {
        this.clearAllTimers(room);
        delete rooms[roomId];
        continue;
      }

      this.broadcast(roomId);

      // If we were mid-vote and remaining players have all voted, resolve now
      if (
        room.gameState === 'voting' &&
        Object.keys(room.votes).length >= room.players.length
      ) {
        this.revealResults(roomId, room.roundToken);
      }
    }
  }

  @SubscribeMessage('create_room')
  createRoom(client: any, roomId: string) {
    rooms[roomId] = {
      players: [
        {
          id: client.id,
          name: 'Host',
        },
      ],
      hostId: client.id,
      gameState: 'lobby',
      questionsQueue: [],
      currentQuestionIndex: 0,
      votes: {},
      hasVoted: new Set(),
      roundActive: false,
      roundToken: 0,
    };

    client.join(roomId);

    client.emit('joined_room', {
      roomId,
      hostId: client.id,
      gameState: 'lobby',
    });

    this.broadcast(roomId);

    return { roomId };
  }

  @SubscribeMessage('join_room')
  joinRoom(client: any, data: { roomId: string; name: string }) {
    const room = rooms[data.roomId];
    if (!room) {
      client.emit('join_error', { message: 'Room not found' });
      return;
    }

    const exists = room.players.some((p) => p.id === client.id);

    if (!exists) {
      room.players.push({
        id: client.id,
        name: data.name,
      });
    }

    client.join(data.roomId);

    if (!room.hostId) {
      room.hostId = client.id;
    }

    client.emit('joined_room', {
      roomId: data.roomId,
      hostId: room.hostId,
      gameState: room.gameState,
    });

    // Sync the joining/rejoining client with current round state, so a
    // client that connects mid-round doesn't sit on the wrong screen.
    if (room.gameState === 'question') {
      client.emit('new_question', {
        question: room.questionsQueue[room.currentQuestionIndex],
      });
    } else if (room.gameState === 'voting') {
      client.emit('start_voting', {
        question: room.questionsQueue[room.currentQuestionIndex],
        duration: VOTE_DURATION_MS / 1000,
        players: room.players,
        hasVoted: room.hasVoted.has(client.id),
      });
    }

    this.broadcast(data.roomId);
  }

  @SubscribeMessage('add_question')
  addQuestion(client: any, data: { roomId: string; question: string }) {
    const room = rooms[data.roomId];
    if (!room) return;
    if (room.hostId !== client.id) return;
    if (!data.question?.trim()) return;

    room.questionsQueue.push(data.question.trim());

    this.server.to(data.roomId).emit('questions_updated', {
      questions: room.questionsQueue,
    });
  }

  @SubscribeMessage('start_game')
  startGame(client: any, roomId: string) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostId !== client.id) return;
    if (room.roundActive) return;
    if (room.questionsQueue.length === 0) return;

    room.roundActive = true;
    room.currentQuestionIndex = 0;

    // Bump the token and clear any leftover timers from a previous game.
    this.clearAllTimers(room);
    room.roundToken += 1;

    this.startQuestion(roomId, room.roundToken);
  }

  // ❓ QUESTION PHASE
  startQuestion(roomId: string, token: number) {
    const room = rooms[roomId];
    if (!room) return;
    if (token !== room.roundToken) return; // stale timer, ignore

    const question = room.questionsQueue[room.currentQuestionIndex];

    if (!question) {
      room.gameState = 'finished';
      room.roundActive = false;
      this.server.to(roomId).emit('game_finished');
      this.broadcast(roomId);
      return;
    }

    room.gameState = 'question';
    room.votes = {};
    room.hasVoted = new Set();

    this.server.to(roomId).emit('new_question', { question });
    this.broadcast(roomId);

    room.questionTimer = setTimeout(() => {
      this.startVoting(roomId, question, token);
    }, QUESTION_DELAY_MS);
  }

  // 🗳️ VOTING PHASE (10 seconds)
  startVoting(roomId: string, question: string, token: number) {
    const room = rooms[roomId];
    if (!room) return;
    if (token !== room.roundToken) return; // stale timer, ignore

    room.gameState = 'voting';

    this.server.to(roomId).emit('start_voting', {
      question,
      duration: VOTE_DURATION_MS / 1000,
      players: room.players,
      startTime: Date.now(),
    });
    this.broadcast(roomId);

    room.voteTimer = setTimeout(() => {
      this.revealResults(roomId, token);
    }, VOTE_DURATION_MS);
  }

  // 🗳️ SUBMIT VOTE
  @SubscribeMessage('submit_vote')
  submitVote(client: any, data: { roomId: string; targetId: string }) {
    const room = rooms[data.roomId];
    if (!room) return;

    if (room.gameState !== 'voting') return;
    if (room.hasVoted.has(client.id)) return; // already voted — hard block server-side
    if (!room.players.some((p) => p.id === client.id)) return;
    if (!room.players.some((p) => p.id === data.targetId)) return;

    room.votes[client.id] = data.targetId;
    room.hasVoted.add(client.id);

    client.emit('vote_received');

    const totalVotes = Object.keys(room.votes).length;
    const totalPlayers = room.players.length;

    if (totalVotes >= totalPlayers) {
      if (room.voteTimer) clearTimeout(room.voteTimer);
      this.revealResults(data.roomId, room.roundToken);
    }
  }

  // 🏆 RESULTS
  revealResults(roomId: string, token: number) {
    const room = rooms[roomId];
    if (!room) return;
    if (token !== room.roundToken) return; // stale timer, ignore
    if (room.gameState !== 'voting') return; // already resolved this round

    if (room.voteTimer) clearTimeout(room.voteTimer);
    if (room.questionTimer) clearTimeout(room.questionTimer);

    const tally: Record<string, number> = {};

    for (const voter in room.votes) {
      const target = room.votes[voter];
      tally[target] = (tally[target] || 0) + 1;
    }

    let winnerId: string | null = null;
    let max = 0;

    for (const id in tally) {
      if (tally[id] > max) {
        max = tally[id];
        winnerId = id;
      }
    }

    const winner = room.players.find((p) => p.id === winnerId) || null;

    room.gameState = 'result';

    this.server.to(roomId).emit('round_result', {
      winner,
      tally,
    });
    this.broadcast(roomId);

    room.currentQuestionIndex += 1;

    room.nextRoundTimer = setTimeout(() => {
      this.startQuestion(roomId, token);
    }, RESULT_DELAY_MS);
  }

  clearAllTimers(room: Room) {
    if (room.questionTimer) clearTimeout(room.questionTimer);
    if (room.voteTimer) clearTimeout(room.voteTimer);
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
  }

  broadcast(roomId: string) {
    const room = rooms[roomId];
    if (!room) return;

    this.server.to(roomId).emit('room_updated', {
      players: room.players,
      hostId: room.hostId,
      gameState: room.gameState,
      questions: room.questionsQueue,
    });
  }
}
