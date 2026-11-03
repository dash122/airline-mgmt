// The game clock runs on its own. One simulated day passes every DAY_MS at 1x speed.
import { AIRPORT_BY_CODE } from '../data/airports';
import { DAY, utcFromLocal, utcOffsetMin } from '../sim/simulate';

export const DAY_MS = 60_000;
export const SPEEDS = [0, 1, 4, 12] as const;
export type Speed = (typeof SPEEDS)[number];

export class GameClock {
  private anchorMin: number;
  private anchorTs: number;
  speed: Speed;
  constructor(utcMin: number, speed: Speed = 1) {
    this.anchorMin = utcMin;
    this.anchorTs = performance.now();
    this.speed = speed;
  }
  /** Simulated UTC minutes since the game started (day 0, 00:00 UTC). */
  now(): number {
    return this.anchorMin + ((performance.now() - this.anchorTs) / DAY_MS) * DAY * this.speed;
  }
  setSpeed(speed: Speed) {
    this.anchorMin = this.now();
    this.anchorTs = performance.now();
    this.speed = speed;
  }
}

/** Day number at the base, starting from 1 (a new day begins at local midnight). */
export const dayAt = (base: string, utcMin: number) => Math.floor((utcMin + utcOffsetMin(AIRPORT_BY_CODE[base])) / DAY) + 1;

/** A new game starts at 06:00 local time on day 1. */
export const startMinute = (base: string) => utcFromLocal(base, 6 * 60);

export interface DayRecord {
  day: number;
  revenue: number;
  cost: number;
  pax: number;
}

export interface GameState {
  version: 1;
  utcMin: number;
  /** Profit or loss since the start, NT$. */
  balance: number;
  /** The most recent days, oldest first. */
  history: DayRecord[];
}

export const HISTORY_DAYS = 28;
export const newGame = (base: string): GameState => ({ version: 1, utcMin: startMinute(base), balance: 0, history: [] });
