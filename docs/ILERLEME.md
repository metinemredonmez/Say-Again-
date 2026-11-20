# İlerleme

Her çalışma oturumunun sonunda tarihli tek satır ekle: ne bitti, sırada ne var. Yeni satır en üste.

## 2026-11-20

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
