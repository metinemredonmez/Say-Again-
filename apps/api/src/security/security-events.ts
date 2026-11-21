import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AuthenticationEvents } from '@nestjs/authentication';
import type { Subscription } from 'rxjs';
import { currentRequest } from './request-context.js';

// LOG-01: security events as structured log entries (JSON in production, see main.ts): what
// happened, the decision, the server-verified actor, the object, the reason, and the request's
// id, resolved IP and socket peer. LOG-02: never a token, a transcript, a note or a store
// payload; ids and fixed reason codes only.

export type SecurityEventName =
  | 'auth.device_registered'
  | 'auth.refresh_reused'
  | 'auth.signed_out'
  | 'auth.denied'
  | 'access.forbidden'
  | 'rate_limited'
  | 'account.deleted'
  | 'ai_budget.user_limit'
  | 'ai_budget.global_limit'
  | 'ai.output_rejected'
  | 'subscription.linked'
  | 'subscription.refused'
  | 'subscription.moved'
  | 'webhook.refused';

export interface SecurityEvent {
  event: SecurityEventName;
  /** alert: someone should look (token theft, the global budget is spent). */
  outcome: 'allow' | 'deny' | 'alert';
  /** The user id from the verified token or the database, never from the request body. */
  actor?: string;
  /** What the event is about: a lesson id, a store name, a route. */
  object?: string;
  /** A fixed code or a server-written message. */
  reason?: string;
}

@Injectable()
export class SecurityEvents implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SecurityEvent');
  private subscription?: Subscription;

  constructor(private readonly auth: AuthenticationEvents) {}

  // Sign-ins, refresh-token reuse (a stolen token) and sign-outs come from the authentication
  // package. Its subject emits synchronously, inside the request that caused the event.
  onModuleInit(): void {
    this.subscription = this.auth.events$.subscribe((e) => {
      if (e.type === 'sign-in') {
        this.record({
          event: 'auth.device_registered',
          outcome: 'allow',
          actor: e.userId,
          reason: e.method,
        });
      } else if (e.type === 'refresh-token-reused') {
        this.record({
          event: 'auth.refresh_reused',
          outcome: 'alert',
          actor: e.userId,
          object: e.tokenFamilyId,
          reason: 'token family revoked',
        });
      } else if (e.type === 'sign-out') {
        this.record({
          event: 'auth.signed_out',
          outcome: 'allow',
          actor: e.userId,
          ...(e.everywhere ? { reason: 'everywhere' } : {}),
        });
      }
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  record(event: SecurityEvent): void {
    const request = currentRequest();
    const entry = {
      ...event,
      requestId: request?.requestId,
      ip: request?.ip,
      peer: request?.peer,
      method: request?.method,
      path: request?.path,
    };
    if (event.outcome === 'alert') {
      this.logger.warn(entry);
    } else {
      this.logger.log(entry);
    }
  }
}
