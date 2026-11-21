# evals

AI kalite testlerinin cevap anahtarları ve çalıştırıcısı. Testlerin tanımı ve eşikleri:
`docs/05-ai-kalite-testleri.md`.

## Çalıştırma

```bash
cd apps/api
npm run eval                      # sahte AI: çalıştırıcıyı dener, kalite ölçmez, ücretsiz
npm run eval -- --live            # gerçek modeller (apps/api/.env içindeki anahtarlar); ücretli
npm run eval -- --live --only=1,2 --limit=5   # yalnızca bazı testler, anahtar başına en fazla 5 örnek
```

- Örnek anahtarlarla `--live` koşusu yaklaşık 1 dolar tutar. Gerçek harcama koşunun sonunda yazılır.
- Değerlendirici, derslerdeki yolun aynısından geçer: sunucu denetimi ve bir yeniden deneme
  (`apps/api/src/ai/evaluate-checked.ts`). Böylece ölçülen, öğrencinin gördüğüdür.
- Sonuç tablo olarak ekrana yazılır. Ayrıntı (her örneğin girdisi, çıktısı ve gerekçesi)
  `evals/results/` altındaki JSON dosyasına gider. Bu klasör git'e girmez.
- `--live` koşusunda bir test eşiğin altındaysa komut 1 ile çıkar: sürüm çıkmaz.

Durumlar:

| Durum | Anlamı |
| --- | --- |
| GEÇTİ | Otomatik denetimle eşik tuttu |
| KALDI | Eşiğin altında |
| İNCELEME | Otomatik denetim karar veremedi; bir kişi ayrıntı dosyasındaki örneklere bakar |
| SET YOK | Cevap anahtarı henüz yok |

## Dosyalar (`golden/`)

| Dosya | Test | Durum |
| --- | --- | --- |
| `corrections.sample.json` | 1, 2, 4 | Taslak: 10 hatalı, 6 doğru cümle. Gerçek set `corrections.json` adıyla gelir (50 + 50) ve eğitmen onaylar |
| `followups.json` | 5, 6, 9, 10 | Taslak: 20 senaryonun her birine bir öğrenci cevabı. Kendi provalarından gerçek cevaplarla değiştir |
| `adversarial.json` | 8 | Taslak: 15 konu dışı, kaba ya da kural değiştirmeye çalışan girdi |
| `transcripts.json` | 3 | Yok: 20 ders dökümü. Gelene kadar düzeltme setinin çıktıları okunur |
| `audio/` | 7 | Yok: Türk aksanlı 20 ses kaydı ve doğru dökümleri |

Bir dosyada `"status"` alanı varsa (ör. `"draft: ..."`), rapor o anahtarı taslak diye işaretler.
Eğitmen onayından sonra bu alan silinir.

## Biçim

```json
{ "id": "e01", "input": "öğrencinin cümlesi", "hasError": true, "expected": "doğru hali", "category": "tense",
  "alsoAccept": ["eğitmenin kabul ettiği başka bir düzeltme"], "scenarioId": "pro-interview-01" }
{ "id": "c01", "input": "doğru bir cümle", "hasError": false }
```

- **Test 1:** `hasError: true` olanlarda değerlendirici `kind: "correction"` dönmeli ve
  `category` eşleşmeli. `improved` alanı `expected`'a ya da `alsoAccept` içindekilerden birine
  eşit olmalı. Büyük küçük harf, noktalama ve kısaltmalar (`I've` / `I have`) fark etmez.
  Farklı ama doğru olabilecek bir düzeltme İNCELEME'ye düşer. Eğitmen doğru bulursa onu
  `alsoAccept`'e ekler.
- **Test 2:** `hasError: false` olanlarda değerlendirici `kind: "polish"` dönmeli.
  `"correction"` dönerse yanlış alarmdır.
- **Diğer alanlar:** `scenarioId` isteğe bağlı; yoksa ilk senaryo kullanılır.
  `followups.json`: `{ id, scenarioId, answer }`. `adversarial.json`: `{ id, scenarioId, input }`.
  `transcripts.json`: `{ id, scenarioId, transcript: [{ speaker, text }] }`.
