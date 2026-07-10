import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../lib/firebase.js';

export async function uploadEventFile(file, folder, userId) {
  if (!storage) {
    throw new Error('Firebase Storage is not configured.');
  }

  const cleanName = file.name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const path = `event-assets/${userId || 'admin'}/${folder}/${Date.now()}-${cleanName}`;
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, file, { contentType: file.type });

  return getDownloadURL(fileRef);
}
