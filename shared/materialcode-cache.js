(function (global) {
  const DB_NAME = "MTC_MATERIALCODE_CACHE_DB_V1";
  const STORE_NAME = "snapshots";
  const CATALOG_KEY = "MTC_SHARED_MATERIAL_CATALOG_V1";
  const LEGACY_CACHE_KEY = "MTC_MATERIALCODE_CACHE_V1";
  const API_STORAGE_KEY = "MTC_MATERIALCODE_GAS_URL";
  const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzGRpQ3sA_9Wpga7u2HwNI6rMU7VhlsFSVoE1V3Ppz0hB6I9-puoMi0MByy9m7e3xcjSg/exec";
  const FIXED_ASSET_CATALOG_KEY = "MTC_SHARED_FIXED_ASSET_CATALOG_V1";
  const FIXED_ASSET_API_STORAGE_KEY = "MTC_FIXED_ASSET_GAS_URL";
  const DEFAULT_FIXED_ASSET_API_URL = "https://script.google.com/macros/s/AKfycbwtezzQFRiqUdN6FrzJ1KF-3uN-AR8kNAG_vl3KnI5zcwm8ZXa7hgtEhEc-sJ8nNsf90w/exec";
  const CACHE_MAX_AGE = 15 * 60 * 1000;

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB tidak tersedia pada browser ini."));
        return;
      }

      const request = global.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        reject(request.error || new Error("Database cache browser tidak dapat dibuka."));
      };
    });
  }

  function readEntry(key) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(key);
        request.onsuccess = function () {
          database.close();
          resolve(request.result || null);
        };
        request.onerror = function () {
          database.close();
          reject(request.error || new Error("Cache katalog tidak dapat dibaca."));
        };
      });
    });
  }

  function writeEntry(entry) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(entry);
        transaction.oncomplete = function () {
          database.close();
          resolve();
        };
        transaction.onerror = function () {
          database.close();
          reject(transaction.error || new Error("Cache katalog tidak dapat disimpan."));
        };
        transaction.onabort = function () {
          database.close();
          reject(transaction.error || new Error("Penyimpanan cache katalog dibatalkan."));
        };
      });
    });
  }

  function deleteEntry(key) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(key);
        transaction.oncomplete = function () {
          database.close();
          resolve();
        };
        transaction.onerror = function () {
          database.close();
          reject(transaction.error || new Error("Cache lama tidak dapat dihapus."));
        };
      });
    });
  }

  function normalizeRecords(records) {
    return records.map(function (record) {
      const code = String(record.code == null ? record.bmc || "" : record.code).trim();
      const rowId = Number(record.rowId);
      return {
        code: code,
        bmc: code,
        rowId: Number.isInteger(rowId) && rowId >= 2 ? rowId : null,
        partNo: String(record.partNo || "").trim(),
        itemName: String(record.itemName || "").trim(),
        itemSize: String(record.itemSize || "").trim(),
        unit: String(record.unit || "").trim(),
        price: record.price == null ? "" : String(record.price)
      };
    }).filter(function (record) {
      return record.code || record.itemName;
    });
  }

  function makeSnapshot(records, source, updatedAt) {
    return {
      key: CATALOG_KEY,
      source: source,
      updatedAt: Number(updatedAt) || Date.now(),
      records: normalizeRecords(records)
    };
  }

  function legacySnapshotFromLocalStorage() {
    try {
      const snapshot = JSON.parse(global.localStorage.getItem(LEGACY_CACHE_KEY) || "null");
      if (!snapshot || !Array.isArray(snapshot.records)) return null;
      const updatedAt = Number(snapshot.updatedAt || snapshot.ts) || Date.parse(snapshot.savedAt) || 0;
      return makeSnapshot(snapshot.records, "materialcode", updatedAt);
    } catch (error) {
      console.warn("Cache lama MaterialCode tidak dapat dibaca.", error);
      return null;
    }
  }

  async function getSnapshot() {
    try {
      const sharedSnapshot = await readEntry(CATALOG_KEY);
      if (sharedSnapshot && Array.isArray(sharedSnapshot.records)) {
        try {
          await deleteEntry(LEGACY_CACHE_KEY);
        } catch (error) {
          console.warn("Cache lama MaterialCode di IndexedDB tidak dapat dihapus.", error);
        }
        try {
          global.localStorage.removeItem(LEGACY_CACHE_KEY);
        } catch (error) {
          console.warn("Cache lama MaterialCode di localStorage tidak dapat dihapus.", error);
        }
        return sharedSnapshot;
      }

      const legacyIndexedDbSnapshot = await readEntry(LEGACY_CACHE_KEY);
      if (legacyIndexedDbSnapshot && Array.isArray(legacyIndexedDbSnapshot.records)) {
        const migrated = makeSnapshot(
          legacyIndexedDbSnapshot.records,
          "materialcode",
          Number(legacyIndexedDbSnapshot.updatedAt) || Date.parse(legacyIndexedDbSnapshot.savedAt) || 0
        );
        await writeEntry(migrated);
        await deleteEntry(LEGACY_CACHE_KEY);
        try {
          global.localStorage.removeItem(LEGACY_CACHE_KEY);
        } catch (error) {
          console.warn("Cache lama MaterialCode di localStorage tidak dapat dihapus.", error);
        }
        return migrated;
      }

      const legacyLocalSnapshot = legacySnapshotFromLocalStorage();
      if (legacyLocalSnapshot) {
        await writeEntry(legacyLocalSnapshot);
        try {
          global.localStorage.removeItem(LEGACY_CACHE_KEY);
        } catch (error) {
          console.warn("Cache lama MaterialCode di localStorage tidak dapat dihapus.", error);
        }
        return legacyLocalSnapshot;
      }
      return null;
    } catch (error) {
      console.warn("Cache bersama MaterialCode tidak dapat dibaca dari IndexedDB.", error);
      const legacyLocalSnapshot = legacySnapshotFromLocalStorage();
      if (legacyLocalSnapshot) return legacyLocalSnapshot;
      throw error;
    }
  }

  async function saveMaterialCodeCatalog(records) {
    const snapshot = makeSnapshot(records, "materialcode", Date.now());
    await writeEntry(snapshot);
    try {
      await deleteEntry(LEGACY_CACHE_KEY);
    } catch (error) {
      console.warn("Cache lama MaterialCode di IndexedDB tidak dapat dihapus.", error);
    }
    try {
      global.localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch (error) {
      console.warn("Cache lama MaterialCode di localStorage tidak dapat dihapus.", error);
    }
    return snapshot;
  }

  async function seedCatalog(records, updatedAt) {
    const existing = await getSnapshot();
    if (existing) return existing;
    const snapshot = makeSnapshot(records, "legacy", updatedAt);
    await writeEntry(snapshot);
    return snapshot;
  }

  function getApiUrl() {
    try {
      const saved = (global.localStorage.getItem(API_STORAGE_KEY) || "").trim();
      if (saved) return saved;
    } catch (error) {
      console.warn("URL API MaterialCode di localStorage tidak dapat dibaca.", error);
    }
    return DEFAULT_API_URL;
  }

  async function loadCatalog(options) {
    const settings = options || {};
    let snapshot = await getSnapshot();
    if (!snapshot && Array.isArray(settings.fallbackRecords) && settings.fallbackRecords.length) {
      snapshot = await seedCatalog(settings.fallbackRecords, settings.fallbackUpdatedAt);
    }

    const isFresh = snapshot &&
      snapshot.source !== "legacy" &&
      Date.now() - Number(snapshot.updatedAt || 0) <= CACHE_MAX_AGE;
    if (snapshot && isFresh && !settings.forceRefresh) {
      return Object.assign({}, snapshot, { stale: false });
    }

    try {
      const response = await global.fetch(getApiUrl(), {
        method: "POST",
        mode: "cors",
        redirect: "follow",
        credentials: "omit",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "getData", forceRefresh: Boolean(settings.forceRefresh) })
      });
      if (!response.ok) throw new Error("GAS mengembalikan HTTP " + response.status + ".");
      const data = await response.json();
      if (data.status !== "success" || !Array.isArray(data.records)) {
        throw new Error(data.message || "Respons GAS tidak menyertakan daftar Material Code.");
      }
      return Object.assign(await saveMaterialCodeCatalog(data.records), { stale: false });
    } catch (error) {
      if (snapshot) return Object.assign({}, snapshot, { stale: true, error: error.message });
      throw error;
    }
  }

  function normalizeFixedAssetRecords(records) {
    return records.map(function (record) {
      const rowIndex = Number(record.rowIndex);
      return {
        rowIndex: Number.isInteger(rowIndex) && rowIndex >= 2 ? rowIndex : null,
        equipmentNo: String(record.equipmentNo || "").trim(),
        equipmentName: String(record.equipmentName || "").trim(),
        type: String(record.type || "").trim(),
        serialNo: String(record.serialNo || "").trim(),
        hm: record.hm == null ? "" : record.hm,
        lastServiceDate: String(record.lastServiceDate || "").trim(),
        lastOverhaulDate: String(record.lastOverhaulDate || "").trim()
      };
    }).filter(function (record) {
      return record.equipmentNo;
    });
  }

  function makeFixedAssetSnapshot(records, source, updatedAt) {
    return {
      key: FIXED_ASSET_CATALOG_KEY,
      source: source,
      updatedAt: Number(updatedAt) || Date.now(),
      records: normalizeFixedAssetRecords(records)
    };
  }

  async function getFixedAssetSnapshot() {
    const snapshot = await readEntry(FIXED_ASSET_CATALOG_KEY);
    return snapshot && Array.isArray(snapshot.records) ? snapshot : null;
  }

  async function saveFixedAssetCatalog(records) {
    const snapshot = makeFixedAssetSnapshot(records, "fixedasset", Date.now());
    await writeEntry(snapshot);
    return snapshot;
  }

  async function seedFixedAssetCatalog(records, updatedAt) {
    const existing = await getFixedAssetSnapshot();
    if (existing) return existing;
    const snapshot = makeFixedAssetSnapshot(records, "legacy", updatedAt);
    await writeEntry(snapshot);
    return snapshot;
  }

  function getFixedAssetApiUrl() {
    try {
      const saved = (global.localStorage.getItem(FIXED_ASSET_API_STORAGE_KEY) || "").trim();
      if (saved) return saved;
    } catch (error) {
      console.warn("URL API Fixed Asset di localStorage tidak dapat dibaca.", error);
    }
    return DEFAULT_FIXED_ASSET_API_URL;
  }

  async function loadFixedAssetCatalog(options) {
    const settings = options || {};
    let snapshot = await getFixedAssetSnapshot();
    if (!snapshot && Array.isArray(settings.fallbackRecords) && settings.fallbackRecords.length) {
      snapshot = await seedFixedAssetCatalog(settings.fallbackRecords, settings.fallbackUpdatedAt);
    }

    const isFresh = snapshot &&
      snapshot.source !== "legacy" &&
      Date.now() - Number(snapshot.updatedAt || 0) <= CACHE_MAX_AGE;
    if (snapshot && isFresh && !settings.forceRefresh) {
      return Object.assign({}, snapshot, { stale: false });
    }

    try {
      const response = await global.fetch(getFixedAssetApiUrl(), {
        method: "POST",
        mode: "cors",
        redirect: "follow",
        credentials: "omit",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "getData", forceRefresh: Boolean(settings.forceRefresh) })
      });
      if (!response.ok) throw new Error("GAS Fixed Asset mengembalikan HTTP " + response.status + ".");
      const data = await response.json();
      if (data.status !== "success" || !Array.isArray(data.records)) {
        throw new Error(data.message || "Respons GAS tidak menyertakan daftar Fixed Asset.");
      }
      return Object.assign(await saveFixedAssetCatalog(data.records), { stale: false });
    } catch (error) {
      if (snapshot) return Object.assign({}, snapshot, { stale: true, error: error.message });
      throw error;
    }
  }

  global.MTCMaterialCatalogCache = Object.freeze({
    getSnapshot: getSnapshot,
    loadCatalog: loadCatalog,
    saveMaterialCodeCatalog: saveMaterialCodeCatalog,
    seedCatalog: seedCatalog
  });
  global.MTCFixedAssetCatalogCache = Object.freeze({
    getSnapshot: getFixedAssetSnapshot,
    loadCatalog: loadFixedAssetCatalog,
    saveCatalog: saveFixedAssetCatalog,
    seedCatalog: seedFixedAssetCatalog
  });
})(window);
