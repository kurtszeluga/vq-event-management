const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GOOGLE_API_SCRIPT = 'https://apis.google.com/js/api.js';
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';

let apiScriptPromise;
let identityScriptPromise;
let pickerPromise;
let oauthToken = '';

export async function pickGoogleDriveFile({ mimeTypes }) {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (!apiKey || !clientId) {
    throw new Error('Google Drive Picker is not configured.');
  }

  await Promise.all([loadGoogleApi(), loadGoogleIdentity()]);
  await loadPicker();
  oauthToken = await getOAuthToken(clientId);

  return openPicker({ apiKey, mimeTypes });
}

function loadGoogleApi() {
  if (!apiScriptPromise) {
    apiScriptPromise = loadScript(GOOGLE_API_SCRIPT);
  }

  return apiScriptPromise;
}

function loadGoogleIdentity() {
  if (!identityScriptPromise) {
    identityScriptPromise = loadScript(GOOGLE_IDENTITY_SCRIPT);
  }

  return identityScriptPromise;
}

function loadPicker() {
  if (!pickerPromise) {
    pickerPromise = new Promise((resolve) => {
      window.gapi.load('picker', resolve);
    });
  }

  return pickerPromise;
}

function getOAuthToken(clientId) {
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        resolve(response.access_token);
      }
    });

    tokenClient.requestAccessToken({ prompt: oauthToken ? '' : 'consent' });
  });
}

function openPicker({ apiKey, mimeTypes }) {
  return new Promise((resolve, reject) => {
    const view = new window.google.picker.DocsView()
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);

    if (mimeTypes) {
      view.setMimeTypes(mimeTypes);
    }

    const picker = new window.google.picker.PickerBuilder()
      .setOAuthToken(oauthToken)
      .setDeveloperKey(apiKey)
      .setOrigin(window.location.origin)
      .addView(view)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.CANCEL) {
          resolve(null);
          return;
        }

        if (data.action !== window.google.picker.Action.PICKED) {
          return;
        }

        const doc = data.docs?.[0];

        if (!doc?.id) {
          reject(new Error('No Google Drive file was selected.'));
          return;
        }

        resolve({
          id: doc.id,
          mimeType: doc.mimeType || '',
          name: doc.name || '',
          url: doc.url || getDriveViewUrl(doc.id),
          imageUrl: getDriveImageUrl(doc.id)
        });
      })
      .build();

    picker.setVisible(true);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);

    if (existingScript) {
      if (existingScript.dataset.loaded === 'true') {
        resolve();
        return;
      }

      existingScript.addEventListener('load', resolve, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.append(script);
  });
}

function getDriveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function getDriveImageUrl(fileId) {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}
