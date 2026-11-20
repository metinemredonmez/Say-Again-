# İlerleme

Her çalışma oturumunun sonunda tarihli tek satır ekle: ne bitti, sırada ne var. Yeni satır en üste.

## 2026-11-20

- Ad **Say Again** oldu, kod GitHub'a gönderildi (https://github.com/metinemredonmez/Say-Again-,
  herkese açık). API'de `GET /health` (Terminus) ve `GET /scenarios`, `GET /scenarios/:id` yazıldı:
  içerik açılışta Zod ile doğrulanır, bozuksa API başlamaz; transfer sorusu istemciye gitmez.
  Güvenlik başlıkları, IP başına hız sınırı, CORS kapalı. Senaryolara `targetLanguage: "en"`
  eklendi. GitHub Actions CI (API: audit, lint, test, e2e, build). API'de 13 birim ve 8 e2e testi,
  lint, tip denetimi ve build geçiyor. Kararlar `docs/KARARLAR.md` içinde (AI modülü API içinde,
  admin paneli Aşama 3). Bilinen durum: mobil şablonda `npx tsc --noEmit` 3 hata, `npx expo lint`
  1 hata veriyor (hepsi Expo şablon dosyalarında; ilk mobil görevde şablon ekranlarıyla gidecek);
  `npx expo lint` ilk çalıştırmada `eslint.config.js` ve ESLint paketlerini ekledi. API'de 5 açık
  yalnızca geliştirme aracı `@nestjs/mau` içinde, üretim bağımlılıklarında açık yok. Sırada: ders
  akışı sahte AI ile (`POST /lessons`, `/turns`, `/finish`, `/resay`) ve `src/ai` arayüzleri.
- Proje iskeleti kuruldu: `apps/mobile` (create-expo-app, Expo SDK 58) ve `apps/api` (nest new,
  NestJS 12) resmî şablonların dokunulmamış halidir; yalnızca adları değiştirildi. Uygulama kodu
  henüz yazılmadı.
- İçerik hazır: 20 senaryo (`content/scenarios.json`), hata kategorileri, koç ve değerlendirici
  istemleri, hedef veritabanı şeması (`db/schema.sql`).
- API şablonunda derleme, birim testi, e2e testi ve lint geçiyor (kurulum sonrası denendi).
- Bilinen durum: mobil şablonda `npx tsc --noEmit`, `src/components/app-tabs.web.tsx` dosyasında bir
  tip hatası veriyor. Şablondan geliyor ve yalnızca web hedefini ilgilendiriyor; `expo-env.d.ts`
  dosyası ilk `npx expo start` ile oluşur.
- Bilinen durum: npm 10.9 ile `apps/api` kurulumu "Cannot read properties of null (reading
  'edgesOut')" hatası verdi; `npx npm@latest install` ile kuruldu.
- Eksik kalanlar: şablonların ürettiği `.claude` ve `.vscode` klasörleri bu klasöre yazılamadı
  (uzaktan yazma bu klasörlerde kapalı). Eksik dosyalar: `apps/api/.claude/skills/` (NestJS
  becerileri; `cd apps/api && npx @nestjs/skills add --agent claude` ile kurulur),
  `apps/mobile/.claude/settings.json` (Expo eklentisini etkinleştirir; Claude Code'da `/plugin` ile
  açılır) ve `apps/mobile/.vscode/` (editör önerileri; isteğe bağlı).
- Git deposu başlatılmadı: `git init` ve ilk commit sende.
- Sırada: Aşama 1 (`docs/04-yol-haritasi.md`). EF SET sonucu: henüz yok.
