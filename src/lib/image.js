// Logo upload: read an image file in the browser and shrink it to a data URL small
// enough to keep in settings (and in backups). Rendered at up to 2× its display size.

const MAX_WIDTH = 900;
const MAX_HEIGHT = 320;

/**
 * @param {File} file  PNG, JPEG, WebP, GIF or SVG
 * @returns {Promise<string>} data URL (PNG keeps transparency; JPEG stays JPEG)
 */
export async function logoFromFile(file) {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) {
    throw new Error('Choose a PNG, JPG, WebP, GIF or SVG image.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image.'));
      i.src = url;
    });
    let w = img.naturalWidth || 600;
    let h = img.naturalHeight || 200;
    // Vector logos can be drawn at full size; bitmaps are only ever shrunk.
    const scale = file.type === 'image/svg+xml'
      ? Math.min(MAX_WIDTH / w, MAX_HEIGHT / h)
      : Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
