# Say Again

Türkçe konuşanlar için mobil İngilizce koçu: gerçek bir konuşmayı prova et, tek bir düzeltme al,
yeniden söyle ve üç gün sonra aynı beceriyi yardımsız kullanabildiğini gör.

- Mobil uygulama: Expo (iOS ve Android), henüz şablon
- API: NestJS, PostgreSQL (Drizzle), AI katmanı API'nin içinde (`apps/api/src/ai`)
- AI: koç Claude Haiku 5.5, değerlendirici Claude Opus 5.5, ses OpenAI
- İçerik: iki pakette 20 senaryo (`content/scenarios.json`)

## Hızlı başlangıç

Gereken: Node.js 22 veya üstü (`nvm use`, kökteki `.nvmrc`). Docker ya da PostgreSQL sunucusu
gerekmez: API varsayılan olarak süreç içi PostgreSQL (PGlite) ve sahte AI sağlayıcılarıyla çalışır.

```bash
# 1) API
cd apps/api
npm install                # npm 10 "edgesOut" hatası verirse: npx npm@latest install
cp .env.example .env       # JWT_SECRET'i doldur: openssl rand -base64 32
npm run start:dev          # http://localhost:3000

# 2) Mobil uygulama (ayrı bir terminalde)
cd apps/mobile
npm install
cp .env.example .env       # telefonda denerken API adresini bilgisayarının yerel IP'siyle değiştir
npx expo start             # i: iOS simülatörü, a: Android, ya da Expo Go ile QR kodu okut
```

Gerçek AI için `apps/api/.env` içinde `AI_PROVIDER=live`, `ANTHROPIC_API_KEY` ve
`OPENAI_API_KEY` ayarla. Anahtarlar yalnızca bu dosyada durur ve mobil uygulamaya asla girmez.

Yerel PostgreSQL ile çalışmak için (Homebrew): `createdb say_again`, sonra `.env` içinde
`DATABASE_URL=postgres://localhost:5432/say_again`. Göçler geliştirmede açılışta uygulanır;
üretimde `npm run db:migrate` ile.

## API'yi denemek

```bash
# Anonim hesap aç, erişim tokenını al
curl -s -X POST localhost:3000/auth/device -H 'content-type: application/json' -d '{"level":"B1"}'

# Ders başlat (TOKEN yukarıdaki accessToken)
curl -s -X POST 'localhost:3000/lessons?audio=false' -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"scenarioId":"pro-interview-01"}'
```

Bütün uçlar ve ders akışı: `docs/03-mimari.md`.

## Mağaza abonelikleri

Abonelik Apple ve Google ile doğrudan doğrulanır. Gerekenler `apps/api/.env.example` içinde.
Apple için kök sertifikaları Apple PKI sayfasından (https://www.apple.com/certificateauthority/)
indirip bir klasöre koy ve `APPLE_ROOT_CERTS_DIR` ile göster: `AppleRootCA-G3.cer`,
`AppleRootCA-G2.cer`, `AppleIncRootCertificate.cer`. Mağaza ayarları yokken abonelik uçları
`store_not_configured` döner; pilot için `PAYWALL_ENABLED=false` kotayı kapatır.

Uygulama satın almayı başlatırken `GET /me` içindeki `storeAccountToken` değerini Apple'da
`appAccountToken`, Google'da `obfuscatedAccountId` olarak geçmeli. "Satın almayı geri yükle"
Apple'da StoreKit'in `jwsRepresentation` değerini (`signedTransaction`), Google'da satın alma
tokenını `restore: true` ile gönderir; abonelik yeni hesaba taşınır.

## Klasörler

| Klasör | İçerik |
| --- | --- |
| `apps/api` | NestJS API: kimlik, dersler, AI (`src/ai`), tekrar ve transfer, kota, abonelik, göçler (`drizzle/`) |
| `apps/mobile` | Expo uygulaması (şablon). Hedef: Bugün, Prova, Düzeltme, Defter, Hesap ekranları |
| `content` | Senaryolar ve hata kategorileri |
| `prompts` | Koç, değerlendirici ve transfer değerlendirme istemleri; kodsuz prova için başlangıç istemi |
| `db` | Yerel PostgreSQL verisi (Docker ile); şema `apps/api/src/database` içinde |
| `evals` | AI kalite testlerinin cevap anahtarları |
| `docs` | Ürün, MVP kapsamı, mimari, yol haritası, kalite testleri, yayın ve hukuk, 30 günlük plan, güvenlik denetimi (`08-guvenlik.md`) |

## Kontrol

```bash
npm run check    # API: lint, test, e2e, build
```

GitHub Actions her push'ta ve pull request'te aynı denetimi çalıştırır, e2e testlerini ayrıca
gerçek PostgreSQL'de koşar (`.github/workflows/ci.yml`).
