// data.worker.js
self.onmessage = async (e) => {
  const { url } = e.data;
  try {
    // Fix: Force absolute path resolution relative to the app origin
    const fullUrl = new URL(url, self.location.origin).href;
    const res = await fetch(fullUrl);
    
    if (res.status === 404) {
      self.postMessage({ url, data: { type: 'FeatureCollection', features: [] } });
      return;
    }
    const buf = await res.arrayBuffer();
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('windows-1252').decode(buf);
    }
    if (text.trimStart().startsWith('<')) {
      self.postMessage({ url, data: { type: 'FeatureCollection', features: [] } });
      return;
    }
    const json = JSON.parse(text);
    self.postMessage({ url, data: json });
  } catch (err) {
    self.postMessage({ url, error: err.message, data: { type: 'FeatureCollection', features: [] } });
  }
};