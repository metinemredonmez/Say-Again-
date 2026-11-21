# Kararlar

Önemli ürün ve teknik kararların kaydı. Yeni karar en üste eklenir: tarih, karar, neden, vazgeçilen
seçenek.

## 2026-11-21

- **Red-team kataloğuna göre tam denetim (`docs/08-guvenlik.md`).** P0'lar önce ele alındı. Sonuç
  dosyası `docs/guvenlik/sonuclar-2026-11-21.yaml`: 34 geçti, 38 gerekçeyle uygulanmaz, 1 risk
  kabulü, 35 doğrulanacak. P0 yayın kapısı ENGELLİ. Açık P0'ların hepsi admin paneline ya da
  barındırmaya bağlı.
- **AI harcaması ayrı bir defterde (`ai_spend`), hesap silinince satırlar kalır.** Neden: önceki
  hesapta silinen hesabın harcaması genel bütçeden düşüyordu ve paralel transfer cevaplarının
  maliyeti hiç sayılmıyordu (SA-01, SA-02). Satırda kullanıcı bağı boşalır, kişisel veri kalmaz.
  Vazgeçilen: ders ve tekrar kayıtlarındaki maliyet sütunlarını toplamak (bunlar istatistik için
  kalıyor).
- **Üretim açılış denetimi sıkılaştı.** Şunlardan biri varsa API başlamaz:
  - yer tutucu ya da test değeri olan bir `JWT_SECRET`,
  - `sslmode` olmayan uzak bir veritabanı,
  - fiyatı tanımsız bir model.

  Vazgeçilen: uyarı yazıp başlamak, çünkü uyarı fail-open demek.
- **Erişim tokenı `typ: at+jwt`.** Aynı sırla imzalanmış başka bir JWT erişim tokenı yerine geçemez.
- **Güvenlik olayları yapılandırılmış log olarak, istek kimliğiyle (`X-Request-Id`); üretimde JSON.**
  Hata loglarında sorgu değerleri, dökümler ve tokenlar yok. Alarm kuralları log platformu
  seçilince yazılacak.
- **Veri katmanında ikinci bariyer: RLS yerine `(id, user_id)` bileşik yabancı anahtarlar.** Neden:
  tek veritabanı rolü ve kullanıcı başına veri modeli için yeterli ve basit. Admin API'si satır
  bazlı rol gerektirirse RLS yeniden değerlendirilecek.
- **Risk kabulü (SES-03, sahibi ürün sahibi, son tarih 2027-06-30):** yenileme tokenı 365 gün, aile
  10 yıl. Anonim hesabın başka geri dönüş yolu yok. Apple/Google ile giriş eklenince kısaltılacak.

## 2026-11-20

- **Bağımsız güvenlik ve doğruluk incelemesinden sonra (aynı gün).** Düzeltilenler: günlük sınır ders
  sayısına değil gerçek AI harcamasına bağlı (kullanıcı başına 1,5 $, toplam 100 $; boş ders
  başlatmak kimseyi kilitlemez); satın alma, mağazanın kanıtıyla (Apple'da cihazda imzalı işlem,
  Google'da satın alma tokenı) yeni hesaba taşınabiliyor, yeniden abonelik o hesaba geçiyor;
  değerlendirme bir talep tokenıyla korunuyor; aynı anda iki cevap kilitle engelleniyor; senaryosu
  silinmiş ders kullanıcıyı kilitlemiyor; düzeltme denetimi bütün cümle ve yazıyla sayıları da
  arıyor; transfer açıkken o ifadenin tekrarı gösterilmiyor; ipuçları herkese açık senaryo
  detayından çıktı; yeniden söyleme düzeltilen cümleyle ortak bir kelime istiyor.
  **Kabul edilen riskler (Aşama 5'ten önce ele alınacak):**
  - Ücretsiz dersler kuruluma bağlı: uygulamayı silip yükleyen yine üç ders alır. Çözüm App
    Attest / Play Integrity.
  - Yenileme cevabı ağda kaybolursa token ailesi iptal olur ve anonim hesap kaybolur. Mobilde
    yenileme tek seferde bir kez yapılmalı; mağaza sürümünden önce Apple/Google ile giriş ya da
    kurtarma kodu eklenmeli.
  - Sandbox satın almaları da erişim açar: yalnızca TestFlight testçileri ve App Review sandbox
    kullanabildiği için bilerek bırakıldı.
- **Backend ve AI katmanı tamamlandı (API).** Kimlik: anonim cihaz hesabı, `@nestjs/authentication`
  ile 15 dakikalık JWT ve tek kullanımlık, dönen yenileme tokenı (yeniden kullanılırsa aile iptal).
  Anonim hesabın başka giriş yolu olmadığı için yenileme ailesi uzun yaşar (token 1 yıl, aile 10
  yıl). Vazgeçilen: cihaz kimliğini tek başına kimlik saymak.
- **Koç Claude Haiku 5.5, değerlendirici Claude Opus 5.5.** Resmî Anthropic SDK (`@anthropic-ai/sdk`),
  `@nestjs/ai` değil: Claude çağrıları resmî SDK ile yapılır. Modeller `.env` ile değişir.
- **Ses OpenAI ile: döküm `gpt-transcribe`, seslendirme `gpt-4o-mini-tts`.** Risk: OpenAI bütün
  `/v1/audio/speech` modellerini 2027-01-06'da kapatıyor; yerine yalnızca Realtime API'deki
  `gpt-realtime-2.1-mini` var. Pilot (Aşama 4) bu tarihe denk geldiği için seslendirme sağlayıcısı
  pilottan önce değişmeli: Realtime API, başka bir sağlayıcı ya da telefondaki yerleşik ses
  (`expo-speech`). `TextToSpeech` arayüzü sayesinde değişiklik tek sınıf.
- **Abonelik mağazalarla doğrudan doğrulanır** (`@apple/app-store-server-library`,
  `@googleapis/androidpublisher`). Satın almayı hesaba bağlamak için uygulama kullanıcı kimliğini
  Apple'da `appAccountToken`, Google'da `obfuscatedAccountId` olarak geçer. Vazgeçilen: RevenueCat.
- **Admin API admin şablonu gelince yazılacak.** Bildirimler (`ai_reports`) ve maliyet alanları
  şimdiden kaydediliyor.
- **Node.js 22 ve üstü.** OpenAI ve Google paketleri Node 22 istiyor; Node 20'nin desteği bitti.
  Kök klasörde `.nvmrc` var (`nvm use`).
- **Testler PGlite (süreç içi PostgreSQL) üzerinde,** CI ayrıca gerçek PostgreSQL'de çalıştırır.
- **Ad: Say Again.** Repo: https://github.com/metinemredonmez/Say-Again- (şu an herkese açık). Neden:
  uygulamanın ana kuralını anlatıyor (düzeltmeyi al, aynı fikri yeniden söyle), yeni başlayan biri
  iki kelimeyi de bilir ve ad tek bir dile bağlı değil. Vazgeçilen: Prova, Out Loud, Warm Up.
  Klasör adı `learning-eng` olarak kaldı.
- **AI katmanı API'nin içinde bir modül (`apps/api/src/ai`), ayrı servis değil.** Neden: bir turda
  döküm, koç ve seslendirme sırayla çalışır, ayrı servis her adıma ağ gecikmesi ekler; tek kişilik
  bakımda tek servis yeter; servisler arası kimlik doğrulama gerekmez. Dört sağlayıcı arayüzü
  modülün sınırıdır, gerekirse modül tek parça olarak ayrı servise taşınır. Ayırma koşulu: kendi
  modelini çalıştırmak (GPU), Python kütüphanesi gereksinimi ya da AI yükünü ayrı ölçekleme.
  Vazgeçilen: ayrı NestJS ya da Python (FastAPI) servisi.
- **Admin paneli pilottan önce (Aşama 3), Next.js ile.** İçerik: "bu düzeltme yanlış" bildirimleri,
  ders maliyeti, elde tutma ve transfer sonuçları. Admin girişi, oturum ve yetki ilk günden
  red-team kataloğuna göre (AUT, SES, AZ). Vazgeçilen: iskeleti şimdi kurmak.
- **Diller: önce İngilizce; içerik ve veri modeli hedef dili baştan taşır.** Her senaryoda
  `targetLanguage` (ISO 639-1), `users.target_language`. Başka diller MVP sonrası. Vazgeçilen:
  İngilizce ve Türkçeyi birlikte yayınlamak.
- **API güvenlik temeli ilk uçlarla birlikte kuruldu.** Güvenlik başlıkları (`useSecurityHeaders`),
  IP başına hız sınırı (RES-01), `trust proxy` kapalı (NET-03), CORS kapalı, içerik açılışta
  doğrulanır ve bozuksa API başlamaz (EXC-01), istemciye yalnızca izinli alanlar gider (API-02).

- **Platform: mobil (Expo) + NestJS API + PostgreSQL.** Neden: ürünün asıl kullanımı her gün telefonda
  sesli prova; bildirimler, mağaza dağıtımı ve mağazanın vergi tahsilatı bunu destekliyor. Vazgeçilen:
  web önce (Next.js). Bedeli: dağıtım ve fiyat deneyi daha yavaş.
- **Kitle: iki paketle başla (profesyonel ve satıcı), ücretli denemenin kitlesini pilot seçsin.**
- **Ses: bas-konuş, sıralı akış.** Neden: koç sözünü kesmez, hata kaynağı (döküm mü, değerlendirme mi)
  ayrılabilir, gerçek zamanlı ses aynı kullanımda ayda 10–20 dolar tutar.
- **Geri bildirim: ders başına tek düzeltme ve ardından yeniden söyleme.** Vazgeçilen: ders sonunda
  üç hata listesi.
- **Transfer: üç gün sonra, önceden yazılmış farklı bir soru; önceki cevap gösterilmez.** Soruları AI
  üretmez.
- **Tekrar aralıkları: 1, 3 ve 7 gün.**
- **İş modeli deneyi: üç ücretsiz prova, sonra ayda 20 ders; 299 TL ve 449 TL test fiyatları.**
- **Proje klasörü: `~/Desktop/learning-eng`.** Uygulama kodu Claude Code ile bu klasörde yazılacak.
