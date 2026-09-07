/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 *     python scripts/build-mark-bitmaps.py "<artwork folder>" [96]
 *
 * Certification artwork rasterised to 1-bit bitmaps for the Argox CP-2140EX
 * (203dpi, PPLB). Regenerate when a certifier supplies new artwork; never
 * hand-edit, because the bytes are checked against their own dimensions by
 * mark-bitmaps.test.ts and a hand-tweak will fail that rather than silently
 * print something wrong.
 *
 * These replace the redrawn SVGs in marks.ts FOR PRINTING ONLY. The SVGs stay
 * for the on-screen editor and the PDF proof, where scaling is free. Rainforest
 * Alliance and Fairtrade both license their artwork, and these are the files
 * they supplied — which is what marks.ts flagged with officialArtworkRequired.
 *
 * The MarkBitmap type lives in lib/core/labels/bitmap.ts, not here: core owns
 * the printer contract and features import core, never the reverse
 * (ARCHITECTURE.md §2, enforced by eslint.boundaries.mjs).
 */

import type { MarkBitmap } from '@/lib/core/labels/bitmap'

export const MARK_BITMAPS: Record<string, MarkBitmap> = {
  jas: {
    key: 'jas',
    source: 'JAS.png',
    widthDots: 96,
    heightDots: 96,
    widthBytes: 12,
    // EPL2 GW payload, base64. MSB-first, a 0 bit prints black.
    dataBase64:
      '///////////////////////////////////8B//gP//gH//////AAH4AA/8AAf////8AAAgAAHgAAH////wAAAAAADAA' +
      'AB////gH/gB/8AA/8A///+A//wD//gH//gP//8D//gB//4f//4H//4P//AA//8///+D//wf/+AAf//////B//w//8GIP' +
      '//////h//h//8MMH//////w//D//4OOH//////4f/D//4GMD//////4f+H//wAAD//////8P+H//wAAB//////8P8P//' +
      'hgAh///H/B+H8P//h4Dw/+8B4B+H8f//j8Pw/+84x//H8f//B+Pw/+58T//H4f//AePA/+5+T//D4f//AEMA/+5+YD/D' +
      '4f//AAAA/+5+cB/D4f//CAAI/+58f8/D4f//DgA45+4Qf+/D4f//D4D4584Af+fD4f//D+P4845+f8/D8f//B+Pw+B5+' +
      'YA/H8f//gePA/n/////H8P//gEMA//////+H8P//gAAB//////+H+P//gAAB//////+P+H//wwBh//////8P+H//w8HD' +
      '//////8P/D//4ePD//////4f/B//4OOH//////w//g//8MMH//////g//wf/+GIP//////B//4P//AAf/////+D//8H/' +
      '/AA//8///8H//+B//gB//wP//wP///Af/wD//AD//Af///gD/AAf4AAf4A////4AAAAAADAAAD////+AABwAAPwAAP//' +
      '///wAP8AB/+AB///////////////////////////////////////////////////////////////////////////////' +
      '/////////////////////////////////////zzzsGPz397O3j3v/BgzsEnB397OzBzv+fexvcyc397Gycxv++eUvcye' +
      '397W2+1v++eWncG+397a2+0v++eWHcme397Y2+2v+fe3Pc2c387cyc2P/BA3PczBw+DczB3P/zz3ve7zw/Pe3j3v////' +
      '////////////////////////////////////////////////////////////////////////////////////////////' +
      '/wQQQJhuHmBcGMw//nzzO5vs/DvZ2Mn//vzzO5vt/TvbyEn//vwQe5hp/bvTyUx//vzwe5lp/DvbyQ8//nzze5vt+Bvb' +
      'yY+//zzzO5vse9nZmc0//4QTO5vvG9veOcx/////////////////////////////////////////////////////////' +
      '////////////////////////////////////////////Dc598/e+f//////+fcwwweYMP//////+/c2Xfcbpv//////8' +
      '/cw3fZbsP//////8/cwwebbsP//////8/cmecwLpn//////+fMmc5/ZJn///////DhwxwfccP///////////////////' +
      '////////////////////////////////////////////////////////////////',
  },
  control_union: {
    key: 'control_union',
    source: 'Control Union.png',
    widthDots: 96,
    heightDots: 96,
    widthBytes: 12,
    // EPL2 GW payload, base64. MSB-first, a 0 bit prints black.
    dataBase64:
      '////////////////////////////////////////////////////////////////////////////////////////////' +
      '///////////////////////////wf//////////////gP5///////////9/nPx///////////AfnPx///////////Efn' +
      'Pz///////////GfjPz/v/////////gfgPz/v///////+fgPwfw/ff//////4fjH//w/e///////x/z////++///////g' +
      '/z////+9///////sf//////Z///////8f//////j/P/////+P///////+f//////P///////9/////v/f///////7d//' +
      '//H/////////3b////h//////////3////w//////////P///8Af/////+A/+f///4Af/////gAf/////8P/////8AAH' +
      '//3//+H/////gAAD//v///D////8AAAB/+f///z////wAAAA/9/////////AAAAAf/////////4AAAAAP////P/9//AA' +
      'AAAAH///8D/4f4AAAAAAH/8P8B/wAAAAAAAAD/z355/wAAAAAAAAB/v355/gAAAAAAAAB/v34Z/gAAAAAAAAA/v38B/A' +
      'AAAAAAAfw/3P+D/AAAAAAAD/8f4///+AAAAAAAP/+f////+AAAAAAA///P////8AAAAAAB///v////8AAAAAAH//////' +
      '//8AAAAAAP//////HP8AAAAAAf/////hHP4AAAAAB/////95PP4AAAAAD//////3HP4AAAAAP//////vAP4AAAAAf///' +
      '///fgf4AAAAA//////8A//4AAAAD//////////4AAAAP//////////4AAAAf//////////4AAAB///////////4AAAH/' +
      '//////////4AAAf///////////4AAB////////////+AAH/////////////wB///////////////////////////////' +
      '////////////////////////H//////////////gA/////////////8AAf////////////wAAP///////////+AAAf//' +
      '/////////4AAAf///////////gAAA///////////8AAAA///////////wAAAB//////z///+AAAAB//////4f//wAAAA' +
      'D//////4B/+AAAAAH//////8AAAAAAAD///////+AAAAAAAf////////AAAAAAB/////////gAAAAAH/////////wAAA' +
      'AAf/////////4AAAAA//////////+AAAAD///////////AAAAH///////////wAAAP///////////4AAAf//////////' +
      '//AAB/////////////wAD//////////////gH///////////////////////////////////////////////////////' +
      '////////////////////////////////////////////////////////////////',
  },
  rainforest_alliance: {
    key: 'rainforest_alliance',
    source: 'Rainforest Alliance.png',
    widthDots: 96,
    heightDots: 96,
    widthBytes: 12,
    // EPL2 GW payload, base64. MSB-first, a 0 bit prints black.
    dataBase64:
      '///////////////////////////////////////////////////////+f/////////////44OH////////////wAAD//' +
      '/////////gAAAAD//////////gAAAAB//////////AP//4A/////////gA////AB////////AP////4A////////A//j' +
      'D/+A///////+D/jrn//w///////gH/Hn3+f4B//////Af3Lzn8f+A//////A/Djpn4e/A//////D/Ltjvxc/g//////H' +
      '/jh//wd/w/////wPh1///+b78D////gfI0////Tz+B////g/c3//v/xn/B////h/e/8DHP/PPB////j/M/g/PP/Ofh//' +
      '//Dzh+H/OP/s/x///+Hn/4//M//5/4///4Px/z//N//798H//wf5/H//D///A8H//we8+P//Hv/+N+H//4+f8//+AH//' +
      'j+H//4/H5//+CPw/z/H//x+Dz//8f/wf3/H//hwf3//4//4f/Hh/+D8/n//x/8AH8Pg/+D/PP//w/AcB5Pw/+D//f/nx' +
      '4A2A/Pw//Hj+f/D/gAyA/Dw//H48/HH+AAyA+P4//H+c/HPwAAyB+/4/+P/9/HfgAAcD/x4f8P/5/neAAAAHvg8P4PB7' +
      '/24AAAAfnO8P4OL7/0wAAAA/nO8P8fDz/zAAAAD/3O8P8fzz/2AAAAP/3n8f+f5z/8AAAB//z/8f8f/z/4AAAD//z/+f' +
      '8f/z/wAAAD//zgeP4eD3/AAACH5/zteHwcn3/AAACP4/zteH4cB3+AAAGPx/zveH8f/z8AAAGP3/z/+P8f/z4AYAMPP3' +
      'z/8f+f/zwAPwcMPDz/8f8f/zwAA88AAD3/8f8fnzwAAP+wP/3z8P4Pj7wAAD//n/nx8P4Pn5wAAA//x/nz8P8P/58AAA' +
      'f/8fv/8P+P/9/AAAf/8/P/4f/H+8///Af///O/4//H4c//gA///+e/4//Hhef4AD///+8pw/+DsffAAP///88Lw/+D8/' +
      'OAD////9+Dw//D/3nAP8f//5/jg//h/Dz8AAf//zz/h//x+Lz/AAf//nh/H//48J5/wf///PgPH//48v8/4P//+P5eH/' +
      '/wef+P8z//8+c+H//wfcPH85//5/P8H//4P5vx+8f/j5n8H//+Hzn4+cP+P834f///D7n+OOf4/mXx////j5M/uP/D/P' +
      'Hh////h8cP+fwf/n/B////g/5P////3z/B////gfwZ////x78B////wP373//9w78H/////H/zh//d0fw//////D/3t8' +
      'fNwfg//////A/zD9fAz/A//////AfzL8fIz+A//////gH/H8Pu/4B//////+D/j5Pv/g////////Af/8v/+A////////' +
      'AH////4A////////gA////AB/////////AH//4A//////////gAAAAB//////////ggAABD///////////wAAD//////' +
      '//////44OH/////////////+f///////////////////////////////////////',
  },
  fairtrade: {
    key: 'fairtrade',
    source: 'Fairtrade.png',
    widthDots: 96,
    heightDots: 96,
    widthBytes: 12,
    // EPL2 GW payload, base64. MSB-first, a 0 bit prints black.
    dataBase64:
      '/////////////////////////////////4AAAAAAAAAAAAP//4AAAAAAAAAAAAP//4AAAAAAAAAAAAP//4AAAAAAAAAA' +
      'CIP//4AAAAAAAAAAEkP//4AAAAAH8AAAJ6P//4AAAAD//4AALIP//4AAAAP///AAL4P//4AAAA////wALKP//4AAAB//' +
      '//8AJKP//4AAAH/////AEEP//4AAAP/////gD4P//4AAAP/////4AAP//4AAAf/////8AAP//4AAA//////+AAP//4AA' +
      'A///////AAP//4AAA///////gAP//4ACB///////wAP//4AGB///4///wAP//4AMB///AH//4AP//4AMB//+AD//8AP/' +
      '/4AcB//8AB//8AP//4AcB//4AA//+AP//4A8B//4AA//+AP//4B8B//wAAf//AP//4B8B//wAAf//AP//4B8B//wAAf/' +
      '/gP//4D8A//wAAf//gP//4D8A//wAAf//gP//4D8Af/wAAf//wP//4H+Af/4AA///wP//4H+AP/4AA///wP//4H+AH/8' +
      'AB///wP//4H/AD/+AD///wP//4H/AA//AH///4P//4P/gAf/wf///4P//4P/gAH//////4P//4P/wAA//////4P//4P/' +
      '4AAD/////4P//4P/8AAAP////4P//4P/+AAAA////4P//4P//AAAAH///4P//4H//gAAAA///wP//4H//wAAAAP//wP/' +
      '/4H//4AAAAD//wP//4H//4AAAAA//wP//4H//8AAAAAf/wP//4D//+AAAAAP/wP//4D///AAAAAH/gP//4D///gAAAAD' +
      '/gP//4D///gAAAAB/gP//4B///wAAAAB/AP//4B///wAAAAA/AP//4A///4AAAAA+AP//4A///4AAAAA+AP//4Af//8A' +
      'AAAA8AP//4AP//8AAAAAcAP//4AP//8AAAAAYAP//4AH//+AAAAAQAP//4AD//+AAAAAAAP//4AD//+AAAAAAAP//4AB' +
      '//+AAAAAAAP//4AA//+AAAAAAAP//4AAf/+AAAAAAAP//4AAH/+AAAAAAAP//4AAD/8AAAAAAAP//4AAB/8AAAAAAAP/' +
      '/4AAAf8AAAAAAAP//4AAAH4AAAAAAAP//4AAAB4AAAAAAAP//4AAAAAAAAAAAAP//4AAAAAAAAAAAAP//4AAAAAAAAAA' +
      'AAP//4AAAAAAAAAAAAP//4AAAAAAAAAAAAP//4AAAAAAAAAAAAP//4AAAAAAAAAAAAP//4fzhvz+/Bh/H4P//4YDhsY4' +
      'xhxjmAP//4YGhsMQxjRhkAP//4YGxsIQxjRhmAP//4fmxv4Q/iZgn4P//4YERvwQ/GZgkAP//4YP5swQzH5hkAP//4YP' +
      '5sYQzH9jkAP//4YYJsYQxsN/H4P//4IIJEIQAgE4H4P//4AAAAAAAAAAAAP//4AAAAAAAAAAAAP//4AAAAAAAAAAAAP/' +
      '/4AAAAAAAAAAAAP//4AAAAAAAAAAAAP/////////////////////////////////',
  },
  cape_natural: {
    key: 'cape_natural',
    source: 'CNTP.png',
    widthDots: 96,
    heightDots: 96,
    widthBytes: 12,
    // EPL2 GW payload, base64. MSB-first, a 0 bit prints black.
    dataBase64:
      '////////////////////////////////////////////////////////////////////////////////////////////' +
      '////////////////////////////////////////////////////////////////////////////////////////////' +
      '/////////////////////////////////v///////////////v///////////////P///////////////H//////////' +
      '/////H///////////////H///////////////H///////////////n4D/////////////vAAf////////////8AAH///' +
      '/////////8AAD//////////AAP7wB/////////gH//4GA///////74D//8OBAf//////vA///+HAQP/////+8H///+DA' +
      'AH/////7g/////DgAH/////uD/////gwAD////+YP//////4AB////9wf//////8AA////zB///////+AAP///mD////' +
      '////AAB///MH////////gAB//+YP//Af////4A///8wf/+Af/////////5g//8Ef/////////7B//4f//////////2B/' +
      '/4/+f+/3/////mD//4/4BgPA/////sH//4/4BgGM/////MH//4/xxnEIf////YP//4fx5ngAf///+YP//8ORxnEf////' +
      '+YP//8AYBgGI////+QP///AYBgHA////8wf///x+fmfj////8wf//////H//////8wf//////n//////8wf//////H//' +
      '/j//8wf/Hh///////j//8wf/Dz/+f////j//8wP/Dj/+P////j//+YP/Bj/+f////j//+YP/AhxMGczGNj//+YP/AzAE' +
      'EcQEAj//+MH/MDCEMcQoQj///MH/GCPGccR44j///GD/OCPGccR44j///mD/PDGGMcR44j///jB/PDAGGAx4Aj///zg/' +
      'PhgGGAx8Aj///xwf/////////7///44P/////////////8cH/////////////+OD//////////////HB////////////' +
      '//jgf/////////////w4P/////////////4eD/////////////+Hg////////H/////B4H//////8f/////weA//////' +
      'B//////8HwD////wP///////A/AD//gD////////4H8AAAA//////////Af/AD/4/////////8A///8H//////////4A' +
      'AAB////////////+AD//////////////////////////////////////////////////////////////////////////' +
      '////////////////////////////////////////////////////////////////////////////////////////////' +
      '////////////////////////////////////////////////////////////////',
  },
}
