import type { AppUser } from '../users/users.repository.js';

// Tells @nestjs/authentication the user type once, so @CurrentUser() and
// AuthenticationContext are typed everywhere.
declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: AppUser;
  }
}
