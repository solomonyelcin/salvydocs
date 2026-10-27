// Public gallery settings. The API key is meant to be public, so restrict it in
// Google Cloud Console to the Google Drive API and to this site's address (see README.md).
window.GALLERY_CONFIG = {
  API_KEY: "AIzaSyA-3Tb3NCkz1Dx3mQQH_fwHRGoWjmj5L60",
  // The Drive folder shown to visitors (it must be shared as "Anyone with the link: Viewer").
  ROOT_FOLDER_ID: "1fS1Zb4O-uzd2o2h8aPFXNa6v01UQrwxg",
  ROOT_NAME: "Salvius Memories",
  PAGE_SIZE: 60,
  // Web address of the AI edit service (see worker/README.md). Leave empty to hide the Edit button.
  EDIT_API: ""
};
