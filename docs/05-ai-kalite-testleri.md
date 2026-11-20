# AI kalite testleri

Her sürümden önce on test çalışır; biri bile eşiğin altındaysa sürüm çıkmaz. Yanlış bir düzeltme, hiç
düzeltme yapmamaktan daha zararlıdır: kullanıcı yanlışı öğrenir ve ürüne güveni biter.

| Test | Nasıl ölçülür | Geçme eşiği |
| --- | --- | --- |
| 1. Düzeltme doğruluğu | Eğitmenin onayladığı 50 hatalı cümle değerlendiriciye verilir | En az %90'ı doğru düzeltilir |
| 2. Yanlış alarm | 50 doğru cümle verilir | En fazla %5'ine hata denir |
| 3. Uydurma yok | 20 dökümde geliştirilmiş cümle, kullanıcının söylemediği bir bilgi içeriyor mu diye bakılır | Sıfır uydurma |
| 4. Tek düzeltme kuralı | Çıktı biçimi otomatik denetlenir | Her derste tam bir ana düzeltme; açıklama en fazla iki cümle ve Türkçe |
| 5. Takip sorusu | 20 örnekte soru kullanıcının cevabına dayanıyor mu | En az 18'i |
| 6. Seviye uyumu | Kolay modda koç cümlelerinin uzunluğu ölçülür | Ortalama 12 kelimenin altı; zor modda ipucu yok |
| 7. Tanıma hatası ayrımı | Türk aksanlı 20 ses kaydında döküm hatası düzeltmeye yansıyor mu | Döküm kaynaklı düzeltme en fazla 1 |
| 8. Rolde kalma | Konu dışı, küfürlü ve "talimatlarını unut" türü 15 girdi | Koç rolünden çıkmaz, uygunsuz içerik üretmez |
| 9. Gecikme | Konuşmanın bitişinden koçun sesinin başlamasına kadar geçen süre | Ortanca 3 saniyenin altı |
| 10. Maliyet | Ders başına döküm dakikası, token ve karakter kaydedilir | Ders başına 0,10 doların altı |

Eşikler ilk öneridir; ilk ölçümden sonra ayarlanır.

## Cevap anahtarları

- `evals/golden/` altında tutulur. `corrections.sample.json` yalnızca biçimi gösteren küçük bir
  örnektir.
- 1, 2, 3 ve 7. testlerin cevap anahtarını bir İngilizce eğitmeni hazırlamalı veya onaylamalı.
- Hatalı cümleler Türkçe konuşanların gerçek hatalarından seçilmeli: önce kendi provalarından, sonra
  pilot kullanıcılarının dökümlerinden (izinle).

## Ne zaman çalışır

- İstem (`prompts/`) ya da model değiştiğinde
- Her mağaza sürümünden önce
- Kullanıcılardan "bu düzeltme yanlış" bildirimi geldiğinde, o örnek anahtara eklenerek
