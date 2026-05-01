/**
 * Image compression utility
 * Compresses images client-side before upload to save storage and bandwidth
 * Works on both desktop and mobile browsers
 */

export interface CompressionOptions {
  maxWidth?: number;      // Max width in pixels (default: 1920)
  maxHeight?: number;     // Max height in pixels (default: 1920)
  quality?: number;       // JPEG quality 0-1 (default: 0.92)
  maxSizeMB?: number;     // Max file size in MB (default: 2)
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.92,
  maxSizeMB: 2
};

/**
 * Compress an image file
 * @param file - The image file to compress
 * @param options - Compression options
 * @returns Promise<File> - Compressed image file
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<File> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  console.log('[ImageCompression] Starting compression for:', file.name, 'size:', formatSize(file.size), 'type:', file.type);

  // Skip compression for small files (< 100KB) or non-images
  if (file.size < 100 * 1024 || !file.type.startsWith('image/')) {
    console.log('[ImageCompression] Skipping - small file or not an image');
    return file;
  }

  // Skip compression for GIFs (would lose animation)
  if (file.type === 'image/gif') {
    console.log('[ImageCompression] Skipping - GIF file');
    return file;
  }

  try {
    // Use createImageBitmap for better mobile support (handles EXIF orientation)
    let imageBitmap: ImageBitmap | null = null;
    let img: HTMLImageElement | null = null;
    let objectUrl: string | null = null;

    try {
      // Try createImageBitmap first (better for mobile, handles orientation)
      imageBitmap = await createImageBitmap(file);
      console.log('[ImageCompression] Created ImageBitmap:', imageBitmap.width, 'x', imageBitmap.height);
    } catch (e) {
      // Fallback to Image element
      console.log('[ImageCompression] ImageBitmap failed, using Image element fallback');
      img = await loadImage(file);
      console.log('[ImageCompression] Loaded Image:', img.width, 'x', img.height);
    }

    const sourceWidth = imageBitmap?.width || img?.width || 0;
    const sourceHeight = imageBitmap?.height || img?.height || 0;

    if (sourceWidth === 0 || sourceHeight === 0) {
      console.error('[ImageCompression] Invalid image dimensions');
      return file;
    }

    // Calculate new dimensions while maintaining aspect ratio
    let width = sourceWidth;
    let height = sourceHeight;

    if (width > opts.maxWidth) {
      height = (height * opts.maxWidth) / width;
      width = opts.maxWidth;
    }

    if (height > opts.maxHeight) {
      width = (width * opts.maxHeight) / height;
      height = opts.maxHeight;
    }

    width = Math.round(width);
    height = Math.round(height);

    console.log('[ImageCompression] Resizing to:', width, 'x', height);

    // Create canvas and draw
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[ImageCompression] Canvas context not available');
      return file;
    }

    // Draw white background (for transparency)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Draw image
    if (imageBitmap) {
      ctx.drawImage(imageBitmap, 0, 0, width, height);
      imageBitmap.close(); // Free memory
    } else if (img) {
      ctx.drawImage(img, 0, 0, width, height);
    }

    // Clean up object URL if we created one
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }

    // Compress with decreasing quality until target size
    const targetSize = opts.maxSizeMB * 1024 * 1024;
    let quality = opts.quality;
    let blob: Blob | null = null;

    while (quality >= 0.5) {
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      console.log('[ImageCompression] Compressed at quality', quality.toFixed(2), ':', formatSize(blob.size));

      if (blob.size <= targetSize || quality <= 0.5) {
        break;
      }
      quality -= 0.1;
    }

    if (!blob) {
      console.error('[ImageCompression] Failed to create blob');
      return file;
    }

    // Create new file
    const compressedFile = new File(
      [blob],
      file.name.replace(/\.[^.]+$/, '.jpg'),
      { type: 'image/jpeg', lastModified: Date.now() }
    );

    const savings = ((1 - compressedFile.size / file.size) * 100).toFixed(1);
    console.log(`[ImageCompression] Done: ${formatSize(file.size)} -> ${formatSize(compressedFile.size)} (${savings}% saved)`);

    return compressedFile;

  } catch (error) {
    console.error('[ImageCompression] Error:', error);
    // Return original file if compression fails
    return file;
  }
}

/**
 * Load image using Image element (fallback for older browsers)
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}

/**
 * Convert canvas to blob (Promise wrapper)
 */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob'));
        }
      },
      type,
      quality
    );
  });
}

/**
 * Compress multiple images
 */
export async function compressImages(
  files: File[],
  options: CompressionOptions = {}
): Promise<File[]> {
  return Promise.all(files.map(file => compressImage(file, options)));
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Check if image needs compression
 */
export function needsCompression(file: File, maxSizeMB: number = 1): boolean {
  return file.size > maxSizeMB * 1024 * 1024;
}
