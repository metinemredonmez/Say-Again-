# Mimari

Bu belge hedef tasarımı anlatır. API'de şimdilik yalnızca `GET /health`, `GET /scenarios` ve
`GET /scenarios/:id` kodlandı; `apps/mobile` hâlâ Expo şablonudur.

## Bileşenler

| Katman | Seçim | Not |
| --- | --- | --- |
| Mobil uygulama | Expo (React Native, TypeScript, Expo Router) | Tek kodla iOS ve Android; Expo Go ile ilk günden telefonda |
| API | NestJS (ESM, Vitest) | AI çağrıları, kota ve anahtarlar sunucuda kalır |
| AI katmanı | API içinde modül: `apps/api/src/ai` | Ayrı servis değil; gerekçe `docs/KARARLAR.md` |
| Admin paneli | Next.js, `apps/admin` (Aşama 3) | Bildirimler, maliyet, elde tutma ve transfer sonuçları; admin girişi ilk günden |
| Veritabanı | PostgreSQL | Şema: `db/schema.sql` |
| Ses | Bas-konuş kayıt; dökümü, cevabı ve seslendirmeyi API yapar | Sağlayıcı değiştirmek uygulama güncellemesi gerektirmez |
| Abonelik | Mağaza içi satın alma | Aşama 5 |
| Dağıtım | EAS Build, TestFlight, Play kapalı test | Aşama 3 |

## Bir dersin akışı

```
Mobil                         API                               AI sağlayıcıları
-----                         ---                               ----------------
Dersi başlat  ─────────────▶  POST /lessons
              ◀─────────────  açılış sorusu (metin + ses)
Bas-konuş kaydı ───────────▶  POST /lessons/:id/turns  ───────▶ döküm (ses → metin)
                                                       ───────▶ koç (takip sorusu)
              ◀─────────────  döküm + koçun cevabı     ◀─────── seslendirme (metin → ses)
Dersi bitir   ─────────────▶  POST /lessons/:id/finish ───────▶ değerlendirici (tek düzeltme)
              ◀─────────────  düzeltme
Yeniden söyle ─────────────▶  POST /lessons/:id/resay
              ◀─────────────  kişisel ifade + tekrar ve transfer tarihleri
```

Ses dosyası dökümden sonra silinir; yalnızca metin saklanır.

## API uçları (taslak)

| Uç | Ne yapar |
| --- | --- |
| `GET /health` | Canlılık denetimi |
| `GET /scenarios?pack=` | Senaryo listesi (`content/scenarios.json` içinden). Kodlandı |
| `GET /scenarios/:id` | Tek senaryo: açılış sorusu ve ipuçlarıyla. Kodlandı |
| `POST /lessons` | Dersi başlatır; açılış sorusunu döner |
| `POST /lessons/:id/turns` | Kullanıcının cevabını alır (ses ya da metin); döküm ve koçun cevabını döner |
| `POST /lessons/:id/finish` | Değerlendiriciyi çalıştırır; tek düzeltmeyi döner |
| `POST /lessons/:id/resay` | Yeniden söylemeyi kaydeder; ifadeyi ve tekrar ile transfer kayıtlarını oluşturur |
| `GET /today` | Bugün bekleyen tekrarlar ve transfer soruları (transfer önce) |
| `POST /review-items/:id/result` | Sonucu kaydeder: `unaided`, `hinted`, `failed` |
| `GET /phrases` | Kişisel ifadeler |
| `POST /corrections/:id/report` | "Bu düzeltme yanlış" bildirimi |

## Ders durumları

`in_progress` → (finish) → `awaiting_resay` → (resay) → `completed`

Kurallar:

- Koç ilk cevaptan sonra tam bir takip sorusu sorar; ikinci cevaptan sonra yeni soru sormaz.
- `finish` için en az bir kullanıcı cevabı gerekir.
- `resay` olmadan ders `completed` olmaz ve kotadan düşmez.
- `completed` olunca: bir kişisel ifade, +1, +3 ve +7 gün için tekrar kayıtları ve +3 gün için bir
  transfer kaydı oluşur.
- Transfer sonucu `failed` ise ifade için ertesi güne yeni bir tekrar kaydı açılır.

## Veri modeli

Tabloların tamamı `db/schema.sql` içinde.

| Tablo | İçerik |
| --- | --- |
| `users` | Cihaz kimliği ile anonim kullanıcı; seviye, paket, zorluk |
| `lessons` | Senaryo, durum, zamanlar |
| `turns` | Koç ve kullanıcı satırları (metin) |
| `corrections` | Seçilen cümle, geliştirilmiş hali, Türkçe açıklama, kategori, bildirim |
| `phrases` | Dersten çıkan kişisel ifade |
| `review_items` | Tekrar ve transfer kuyruğu: tür, tarih, sonuç |
| `usage_months` | Aylık ders sayacı (kota) |
| `subscriptions` | Mağaza aboneliği durumu |

Senaryolar veritabanında değil, `content/scenarios.json` içinde durur; API açılışta okur ve doğrular.
Dosya bozuksa (bilinmeyen alan, tekrar eden kimlik, olmayan paket, açılışla aynı transfer sorusu) API
başlamaz. Her senaryo `targetLanguage` taşır (şimdilik yalnızca `en`).

Senaryo uçları istemciye yalnızca izinli alanları döner. `transfer`, `coachRole` ve `followUp`
hiçbir zaman gönderilmez: transfer sorusu üç gün sonra sorulana kadar görülmemeli, diğer ikisi koç
istemine aittir.

## AI katmanı

Yer: API'nin içinde `apps/api/src/ai` modülü. Ders akışı yalnızca aşağıdaki arayüzleri bilir;
sağlayıcıyı değiştirmek ya da modülü ayrı bir servise taşımak ders koduna dokunmaz.

İki ayrı görev, iki ayrı istem (`prompts/`):

1. **Koç** (`prompts/coach.md`): rolünde kalır, kısa konuşur, tek takip sorusu sorar, düzeltme
   yapmaz. Hızlı ve ucuz bir model yeter.
2. **Değerlendirici** (`prompts/evaluator.md`): ders bitince tek düzeltmeyi yapılandırılmış JSON
   olarak döner. Ürünün kalitesi burada belli olur; daha güçlü bir model kullan.

Dört sağlayıcı arayüzü önerilir; her birinin önce sahte (mock) bir uygulaması yazılır, böylece akış
anahtarsız test edilir:

- `SpeechToText`: ses → metin
- `CoachModel`: konuşma bağlamı → koçun bir sonraki cümlesi
- `EvaluatorModel`: döküm → tek düzeltme (JSON; şema ile doğrulanır)
- `TextToSpeech`: metin → ses

Transfer soruları AI ile üretilmez; senaryoyla birlikte yazılıdır.

## Maliyet hedefi

10 dakikalık ders varsayımı: 4 dakika kullanıcı sesi, 2.250 karakter koç sesi, 6.000 girdi ve 1.000
çıktı tokenı. Liste fiyatlarıyla ders başına yaklaşık 0,063 dolar; yeniden denemeler için %20 payla
0,076 dolar; ayda 20 ders için 1,51 dolar. Gerçek zamanlı ses API'leri aynı kullanımda ayda 10–20
dolar tutar; bu yüzden bas-konuş seçildi.

Her ders için döküm dakikası, token ve karakter sayısı kaydedilmeli (kalite testi 10).

## Açık teknik kararlar (Aşama 1–2)

- **AI sağlayıcıları.** Döküm, metin ve seslendirme için hangi servisler? İki seçeneği aynı kayıtlarla
  dene, kalite testleriyle seç.
- **Veritabanı erişimi.** NestJS'in birinci parti paketlerinden biri (`apps/api/AGENTS.md` listeler).
- **Kimlik.** Cihaz kimliği ile anonim başla; hesap ve giriş mağaza sürümünden önce eklenir.
- **Ses kaydı.** Expo'nun güncel ses modülü; sürüm dokümanından doğrula (`apps/mobile/AGENTS.md`).
- **API barındırma.** Pilot öncesi seçilir.

## Güvenlik ve gizlilik

- AI anahtarları yalnızca API'de (`apps/api/.env`); mobil uygulamada anahtar bulunmaz.
- Kurulu temel: güvenlik başlıkları (`app.useSecurityHeaders()`), IP başına dakikada 300 istek
  (`@nestjs/throttler`), CORS kapalı, `trust proxy` kapalı. Barındırma seçilince `trust proxy`
  yalnızca o vekile açılır (NET-03); admin paneli için CORS tek bir origin listesiyle açılır.
- Ses kaydı saklanmaz. Metin dökümleri kullanıcı silme isteğinde silinir.
- Kullanıcı başına günlük ve aylık istek sınırı sunucuda uygulanır.
- Kullanıcının mesajındaki "talimatlarını unut" türü girdiler koç isteminde reddedilir (kalite testi 8).
