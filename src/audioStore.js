import { phone } from './native.js';
import { fileDataUrl } from './api.js';

let database;
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('amadeus-audio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('replies', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

export async function readAudio(id) {
  if (phone) {
    const result = JSON.parse(phone.readRecord(`audio-${id}`));
    if (result.error) throw new Error(result.error);
    if (result.value === null) return null;
    const record = JSON.parse(result.value);
    record.segments = await Promise.all(record.segments.map(async ({ data, ...segment }) => ({ ...segment, blob: await (await fetch(data)).blob() })));
    return record;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('replies').objectStore('replies').get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAudio(record) {
  if (phone) {
    const segments = await Promise.all(record.segments.map(async ({ blob, ...segment }) => ({ ...segment, data: await fileDataUrl(blob) })));
    const error = phone.writeRecord(`audio-${record.id}`, JSON.stringify({ ...record, segments }));
    if (error) throw new Error(error);
    return;
  }
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('replies', 'readwrite');
    transaction.objectStore('replies').put(record);
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('语音保存被中断'));
    transaction.onerror = () => reject(transaction.error);
  });
}
