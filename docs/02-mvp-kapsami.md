# MVP kapsamı

MVP tek bir döngüyü kusursuz yapar: **prova et → tek düzeltme al → yeniden söyle → üç gün sonra
yardımsız dene.** Bu döngüye hizmet etmeyen her şey ikinci sürüme kalır.

## Ekranlar ve kabul ölçütleri

| Ekran | Ne yapar | Kabul ölçütü |
| --- | --- | --- |
| 1. Karşılama | Seviye, paket (profesyonel veya satıcı) ve hedefi sorar | Üç sorudan fazla değil; ilk prova kayıt olmadan, 3 dakika içinde başlar |
| 2. Bugün | Günün provasını ve bekleyen tekrar ile transfer sorularını gösterir | Tek birincil düğme; bekleyen transfer sorusu varsa önce o gelir |
| 3. Prova | Koç karşı tarafı oynar; kullanıcı bas-konuş ile cevap verir, 10 dakika | Kullanıcı konuşurken koç sözünü kesmez; her turun dökümü görünür; koç tek bir takip sorusu sorar; takılınca kısa İngilizce ipucu verir |
| 4. Düzeltme | Kullanıcının cümlesi, geliştirilmiş hali, Türkçe kısa açıklama; ardından yeniden söyleme | Tek ana düzeltme; açıklama en fazla iki cümle; koç kullanıcının söylemediği bir bilgi eklemez; yeniden söyleme tamamlanmadan ders bitmez; "bu düzeltme yanlış" düğmesi var |
| 5. Tekrar ve transfer | Kişisel ifadeler 1, 3 ve 7 gün sonra; transfer sorusu 3 gün sonra | Transfer sorusunda önceki cevap ekranda yok; sonuç "ipucusuz", "ipucuyla" veya "yapamadı" olarak kaydedilir |
| 6. Hesap | Zorluk seçimi, kalan ders kotası, abonelik | Satın almayı geri yükleme ve hesabı verileriyle silme uygulama içinden yapılır |

## İçerik

20 senaryo, iki paket (`content/scenarios.json`):

- Profesyonel (12): dört iş görüşmesi, dört teknik toplantı, dört günlük hayat.
- Satıcı (8): dört müşteri mesajı (yazılı), iki tedarikçi ve kargo görüşmesi, iki ürün konuşması.

Her senaryo bir açılış sorusu, bir hedef beceri, ipuçları, bir takip sorusu örneği ve üç gün sonra
sorulacak bir transfer sorusundan oluşur.

İki zorluk: kolayda koç yavaş ve kısa konuşur, ipucu verir; zorda ipucu yoktur ve takip sorusu açık
uçludur.

## Olmayacaklar (bilinçli olarak)

- Web sürümü (ilk sürüm yalnızca iOS ve Android)
- Ligler, rozetler, avatarlar, animasyonlu karakterler
- Ses bazında telaffuz puanlaması
- Sıfırdan başlayanlar için müfredat (A1); MVP A2–B2 arasına hitap eder
- İngilizce dışı diller (içerik ve veri modeli hedef dili baştan taşır, diller sonra eklenir), sosyal
  özellikler, öğretmen pazaryeri
- Kesintisiz gerçek zamanlı sesli sohbet

## Mağaza sürümü için ek gereksinimler

Pilotta şart değil, mağaza başvurusunda şart:

- Abonelik ve aylık ders kotası
- Satın almayı geri yükleme
- Hesabı ve verileri uygulama içinden silme
- AI yanıtını uygulamadan çıkmadan bildirme
- Gizlilik politikası, kullanım şartları, veri beyanları

## MVP'nin cevaplaması gereken iki soru

1. Kullanıcılar ikinci haftada hâlâ geliyor mu?
2. Yedinci gün transfer görevini ipucusuz geçebiliyorlar mı?
