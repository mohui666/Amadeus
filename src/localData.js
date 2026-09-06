// Android records belong to the app, independent of the configured service URL.
export function readLocalData(key) {
  const phone = globalThis.window?.AmadeusAndroid;
  if (phone) {
    const result = JSON.parse(phone.readRecord(key));
    if (result.error) throw new Error(result.error);
    if (result.value !== null) return result.value;
  }
  // Import existing WebView data on the first upgraded launch.
  return localStorage.getItem(`amadeus.${key}`);
}

export function writeLocalData(key, value) {
  const phone = globalThis.window?.AmadeusAndroid;
  if (phone) {
    const error = phone.writeRecord(key, value);
    if (error) throw new Error(error);
  } else localStorage.setItem(`amadeus.${key}`, value);
}
