import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  JwtBearerProvider,
  type JwtClaims,
} from '@nestjs/authentication';
import { UsersRepository, type AppUser } from '../users/users.repository.js';
import './auth-types.js';

// TOK-01: the package pins HS256 for the secret and checks signature, exp, iss and aud before
// validate() runs. validate() loads the user on every request, so a deleted account loses access
// at once.
@Injectable()
export class JwtAuth extends JwtBearerProvider<AppUser> {
  constructor(
    private readonly users: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super({ realm: 'say-again' });
    registry.registerProvider(this);
  }

  validate({ sub }: JwtClaims) {
    return sub ? this.users.findById(sub) : null;
  }
}
