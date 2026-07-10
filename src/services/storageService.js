import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../lib/firebase.js';

const IMAGE_MAX_WIDTH = 1600;
const IMAGE_MAX_HEIGHT = 1200;
const IMAGE_MAX_BYTES = 1024 * 1024;
const PDF_MAX_BYTES = 10 * 1024 * 1024;

export async function uploadEventImage(file, userProfile) {
  if (!storage) {
    throw new Error('Firebase Storage is not configured.');
  }

  if (!file?.type?.startsWith('image/')) {
    throw new Error('Choose an image file.');
  }

  const resizedImage = await resizeImage(file);
  const path = getAssetPath('event-images', resizedImage.name, userProfile);
  const fileRef = ref(storage, path);
  const snapshot = await uploadBytes(fileRef, resizedImage.blob, {
    contentType: resizedImage.blob.type
  });

  return getDownloadURL(snapshot.ref);
}

export async function uploadEventPdf(file, userProfile) {
  if (!storage) {
    throw new Error('Firebase Storage is not configured.');
  }

  if (file?.type !== 'application/pdf') {
    throw new Error('Choose a PDF file.');
  }

  if (file.size > PDF_MAX_BYTES) {
    throw new Error('PDF files must be 10 MB or smaller.');
  }

  const path = getAssetPath('event-documents', file.name, userProfile);
  const fileRef = ref(storage, path);
  const snapshot = await uploadBytes(fileRef, file, {
    contentType: 'application/pdf'
  });

  return getDownloadURL(snapshot.ref);
}

export async function deleteEventFile(fileUrl) {
  if (!storage || !fileUrl) {
    return;
  }

  await deleteObject(ref(storage, fileUrl));
}

async function resizeImage(file) {
  const image = await decodeImage(file);
  const scale = Math.min(
    IMAGE_MAX_WIDTH / image.width,
    IMAGE_MAX_HEIGHT / image.height,
    1
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const context = canvas.getContext('2d');
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  image.close?.();

  for (let quality = 0.85; quality >= 0.55; quality -= 0.1) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);

    if (blob.size <= IMAGE_MAX_BYTES) {
      return {
        blob,
        name: `${stripExtension(file.name)}.jpg`
      };
    }
  }

  throw new Error('Image is too large. Choose a smaller image.');
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width
      };
    } catch {
      // Some mobile browsers do not decode every photo-library format here.
    }
  }

  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({
        close: () => URL.revokeObjectURL(imageUrl),
        height: image.naturalHeight,
        source: image,
        width: image.naturalWidth
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error('Image could not be opened. Choose a JPG, PNG, or WebP image.'));
    };
    image.src = imageUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Image could not be resized.'));
        }
      },
      type,
      quality
    );
  });
}

function getAssetPath(folder, fileName, userProfile) {
  const userId = userProfile?.userId || userProfile?.id;

  if (!userId) {
    throw new Error('Your admin profile is still loading. Try the upload again.');
  }

  const safeFileName = slugify(fileName);
  return `${folder}/${userId}/${Date.now()}-${safeFileName}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}
