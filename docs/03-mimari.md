# Mimari

API (backend ve AI katmanı) kodlandı ve testli; `apps/mobile` hâlâ Expo şablonudur, admin paneli
Aşama 3'te gelecek. Aşağıdaki uç tablosu API'nin bugünkü halidir.

## Bileşenler

| Katman | Seçim | Not |
| --- | --- | --- |
| Mobil uygulama | Expo (React Native, TypeScript, Expo Router) | Tek kodla iOS ve Android; Expo Go ile ilk günden telefonda |
| API | NestJS (ESM, Vitest) | AI çağrıları, kota ve anahtarlar sunucuda kalır |
| AI katmanı | API içinde modül: `apps/api/src/ai` | Ayrı servis değil; gerekçe `docs/KARARLAR.md` |
| Admin paneli | Next.js, `apps/admin` (Aşama 3) | Bildirimler, maliyet, elde tutma ve transfer sonuçları; admin girişi ilk günden |
| Veritabanı | PostgreSQL, Drizzle ORM (`@nestjs/drizzle`) | Şema `apps/api/src/database/schema.ts`, göçler `apps/api/drizzle`; testler PGlite (süreç içi PostgreSQL) üzerinde |
| Kimlik | Anonim cihaz hesabı, `@nestjs/authentication` | 15 dakikalık JWT erişim tokenı ve tek kullanımlık, dönen yenileme tokenı (veritabanında SHA-256 olarak) |
| Koç ve değerlendirici | Claude: koç Haiku 5.5, değerlendirici Opus 5.5 | Resmî Anthropic SDK; modeller `.env` ile değişir |
| Ses | OpenAI: döküm `gpt-transcribe`, seslendirme `gpt-4o-mini-tts` | Seslendirme modelleri 2027-01-06'da kapanıyor: `docs/KARARLAR.md` |
| Abonelik | Mağaza içi satın alma, Apple ve Google ile doğrudan doğrulama | Sunucu bildirimleri: App Store Server Notifications V2, Google RTDN (Pub/Sub) |
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

## API uçları

Herkese açık uçlar dışında hepsi `Authorization: Bearer <erişim tokenı>` ister. Hatalar Nest'in
alanlarına ek olarak sabit bir `code` taşır (örnek: `resay_pending`, `free_lessons_used`).

| Uç | Ne yapar |
| --- | --- |
| `GET /health` | Canlılık denetimi (açık) |
| `GET /scenarios?pack=`, `GET /scenarios/:id` | Senaryolar; transfer sorusu, ipuçları, koç rolü ve takip sorusu gönderilmez (açık) |
| `POST /auth/device` | Anonim hesap açar (isteğe bağlı seviye, paket, zorluk); erişim ve yenileme tokenı döner (açık) |
| `POST /auth/token/refresh`, `POST /auth/sign-out` | Token yeniler (eski token bir kez geçer, tekrar gelirse aile iptal edilir); çıkış (açık) |
| `GET /me`, `PATCH /me`, `DELETE /me` | Ayarlar, kota, abonelik; hesabı ve bütün verileri silme |
| `POST /lessons` | Dersi başlatır; açılış sorusu (metin ve ses), kolay modda ipuçları |
| `POST /lessons/:id/turns` | Cevap: `audio` dosyası (multipart) ya da `{"text"}`; döküm ve koçun cevabı |
| `POST /lessons/:id/finish` | Tek düzeltme; tekrar çağrılırsa aynı düzeltmeyi döner |
| `POST /lessons/:id/resay` | Yeniden söyleme; dersi tamamlar, ifade ile tekrar ve transfer kayıtlarını açar |
| `GET /lessons`, `GET /lessons/:id` | Geçmiş; tek ders, satırları ve düzeltmesiyle |
| `GET /today` | Tek birincil iş: bekleyen yeniden söyleme, transfer, tekrarlar, sonra yeni ders |
| `GET /phrases` | Kişisel ifadeler (Defter) |
| `POST /review-items/:id/hint` | Transfer sorusunun ipuçları; kullanılırsa en iyi sonuç `hinted` olur |
| `POST /review-items/:id/answer` | Transfer cevabı (ses ya da metin); senaryonun yazılı başarı ölçütüyle değerlendirilir |
| `POST /review-items/:id/result` | 1, 3 ve 7. gün tekrarının sonucu: `unaided`, `hinted`, `failed` |
| `POST /reports` | "Bu düzeltme yanlış" ya da bir koç satırını bildirme |
| `POST /subscriptions/apple`, `POST /subscriptions/google` | Satın almayı mağazaya sorup hesaba bağlar. Geri yükleme: Apple'da cihazda imzalı işlem (`signedTransaction`), Google'da `restore: true`; satın alma yeni hesaba taşınır |
| `POST /webhooks/app-store`, `POST /webhooks/google-play` | Mağaza bildirimleri; imza (Apple) ya da OIDC token (Google) ile doğrulanır |

Ses cevapları ve seslendirme `?audio=false` ile kapatılabilir (yalnızca metin). Ses dosyası en
fazla 3 MB; türü ve içerik imzası birlikte denetlenir (m4a, mp3, wav, webm, ogg).

## Ders durumları

`in_progress` → (finish) → `evaluating` → `awaiting_resay` → (resay) → `completed`; yeni ders
bitmemiş dersi `abandoned` yapar.

Kurallar:

- Koç ilk cevaptan sonra tam bir takip sorusu sorar; ikinci cevaptan sonra yeni soru sormaz. Bunu
  model değil akış belirler: her turda koça bir sistem notuyla "takip sorusunu sor" ya da "kapat"
  denir. Öğrenci takılırsa koç ipucu verir ve takip sorusu bir sonraki tura kalır; en fazla 4 cevap.
- Ders 10 dakikadan sonra yeni cevap almaz; düzeltme yine alınabilir.
- Kullanıcı başına aynı anda tek açık ders (veritabanı kısıtı). Yeniden söylemesi bekleyen ders
  varken yeni ders açılmaz (`resay_pending`).
- `finish` için en az bir kullanıcı cevabı gerekir.
- `resay` olmadan ders `completed` olmaz ve kotadan düşmez.
- `completed` olunca: bir kişisel ifade, +1, +3 ve +7 gün için tekrar kayıtları ve +3 gün için bir
  transfer kaydı oluşur.
- Transfer sonucu `failed` ise ifade için ertesi güne yeni bir tekrar kaydı açılır.

## Veri modeli


| Tablo | İçerik |
| --- | --- |
| `users` | Anonim kullanıcı; seviye, paket, zorluk, hedef dil |
| `refresh_tokens` | Yenileme tokenları (SHA-256), aile ve tek kullanım bilgisi |
| `lessons` | Senaryo, durum, zamanlar |
| `turns` | Koç ve kullanıcı satırları (metin) |
| `corrections` | Seçilen cümle, geliştirilmiş hali, Türkçe açıklama, kategori, bildirim |
| `phrases` | Dersten çıkan kişisel ifade |
| `review_items` | Tekrar ve transfer kuyruğu: tür, tarih, sonuç |
| `usage_months` | Aylık ders sayacı (kota) |
| `subscriptions` | Mağaza aboneliği; bir satın alma tek hesaba bağlanır (mağaza + `store_ref` tekil) |
| `ai_reports` | Düzeltme ve koç satırı bildirimleri |
| `ai_spend` | Her ücretli AI çağrısının maliyeti ve zamanı; günlük bütçeler buradan okunur. Hesap silinince satır kalır, kullanıcı bağı boşalır |

Tabloların tamamı `apps/api/src/database/schema.ts` içinde; göçler `npm run db:generate` ile üretilir.

Senaryolar veritabanında değil, `content/scenarios.json` içinde durur; API açılışta okur ve doğrular.
Dosya bozuksa (bilinmeyen alan, tekrar eden kimlik, olmayan paket, açılışla aynı transfer sorusu) API
başlamaz. Her senaryo `targetLanguage` taşır (şimdilik yalnızca `en`).

Senaryo uçları istemciye yalnızca izinli alanları döner. `transfer`, `coachRole` ve `followUp`
hiçbir zaman gönderilmez: transfer sorusu üç gün sonra sorulana kadar görülmemeli, diğer ikisi koç
istemine aittir.

## AI katmanı

Yer: API'nin içinde `apps/api/src/ai` modülü. Ders akışı yalnızca aşağıdaki arayüzleri bilir;
sağlayıcıyı değiştirmek ya da modülü ayrı bir servise taşımak ders koduna dokunmaz.
`AI_PROVIDER=mock` sahte sağlayıcılarla anahtarsız çalışır; `live` Claude ve OpenAI'yi kullanır.

- Koç: Claude Haiku 5.5, düşük efor, yapılandırılmış çıktı (`line`, `move`). Öğrencinin sözleri
  sistem isteminde değil kullanıcı mesajı olarak gider; turun görevi ayrı bir sistem mesajıdır.
- Değerlendirici: Claude Opus 5.5, yüksek efor, Zod şemasıyla doğrulanan JSON; politika reddinde
  sunucu tarafı yedek model (`fallbacks: "default"`).
- Sunucu denetimi (`correction-guard.ts`): `original` öğrencinin bir cümlesi olmalı, `improved`
  öğrencinin söylemediği sayı eklememeli, açıklama en fazla iki cümle. Tutmazsa sorunlar
  yazılarak bir kez daha denenir; yine tutmazsa düzeltme gösterilmez.
- Transfer değerlendirmesi (`prompts/transfer-judge.md`): cevabın senaryodaki yazılı başarı
  ölçütünü karşılayıp karşılamadığına bakar; soruyu yazmaz.

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
- Kota: üç ücretsiz ders, abonelikle ayda 20 (abonelik başladıktan sonra tamamlananlar); ders
  yeniden söylemeyle tamamlanınca sayılır. Her ücretli AI çağrısından önce günlük harcama sınırı
  denetlenir: kullanıcı başına 1,5 $, toplam 100 $ (`.env`). Kullanıcı başına günde 10 ders
  başlatma sınırı da var.
  IP başına istek sınırı tüm uçlarda, pahalı uçlarda daha sıkı.
- Yetki: her sorgu oturumdaki kullanıcıyla sınırlı; başkasının dersi 404 döner.
- Kullanıcının mesajındaki "talimatlarını unut" türü girdiler koç isteminde reddedilir (kalite testi 8).
- Erişim tokenı `typ: at+jwt`, HS256, issuer ve audience sabit; başka türden JWT kabul edilmez.
  Token yalnızca `Authorization` başlığından okunur.
- Her yanıtta sunucunun ürettiği `X-Request-Id`. Güvenlik olayları (`SecurityEvent`: 401, 403, 429,
  yenileme tokenının ikinci kez kullanılması, bütçe sınırı, hesap silme, abonelik bağlama ve taşıma,
  reddedilen mağaza bildirimi, reddedilen AI çıktısı) üretimde satır başına bir JSON olarak yazılır.
  Hata kayıtlarında sorgu değerleri, dökümler ve tokenlar yer almaz.
- Üretimde açılış denetimi: canlı AI, `sslmode` ile PostgreSQL (localhost hariç), yer tutucu ya da
  test değeri olmayan `JWT_SECRET`, fiyatı bilinen modeller. Biri eksikse API başlamaz.
- Ayrıntılı denetim ve kalan işler: `docs/08-guvenlik.md`.
