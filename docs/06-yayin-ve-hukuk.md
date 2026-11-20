# Yayın ve hukuk

Bu belge bir kontrol listesidir, hukuki ya da mali tavsiye değildir. Yayından önce bir hukukçuya ve
muhasebeciye danış. "Doğrulandı" notu olmayan maddeler genel bilgiye dayanır; başvurudan önce güncel
mağaza kurallarından kontrol et.

## Mağaza yayın planı

| Konu | App Store | Google Play |
| --- | --- | --- |
| Hesap | Apple Developer Program üyeliği (yıllık ücretli) | Tek seferlik 25 dolar kayıt ücreti (doğrulandı) |
| Kapalı test | TestFlight ile davet | Kişisel hesap 13 Kasım 2023'ten sonra açıldıysa: en az 12 testçi, kesintisiz 14 gün. Kurumsal hesap muaf ama D-U-N-S numarası ister (doğrulandı) |
| Abonelik | Mağaza içi satın alma; %15 komisyon için App Store Small Business Program'a ayrıca başvurulur, yoksa %30 (doğrulandı) | Play Billing; 2026'da hizmet ve faturalama bedeli ayrıldı, abonelikte %10 hizmet bedeli duyuruldu. Türkiye'deki oranı Play Console'dan doğrula |
| Zorunlu özellikler | Satın almayı geri yükleme; hesabı uygulama içinden silme | AI içeriğini uygulamadan çıkmadan bildirme (doğrulandı); hesap ve veri silme |
| Beyanlar | Gizlilik etiketleri, yaş derecelendirmesi | Veri güvenliği formu, içerik derecelendirmesi |

Pilotun 30 kişisi Google'ın 12 testçi şartını da karşılar; yeter ki testçiler 14 gün boyunca kapalı
testte kalsın.

Kaynaklar:

- Google Play test şartı: https://support.google.com/googleplay/android-developer/answer/14151465
- Google Play AI içerik politikası: https://support.google.com/googleplay/android-developer/answer/13985936
- App Store Small Business Program: https://www.revenuecat.com/blog/engineering/small-business-program
- Google Play ücret yapısı (Mart 2026): https://android-developers.googleblog.com/2026/03/a-new-era-for-choice-and-openness.html

## Kişisel veri ve KVKK

- **Ses ve dökümler kişisel veridir.** Ses kaydını saklama; yalnızca metin dökümünü tut ve kullanıcıya
  silme düğmesi ver.
- **Veri yurt dışına çıkıyor.** AI sağlayıcıları ve barındırma yurt dışında olduğu için KVKK'nın yurt
  dışı aktarım kuralları devreye girer; aydınlatma metni ve açık rıza akışı gerekir.
- **Sağlayıcı şartları.** API üzerinden giden verinin model eğitiminde kullanılıp kullanılmadığını
  seçtiğin sağlayıcının güncel şartlarından doğrula ve gizlilik politikana yaz.
- **Yaş sınırı.** İlk sürüm yalnızca 18 yaş üstü.
- **Gerekli sayfalar.** Gizlilik politikası, kullanım şartları, abonelik iptal ve iade koşulları.

## Vergi

- Mağaza üzerinden satışta KDV ve dijital hizmet vergisi fiyattan mağaza tarafından düşülür. Türkiye'de
  dijital hizmet vergisi 1 Ocak 2026'da %7,5'ten %5'e indi ve Apple bunu geliştirici gelirlerine
  yansıttı: https://www.cnbce.com/teknoloji/apple-app-store-gelirlerinde-turkiye-icin-vergi-guncellemesine-gitti-h24067
- Geliri hangi şirketin elde edeceği ve nasıl beyan edileceği muhasebeciyle netleşmeli. Gelir
  İdaresi'nin 30 Ocak 2026 tarihli özelgesi mağaza gelirlerinin vergilendirilmesini ele alıyor:
  https://www.alomaliye.com/2026/02/18/app-store-ve-google-playden-elde-edilen-gelirler-nasil-vergilendirilir/
- Mağaza hesabını kişisel mi şirket adına mı açacağın hem Google'ın test şartını hem vergiyi etkiler.

## Birim ekonomi (kaba hesap)

Varsayımlar: KDV %20, dijital hizmet vergisi %5, komisyon %15, kur 49,8 TL/dolar (Ekim 2026 sonu), AI
gideri ayda 1,51 dolar.

| Fiyat | KDV sonrası | Vergi ve komisyon sonrası | AI gideri | Kalan |
| --- | --- | --- | --- | --- |
| 299 TL | 249 TL | 201 TL | 75 TL | 126 TL |
| 449 TL | 374 TL | 302 TL | 75 TL | 227 TL |

Mağazanın geliri tam olarak nasıl hesapladığı farklı olabilir; tablo yalnızca büyüklük sırasını
gösterir.
