# evals

AI kalite testlerinin cevap anahtarları. Testlerin tanımı ve eşikleri:
`docs/05-ai-kalite-testleri.md`.

## Dosyalar

- `golden/corrections.sample.json`: değerlendirici için örnek cümle seti. Yalnızca biçimi gösterir:
  10 hatalı ve 6 doğru cümle. Gerçek set 50 hatalı ve 50 doğru cümle içermeli ve bir İngilizce
  eğitmeni tarafından onaylanmalı.

## Biçim

```json
{ "id": "e01", "input": "öğrencinin cümlesi", "hasError": true, "expected": "doğru hali", "category": "tense" }
{ "id": "c01", "input": "doğru bir cümle", "hasError": false }
```

- `hasError: true` olanlarda değerlendiricinin `improved` alanı `expected` ile aynı anlamı taşımalı ve
  `category` eşleşmeli (test 1).
- `hasError: false` olanlarda değerlendirici `kind: "polish"` dönmeli; `"correction"` dönerse yanlış
  alarmdır (test 2).

## Eklenecek setler

| Test | Dosya (önerilen) | İçerik |
| --- | --- | --- |
| 3. Uydurma yok | `golden/transcripts.json` | 20 ders dökümü |
| 5. Takip sorusu | `golden/followups.json` | 20 kullanıcı cevabı |
| 7. Tanıma hatası | `golden/audio/` | Türk aksanlı 20 ses kaydı ve doğru dökümleri |
| 8. Rolde kalma | `golden/adversarial.json` | 15 konu dışı ya da kural değiştirmeye çalışan girdi |

Çalıştırıcı (runner) henüz yazılmadı; Aşama 3'ün işi.
