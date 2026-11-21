# db

Veritabanı şeması artık API'nin içinde ve göçlerle yönetiliyor:

- Şema: `apps/api/src/database/schema.ts` (Drizzle)
- Göçler: `apps/api/drizzle` (`npm run db:generate` üretir, `npm run db:migrate` uygular)

Bu klasör yalnızca `docker compose up -d db` ile çalışan yerel PostgreSQL'in verisini
(`db/data/`, git'e girmez) tutar. Docker yoksa Homebrew PostgreSQL ya da `DATABASE_URL=pglite:...`
kullan (`apps/api/.env.example`).
