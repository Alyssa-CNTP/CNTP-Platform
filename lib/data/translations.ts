export type Lang = 'en' | 'af' | 'zu' | 'xh'

export const TRANSLATIONS = {
  en: {
    // UI
    vl: 'Type / Variant', bl: 'Batch / Lot number',
    pal: 'Pallet', bx: 'Boxes', bg: 'Bags', pb: 'Paper Bags',
    ns: 'Nothing here — no stock',
    nson: '✓ Nothing here — tap to undo',
    cq: 'Confirm: nothing on the floor for',
    sure: 'Are you sure?', can: 'Cancel', yn: 'Yes — nothing here',
    abag: '+ Add another bag', aplt: '+ Add pallet', ai: '+ Add item',
    // Rooibos sections
    s1t: 'Sieving Tower',    s1h: 'Leaf, sticks, all dusts',
    s2t: 'Refining 1',       s2h: 'Sticks → indent & white dust',
    s3t: 'Refining 2',       s3h: 'Heavy sticks and dust',
    s4t: 'Pasteuriser',      s4h: 'Count by pallet',
    s5t: 'Blender',          s5h: 'Blends and refill material',
    s6t: 'Granule Line',     s6h: 'Granules and by-product dusts',
    s7t: 'Final Product',    s7h: 'Count by pallet',
    s8t: 'Hammermill / Other', s8h: 'Red dust, yellow dust, waste',
    // Rosehip sections
    r1t: 'Rosehips: Final Product', r1h: 'Whole berries and shells',
    r2t: 'Rosehips: Processing',    r2h: 'Shells, seeds, coarse',
    r3t: 'Rosehips: Packing',       r3h: 'TBC, pyramid cut, granules',
    r4t: 'Rosehips: Waste',         r4h: 'Dusts, floor waste',
  },
  af: {
    vl: 'Tipe / Variant', bl: 'Batch / Lotnommer',
    pal: 'Pallet', bx: 'Bokse', bg: 'Sakke', pb: 'Papiersakkies',
    ns: 'Niks hier — geen voorraad', nson: '✓ Niks hier — ontdoen',
    cq: 'Bevestig: niks vir', sure: 'Is jy seker?', can: 'Kanselleer', yn: 'Ja — niks hier',
    abag: '+ Voeg sak by', aplt: '+ Voeg pallet by', ai: '+ Voeg item by',
    s1t: 'Siewtoring',      s1h: 'Blaar, stokkies, stuif',
    s2t: 'Verfyning 1',     s2h: 'Stokkies → stuif',
    s3t: 'Verfyning 2',     s3h: 'Swaar stokkies en stuif',
    s4t: 'Pasteuriseerder', s4h: 'Tel per pallet',
    s5t: 'Menger',          s5h: 'Mengsels',
    s6t: 'Korrellyne',      s6h: 'Korrels en stuif',
    s7t: 'Eindproduk',      s7h: 'Tel per pallet',
    s8t: 'Hamermolen / Ander', s8h: 'Rooistof, geelstuif, afval',
    r1t: 'Roosbottels: Eindproduk', r1h: 'Bessies en doppe',
    r2t: 'Roosbottels: Verwerking', r2h: 'Doppe, sade',
    r3t: 'Roosbottels: Verpakking', r3h: 'TBC, korrels',
    r4t: 'Roosbottels: Afval',      r4h: 'Stuif, afval',
  },
  zu: {
    vl: 'Uhlobo', bl: 'Batch',
    pal: 'I-pallet', bx: 'Amabhokisi', bg: 'Amabheji', pb: 'Amaphepha-bheji',
    ns: 'Akukho lutho lapha', nson: '✓ Akukho — buyisela',
    cq: 'Qinisekisa: akukho nge', sure: 'Uqinisekile?', can: 'Khansela', yn: 'Yebo — akukho',
    abag: '+ Engeza ibhegi', aplt: '+ Engeza i-pallet', ai: '+ Engeza into',
    s1t: 'Inqola yokhefefo',     s1h: 'Izicubu, izinti, uthuli',
    s2t: 'Ukuhlanzwa 1',         s2h: 'Izinti → uthuli',
    s3t: 'Ukuhlanzwa 2',         s3h: 'Izinti ezisindayo',
    s4t: 'Pasteuriser',          s4h: 'Bala nge-pallet',
    s5t: 'Ihlanganiso',          s5h: 'Izihlanganiso',
    s6t: 'Umugqa wezikhoba',     s6h: 'Izikhoba nothuli',
    s7t: 'Umkhiqizo Wokugcina',  s7h: 'Bala nge-pallet',
    s8t: 'Hammermill',           s8h: 'Uthuli, inkucuza',
    r1t: 'Rosehips: Umkhiqizo',       r1h: 'Izithelo nezinwele',
    r2t: 'Rosehips: Ukucutshungulwa', r2h: 'Izinwele, imbewu',
    r3t: 'Rosehips: Ukuphakiwa',      r3h: 'TBC, izikhoba',
    r4t: 'Rosehips: Inkucuza',        r4h: 'Uthuli, inkucuza',
  },
  xh: {
    vl: 'Uhlobo', bl: 'Batch',
    pal: 'I-pallet', bx: 'Amabhokisi', bg: 'Izikhwama', pb: 'Iiphepha-bheji',
    ns: 'Akukho nto apha', nson: '✓ Akukho — buyisa',
    cq: 'Qinisekisa: akukho nge', sure: 'Uqinisekile?', can: 'Rhoxisa', yn: 'Ewe — akukho',
    abag: '+ Yongeza isikhwama', aplt: '+ Yongeza i-pallet', ai: '+ Yongeza into',
    s1t: 'Isikhelo',               s1h: 'Amaqabi, izinto, uthuli',
    s2t: 'Ukucocwa 1',             s2h: 'Izinto → uthuli',
    s3t: 'Ukucocwa 2',             s3h: 'Izinto ezinzima',
    s4t: 'Pasteuriser',            s4h: 'Bala nge-pallet',
    s5t: 'Isixube',                s5h: 'Izixube',
    s6t: 'Umgca we-granule',       s6h: 'Ii-granule nothuli',
    s7t: 'Imveliso Yokugqibela',   s7h: 'Bala nge-pallet',
    s8t: 'Hammermill',             s8h: 'Uthuli, inkunkuma',
    r1t: 'Rosehips: Imveliso',        r1h: 'Iziqhamo nezinwele',
    r2t: 'Rosehips: Ukulungiselela',  r2h: 'Izinwele, imbewu',
    r3t: 'Rosehips: Ukuphakishwa',    r3h: 'TBC, ii-granule',
    r4t: 'Rosehips: Inkunkuma',       r4h: 'Uthuli, inkunkuma',
  },
} as const

type TranslationKey = keyof typeof TRANSLATIONS.en

export function t(lang: Lang, key: TranslationKey): string {
  return (TRANSLATIONS[lang] as Record<string, string>)[key]
    ?? TRANSLATIONS.en[key]
    ?? key
}
