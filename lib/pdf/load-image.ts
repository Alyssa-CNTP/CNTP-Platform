// Fetch an image URL (a public asset like /logo.png, or a signature data URL)
// and return a data URL + natural dimensions, for embedding into a jsPDF
// document via doc.addImage(). Shared between every client-side PDF export in
// the app (COA, Pasteuriser job card) — extracted here so the loading logic
// stays in one place rather than being copy-pasted per page.
export async function loadImage(url: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url); const blob = await res.blob()
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob)
    })
    const dim = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image(); img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => resolve({ w: 1, h: 1 }); img.src = dataUrl
    })
    return { dataUrl, w: dim.w, h: dim.h }
  } catch { return null }
}
