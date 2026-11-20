# Yol haritası

Haftada 10–12 saat varsayımıyla kapalı pilot 7. haftada, mağaza yayını 14. haftada. Her aşamanın
sonunda bir kapı var; ölçüt tutmadan sonrakine geçme. Haftada 15 saatle aynı iş yaklaşık 10 haftaya
iner.

| Aşama | Hafta | Kapı |
| --- | --- | --- |
| 1. Keşif ve tek ders | 0–1 | Kendi telefonunda sesli cevap verirsin, tek düzeltme alırsın, yeniden söylersin |
| 2. Çekirdek döngü | 2–4 | Bugün takıldığın ifade sonraki derste farklı bir soruyla geri gelir |
| 3. İçerik ve kalite | 5–6 | Kalite eşikleri geçilir; 14 gün boyunca her gün kendin kullanırsın |
| 4. Kapalı pilot | 7–9 | İkinci hafta elde tutma %30 ve üzeri; yedinci gün transferi kimlerin ipucusuz geçtiği görülür |
| 5. Mağaza yayını | 10–14 | Gerçek cihazlarda ders ve satın alma akışı tamamlanır; ilk ücretli kullanıcılar ölçülür |

## Aşama 1: Keşif ve tek ders (hafta 0–1)

Hedef üç görev: kendini tanıtma (`pro-interview-01`), toplantıda durum aktarma (`pro-meeting-01`),
otel tarihini değiştirme (`pro-daily-01`).

Öğrenme tarafı (uygulamadan bağımsız):

- [ ] EF SET testini çöz, sonucu `docs/ILERLEME.md` dosyasına yaz
- [ ] `prompts/starter-prompt.md` ile her gün 10 dakika prova yap (`docs/07-30-gun-plani.md`)
- [ ] 5 kişiyle 15'er dakika konuş: "İngilizce seni en çok nerede zorluyor?"

Geliştirme tarafı:

- [ ] İki uygulamayı çalıştır: `apps/api` (`npm run start:dev`) ve `apps/mobile` (`npx expo start`)
- [ ] API: `GET /health` ve `GET /scenarios` (içerik `content/scenarios.json` içinden, açılışta doğrulanır)
- [ ] API: ders akışı sahte AI ile (`POST /lessons`, `/turns`, `/finish`, `/resay`); birim ve e2e testleri
- [ ] Mobil: Bugün ekranında senaryo listesi; Prova ekranı metinle uçtan uca çalışır
- [ ] Mobil: bas-konuş ses kaydı ve API'ye yükleme
- [ ] API: gerçek döküm, koç, değerlendirici ve seslendirme sağlayıcıları (iki seçeneği karşılaştır)
- [ ] Kendi telefonunda üç görevi sesli tamamla

Kapı tutmazsa: kapsamı tek senaryoya indir.

## Aşama 2: Çekirdek döngü (hafta 2–4)

- [ ] PostgreSQL bağlantısı ve `db/schema.sql` şemasının göçleri
- [ ] Cihaz kimliği ile anonim kullanıcı
- [ ] Kişisel ifadeler (Defter ekranı)
- [ ] 1, 3 ve 7 günlük tekrar kuyruğu
- [ ] Transfer sorusu: üç gün sonra, önceki cevap gösterilmeden; sonuç kaydı
- [ ] Bugün ekranı: bekleyen transfer önce, sonra tekrarlar, sonra yeni prova
- [ ] Günlük bildirim
- [ ] Ders başına maliyet ve gecikme kaydı

Kapı tutmazsa: tekrarı sadeleştir (yalnızca 3. gün).

## Aşama 3: İçerik ve kalite (hafta 5–6)

- [ ] 20 senaryonun tamamı iki zorlukta denenir
- [ ] Karşılama ekranı: seviye, paket, hedef
- [ ] AI kalite testleri (`docs/05-ai-kalite-testleri.md`); cevap anahtarını bir İngilizce eğitmeni onaylar
- [ ] "Bu düzeltme yanlış" bildirimi
- [ ] EAS Build; TestFlight ve Play kapalı test kurulumu
- [ ] Gizlilik politikası ve kullanım şartları taslağı (`docs/06-yayin-ve-hukuk.md`)

Kapı tutmazsa: kendin kullanmıyorsan başkası da kullanmaz; neyin sıktığını düzelt.

## Aşama 4: Kapalı pilot (hafta 7–9)

- [ ] 30 kişi davet et, iki pakete yaklaşık yarı yarıya
- [ ] Haftalık birebir görüşmeler
- [ ] İlk ve yedinci gün görevlerinin ölçümü; ikinci hafta elde tutma
- [ ] Paket karşılaştırması ve ücretli denemenin kitlesine karar

Kapı tutmazsa: yayınlama. Bırakanlarla konuş, döngüyü düzelt, pilotu tekrarla.

## Aşama 5: Mağaza yayını (hafta 10–14)

- [ ] Hesap ve giriş
- [ ] Abonelik (mağaza içi satın alma), ayda 20 ders kotası, üç ücretsiz prova
- [ ] Satın almayı geri yükleme
- [ ] Hesabı ve verileri uygulama içinden silme
- [ ] AI yanıtını bildirme
- [ ] Mağaza sayfaları, ekran görüntüleri, veri beyanları
- [ ] Başvurular; fiyat deneyi (449 TL, dönüşüm zayıfsa 299 TL)

Reddedilirse: gerekçeyi düzelt ve yeniden başvur.
