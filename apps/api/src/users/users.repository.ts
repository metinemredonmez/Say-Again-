import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '../database/database.js';
import {
  DIFFICULTIES,
  LEVELS,
  PACKS,
  refreshTokens,
  users,
  type User,
} from '../database/schema.js';

export type Level = (typeof LEVELS)[number];
export type Pack = (typeof PACKS)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];

/** The signed-in user, as handlers see it. */
export type AppUser = User;

export interface UserSettings {
  level?: Level | null;
  pack?: Pack;
  difficulty?: Difficulty;
}

export function toPublicUser(user: AppUser) {
  return {
    id: user.id,
    level: user.level,
    pack: user.pack,
    difficulty: user.difficulty,
    targetLanguage: user.targetLanguage,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class UsersRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async create(settings: UserSettings): Promise<AppUser> {
    const [user] = await this.db.insert(users).values(settings).returning();
    return user;
  }

  async findById(id: string): Promise<AppUser | null> {
    // Token subjects are UUIDs we issued; anything else cannot be a user.
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return null;
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user ?? null;
  }

  async update(id: string, settings: UserSettings): Promise<AppUser> {
    if (Object.keys(settings).length === 0) {
      return (await this.findById(id))!;
    }
    const [user] = await this.db
      .update(users)
      .set(settings)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  /** Deletes the user and, through cascades, every lesson, transcript, phrase and review (DAT). */
  async delete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
  }
}
