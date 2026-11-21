# Admin paneli: kaldığımız yer (2026-11-21)

Başlamadan durduruldu. Kod yazılmadı. Kullanıcı önce başka bir işin bitmesini istedi. Bu not, işe
kaldığı yerden devam etmek için.

## Verilen kararlar

- **Şablon:** shadcn/ui (ücretsiz), Next.js 16 (`apps/admin`), resmî dashboard bloğu.
  - Ücretli alternatifler: Untitled UI React Pro ve Tailwind Plus. İkisi de hem admin paneline hem
    tanıtım sitesine uyuyor. Tanıtım sitesine gelince yeniden konuşulacak.
- **Bağlantı:** Admin sitesi API'ye kendi alan adı üzerinden bağlanır. Next.js `rewrites`,
  `/api/admin/*` isteklerini API'nin `/admin/*` uçlarına iletir.
  - Böylece CORS kapalı kalır.
  - Oturum çerezi yalnızca admin alan adında durur: `__Host-sid`, HttpOnly, Secure, SameSite.
- **Kimlik:** `@nestjs/authentication` paketinin kendi özellikleri kullanılır:
  - `SessionCookieProvider`,
  - `SignInService`,
  - `MfaService` (TOTP ve kurtarma kodları),
  - `PasswordHasher` (scrypt).

  Elle yazılmış kimlik kodu olmayacak.
- **Kurallar (red-team kataloğu):**
  - AUT-01: MFA zorunlu. Doğrulama uygulaması kurulmadan hiçbir admin ucu açılmaz.
    Uçlarda `@Authenticate({ providers: [AdminSessionAuth], mfa: true })`.
  - PWD-01, PWD-03:
    - Parola en az 15 karakter.
    - Sızmış parola kontrolü HIBP aralık API'siyle yapılır: servise yalnızca SHA-1 özetinin ilk 5
      karakteri gider.
    - Servise ulaşılamazsa kurulum reddedilir (fail-closed).
    - Bağlama özgü bir yasak liste de var: e-posta adresi, "sayagain".
  - SES-03: 30 dakika hareketsizlikte ya da en geç 12 saatte oturum kapanır.
  - AUT-02: giriş için IP başına ve hesap başına hız sınırı. MFA kilidi pakette hazır (15 dakikada
    5 yanlış kod).
  - AZ-05:
    - İki rol: `reviewer` (bildirim kapatır) ve `viewer` (yalnızca okur).
    - Admin ekleme, rol değiştirme ve devre dışı bırakma yalnızca sunucudaki komut satırından
      yapılır; web'de bu işlerin ucu yok.
    - Son etkin admin devre dışı bırakılamaz.
  - AZ-01: `@nestjs/authorization` ile varsayılan ret.
    - Mobil denetleyicilere `@Can(LearnerPolicy, 'use')`.
    - Admin uçlarına `@Can(AdminPolicy, 'view' | 'review')`.
  - Sağlayıcı ayrımı: admin çerez sağlayıcısı yalnızca `/admin` yollarında çalışır (order 1).
    Öğrenci JWT'si admin uçlarında geçmez.
  - WEB-03: CSRF için `app.enableCsrfProtection({ trustedOrigins: [ADMIN_ORIGIN] })`. Mobil
    uygulama ve mağaza bildirimleri Origin göndermediği için etkilenmez (doğrulandı).
  - LOG-01: güvenlik olayları.
    - admin girişi ve başarısız giriş,
    - `mfa-failed` (kilitlendiyse alarm),
    - `mfa-enabled`,
    - davetin kullanılması,
    - bildirim durumunun değişmesi.
  - INP-03, WEB-02/04: öğrenci metni ve AI çıktısı yalnızca metin olarak gösterilir. CSP nonce ile
    (Next.js proxy), sıkı güvenlik başlıkları.

## Yapılacaklar

1. **API, şema ve göç:**
   - `admins`: e-posta (NFC + küçük harf, tekil), parola özeti, rol, `disabled_at`.
   - `admin_invites`: SHA-256, tek kullanım, 48 saat.
   - `sessions` ve `mfa_*` tabloları (dokümandaki Drizzle deposu).
   - `ai_reports` için `status`, `resolved_at`, `resolved_by`.
2. **API, depo:** oturum ve MFA deposu. Paketin `authenticationStoreContract({ concurrent: true })`
   testleriyle sınanır.
3. **API, uçlar:**
   - `/admin/auth`: `sign-in`, `mfa/verify`, `mfa/enroll`, `mfa/confirm`, `setup` (davet ve parola),
     `sign-out`, `me`.
   - `/admin`: `overview` (günlük maliyet ve ders sayıları), `retention` (haftalık kohort, ikinci
     hafta), `transfers` (senaryo başına sonuçlar), `reports` (liste, ayrıntı, durum değiştirme).
   - Öğrenci kimliği gösterilmez.
4. **API, komut satırı:** `npm run admin -- invite <e-posta> <rol>`, `role` ve `disable`. Kurulum
   bağlantısı `ADMIN_ORIGIN/setup#token=...` biçiminde; token adres çubuğundaki `#` kısmında durur,
   sunucuya gitmez.
5. **Ayarlar:**
   - `ADMIN_ORIGIN`,
   - `TOTP_ENCRYPTION_KEY` (üretimde zorunlu, yer tutucu denetimi),
   - `PASSWORD_BREACH_CHECK=hibp` (üretimde zorunlu).
6. **Testler (e2e):**
   - davetten kuruluma ve MFA'ya kadar tam akış,
   - MFA olmadan 401,
   - öğrenci tokenı ile admin uçları 401, admin çerezi ile mobil uçlar 401,
   - `viewer` için 403,
   - yabancı Origin için 403,
   - davetin ikinci kez kullanılması,
   - bilinmeyen e-posta ile yanlış parolanın aynı yanıtı vermesi,
   - devre dışı bırakılmış adminin oturumunun bitmesi.
7. **Web (`apps/admin`):**
   - Next.js 16, Tailwind, shadcn 4.23.
   - Sayfalar: `/login`, `/login/mfa`, `/setup` (parola, QR ile TOTP, kurtarma kodları), `/`
     (genel bakış ve grafikler), `/reports`.
8. **Kontrol ve kapanış:**
   - CI'a admin işi (lint, tip denetimi, build).
   - Tarayıcıda giriş akışı denemesi.
   - Güvenlik sonuç dosyasını güncelleme (AUT-01, AZ-05, PWD, WEB, NET-05).
   - `docs/08-guvenlik.md`.

Paket sürümleri (2026-11-21): `@nestjs/authorization` 0.1.4, `next` 16.4.6, `shadcn` 4.23.0.
