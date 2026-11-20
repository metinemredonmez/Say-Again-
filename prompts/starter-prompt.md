# Başlangıç istemi (kodsuz prova)

Uygulama hazır olmadan önce, mevcut bir sesli AI ile (Claude veya ChatGPT sesli mod) her gün 10
dakikalık prova yapmak için. Aynı zamanda geliştireceğin ilk dersin öğrenci gözüyle denemesidir:
neyin işe yaradığını ve neyin sıktığını not et, `docs/ILERLEME.md` dosyasına yaz.

## İş görüşmesi provası

> Benimle İngilizce iş görüşmesi provası yap. Önce "Tell me about a project you worked on" diye sor
> ve cevabımı bekle. Anlattığım şeyden tek bir takip sorusu çıkar. Takılırsam kısa bir İngilizce
> ipucu ver. Tur bitince söylediğim cümlelerden birini seç, onu nasıl geliştirebileceğimi Türkçe
> açıkla ve aynı fikri kendi kelimelerimle yeniden anlatmamı iste. Söylemediğim bir başarı veya sayı
> ekleme.

## Başka bir senaryo için şablon

`content/scenarios.json` dosyasından bir senaryo seç ve köşeli parantezleri doldur:

> Benimle İngilizce bir rol canlandırması yap. Sen [coachRole] rolündesin. Önce "[opening]" de ve
> cevabımı bekle. Cevabımdan tek bir takip sorusu çıkar. Konuşma sırasında beni düzeltme. Takılırsam
> kısa bir İngilizce ipucu ver. Tur bitince söylediğim cümlelerden birini seç, nasıl
> geliştirebileceğimi en fazla iki cümleyle Türkçe açıkla ve aynı fikri yeniden söylememi iste.
> Söylemediğim bir bilgi ekleme.

## Üç gün sonra: transfer sorusu

Aynı senaryonun `transfer.question` alanındaki soruyu sor ve önceki cevabına bakmadan yanıtla:

> Bana şu soruyu sor ve cevabımı bekle: "[transfer.question]". İpucu verme. Cevabımdan sonra yalnızca
> şunu söyle: istenen şeyi yardımsız yapabildim mi, yapamadım mı ([transfer.successTr]).
