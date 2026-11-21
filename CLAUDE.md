# Say Again

Türkçe konuşanlar için mobil İngilizce koçu. Kullanıcı gerçek hayatta yapacağı bir konuşmayı prova
eder, tek bir düzeltme alır, aynı fikri yeniden söyler ve üç gün sonra aynı beceriyi farklı bir soruda
yardımsız kullanıp kullanamadığını görür.

Bu dosya Claude Code içindir. Ürünün tamamı `docs/` altında anlatılır; önce oraya bak.

## Önce bunları oku

1. `docs/04-yol-haritasi.md`: aşamalar, kapılar ve sıradaki görevler.
2. `docs/ILERLEME.md`: en son nerede kalındı.
3. `docs/01-urun.md` ve `docs/02-mvp-kapsami.md`: ne yapıyoruz, ne yapmıyoruz.
4. `docs/03-mimari.md`: API sözleşmesi, veri modeli, AI katmanı.

## Ürün kuralları (değiştirmeden önce kullanıcıya sor)

- **Bas-konuş.** Kullanıcı konuşurken koç sözünü kesmez. Gerçek zamanlı (kesintisiz) ses yok.
- **Koç konuşma sırasında düzeltme yapmaz.** Tek bir takip sorusu sorar ve onu kullanıcının
  cevabından çıkarır.
- **Tek düzeltme.** Ders bitince tek bir ana düzeltme gösterilir: kullanıcının kendi cümlesi,
  geliştirilmiş hali ve en fazla iki cümlelik Türkçe açıklama.
- **Uydurma yok.** Koç ve değerlendirici, kullanıcının söylemediği bir başarı, sayı ya da bilgi
  ekleyemez.
- **Yeniden söyleme.** Kullanıcı aynı fikri yeniden söylemeden ders tamamlanmış sayılmaz.
- **Tekrar.** Dersten çıkan kişisel ifade 1, 3 ve 7 gün sonra geri gelir.
- **Transfer.** Üç gün sonra aynı beceriyi isteyen farklı bir soru sorulur. Önceki cevap ekranda
  gösterilmez. Sonuç `unaided`, `hinted` ya da `failed` olarak kaydedilir.
- **Ders 10 dakikayı geçmez.** Ücretli sürümde ayda 20 ders kotası vardır.
- **Transfer soruları AI ile üretilmez.** Her senaryoyla birlikte `content/scenarios.json` içinde
  yazılıdır.

## Klasör yapısı

```
apps/api       NestJS API (ESM, Vitest, oxlint, Drizzle). Kurallar: apps/api/AGENTS.md
apps/mobile    Expo uygulaması (Expo Router, TypeScript). Kurallar: apps/mobile/AGENTS.md
content/       Senaryolar ve hata kategorileri (tek doğruluk kaynağı; API buradan okur)
prompts/       Koç, değerlendirici ve transfer değerlendirme istemleri
db/            Yerel PostgreSQL verisi (şema apps/api/src/database, göçler apps/api/drizzle)
evals/         AI kalite testleri için cevap anahtarları
docs/          Ürün, mimari, yol haritası, yayın ve hukuk notları
```

## Komutlar

```bash
# API (apps/api)
npm install            # npm 10'da "edgesOut" hatası verirse: npx npm@latest install
npm run start:dev      # http://localhost:3000
npm test               # birim testleri (Vitest)
npm run test:e2e       # uçtan uca testler
npm run lint
npm run build
npm run db:generate    # şema değişince göç üret
npm run db:migrate     # göçleri DATABASE_URL'e uygula

# Mobil (apps/mobile)
npm install
npx expo start         # Expo Go ile telefonda ya da simülatörde aç
npx tsc --noEmit       # tip denetimi
npx expo lint
```

Kök klasörden kısayollar: `npm run api`, `npm run mobile`, `npm run db` (yerel PostgreSQL, Docker
gerekir), `npm run check` (API: lint, test, e2e, build).

Şablonların getirdiği Claude Code eklentileri bu klasöre yazılamadı (ayrıntı: `docs/ILERLEME.md`).
İlk oturumda kur:

```bash
cd apps/api && npx @nestjs/skills add --agent claude   # NestJS becerileri (apps/api/.claude/skills)
```

Expo eklentisi için Claude Code'da `/plugin` ile `expo@claude-plugins-official` eklentisini etkinleştir.

## Çalışma biçimi

- Her seferinde `docs/04-yol-haritasi.md` içindeki sıradaki tek görevi al. Görev büyükse böl.
- Bir görevi bitmiş saymadan önce ilgili uygulamanın testlerini, lint'ini ve tip denetimini çalıştır.
- Görev bitince `docs/ILERLEME.md` dosyasına tarihli tek satır ekle. Önemli bir karar verildiyse
  `docs/KARARLAR.md` dosyasına yaz.
- NestJS ve Expo sürümleri yeni. `apps/api/AGENTS.md` ve `apps/mobile/AGENTS.md` dosyalarındaki
  talimatlara uy ve API'leri hafızadan değil güncel dokümandan doğrula.
- Kod, tanımlayıcılar ve commit mesajları İngilizce. Kullanıcıyla Türkçe konuş. Kullanıcı İngilizce
  öğreniyor: isterse açıklamaları sade İngilizceyle yap ve yazdıklarını nazikçe düzelt.
- Gizli anahtarlar yalnızca `apps/api/.env` içinde durur ve asla mobil uygulamaya konmaz. AI
  sağlayıcılarına yalnızca API erişir.
- Kullanıcının ses kaydı saklanmaz; yalnızca metin dökümü tutulur (`docs/06-yayin-ve-hukuk.md`).

## Şu anki durum

Uygulamanın adı **Say Again**; repo https://github.com/metinemredonmez/Say-Again- (CI: GitHub
Actions, yalnızca API). Node.js 22+ gerekir (`.nvmrc`).

Backend ve AI katmanı tamam (API): anonim cihaz hesabı ve tokenlar, ders akışı, Claude koç
(Haiku 5.5) ve değerlendirici (Opus 5.5), OpenAI ses, tekrar ve transfer, Bugün, Defter, kota,
Apple ve Google abonelik doğrulaması, bildirimler, hesap silme. Gerçek anahtarlarla ve mağaza
hesaplarıyla henüz denenmedi. Güvenlik denetimi ve kalan P0'lar: `docs/08-guvenlik.md`.
`apps/mobile` hâlâ Expo şablonudur; admin paneli için kullanıcı bir
şablon verecek, admin API'si onunla yazılacak (`docs/KARARLAR.md`). Açık risk: OpenAI seslendirme
modelleri 2027-01-06'da kapanıyor. Görev listesi `docs/04-yol-haritasi.md` içinde.
