# Say Again

Türkçe konuşanlar için mobil İngilizce koçu: gerçek bir konuşmayı prova et, tek bir düzeltme al,
yeniden söyle ve üç gün sonra aynı beceriyi yardımsız kullanabildiğini gör.

- Mobil uygulama: Expo (iOS ve Android)
- API: NestJS
- Veritabanı: PostgreSQL (şema hazır, bağlantı Aşama 2'de)
- İçerik: iki pakette 20 senaryo (`content/scenarios.json`)

## Hızlı başlangıç

Gereken: Node.js 22 veya üstü. npm 10'da kurulum "edgesOut" hatası verirse `npx npm@latest install`
kullan.

```bash
# 1) API
cd apps/api
npm install
cp .env.example .env
npm run start:dev          # http://localhost:3000

# 2) Mobil uygulama (ayrı bir terminalde)
cd apps/mobile
npm install
cp .env.example .env       # telefonda denerken API adresini bilgisayarının yerel IP'siyle değiştir
npx expo start             # i: iOS simülatörü, a: Android, ya da Expo Go ile QR kodu okut
```

API şu an `GET /health`, `GET /scenarios` ve `GET /scenarios/:id` uçlarını sunar. Mobil uygulama
hâlâ Expo'nun karşılama ekranını gösterir. Sıradaki işler `docs/04-yol-haritasi.md` içinde.

## Klasörler

| Klasör | İçerik |
| --- | --- |
| `apps/api` | NestJS API: sağlık ve senaryo uçları hazır. Hedef: ders akışı, AI modülü (`src/ai`), tekrar ve transfer kuyruğu |
| `apps/mobile` | Expo uygulaması (şablon). Hedef: Bugün, Prova, Düzeltme, Defter, Hesap ekranları |
| `content` | Senaryolar ve hata kategorileri |
| `prompts` | Koç ve değerlendirici istemleri, kodsuz prova için başlangıç istemi |
| `db` | PostgreSQL şeması ve yerel veritabanı için notlar |
| `evals` | AI kalite testlerinin cevap anahtarları |
| `docs` | Ürün, MVP kapsamı, mimari, yol haritası, kalite testleri, yayın ve hukuk, 30 günlük plan |

## Claude Code ile devam

Bu klasörü Claude Code'da aç ve şunu yaz:

> CLAUDE.md'yi ve docs/04-yol-haritasi.md'yi oku, Aşama 1'in ilk görevinden başla.

## Kontrol

```bash
npm run check    # API: lint, test, e2e, build
```

GitHub Actions her push'ta ve pull request'te aynı denetimi çalıştırır (`.github/workflows/ci.yml`).
