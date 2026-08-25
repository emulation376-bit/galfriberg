import { describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {
  ApplyRoomGuessInput,
  StoredPlayer,
  StoredRoom,
  applyRoomGuess,
  deleteRoom,
  getRoom,
  getRoomForIdentity,
  removeExpiredSpectators,
  saveRoom,
  withRoomLock,
} from './roomStore';

function makeRoom(id: string): StoredRoom {
  const now = Date.now();
  return {
    id,
    recordId: randomUUID(),
    ownerIp: '127.0.0.1',
    hostKey: 'u:1',
    status: 'waiting',
    matchmaking: false,
    readyCheckEndsAt: null,
    dbType: 'normal',
    boType: 3,
    rematchAllowed: true,
    rematchInviterKey: null,
    allowSpectators: false,
    anonymous: false,
    round: 0,
    players: [{
      key: 'u:1', userId: 1, name: 'one', socketId: 's1', ready: true,
      score: 0, guesses: [], lastGuessAt: null, connected: true, disconnectDeadline: null,
    }],
    spectators: [],
    targetPlayerId: null,
    roundEndsAt: null,
    nextRoundAt: null,
    eventResults: {},
    roundResult: null,
    matchResult: null,
    replayRounds: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe('roomStore local fallback', () => {
  it('derives one stable UUID for legacy rooms without a record id', async () => {
    const room = makeRoom(`legacy-${Date.now()}`);
    delete (room as Partial<StoredRoom>).recordId;
    await saveRoom(room);
    const first = await getRoom(room.id);
    const second = await getRoom(room.id);
    expect(first?.recordId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second?.recordId).toBe(first?.recordId);
    if (first) await deleteRoom(first);
  });

  it('serializes concurrent room updates and indexes identities', async () => {
    const room = makeRoom(`T${Date.now()}`);
    await saveRoom(room);
    await Promise.all(Array.from({ length: 20 }, () =>
      withRoomLock(room.id, (locked) => {
        locked.players[0].score += 1;
      })
    ));
    const found = await getRoomForIdentity('u:1');
    expect(found?.players[0].score).toBe(20);
    if (found) await deleteRoom(found);
  });

  it('does not clear a newer identity mapping when an old room is deleted', async () => {
    const oldRoom = makeRoom(`OLD${Date.now()}`);
    oldRoom.status = 'finished';
    oldRoom.matchResult = { winnerKey: 'u:1', reason: 'test', forfeitedKey: null };
    const newRoom = makeRoom(`NEW${Date.now()}`);
    await saveRoom(oldRoom);
    await saveRoom(newRoom);
    await deleteRoom(oldRoom);
    expect((await getRoomForIdentity('u:1'))?.id).toBe(newRoom.id);
    await deleteRoom(newRoom);
  });

  it('does not let a delayed old-room save reclaim an identity from a new room', async () => {
    const oldRoom = makeRoom(`LATE${Date.now()}`);
    oldRoom.status = 'finished';
    oldRoom.matchResult = { winnerKey: 'u:1', reason: 'test', forfeitedKey: null };
    const newRoom = makeRoom(`CURRENT${Date.now()}`);
    await saveRoom(oldRoom);
    await saveRoom(newRoom);

    await withRoomLock(oldRoom.id, (locked) => {
      locked.players[0].connected = false;
      locked.players[0].disconnectDeadline = Date.now() + 1000;
    });

    expect((await getRoomForIdentity('u:1'))?.id).toBe(newRoom.id);
    const delayedOldRoom = await import('./roomStore').then(({ getRoom }) => getRoom(oldRoom.id));
    if (delayedOldRoom) await deleteRoom(delayedOldRoom);
    await deleteRoom(newRoom);
  });

  it('rejects creating a second active room for the same identity', async () => {
    const first = makeRoom(`FIRST${Date.now()}`);
    const second = makeRoom(`SECOND${Date.now()}`);
    await saveRoom(first);
    await expect(saveRoom(second)).rejects.toThrow('ROOM_IDENTITY_CONFLICT');
    expect((await getRoomForIdentity('u:1'))?.id).toBe(first.id);
    await deleteRoom(first);
  });

  it('rejects an older room snapshot after a newer revision is stored', async () => {
    const room = makeRoom(`REV${Date.now()}`);
    await saveRoom(room);
    const stale = structuredClone(room);
    await withRoomLock(room.id, (locked) => {
      locked.players[0].score = 2;
    });
    await expect(saveRoom(stale)).rejects.toThrow('STALE_ROOM_WRITE');
    expect((await getRoomForIdentity('u:1'))?.players[0].score).toBe(2);
    const current = await getRoomForIdentity('u:1');
    if (current) await deleteRoom(current);
  });

  it('removes multiple expired spectators in one room update', async () => {
    const room = makeRoom(`SPECTATORS${Date.now()}`);
    const now = Date.now();
    room.allowSpectators = true;
    room.spectators = [
      {
        key: 'g:s1', userId: null, name: 's1', socketId: 'socket-s1',
        connected: false, disconnectDeadline: now - 1,
      },
      {
        key: 'g:s2', userId: null, name: 's2', socketId: 'socket-s2',
        connected: false, disconnectDeadline: now - 1,
      },
      {
        key: 'g:s3', userId: null, name: 's3', socketId: 'socket-s3',
        connected: true, disconnectDeadline: null,
      },
    ];
    await saveRoom(room);

    const result = await removeExpiredSpectators(room.id, ['g:s1', 'g:s2'], now);
    expect(result?.removedKeys).toEqual(['g:s1', 'g:s2']);
    expect((await getRoomForIdentity('u:1'))?.spectators.map((spectator) => spectator.key))
      .toEqual(['g:s3']);

    const current = await import('./roomStore').then(({ getRoom }) => getRoom(room.id));
    if (current) await deleteRoom(current);
  });

  it('keeps a casual round open until every player finished answering', async () => {
    const room = makeCasualPlayingRoom(`CASUAL1${Date.now()}`);
    await saveRoom(room);
    const inputA = guessInput(room.id, 'u:1', 's1', 1, 101, { gameId: 101, correct: true });
    const appliedA = await applyRoomGuess(inputA);
    expect(appliedA.kind).toBe('applied');
    if (appliedA.kind !== 'applied') return;
    expect(appliedA.shouldFinish).toBe(false);
    expect(appliedA.matchOver).toBe(false);
    expect(appliedA.casual).toBe(true);

    const inputB = guessInput(room.id, 'u:2', 's2', 1, 202, { gameId: 202, correct: true });
    const appliedB = await applyRoomGuess(inputB);
    expect(appliedB.kind).toBe('applied');
    if (appliedB.kind !== 'applied') return;
    expect(appliedB.shouldFinish).toBe(true);
    expect(appliedB.matchOver).toBe(false);

    const snapshot = appliedB.room!;
    expect(snapshot.status).toBe('round_over');
    expect(snapshot.roundResult?.winnerKeys).toEqual(['u:1', 'u:2']);
    expect(snapshot.players.find((p) => p.key === 'u:1')?.score).toBe(2);
    expect(snapshot.players.find((p) => p.key === 'u:2')?.score).toBe(1);
    await deleteRoom(room);
  });

  it('lets the other player keep guessing after one casual answer and rejects the finisher', async () => {
    const room = makeCasualPlayingRoom(`CASUAL2${Date.now()}`);
    await saveRoom(room);
    const first = await applyRoomGuess(
      guessInput(room.id, 'u:1', 's1', 1, 101, { gameId: 101, correct: true })
    );
    expect(first.kind).toBe('applied');
    if (first.kind !== 'applied') return;

    const second = await applyRoomGuess(
      guessInput(room.id, 'u:2', 's2', 1, 202, { gameId: 202, correct: false })
    );
    expect(second.kind).toBe('applied');
    if (second.kind !== 'applied') return;
    expect(second.shouldFinish).toBe(false);
    expect(second.room!.status).toBe('playing');

    const finisher = await applyRoomGuess(
      guessInput(room.id, 'u:1', 's1', 1, 103, { gameId: 103, correct: false })
    );
    expect(finisher.kind).toBe('error');
    if (finisher.kind !== 'error') return;
    expect(finisher.code).toBe('PLAYER_ROUND_DONE');
    await deleteRoom(room);
  });

  it('rejects guesses from a surrendered casual player and ends the round when the other answers', async () => {
    const room = makeCasualPlayingRoom(`CASUAL3${Date.now()}`);
    await saveRoom(room);
    await withRoomLock(room.id, (locked) => {
      locked.eventResults['surrender:1:u:1'] = 1;
    });

    const blocked = await applyRoomGuess(
      guessInput(room.id, 'u:1', 's1', 1, 101, { gameId: 101, correct: false })
    );
    expect(blocked.kind).toBe('error');
    if (blocked.kind !== 'error') return;
    expect(blocked.code).toBe('PLAYER_ROUND_DONE');

    const last = await applyRoomGuess(
      guessInput(room.id, 'u:2', 's2', 1, 203, { gameId: 203, correct: true })
    );
    expect(last.kind).toBe('applied');
    if (last.kind !== 'applied') return;
    expect(last.shouldFinish).toBe(true);
    expect(last.room!.status).toBe('round_over');
    expect(last.room!.roundResult?.winnerKeys).toEqual(['u:2']);
    expect(last.room!.roundResult?.reason).toBe('guessed');
    await deleteRoom(room);
  });

  it('awards the first casual correct guess 2 points and a later one 1 point', async () => {
    const room = makeCasualPlayingRoom(`CASUAL4${Date.now()}`);
    await saveRoom(room);

    const first = await applyRoomGuess(
      guessInput(room.id, 'u:1', 's1', 1, 101, { gameId: 101, correct: true })
    );
    expect(first.kind).toBe('applied');
    if (first.kind !== 'applied') return;
    expect(first.room!.players.find((p) => p.key === 'u:1')?.score).toBe(2);

    // A second correct guess in the same round is worth 1 point
    const second = await applyRoomGuess(
      guessInput(room.id, 'u:2', 's2', 1, 202, { gameId: 202, correct: true })
    );
    expect(second.kind).toBe('applied');
    if (second.kind !== 'applied') return;
    expect(second.room!.players.find((p) => p.key === 'u:1')?.score).toBe(2);
    expect(second.room!.players.find((p) => p.key === 'u:2')?.score).toBe(1);

    // A fresh round resets the first-correct bonus
    await deleteRoom(room);
    const next = makeCasualPlayingRoom(`CASUAL5${Date.now()}`);
    next.round = 2;
    await saveRoom(next);
    const nextFirst = await applyRoomGuess(
      guessInput(next.id, 'u:1', 's1', 2, 303, { gameId: 303, correct: true })
    );
    expect(nextFirst.kind).toBe('applied');
    if (nextFirst.kind !== 'applied') return;
    expect(nextFirst.room!.players.find((p) => p.key === 'u:1')?.score).toBe(2);
    await deleteRoom(next);
  });

  it('returns the post-save revision for applied local guesses', async () => {
    const room = makeCasualPlayingRoom(`REV${Date.now()}`);
    await saveRoom(room);
    const before = await getRoom(room.id);
    const result = await applyRoomGuess(
      guessInput(room.id, 'u:1', 's1', 1, 101, { gameId: 101, correct: true })
    );
    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') return;
    const after = await getRoom(room.id);
    expect(after?.revision).toBe((before?.revision ?? 0) + 1);
    // 客户端依赖 result.revision 作为 stateVersion,必须与落库后的 revision 一致
    expect(result.revision).toBe(after?.revision);
    expect(result.room?.revision).toBe(after?.revision);
    await deleteRoom(room);
  });
});

function makeCasualPlayingRoom(id: string): StoredRoom {
  const room = makeRoom(id);
  room.boType = 0;
  room.status = 'playing';
  room.round = 1;
  room.targetGameId = 1;
  room.roundEndsAt = Date.now() + 60_000;
  room.players = [
    player('u:1', 's1'),
    player('u:2', 's2'),
  ];
  return room;
}

function player(key: string, socketId: string): StoredPlayer {
  return {
    key, userId: null, name: key, socketId, ready: true,
    score: 0, guesses: [], lastGuessAt: null, connected: true, disconnectDeadline: null,
  };
}

function guessInput(
  roomId: string,
  identity: string,
  socketId: string,
  expectedRound: number,
  gameId: number,
  options: { correct: boolean }
): ApplyRoomGuessInput {
  return {
    roomId,
    identity,
    socketId,
    expectedRound,
    eventId: `evt-${identity}-${gameId}-${Math.random().toString(36).slice(2)}`,
    targetGameId: 1,
    feedback: {
      gameId,
      title: `title-${gameId}`,
      correct: options.correct,
      attributes: {
        releaseYear: { value: 2000, level: 'wrong' },
        company: { value: '', level: 'wrong' },
        isR18: { value: false, level: 'wrong' },
        scenarioWriter: { value: '', level: 'wrong' },
        musicComposer: { value: '', level: 'wrong' },
        artist: { value: '', level: 'wrong' },
        voiceActor: { value: '', level: 'wrong' },
        tags: { value: '', level: 'wrong' },
        bgmScore: { value: 0, level: 'wrong' },
        isSeries: { value: false, level: 'wrong' },
        length: { value: '', level: 'wrong' },
      },
    },
    maxGuesses: 8,
    nextRoundDelayMs: 100,
    minGuessIntervalMs: 0,
    rateLimit: 100,
    rateWindowSeconds: 10,
  };
}
