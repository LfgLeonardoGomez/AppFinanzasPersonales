/**
 * descargarBlob — hand a Blob to the browser as a download (C-39, design.md D7).
 *
 * The frontend never builds the export document; this is the ONLY thing it
 * does with the bytes the backend sends: create a temporary object URL, an
 * invisible link with the backend's own filename, click it, then clean up.
 */
export function descargarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
