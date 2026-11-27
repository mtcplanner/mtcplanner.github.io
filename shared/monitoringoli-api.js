window.MonitoringOliApi = (() => {
  const endpoint = "https://script.google.com/macros/s/AKfycbxDqN_3UoOxvyRGNo6iH795N9mxUtNB8mWpZfsMq-nrLekclAckAFBm3NTy9VCII736/exec";

  async function request(action, payload = {}) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, ...payload })
      });
    } catch (error) {
      throw new Error("Gagal terhubung ke server Monitoring Oli.");
    }

    if (!response.ok) {
      throw new Error(`Server Monitoring Oli merespons ${response.status}.`);
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("Respons server Monitoring Oli tidak valid.");
    }

    if (!result || result.success === false) {
      throw new Error(result && result.message ? result.message : "Permintaan Monitoring Oli gagal.");
    }
    return result;
  }

  return { request };
})();
