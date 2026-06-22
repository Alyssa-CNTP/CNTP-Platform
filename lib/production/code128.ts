// Code-128B barcode SVG encoder — pure TypeScript, zero dependencies.
// Each character with charCode 32–127 maps to Code-128B value = charCode - 32.
// START B = value 104, STOP = value 106 (13-module symbol).

const PATTERNS: number[][] = [
  [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
  [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
  [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
  [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
  [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
  [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
  [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
  [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
  [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
  [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
  [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
  [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
  [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
  [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
  [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
  [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
  [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
  [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
  [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
  [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
  [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
  [2,1,1,2,3,2],[2,3,3,1,1,1,2],  // index 106 = STOP (7 elements, 13 modules)
];

const START_B = 104;
const STOP    = 106;
const QUIET   = 10; // modules each side

function symbolsFor(text: string): number[] {
  const data: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 127) {
      throw new RangeError(
        `Character '${text[i]}' (charCode ${code}) is outside Code-128B range (32–127).`
      );
    }
    data.push(code - 32);
  }
  return data;
}

function checksum(data: number[]): number {
  let sum = START_B;
  for (let i = 0; i < data.length; i++) {
    sum += (i + 1) * data[i];
  }
  return sum % 103;
}

function totalModules(text: string): number {
  const data = symbolsFor(text);
  // START_B + data symbols + checksum + STOP, each symbol except STOP = 11 modules
  // STOP pattern sums to 13 modules
  const symbolCount = 1 + data.length + 1; // START + data + checksum (not STOP yet)
  let modules = QUIET * 2;
  modules += symbolCount * 11;
  // STOP
  modules += PATTERNS[STOP].reduce((a, b) => a + b, 0);
  return modules;
}

export function getCode128Width(text: string, moduleWidth = 1.5): number {
  return totalModules(text) * moduleWidth;
}

export function encodeCode128(
  text: string,
  opts?: { height?: number; moduleWidth?: number }
): string {
  const height      = opts?.height      ?? 40;
  const moduleWidth = opts?.moduleWidth ?? 1.5;

  const data     = symbolsFor(text);
  const check    = checksum(data);
  const sequence = [START_B, ...data, check, STOP];

  const totalWidth = totalModules(text) * moduleWidth;

  const rects: string[] = [];
  let x = QUIET * moduleWidth; // start after left quiet zone

  for (const sym of sequence) {
    const pattern = PATTERNS[sym];
    let dark = true; // patterns always start with a bar (dark)
    for (const modules of pattern) {
      const w = modules * moduleWidth;
      if (dark) {
        rects.push(
          `<rect x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${height}"/>`
        );
      }
      x += w;
      dark = !dark;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${totalWidth.toFixed(3)}"` +
    ` height="${height}"` +
    ` viewBox="0 0 ${totalWidth.toFixed(3)} ${height}"` +
    ` fill="black">` +
    rects.join("") +
    `</svg>`
  );
}
