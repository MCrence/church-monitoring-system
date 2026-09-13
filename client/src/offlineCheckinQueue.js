const DATABASE_NAME = 'church-monitoring-offline';
const STORE_NAME = 'pending-checkins';

function openQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueCheckin(checkin) {
  const database = await openQueue();
  // Check for an existing pending check-in for the same participant/event/location
  const records = await new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // Consider duplicates only for the same local date (one queue entry per day per event)
  const sameDayDuplicate = records.find((r) => {
    const samePayload = r.qrPayload === checkin.qrPayload;
    const sameEvent = (r.eventName || '') === (checkin.eventName || '');
    const sameLocation = (r.location || '') === (checkin.location || '');
    if (!(samePayload && sameEvent && sameLocation)) return false;
    const rDate = new Date(r.queuedAt);
    const now = new Date();
    return rDate.getFullYear() === now.getFullYear() && rDate.getMonth() === now.getMonth() && rDate.getDate() === now.getDate();
  });
  if (sameDayDuplicate) return false;
  await new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add({ ...checkin, queuedAt: Date.now() });
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  return true;
}

export async function syncQueuedCheckins(sendCheckin) {
  const database = await openQueue();
  const records = await new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const record of records.filter((item) => Date.now() - item.queuedAt <= 4 * 60 * 60 * 1000)) {
    await sendCheckin(record);
    database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(record.id);
  }
}