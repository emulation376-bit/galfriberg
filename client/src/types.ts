export type FeedbackLevel = 'correct' | 'close' | 'wrong';

export interface AttributeFeedback {
  value: string | number | boolean;
  level: FeedbackLevel;
  hint?: 'higher' | 'lower';
  /** staff 类属性（、分隔）逐人信息：matched = 该人是否命中答案的 staff 集合 */
  parts?: Array<{ name: string; matched: boolean }>;
  /** staff 类属性截断后省略的人数（>0 时渲染「+N」省略 cell） */
  omitted?: number;
}

export interface GuessFeedback {
  gameId: number;
  title: string;
  correct: boolean;
  attributes: {
    releaseYear: AttributeFeedback;
    company: AttributeFeedback;
    isR18: AttributeFeedback;
    scenarioWriter: AttributeFeedback;
    musicComposer: AttributeFeedback;
    artist: AttributeFeedback;
    voiceActor: AttributeFeedback;
    tags: AttributeFeedback;
    bgmScore: AttributeFeedback;
    isSeries: AttributeFeedback;
    length: AttributeFeedback;
  };
}

export type HiddenAttributeFeedback = Pick<AttributeFeedback, 'level' | 'hint'>;

export interface HiddenGuessFeedback {
  hidden: true;
  correct: boolean;
  attributes: {
    releaseYear: HiddenAttributeFeedback;
    company: HiddenAttributeFeedback;
    isR18: HiddenAttributeFeedback;
    scenarioWriter: HiddenAttributeFeedback;
    musicComposer: HiddenAttributeFeedback;
    artist: HiddenAttributeFeedback;
    voiceActor: HiddenAttributeFeedback;
    tags: HiddenAttributeFeedback;
    bgmScore: HiddenAttributeFeedback;
    isSeries: HiddenAttributeFeedback;
    length: HiddenAttributeFeedback;
  };
}

export type MultiplayerGuessFeedback = GuessFeedback | HiddenGuessFeedback;

export interface UserInfo {
  id: number;
  username: string;
  role: 'user' | 'admin';
}

export interface GameInfo {
  id: number;
  title: string;
  titleCn: string;
  releaseYear: number;
  company: string;
  isR18: boolean;
  scenarioWriter: string;
  musicComposer: string;
  artist: string;
  voiceActor: string;
  tags: string[];
  isSeries?: boolean;
  lengthMinutes?: number;
  bgmScore: number;
  vndbId?: string | null;
}

export interface CharacterNameClue {
  lang: string;
  name: string;
  latin: string | null;
}

export interface CharacterTraitClue {
  traitId: string;
  traitName: string;
  groupId: string;
  groupName: string;
}

export interface CharacterVoiceActorClue {
  staffId: string;
  name: string;
}

export interface CharacterGameClue {
  gameId: number | null;
  title: string;
  titleCn: string;
  company: string;
  releaseDate: string | null;
  bgmScore: number;
  difficulties: string[];
}

export interface CharacterClue {
  id: string;
  nameCn: string | null;
  surname: string | null;
  givenName: string | null;
  image: string | null;
  ymgal_image?: string | null;
  sex: string | null;
  birthday: number | null;
  height: number | null;
  age: number | null;
  names: CharacterNameClue[];
  traits: CharacterTraitClue[];
  voiceActors: CharacterVoiceActorClue[];
  games: CharacterGameClue[];
  bgmScore: number | null;
  difficulties: string[];
}

export interface CharacterGuessFeedback {
  guessId: string;
  image?: string | null;
  gameTitles: string[];
  releaseRange: {
    earliest: AttributeFeedback;
    latest: AttributeFeedback;
  };
  works: {
    level: 'correct' | 'close' | 'wrong';
    sameCompany: boolean;
    parts?: Array<{ name: string; matched: boolean }>;
    omitted?: number;
  };
  correct: boolean;
  nameLevel: 'correct' | 'close' | 'wrong';
  attributes: {
    sex: AttributeFeedback;
    birthday: AttributeFeedback;
    height: AttributeFeedback;
    age: AttributeFeedback;
    bgmScore: AttributeFeedback;
    difficulty: AttributeFeedback;
    clothes: AttributeFeedback;
    role: AttributeFeedback;
    hair: AttributeFeedback;
    body: AttributeFeedback;
    eyes: AttributeFeedback;
    voiceActor: AttributeFeedback;
  };
}

export interface CharacterListEntry {
  id: string;
  name: string;
  names: string[];
  firstGame: {
    title: string;
    titleCn: string;
    releaseDate: string | null;
  } | null;
}

export interface RoomPlayer {
  key: string;
  name: string;
  ready: boolean;
  connected: boolean;
  score: number;
  guessCount: number;
  /** 聚会赛制下是否已投降本轮（投降后不可再作答） */
  roundSurrendered?: boolean;
  guesses: MultiplayerGuessFeedback[];
}

export interface PlayerPerformanceStats {
  single: {
    games: number;
    wins: number;
    losses: number;
    winRate: number;
    avgGuesses: number | null;
    bestGuesses: number | null;
  };
  character: {
    games: number;
    wins: number;
    losses: number;
    winRate: number;
    avgGuesses: number | null;
    bestGuesses: number | null;
  };
  multi: {
    games: number;
    wins: number;
    losses: number;
    winRate: number;
    recentAverageWinningGuesses: number | null;
    recentMatches: Array<{
      id: number;
      result: 'won' | 'lost' | 'draw';
      score: { me: number; opponent: number };
      boType: number;
      dbType: string;
      opponentDisplayId: string;
      finishedAt: string;
      rounds: Array<{
        round: number;
        winner: 'me' | 'opponent' | null;
        meGuesses: number;
        opponentGuesses: number;
      }>;
    }>;
  };
}

export interface MatchReplayRound {
  round: number;
  reason: string;
  winner: 'me' | 'opponent' | null;
  answer: GameInfo;
  me: { guesses: GuessFeedback[] };
  opponent: { guesses: GuessFeedback[] };
}

export interface MatchReplay {
  id: number | string;
  mode: string;
  boType: number;
  finishedAt: string;
  result: 'won' | 'lost' | 'draw';
  me: { score: number };
  opponent: { displayId: string; score: number };
  rounds: MatchReplayRound[];
}

export interface RoomState {
  id: string;
  hostKey: string;
  status: 'waiting' | 'playing' | 'round_over' | 'finished';
  matchmaking: boolean;
  readyCheckEndsAt: number | null;
  dbType: string;
  boType: number;
  rematchAllowed: boolean;
  rematchInvite: { inviterKey: string } | null;
  allowSpectators: boolean;
  anonymous: boolean;
  round: number;
  roundId: number;
  stateVersion: number;
  winsNeeded: number;
  maxGuesses: number;
  roundEndsAt: number | null;
  matchStartsAt: number | null;
  spectatorCount: number;
  players: RoomPlayer[];
  roundResult: {
    winnerKey: string | null;
    /** 聚会赛制下双方都可能猜中；普通赛制为单个 winnerKey 或 null */
    winnerKeys?: string[] | null;
    reason: string;
    nextRoundAt: number | null;
    answer: {
      title: string;
      titleCn: string;
      releaseYear: number;
      company: string;
      isR18: boolean;
      scenarioWriter: string;
      musicComposer: string;
      artist: string;
      voiceActor: string;
      isSeries?: boolean;
      lengthMinutes?: number;
      bgmScore: number;
    } | null;
  } | null;
  matchResult: {
    winnerKey: string | null;
    reason: string;
    answer: {
      title: string;
      titleCn: string;
      releaseYear: number;
      company: string;
      isR18: boolean;
      scenarioWriter: string;
      musicComposer: string;
      artist: string;
      voiceActor: string;
      isSeries?: boolean;
      lengthMinutes?: number;
      bgmScore: number;
    } | null;
  } | null;
  matchReplay?: MatchReplay;
}

export interface RoomPatch {
  roomId: string;
  baseVersion: number;
  stateVersion: number;
  hostKey?: string;
  players?: {
    added?: RoomPlayer[];
    updated?: Array<Partial<RoomPlayer> & { key: string }>;
    removed?: string[];
  };
  spectatorCount?: number;
}

export interface PresenceStats {
  onlineUsers: number;
  multiplayerRooms: number;
  singleGames: number;
  updatedAt: number;
}
