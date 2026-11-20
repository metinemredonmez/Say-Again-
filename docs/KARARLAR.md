# Kararlar

Önemli ürün ve teknik kararların kaydı. Yeni karar en üste eklenir: tarih, karar, neden, vazgeçilen
seçenek.

## 2026-11-20

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
