# Güvenlik denetimi

Say Again API'si ve AI katmanı, kullanıcının bütün projelerde temel aldığı red-team kataloğuna
(`~/Code/red-team`, OWASP ASVS 5.0.0 eşlemeli 109 kontrol) göre denetlendi. Önce P0 kontroller
ele alındı. Bu belge sonucu, düzeltilen açıkları ve yayından önce kalan işleri anlatır.

- **Tarih:** 2026-11-21
- **Build:** `3fb1e4a` ve `595ad9c`, ikisinin de CI koşusu başarılı (PGlite ve PostgreSQL 17).
- **Kapsam:** `apps/api`: kimlik, dersler, AI, tekrar ve transfer, kota, abonelik.
- **Kapsam dışı:**
  - Mobil uygulama: hâlâ Expo şablonu.
  - Admin paneli: henüz yok.
  - Barındırma: henüz seçilmedi.
- **Sonuç dosyası:** [`docs/guvenlik/sonuclar-2026-11-21.yaml`](guvenlik/sonuclar-2026-11-21.yaml)
  (kataloğun `results/` biçimi). Yeniden hesaplamak için:

```bash
uv run --project ~/Code/red-team redteam report docs/guvenlik/sonuclar-2026-11-21.yaml --format md
```

## Sonuç

**P0 yayın kapısı: ENGELLİ.** Bu beklenen bir durum: açık P0'ların hepsi henüz yapılmamış
parçalara bağlı. Kodda bilinen açık bir P0 bulgusu kalmadı.

| Durum | Sayı |
| --- | --- |
| Geçti | 35 |
| Uygulanmaz (gerekçeli) | 38 |
| Risk kabul edildi | 1 (SES-03, son tarih 2027-06-30) |
| Doğrulanacak | 35 |

Kapıyı tutan P0'lar iki gruba ayrılıyor.

1. **Admin paneliyle birlikte yapılacaklar.**
   - AUT-01: admin için MFA.
   - AZ-05: admin rolleri.
   - INP-03: öğrenci metni ve AI çıktısı ekranda metin olarak gösterilir, HTML olarak değil.
   - Admin gelince şunlar da yeniden değerlendirilecek: PKY-01, WEB-01..05, NET-05 (CORS için tek
     origin listesi), CLI-01/02, SES-02, AZ-03.
2. **Barındırma seçilince yapılacaklar.**
   - ARC-01: çalışan bileşen envanteri.
   - ARC-04 ve DAT-04: veritabanı rolleri (aşağıdaki SQL).
   - KEY-02: sırların çalışma ortamına güvenli enjeksiyonu.
   - KEY-03: rotasyon provası.
   - NET-01: dış uçta TLS.
   - NET-02: uygulama portuna yalnızca vekil erişir.
   - NET-04: çıkış izin listesi.
   - OPS-02 ve OPS-03: sunucu ve container sıkılaştırması.
   - OPS-04: imzalı yayın artefaktı.
   - EXT-05: mağaza servis hesapları.

## Bu denetimde bulunan ve düzeltilen açıklar

Her bulgu kataloğun `templates/bulgu.md` alanlarıyla yazıldı. Hepsi giderildi ve yeniden test
edildi (build `3fb1e4a` / `595ad9c`).

### SA-01: Hesap silinince genel AI bütçesi sıfırlanıyordu

| Alan | Değer |
| --- | --- |
| Önem | Orta |
| CWE | CWE-770 |
| ASVS 5.0.0 | V2.4.1 |
| OWASP Top 10:2025 | A06 |
| CVSS 3.1 | 4.3, `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L` |
| CVSS 4.0 | `CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N` |
| Ön koşul | Anonim hesap (herkes açabilir) |
| İlgili kontroller | AI-03, RES-01 |
| Durum | Giderildi |

**Açıklama:** Günlük harcama, ders ve tekrar kayıtlarından toplanıyordu. Bu kayıtlar hesapla birlikte
siliniyor (cascade), bu yüzden silinen hesabın harcaması toplamdan düşüyordu.

**Sömürü:**

1. Hesap aç ve 1,5 $ harca.
2. `DELETE /me` ile hesabı sil.
3. Başa dön. Çok sayıda IP adresiyle tekrarlanınca 100 $'lık genel sınır hiç dolmaz.

**Düzeltme:** `ai_spend` tablosu. Her ücretli çağrı döner dönmez buraya yazılıyor ve bütçeler bu
tablodan okunuyor. Hesap silinince satır kalıyor ama kullanıcı bağı boşalıyor (`ON DELETE SET
NULL`): kişisel veri kalmıyor.

**Test:** `security.e2e-spec.ts`: "keeps the spend of deleted accounts in the global budget".

### SA-02: Paralel ya da başarısız transfer cevaplarının maliyeti sayılmıyordu

| Alan | Değer |
| --- | --- |
| Önem | Orta |
| CWE | CWE-770 |
| ASVS 5.0.0 | V2.4.1 |
| OWASP Top 10:2025 | A06 |
| CVSS 3.1 | 4.3, `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L` |
| CVSS 4.0 | `CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N` |
| Ön koşul | Hesap ve vadesi gelmiş bir transfer sorusu |
| İlgili kontroller | AI-03, RES-01, BUS-02 |
| Durum | Giderildi |

**Açıklama:** Transfer cevabının maliyeti (döküm ve Opus değerlendirmesi) yalnızca kayıt
tamamlanınca yazılıyordu. Aynı kayda aynı anda gelen cevaplardan biri tamamlanıyor, diğerleri
409 alıyordu ama hepsinin AI maliyeti oluşuyordu. Bu maliyetler hiçbir bütçeye girmiyordu.

**Düzeltme:** Döküm ve değerlendirme maliyeti, çağrı döner dönmez `ai_spend`'e yazılıyor. Ders
akışındaki koç, değerlendirici, döküm ve seslendirme çağrıları da aynı yoldan geçiyor.

### SA-03: Fiyatı tanımsız bir model bütçeyi devre dışı bırakıyordu

| Alan | Değer |
| --- | --- |
| Önem | Düşük |
| CWE | CWE-636 |
| ASVS 5.0.0 | V16.5.3 |
| OWASP Top 10:2025 | A10 |
| CVSS 3.1 | 3.1, `CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L` |
| CVSS 4.0 | `CVSS:4.0/AV:N/AC:H/AT:P/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N` |
| Ön koşul | `.env` içinde `src/ai/pricing.ts`'de olmayan bir model |
| İlgili kontroller | AI-03, EXC-01, RES-01 |
| Durum | Giderildi |

**Açıklama:** Fiyatı bilinmeyen model 0 $ sayılıyor ve yalnızca bir uyarı yazılıyordu. Bu bir
"fail-open" durumuydu: bütçe denetimi çalışıyor gibi görünüp hiçbir şeyi sınırlamıyordu.

**Düzeltme:** `live` modda fiyatı olmayan bir modelle API başlamıyor (`src/config/env.ts`).

### SA-04: Veritabanı hatalarında öğrenci dökümleri log'a yazılıyordu

| Alan | Değer |
| --- | --- |
| Önem | Düşük |
| CWE | CWE-532 |
| ASVS 5.0.0 | V16.2.5 |
| OWASP Top 10:2025 | A09 |
| CVSS 3.1 | 2.5, `CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N` |
| CVSS 4.0 | `CVSS:4.0/AV:L/AC:H/AT:P/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` |
| Ön koşul | Yazma sırasında bir veritabanı hatası ve log erişimi |
| İlgili kontroller | LOG-02, EXC-01 |
| Durum | Giderildi |

**Açıklama:** Nest'in varsayılan hata işleyicisi hatanın tamamını log'a yazar. Drizzle'ın
"Failed query" mesajında da sorgunun değerleri bulunur: öğrencinin cümleleri ve bildirim notları.

**Düzeltme:** Genel hata filtresi (`src/security/api-exception.filter.ts`). Log'a yalnızca hata
sınıfı, veritabanı hata kodu ve kısıt adı, istek kimliği ve yığın satırları (`at ...`) yazılıyor.
Mesaj yazılmıyor. İstemci yalnızca `500` ve istek kimliğini görüyor.

**Test:** Birim testi, mesajı çok satırlı bir hatada değerlerin yığın izinden de sızdığını yakaladı.
Bu da düzeltildi.

### SA-05: Üretim test ya da yer tutucu bir imzalama sırrıyla başlayabiliyordu

| Alan | Değer |
| --- | --- |
| Önem | Yüksek (yanlış yapılandırmaya bağlı) |
| CWE | CWE-1394 |
| ASVS 5.0.0 | V13.2.3 |
| OWASP Top 10:2025 | A04 |
| CVSS 3.1 | 7.4, `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N` |
| CVSS 4.0 | `CVSS:4.0/AV:N/AC:H/AT:P/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N` |
| Ön koşul | Üretimde test sırrı (`vitest.config*.ts`'de herkese açık) ya da yer tutucu bir değer, ve kurbanın kullanıcı kimliği |
| İlgili kontroller | KEY-01 (katalog geçmiş bulgu B4 ile aynı kök neden) |
| Durum | Giderildi |

**Açıklama:** Yalnızca uzunluk (32 karakter) denetleniyordu. Bilinen bir sırla herkes istediği
kullanıcı adına erişim tokenı imzalayabilirdi.

**Düzeltme:** Üretimde şunlar reddediliyor:

- test sırrı,
- yer tutucu kelimeler içeren değerler (`secret`, `change`, `example`, `test`...),
- 10'dan az farklı karakterden oluşan değerler.

Smoke testinde zayıf sırla API başlamadı.

### SA-06: Üretimde uzak veritabanına şifresiz bağlantıya izin veriliyordu

| Alan | Değer |
| --- | --- |
| Önem | Orta (yanlış yapılandırmaya bağlı) |
| CWE | CWE-319 |
| ASVS 5.0.0 | V12.3.1 |
| OWASP Top 10:2025 | A04 |
| CVSS 3.1 | 6.8, `CVSS:3.1/AV:A/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N` |
| CVSS 4.0 | `CVSS:4.0/AV:A/AC:H/AT:P/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N` |
| Ön koşul | `sslmode` olmayan bir `DATABASE_URL`, ve API ile veritabanı arasındaki ağda bir saldırgan |
| İlgili kontroller | NET-01 |
| Durum | Giderildi |

**Düzeltme:** Üretimde `sslmode=require`, `verify-ca` ya da `verify-full` zorunlu. Yalnızca
localhost bundan muaf.

### Sıkılaştırmalar (sömürülebilir açık değil, eksik bariyer)

| Kontrol | Eksik | Yapılan |
| --- | --- | --- |
| LOG-01 | Güvenlik olayı ve istek kimliği yoktu | Her yanıtta sunucunun ürettiği `X-Request-Id` var. Üretimde loglar satır başına bir JSON. `SecurityEvent` kayıtları: 401, 403, 429, yenileme tokenının ikinci kez kullanılması (alarm), bütçe sınırı (genel sınır alarm), hesap silme, abonelik bağlama, taşıma ve ret, reddedilen mağaza bildirimi, reddedilen AI çıktısı |
| AZ-02 | Veritabanında kullanıcılar arası ikinci bariyer yoktu | İfade, tekrar kaydı ve bildirim, üst kaydı `(id, user_id)` ile gösteriyor. Veritabanı başka kullanıcının dersine ya da ifadesine bağlanan satırı reddediyor |
| TOK-01/02 | Token türü denetlenmiyordu; iss, aud ve süre için test yoktu | Erişim tokenı `typ: at+jwt`. Elle imzalanmış tokenlarla yanlış tür, alg, iss, aud, süre, sub ve anahtar 401 dönüyor |
| AI-02 | Model çıktısının uzunluğu sınırsızdı | Koç satırı 600, geri bildirim 300, açıklama 400, yeniden söyleme istemi 300 karakteri geçemez |
| RES-01 | Mağaza bildirim uçlarında hız sınırı yoktu | Adres başına dakikada 1200 istek. Mağazalar reddedilen bildirimi yeniden dener |
| INP-01 | Sorgu şemaları bilinmeyen parametreyi geçiriyordu | Sorgu şemaları katı; bilinmeyen parametre 400 |
| API-01 | Uç envanteri test edilmiyordu | Test, sunulan uçların `docs/03-mimari.md` tablosuyla aynı olduğunu ve açık olmayan her ucun tokensız 401 döndüğünü denetliyor |
| OPS-04 | SBOM yoktu | CI her koşuda üretim bağımlılıklarının CycloneDX SBOM'unu artefakt olarak saklıyor (90 gün) |
| Bağımlılık | `tmp` < 0.2.6, GHSA-ph9p-34f9-6g65 / CVE-2026-44705 (yüksek; yalnızca geliştirme, `@nestjs/mau` içinden). KEV'de yok, EPSS 0,004 | `overrides` ile 0.2.7. `npm audit` (geliştirme dahil) 0 açık |

SA-01, SA-02 ve SA-03 kataloğa yeni bir P0 kontrol olarak eklendi: **AI-03, LLM maliyet bütçesi ve
sınırsız tüketim**, kabul senaryosu DVT-19 (red-team `b81face`).

Önceden doğru olduğu doğrulananlar (testleriyle):

- yenileme tokenının tek kullanımı ve tekrar kullanımda aile iptali,
- BOLA (başka kullanıcının dersi, tekrar kaydı ve bildirimi 404),
- ses dosyasının türü ile içerik imzasının birlikte denetimi,
- X-Forwarded-For sahteciliği,
- mağaza imza ve OIDC doğrulaması,
- öğrenci metninin sistem isteminin dışında tutulması.

## Kısa tehdit modeli

| Akış | Tehdit | Bariyer |
| --- | --- | --- |
| Anonim hesap | Ücretsiz dersler için sınırsız hesap | Adres başına saatte 10 hesap, kullanıcı başına günlük 1,5 $, genel 100 $ (silmeye dayanıklı) |
| Ders | Başkasının dersi; çift istek | Her sorgu `userId` ile ve veritabanı bariyeri; tek açık ders kısıtı; tur kilidi; değerlendirme talep tokenı |
| AI | Öğrencinin talimatı (prompt injection) | Öğrenci metni yalnızca kullanıcı mesajında; turun görevini akış belirler; çıktı şema, `correction-guard` ve uzunluk sınırından geçer; modelin aracı yok |
| Ses | Ses olmayan ya da büyük dosya | 3 MB, tür ile içerik imzası birlikte, sunucunun seçtiği dosya adı, saklanmaz |
| Abonelik | Başkasının satın alması; sahte bildirim | Mağaza hesap tokenı kullanıcı kimliğine eşit olmalı ya da geri yükleme kanıtı gelmeli; Apple JWS zinciri, Google OIDC (audience ve servis hesabı); bildirim yalnızca mağazadan taze okumayı tetikler |
| Token | Çalınmış yenileme tokenı | Tek kullanım; tekrar kullanımda aile iptali ve alarm; erişim tokenı 15 dk |

## Runbook'lar

### Anahtar rotasyonu (KEY-03)

Erişim tokenları `JWT_SECRET` ile imzalanır. Yenileme tokenları veritabanında SHA-256 olarak durur
ve bu sırdan bağımsızdır.

- **Planlı rotasyon:**
  1. Yeni sırrı üret: `openssl rand -base64 32`.
  2. Bütün örneklerde aynı anda değiştir.
  3. Eski erişim tokenları hemen 401 alır. Uygulama yenileme tokenıyla yenisini alır, kullanıcı bir
     şey fark etmez (mobil istemci 401'de bir kez yeniler).
- **Sızıntı şüphesinde:**
  1. Sırrı yukarıdaki gibi değiştir.
  2. Yenileme tokenları da sızmış olabilirse hepsini iptal et:
     `UPDATE refresh_tokens SET revoked = true;`
     Bunun bedeli var: anonim hesaplar geri dönemez. Bu yüzden yalnızca veritabanı sızıntısında yap.
  3. Log'da `auth.refresh_reused` olaylarına bak.
- **AI ve mağaza anahtarları** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `APPLE_PRIVATE_KEY`,
  `GOOGLE_SERVICE_ACCOUNT_JSON`):
  1. Sağlayıcının konsolunda yenisini üret.
  2. `.env`'de değiştir ve API'yi yeniden başlat.
  3. Eskisini konsolda iptal et.

### Anahtar envanteri (KEY-05)

| Sır | Ne için | Nerede |
| --- | --- | --- |
| `JWT_SECRET` | Erişim tokenı imzası | Yalnızca API |
| `ANTHROPIC_API_KEY` | Koç ve değerlendirici | Yalnızca API |
| `OPENAI_API_KEY` | Döküm ve seslendirme | Yalnızca API |
| `APPLE_PRIVATE_KEY` | App Store Server API (In-App Purchase anahtarı) | Yalnızca API |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Play Developer API | Yalnızca API |
| `DATABASE_URL` parolası | PostgreSQL çalışma rolü | Yalnızca API |

Mobil uygulamada yalnızca API adresi bulunur (`EXPO_PUBLIC_API_URL`).

Git geçmişi 2026-11-21'de tarandı: anahtar desenine uyan değer ya da takip edilen `.env` / `.pem`
dosyası yok.

### Veritabanı rolleri (DAT-04, ARC-04)

Göçler ayrı bir rolle çalışır (`npm run db:migrate`). API ise yalnızca veri okuyup yazabilen bir
rolle bağlanır. Üretimde açılışta göç çalışmaz.

```sql
-- Göç rolü: şemanın sahibi. Yalnızca dağıtım sırasında kullanılır.
CREATE ROLE say_again_owner LOGIN PASSWORD '...';
CREATE DATABASE say_again OWNER say_again_owner;
-- Çalışma rolü: API bununla bağlanır. DDL, TRUNCATE ve şema değişikliği yapamaz.
CREATE ROLE say_again_app LOGIN PASSWORD '...';
\c say_again
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO say_again_app;
-- Göçler çalıştıktan sonra, say_again_owner olarak:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO say_again_app;
ALTER DEFAULT PRIVILEGES FOR ROLE say_again_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO say_again_app;
```

### Mağaza servis hesapları (EXT-05)

- **Apple:** App Store Connect'te türü **In-App Purchase** olan bir anahtar. Admin ya da App Manager
  API anahtarı kullanılmaz.
- **Google:**
  - Play Console'da servis hesabına yalnızca "View financial data" ile "Manage orders and
    subscriptions" izinleri verilir.
  - Pub/Sub push aboneliği OIDC token ile kurulur. Audience değeri
    `GOOGLE_PUBSUB_AUDIENCE`, servis hesabı `GOOGLE_PUBSUB_SERVICE_ACCOUNT` olur.

### Çıkış izin listesi (NET-04)

API'nin dışarı çıktığı hedefler:

- `api.anthropic.com`
- `api.openai.com`
- `api.storekit.itunes.apple.com` ve `api.storekit-sandbox.itunes.apple.com`
- `androidpublisher.googleapis.com`, `oauth2.googleapis.com`, `www.googleapis.com` (OIDC
  sertifikaları)
- Apple'ın OCSP ve sertifika uçları
- Veritabanı

Başka hedefe çıkış gerekmez.

### Alarm kuralları (LOG-04, log platformu seçilince)

| Olay | Kural |
| --- | --- |
| `auth.refresh_reused` | Her biri bir uyarı: yenileme tokenı iki kişide |
| `ai_budget.global_limit` | Hemen: bugün bütün ücretli dersler durdu |
| `webhook.refused` | Saatte 20'den fazlası: sahte bildirim denemesi ya da yanlış yapılandırma |
| `auth.denied` | Tek adresten dakikada 100'den fazlası |
| `ai.output_rejected` | Günlük oran %5'i geçerse: istem ya da model sorunu |

Loglarda IP adresi bulunur (kişisel veri). Saklama süresi `docs/06-yayin-ve-hukuk.md` ile
belirlenir (öneri: 30 gün).

## Kalan işler

Yayından önce:

1. **Admin paneli** (şablon bekleniyor):
   - Admin girişi: parola ve MFA (AUT-01) ya da passkey (PKY-01).
   - Rol yaşam döngüsü (AZ-05).
   - CORS için tek origin (NET-05).
   - CSP ve başlıklar (WEB-02/04).
   - Öğrenci metni ve AI çıktısı HTML olarak değil metin olarak gösterilir (INP-03).
   - Admin işlemleri için güvenlik olayları (LOG-01).
2. **Mobil** (şablon bekleniyor):
   - Yenileme tokenı güvenli depoda (WEB-05).
   - Yenileme tek uçuşta (SES-05).
   - MASVS değerlendirmesi (`~/Code/red-team/docs/07-mobil-masvs.md`).
   - Dependabot'un `minimatch` uyarısı (GHSA-g3hv-75wg-m249, Expo'nun derleme aracı içinden).
3. **Barındırma:**
   - Yukarıdaki runbook'lar.
   - `TRUST_PROXY`.
   - Log platformu ve alarmlar.
   - Container sıkılaştırması.
   - Yedek saklama süresi (DAT-05).
   - `security.txt` ve bildirim süreci (VDP-01).
