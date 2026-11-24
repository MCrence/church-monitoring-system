const DATABASE_NAME = "church-monitoring-offline";

export function clearPendingCheckins() {
  if (!("indexedDB" in window)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not clear offline check-in data"));
    request.onblocked = () => reject(new Error("Offline check-in data is still open in another tab"));
  });
}
