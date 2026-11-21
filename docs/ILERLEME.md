# İlerleme

Her çalışma oturumunun sonunda tarihli tek satır ekle: ne bitti, sırada ne var. Yeni satır en üste.

## 2026-11-21

- Admin paneline başlanacaktı, kullanıcının isteğiyle başlamadan durduruldu. Kararlar ve adımlar
  `docs/ADMIN-PLANI.md` içinde (shadcn/ui, Next.js 16, MFA zorunlu, CLI ile admin yönetimi). Kod yok.
- AI kalite testlerinin çalıştırıcısı yazıldı (`npm run eval`, `--live` ile gerçek modeller). On testi
  `evals/golden` anahtarlarına göre ölçüyor, değerlendirici derslerdeki yolun aynısından geçiyor.
  Takip sorusu (20) ve rolde kalma (15) için taslak setler eklendi. Testler: 63 birim, 46 e2e.
  Sırada: gerçek anahtarlarla ilk koşu, eğitmen onaylı 50+50 cümle; admin ve mobil şablonları.
- API ve AI katmanı red-team kataloğuna göre denetlendi (`docs/08-guvenlik.md`). Bulunan altı açık
  düzeltildi: silmeye dayanıklı AI harcama defteri, fiyatsız modelde açılmama, loglarda döküm
  sızıntısı, zayıf sır, şifresiz veritabanı. Eklenenler: güvenlik olayları ve istek kimliği, `at+jwt`,
  veritabanı bariyeri, uç envanteri testi, SBOM. Testler: 49 birim, 46 e2e (PGlite ve PostgreSQL),
  CI yeşil. Sırada: admin ve mobil şablonları; açık P0'lar onlara ve barındırmaya bağlı.

## 2026-11-20

- Backend ve AI katmanı yazıldı (API): anonim hesap ve tokenlar, ders akışı (başlat, cevap, tek
  düzeltme, yeniden söyleme), Claude koç ve değerlendirici, OpenAI döküm ve seslendirme, sunucuda
  düzeltme denetimi, tekrar kuyruğu ve transfer, Bugün, Defter, kota, Apple ve Google abonelik
  doğrulaması ve bildirimleri, bildirim (rapor) ucu, hesap silme. PostgreSQL ve Drizzle göçleri.
  Bağımsız incelemede çıkan 2 yüksek ve 3 orta bulgu düzeltildi (`docs/KARARLAR.md`). 42 birim ve 35
  e2e testi geçiyor (e2e PGlite'ta ve yerel PostgreSQL 15'te); lint, tip denetimi, build temiz;
  üretim bağımlılıklarında açık yok. Gerçek API anahtarlarıyla ve mağaza hesaplarıyla henüz denenmedi. Risk: OpenAI
  seslendirme modelleri 2027-01-06'da kapanıyor. Sırada: admin ve mobil şablonları gelince admin
  API'si ve mobil ekranlar; gerçek anahtarlarla ilk ders.
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
