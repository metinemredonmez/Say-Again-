import { Injectable } from '@nestjs/common';
import {
  AuthenticationStorage,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Database } from '../database/database.js';
import { refreshTokens } from '../database/schema.js';

// Refresh tokens in PostgreSQL, stored by SHA-256. markRefreshTokenUsed() is one conditional
// UPDATE, so of two refreshes with the same token only one wins and reuse revokes the family
// (the package's store contract; SES/TOK).
@Injectable()
export class DrizzleRefreshTokenStore implements RefreshTokenStore {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ refreshTokens: this });
  }

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, id));
    if (!row) {
      return undefined;
    }
    const { revoked: _revoked, usedAt, claims, ...token } = row;
    return {
      ...token,
      ...(usedAt ? { usedAt } : {}),
      ...(claims ? { claims } : {}),
    };
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.db.insert(refreshTokens).values(record);
    await this.db
      .delete(refreshTokens)
      .where(lte(refreshTokens.familyExpiresAt, record.createdAt));
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(refreshTokens)
      .set({ usedAt: at })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.usedAt)))
      .returning({ id: refreshTokens.id });
    return updated.length === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.familyId, familyId));
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const revoked = await this.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.familyId, familyId),
          eq(refreshTokens.revoked, true),
        ),
      )
      .limit(1);
    return revoked.length > 0;
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.userId, userId));
  }
}
